"""
Domain Index Checker - Check if domains are indexed in Google using ScrapingDog API
With API Key Management and Rotation Support
"""

from flask import Flask, render_template, request, jsonify
import requests
import time
import json
import os
import sqlite3
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

app = Flask(__name__)

DB_FILE = 'domains.db'

def init_db():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS saved_domains (
            domain TEXT PRIMARY KEY,
            count INTEGER
        )
    ''')
    conn.commit()
    conn.close()

init_db()

# API Keys storage file
API_KEYS_FILE = 'api_keys.json'

def load_api_keys():
    """Load API keys from file"""
    if os.path.exists(API_KEYS_FILE):
        try:
            with open(API_KEYS_FILE, 'r') as f:
                data = json.load(f)
                return data.get('keys', [])
        except:
            pass
    return []

def save_api_keys(keys):
    """Save API keys to file"""
    with open(API_KEYS_FILE, 'w') as f:
        json.dump({'keys': keys}, f, indent=2)

def get_current_api_key():
    """Get the current active API key (rotates on failure)"""
    keys = load_api_keys()
    if not keys:
        return None
    # Use the first key by default, rotation happens on failures
    return keys[0] if keys else None

# Serper.dev API Configuration
API_URL = "https://google.serper.dev/search"

# Thread-safe progress tracking
progress_lock = threading.Lock()
current_progress = {
    'total': 0,
    'completed': 0,
    'indexed': [],
    'not_indexed': [],
    'errors': [],
    'in_progress': False
}

# Track failed keys
failed_keys = set()
key_lock = threading.Lock()

def reset_progress():
    """Reset progress tracking"""
    global current_progress, failed_keys
    with progress_lock:
        current_progress = {
            'total': 0,
            'completed': 0,
            'indexed': [],
            'not_indexed': [],
            'errors': [],
            'in_progress': False
        }
    with key_lock:
        failed_keys = set()

def get_working_api_key():
    """Get a working API key that hasn't failed"""
    keys = load_api_keys()
    with key_lock:
        for key in keys:
            if key not in failed_keys:
                return key
    return None

def mark_key_failed(key):
    """Mark an API key as failed"""
    with key_lock:
        failed_keys.add(key)

def check_domain_index(domain):
    """
    Check if a domain is indexed in Google using site: search
    Returns: (domain, is_indexed, result_count, error)
    """
    domain = domain.strip().lower()
    if not domain:
        return None
    
    # Remove http/https if present
    domain = domain.replace('https://', '').replace('http://', '').rstrip('/')
    
    api_key = get_working_api_key()
    if not api_key:
        return (domain, None, 0, "No working API key available")
    
    headers = {
        'X-API-KEY': api_key,
        'Content-Type': 'application/json'
    }
    payload = {
        "q": f"site:{domain}"
    }
    
    try:
        response = requests.post(API_URL, headers=headers, json=payload, timeout=30)
        
        if response.status_code == 200:
            data = response.json()
            
            # Check for organic results
            organic_results = data.get('organic', [])
            result_count = len(organic_results)
            
            if result_count > 0:
                return (domain, True, result_count, None)
            else:
                return (domain, False, 0, None)
        elif response.status_code == 401 or response.status_code == 403:
            # API key exhausted or invalid
            mark_key_failed(api_key)
            # Try again with next key
            new_key = get_working_api_key()
            if new_key:
                headers['X-API-KEY'] = new_key
                response = requests.post(API_URL, headers=headers, json=payload, timeout=30)
                if response.status_code == 200:
                    data = response.json()
                    organic_results = data.get('organic', [])
                    result_count = len(organic_results)
                    if result_count > 0:
                        return (domain, True, result_count, None)
                    else:
                        return (domain, False, 0, None)
            return (domain, None, 0, f"API limit reached on all keys")
        elif response.status_code == 429:
             return (domain, None, 0, f"API Rate Limit (429 Too Many Requests)")
        else:
            return (domain, None, 0, f"API Error: {response.status_code}")
            
    except requests.exceptions.Timeout:
        return (domain, None, 0, "Request timeout")
    except requests.exceptions.RequestException as e:
        return (domain, None, 0, str(e))
    except Exception as e:
        return (domain, None, 0, str(e))

def process_domains(domains, batch_delay=10):
    """
    Process multiple domains concurrently in batches of 5
    """
    global current_progress
    
    reset_progress()
    
    # Clean and filter domains
    domains = [d.strip() for d in domains if d.strip()]
    
    with progress_lock:
        current_progress['total'] = len(domains)
        current_progress['in_progress'] = True
    
    results = []
    chunk_size = 5
    
    for i in range(0, len(domains), chunk_size):
        chunk = domains[i:i + chunk_size]
        start_time = time.time()
        
        with ThreadPoolExecutor(max_workers=chunk_size) as executor:
            future_to_domain = {executor.submit(check_domain_index, domain): domain for domain in chunk}
            
            for future in as_completed(future_to_domain):
                result = future.result()
                
                if result is None:
                    continue
                    
                domain, is_indexed, count, error = result
                
                with progress_lock:
                    current_progress['completed'] += 1
                    
                    if error:
                        current_progress['errors'].append({
                            'domain': domain,
                            'error': error
                        })
                    elif is_indexed:
                        current_progress['indexed'].append({
                            'domain': domain,
                            'count': count
                        })
                    else:
                        current_progress['not_indexed'].append(domain)
                
                results.append(result)
        
        # Determine how long to wait before processing the next chunk
        if i + chunk_size < len(domains):
            elapsed = time.time() - start_time
            sleep_time = max(0, batch_delay - elapsed)
            if sleep_time > 0:
                time.sleep(sleep_time)
    
    with progress_lock:
        current_progress['in_progress'] = False
    
    return results

@app.route('/')
def index():
    """Render the main page"""
    return render_template('index.html')

@app.route('/settings')
def settings():
    """Render the settings page"""
    return render_template('settings.html')

@app.route('/api/keys', methods=['GET'])
def get_keys():
    """Get all API keys (masked for security)"""
    keys = load_api_keys()
    # Mask keys for display
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
    """Add a new API key"""
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
    """Delete an API key"""
    keys = load_api_keys()
    if key in keys:
        keys.remove(key)
        save_api_keys(keys)
        return jsonify({'message': 'API key deleted successfully'})
    return jsonify({'error': 'API key not found'}), 404

@app.route('/api/saved_domains', methods=['GET'])
def get_saved_domains():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('SELECT domain, count FROM saved_domains ORDER BY domain ASC')
    rows = c.fetchall()
    conn.close()
    return jsonify({'saved': [{'domain': r[0], 'count': r[1]} for r in rows]})

@app.route('/api/saved_domains/bulk', methods=['POST'])
def save_domains_bulk():
    domains_data = request.json.get('domains', [])
    if not domains_data:
        return jsonify({'error': 'No domains provided'}), 400
        
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    
    added = 0
    for item in domains_data:
        domain = item.get('domain')
        count = item.get('count', 0)
        if domain:
            try:
                c.execute('INSERT OR IGNORE INTO saved_domains (domain, count) VALUES (?, ?)', (domain, count))
                if c.rowcount > 0:
                    added += 1
            except sqlite3.Error:
                pass
                
    conn.commit()
    conn.close()
    return jsonify({'message': f'Successfully saved {added} domains', 'added': added})

@app.route('/api/saved_domains/<path:domain>', methods=['DELETE'])
def delete_saved_domain(domain):
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('DELETE FROM saved_domains WHERE domain = ?', (domain,))
    deleted = c.rowcount
    conn.commit()
    conn.close()
    
    if deleted > 0:
        return jsonify({'message': 'Domain deleted'})
    return jsonify({'error': 'Domain not found'}), 404

@app.route('/check', methods=['POST'])
def check_domains():
    """API endpoint to check domains"""
    # Check if we have API keys
    keys = load_api_keys()
    if not keys:
        return jsonify({'error': 'No API keys configured. Please add API keys in Settings.'}), 400
    
    data = request.json
    domains_text = data.get('domains', '')
    batch_delay = data.get('delay', 10)
    
    # Parse domains from text
    domains = [d.strip() for d in domains_text.strip().split('\n') if d.strip()]
    
    if not domains:
        return jsonify({'error': 'No domains provided'}), 400
    
    # Start processing in background thread
    thread = threading.Thread(target=process_domains, args=(domains, batch_delay))
    thread.start()
    
    return jsonify({
        'message': 'Processing started',
        'total': len(domains)
    })

@app.route('/progress')
def get_progress():
    """Get current processing progress"""
    with progress_lock:
        return jsonify(current_progress)

if __name__ == '__main__':
    app.run(debug=True, port=5000)
