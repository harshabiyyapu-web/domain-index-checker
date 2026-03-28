"""
Article Index Checker - Check if article URLs are indexed in Google using Serper.dev API
With API Key Management, Rotation Support, and Domain Grouping
"""

from flask import Flask, render_template, request, jsonify
import requests
import time
import json
import os
import uuid
from urllib.parse import urlparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

app = Flask(__name__)

# API Keys storage file
API_KEYS_FILE = 'api_keys.json'


def load_api_keys():
    if os.path.exists(API_KEYS_FILE):
        try:
            with open(API_KEYS_FILE, 'r') as f:
                data = json.load(f)
                return data.get('keys', [])
        except:
            pass
    return []


def save_api_keys(keys):
    with open(API_KEYS_FILE, 'w') as f:
        json.dump({'keys': keys}, f, indent=2)


# Serper.dev API
API_URL = "https://google.serper.dev/search"

# Session-based tracking
sessions_lock = threading.Lock()
sessions = {}
session_failed_keys = {}
key_lock = threading.Lock()
active_session_id = None
active_session_lock = threading.Lock()


def create_session():
    global active_session_id
    session_id = str(uuid.uuid4())
    with sessions_lock:
        sessions[session_id] = {
            'total': 0,
            'completed': 0,
            'indexed': [],
            'not_indexed': [],
            'errors': [],
            'in_progress': False,
            'domain_order': [],
        }
    with key_lock:
        session_failed_keys[session_id] = set()
    with active_session_lock:
        active_session_id = session_id
    return session_id


def get_session(session_id):
    with sessions_lock:
        return sessions.get(session_id)


def cleanup_old_sessions(keep_id):
    with sessions_lock:
        to_remove = [sid for sid in sessions if sid != keep_id]
        for sid in to_remove:
            del sessions[sid]
    with key_lock:
        to_remove = [sid for sid in session_failed_keys if sid != keep_id]
        for sid in to_remove:
            del session_failed_keys[sid]


def get_working_api_key(session_id):
    keys = load_api_keys()
    with key_lock:
        failed = session_failed_keys.get(session_id, set())
        for key in keys:
            if key not in failed:
                return key
    return None


def mark_key_failed(session_id, key):
    with key_lock:
        if session_id not in session_failed_keys:
            session_failed_keys[session_id] = set()
        session_failed_keys[session_id].add(key)


def is_session_active(session_id):
    with active_session_lock:
        return active_session_id == session_id


def normalize_url(url):
    """Normalize URL - ensure it has https:// prefix"""
    url = url.strip()
    if not url:
        return url
    if not url.startswith(('http://', 'https://')):
        url = 'https://' + url
    return url


def extract_domain(url):
    """Extract domain from a URL"""
    try:
        parsed = urlparse(url)
        return parsed.netloc or parsed.path.split('/')[0]
    except:
        return url


def check_url_index(url, session_id):
    """
    Check if a URL is indexed in Google using site: search.
    Cascades through ALL available API keys on error before giving up.
    Returns: (url, domain, is_indexed, result_count, error)
    """
    if not url:
        return None

    if not is_session_active(session_id):
        return None

    normalized = normalize_url(url)
    domain = extract_domain(normalized)

    # Build the site: query with the full path
    clean = normalized.replace('https://', '').replace('http://', '').rstrip('/')
    payload = {"q": f"site:{clean}"}

    while True:
        api_key = get_working_api_key(session_id)
        if not api_key:
            return (normalized, domain, None, 0, "All API keys exhausted or failed")

        headers = {
            'X-API-KEY': api_key,
            'Content-Type': 'application/json'
        }

        try:
            response = requests.post(API_URL, headers=headers, json=payload, timeout=30)

            if response.status_code == 200:
                data = response.json()
                organic_results = data.get('organic', [])
                result_count = len(organic_results)
                if result_count > 0:
                    return (normalized, domain, True, result_count, None)
                else:
                    return (normalized, domain, False, 0, None)

            elif response.status_code in (401, 403, 429):
                mark_key_failed(session_id, api_key)
                continue

            else:
                mark_key_failed(session_id, api_key)
                continue

        except requests.exceptions.Timeout:
            return (normalized, domain, None, 0, "Request timeout")
        except requests.exceptions.RequestException as e:
            return (normalized, domain, None, 0, str(e))
        except Exception as e:
            return (normalized, domain, None, 0, str(e))


def process_urls(urls, batch_delay, session_id, domain_order):
    """Process URLs in batches of 5"""
    session = get_session(session_id)
    if not session:
        return

    with sessions_lock:
        session['total'] = len(urls)
        session['in_progress'] = True
        session['domain_order'] = domain_order

    chunk_size = 5

    for i in range(0, len(urls), chunk_size):
        if not is_session_active(session_id):
            with sessions_lock:
                if session_id in sessions:
                    sessions[session_id]['in_progress'] = False
            return

        chunk = urls[i:i + chunk_size]
        start_time = time.time()

        with ThreadPoolExecutor(max_workers=chunk_size) as executor:
            future_to_url = {
                executor.submit(check_url_index, url, session_id): url
                for url in chunk
            }

            for future in as_completed(future_to_url):
                result = future.result()
                if result is None:
                    continue

                url, domain, is_indexed, count, error = result

                with sessions_lock:
                    prog = sessions.get(session_id)
                    if not prog:
                        return
                    prog['completed'] += 1

                    if error:
                        prog['errors'].append({
                            'url': url,
                            'domain': domain,
                            'error': error
                        })
                    elif is_indexed:
                        prog['indexed'].append({
                            'url': url,
                            'domain': domain,
                            'count': count
                        })
                    else:
                        prog['not_indexed'].append({
                            'url': url,
                            'domain': domain
                        })

        if i + chunk_size < len(urls) and is_session_active(session_id):
            elapsed = time.time() - start_time
            sleep_time = max(0, batch_delay - elapsed)
            if sleep_time > 0:
                time.sleep(sleep_time)

    with sessions_lock:
        if session_id in sessions:
            sessions[session_id]['in_progress'] = False


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/settings')
def settings():
    return render_template('settings.html')


@app.route('/api/keys', methods=['GET'])
def get_keys():
    keys = load_api_keys()
    masked_keys = []
    for key in keys:
        if len(key) > 8:
            masked = key[:4] + '*' * (len(key) - 8) + key[-4:]
        else:
            masked = '*' * len(key)
        masked_keys.append({'key': key, 'masked': masked})
    return jsonify({'keys': masked_keys})


@app.route('/api/keys', methods=['POST'])
def add_key():
    data = request.json
    key = data.get('key', '').strip()
    if not key:
        return jsonify({'error': 'API key is required'}), 400
    keys = load_api_keys()
    if key in keys:
        return jsonify({'error': 'API key already exists'}), 400
    keys.append(key)
    save_api_keys(keys)
    return jsonify({'message': 'API key added successfully'})


@app.route('/api/keys/<key>', methods=['DELETE'])
def delete_key(key):
    keys = load_api_keys()
    if key in keys:
        keys.remove(key)
        save_api_keys(keys)
        return jsonify({'message': 'API key deleted successfully'})
    return jsonify({'error': 'API key not found'}), 404


@app.route('/check', methods=['POST'])
def check_urls_endpoint():
    keys = load_api_keys()
    if not keys:
        return jsonify({'error': 'No API keys configured. Please add API keys in Settings.'}), 400

    data = request.json
    urls_text = data.get('urls', '')
    batch_delay = data.get('delay', 10)

    urls = [u.strip() for u in urls_text.strip().split('\n') if u.strip()]
    if not urls:
        return jsonify({'error': 'No URLs provided'}), 400

    # Normalize and compute domain order (first appearance)
    normalized_urls = []
    domain_order = []
    seen_domains = set()
    for u in urls:
        nu = normalize_url(u)
        normalized_urls.append(nu)
        d = extract_domain(nu)
        if d not in seen_domains:
            seen_domains.add(d)
            domain_order.append(d)

    session_id = create_session()
    cleanup_old_sessions(session_id)

    thread = threading.Thread(
        target=process_urls,
        args=(normalized_urls, batch_delay, session_id, domain_order)
    )
    thread.daemon = True
    thread.start()

    return jsonify({
        'message': 'Processing started',
        'total': len(normalized_urls),
        'session_id': session_id,
        'domain_order': domain_order
    })


@app.route('/progress')
def get_progress():
    session_id = request.args.get('session_id')
    if not session_id:
        return jsonify({
            'total': 0, 'completed': 0,
            'indexed': [], 'not_indexed': [], 'errors': [],
            'in_progress': False, 'domain_order': []
        })

    session = get_session(session_id)
    if not session:
        return jsonify({
            'total': 0, 'completed': 0,
            'indexed': [], 'not_indexed': [], 'errors': [],
            'in_progress': False, 'domain_order': []
        })

    with sessions_lock:
        return jsonify(dict(session))


if __name__ == '__main__':
    app.run(debug=True, port=5000)
