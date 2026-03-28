/**
 * Article Index Checker - Checkbox-based selection with domain grouping
 * Side-by-side indexed/not-indexed, per-domain checkboxes, global select buttons
 */

document.addEventListener('DOMContentLoaded', () => {
    // ─── Theme ───
    const themeToggle = document.getElementById('theme-toggle');
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);

    themeToggle?.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('theme', next);
    });

    // ─── DOM ───
    const urlsInput = document.getElementById('urls-input');
    const urlCount = document.getElementById('url-count');
    const clearBtn = document.getElementById('clear-btn');
    const checkBtn = document.getElementById('check-btn');
    const delaySelect = document.getElementById('delay');

    const progressSection = document.getElementById('progress-section');
    const progressBar = document.getElementById('progress-bar');
    const progressBadge = document.getElementById('progress-badge');
    const statCompleted = document.getElementById('stat-completed');
    const statTotal = document.getElementById('stat-total');
    const statIndexed = document.getElementById('stat-indexed');
    const statNotIndexed = document.getElementById('stat-not-indexed');

    const resultsSection = document.getElementById('results-section');
    const resultsContainer = document.getElementById('results-container');
    const copySelectedBtn = document.getElementById('copy-selected-btn');
    const selectedCountEl = document.getElementById('selected-count');
    const selectAllIndexedBtn = document.getElementById('select-all-indexed-btn');
    const selectAllNotIndexedBtn = document.getElementById('select-all-not-indexed-btn');
    const deselectAllBtn = document.getElementById('deselect-all-btn');

    const errorsCard = document.getElementById('errors-card');
    const errorsList = document.getElementById('errors-list');
    const errorsCount = document.getElementById('errors-count');

    const toast = document.getElementById('toast');

    // ─── State ───
    let pollingInterval = null;
    let currentSessionId = null;
    let domainOrder = [];
    let lastRenderedHash = '';

    // ─── URL count ───
    urlsInput?.addEventListener('input', () => {
        const count = urlsInput.value.split('\n').filter(d => d.trim()).length;
        urlCount.textContent = `${count} URL${count !== 1 ? 's' : ''}`;
    });

    clearBtn?.addEventListener('click', () => {
        urlsInput.value = '';
        urlCount.textContent = '0 URLs';
    });

    // ─── Check ───
    checkBtn?.addEventListener('click', startCheck);

    async function startCheck() {
        const text = urlsInput.value.trim();
        if (!text) return showToast('Enter URLs first', 'error');

        stopPolling();
        checkBtn.disabled = true;
        checkBtn.textContent = 'Processing...';
        resetResults();
        progressSection.style.display = 'block';

        try {
            const res = await fetch('/check', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ urls: text, delay: parseInt(delaySelect.value) })
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed');
            }

            const responseData = await res.json();
            currentSessionId = responseData.session_id;
            domainOrder = responseData.domain_order || [];
            startPolling();
        } catch (e) {
            showToast(e.message, 'error');
            resetButton();
        }
    }

    // ─── Polling ───
    function startPolling() {
        const sessionId = currentSessionId;
        pollingInterval = setInterval(async () => {
            if (sessionId !== currentSessionId) { clearInterval(pollingInterval); return; }
            try {
                const data = await (await fetch(`/progress?session_id=${encodeURIComponent(sessionId)}`)).json();
                if (sessionId !== currentSessionId) return;
                updateProgress(data);
                if (!data.in_progress && data.completed > 0) {
                    stopPolling();
                    finishProcessing();
                }
            } catch (e) { console.error(e); }
        }, 500);
    }

    function stopPolling() {
        if (pollingInterval) { clearInterval(pollingInterval); pollingInterval = null; }
    }

    // ─── Progress ───
    function updateProgress(data) {
        const { total, completed, indexed, not_indexed, errors, domain_order } = data;

        statTotal.textContent = total;
        statCompleted.textContent = completed;
        statIndexed.textContent = indexed.length;
        statNotIndexed.textContent = not_indexed.length;

        const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
        progressBar.style.width = `${pct}%`;
        progressBadge.textContent = `${pct}%`;

        if (domain_order && domain_order.length > 0) domainOrder = domain_order;

        const newHash = `${indexed.length}_${not_indexed.length}_${errors.length}`;
        if (newHash !== lastRenderedHash) {
            lastRenderedHash = newHash;
            renderGroupedResults(indexed, not_indexed);
        }

        if (errors.length > 0) {
            errorsCard.style.display = 'block';
            errorsCount.textContent = errors.length;
            errorsList.innerHTML = errors.map(e => `
                <div class="error-row">
                    <span class="error-url">${esc(e.url)}</span>
                    <span class="error-msg">${esc(e.error)}</span>
                </div>
            `).join('');
        }
    }

    // ─── Render Grouped Results ───
    function renderGroupedResults(indexed, not_indexed) {
        if (indexed.length === 0 && not_indexed.length === 0) return;
        resultsSection.style.display = 'block';

        // Save checked state
        const checkedUrls = new Set();
        resultsContainer.querySelectorAll('.url-checkbox:checked').forEach(cb => {
            checkedUrls.add(cb.dataset.url);
        });

        // Group by domain
        const groups = {};
        for (const d of domainOrder) groups[d] = { indexed: [], not_indexed: [] };
        for (const item of indexed) {
            if (!groups[item.domain]) groups[item.domain] = { indexed: [], not_indexed: [] };
            groups[item.domain].indexed.push(item);
        }
        for (const item of not_indexed) {
            if (!groups[item.domain]) groups[item.domain] = { indexed: [], not_indexed: [] };
            groups[item.domain].not_indexed.push(item);
        }

        let html = '';

        for (const domain of domainOrder) {
            const g = groups[domain];
            if (!g || (g.indexed.length === 0 && g.not_indexed.length === 0)) continue;

            html += `<div class="domain-group" data-domain="${esc(domain)}">`;

            // Domain header with checkboxes
            html += `<div class="domain-header">`;
            html += `<span class="dg-name">${esc(domain)}</span>`;
            html += `<div class="dg-controls">`;
            if (g.indexed.length > 0) {
                html += `<label class="dg-check indexed" title="Select all indexed for ${esc(domain)}">`;
                html += `<input type="checkbox" class="domain-indexed-check" data-domain="${esc(domain)}">`;
                html += `<span class="dg-badge indexed">✓ ${g.indexed.length} indexed</span>`;
                html += `</label>`;
            }
            if (g.not_indexed.length > 0) {
                html += `<label class="dg-check not-indexed" title="Select all not indexed for ${esc(domain)}">`;
                html += `<input type="checkbox" class="domain-not-indexed-check" data-domain="${esc(domain)}">`;
                html += `<span class="dg-badge not-indexed">✗ ${g.not_indexed.length} not indexed</span>`;
                html += `</label>`;
            }
            html += `</div>`;
            html += `</div>`;

            // Side-by-side columns
            html += `<div class="domain-columns">`;

            // Indexed column
            html += `<div class="column indexed-col">`;
            if (g.indexed.length > 0) {
                html += `<div class="col-header indexed">✓ Indexed</div>`;
                for (const item of g.indexed) {
                    const checked = checkedUrls.has(item.url) ? ' checked' : '';
                    html += `<div class="url-row">`;
                    html += `<label class="url-label">`;
                    html += `<input type="checkbox" class="url-checkbox" data-url="${esc(item.url)}" data-domain="${esc(domain)}" data-type="indexed"${checked}>`;
                    html += `<span class="url-text">${esc(item.url)}</span>`;
                    html += `</label>`;
                    html += `<button class="row-btn-g" title="Search in Google" data-url="${esc(item.url)}">G</button>`;
                    html += `</div>`;
                }
            } else {
                html += `<div class="col-header indexed">✓ Indexed</div>`;
                html += `<div class="col-empty">No indexed URLs</div>`;
            }
            html += `</div>`;

            // Not Indexed column
            html += `<div class="column not-indexed-col">`;
            if (g.not_indexed.length > 0) {
                html += `<div class="col-header not-indexed">✗ Not Indexed</div>`;
                for (const item of g.not_indexed) {
                    const checked = checkedUrls.has(item.url) ? ' checked' : '';
                    html += `<div class="url-row">`;
                    html += `<label class="url-label">`;
                    html += `<input type="checkbox" class="url-checkbox" data-url="${esc(item.url)}" data-domain="${esc(domain)}" data-type="not-indexed"${checked}>`;
                    html += `<span class="url-text">${esc(item.url)}</span>`;
                    html += `</label>`;
                    html += `<button class="row-btn-g" title="Search in Google" data-url="${esc(item.url)}">G</button>`;
                    html += `</div>`;
                }
            } else {
                html += `<div class="col-header not-indexed">✗ Not Indexed</div>`;
                html += `<div class="col-empty">All URLs indexed</div>`;
            }
            html += `</div>`;

            html += `</div>`; // domain-columns
            html += `</div>`; // domain-group
        }

        resultsContainer.innerHTML = html;
        attachEvents();
        updateSelectedCount();
    }

    // ─── Event Listeners ───
    function attachEvents() {
        // Domain-level indexed checkboxes
        resultsContainer.querySelectorAll('.domain-indexed-check').forEach(cb => {
            cb.addEventListener('change', () => {
                const domain = cb.dataset.domain;
                const checked = cb.checked;
                resultsContainer.querySelectorAll(`.url-checkbox[data-domain="${domain}"][data-type="indexed"]`).forEach(c => {
                    c.checked = checked;
                });
                updateSelectedCount();
            });
        });

        // Domain-level not-indexed checkboxes
        resultsContainer.querySelectorAll('.domain-not-indexed-check').forEach(cb => {
            cb.addEventListener('change', () => {
                const domain = cb.dataset.domain;
                const checked = cb.checked;
                resultsContainer.querySelectorAll(`.url-checkbox[data-domain="${domain}"][data-type="not-indexed"]`).forEach(c => {
                    c.checked = checked;
                });
                updateSelectedCount();
            });
        });

        // Individual URL checkboxes
        resultsContainer.querySelectorAll('.url-checkbox').forEach(cb => {
            cb.addEventListener('change', () => {
                updateSelectedCount();
                // Update domain-level checkbox state
                syncDomainCheckbox(cb.dataset.domain, cb.dataset.type);
            });
        });

        // Google buttons
        resultsContainer.querySelectorAll('.row-btn-g').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const url = btn.dataset.url;
                const clean = url.replace('https://', '').replace('http://', '');
                window.open(`https://www.google.com/search?q=site:${encodeURIComponent(clean)}`, '_blank');
            });
        });
    }

    function syncDomainCheckbox(domain, type) {
        const allCbs = resultsContainer.querySelectorAll(`.url-checkbox[data-domain="${domain}"][data-type="${type}"]`);
        const allChecked = Array.from(allCbs).every(c => c.checked);
        const selector = type === 'indexed' ? '.domain-indexed-check' : '.domain-not-indexed-check';
        const domainCb = resultsContainer.querySelector(`${selector}[data-domain="${domain}"]`);
        if (domainCb) domainCb.checked = allChecked;
    }

    // ─── Global Select Buttons ───
    selectAllIndexedBtn?.addEventListener('click', () => {
        resultsContainer.querySelectorAll('.url-checkbox[data-type="indexed"]').forEach(c => c.checked = true);
        resultsContainer.querySelectorAll('.domain-indexed-check').forEach(c => c.checked = true);
        updateSelectedCount();
        showToast('All indexed URLs selected', 'success');
    });

    selectAllNotIndexedBtn?.addEventListener('click', () => {
        resultsContainer.querySelectorAll('.url-checkbox[data-type="not-indexed"]').forEach(c => c.checked = true);
        resultsContainer.querySelectorAll('.domain-not-indexed-check').forEach(c => c.checked = true);
        updateSelectedCount();
        showToast('All not-indexed URLs selected', 'success');
    });

    deselectAllBtn?.addEventListener('click', () => {
        resultsContainer.querySelectorAll('.url-checkbox').forEach(c => c.checked = false);
        resultsContainer.querySelectorAll('.domain-indexed-check, .domain-not-indexed-check').forEach(c => c.checked = false);
        updateSelectedCount();
    });

    // ─── Copy ───
    copySelectedBtn?.addEventListener('click', copySelectedUrls);

    // Ctrl+C
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
            const selected = resultsContainer.querySelectorAll('.url-checkbox:checked');
            if (selected.length > 0 && document.activeElement !== urlsInput) {
                e.preventDefault();
                copySelectedUrls();
            }
        }
    });

    function copySelectedUrls() {
        const checked = resultsContainer.querySelectorAll('.url-checkbox:checked');
        if (checked.length === 0) return showToast('Select URLs first', 'error');

        const urls = Array.from(checked).map(cb => {
            let url = cb.dataset.url;
            if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url;
            return url;
        });

        copyToClipboard(urls.join('\n')).then(() => {
            showToast(`${urls.length} URL${urls.length > 1 ? 's' : ''} copied!`, 'success');
        }).catch(() => {
            showToast('Failed to copy', 'error');
        });
    }

    function updateSelectedCount() {
        const count = resultsContainer.querySelectorAll('.url-checkbox:checked').length;
        selectedCountEl.textContent = count;
    }

    async function copyToClipboard(text) {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
        } else {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.left = '-999999px';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            document.execCommand('copy');
            ta.remove();
        }
    }

    // ─── Finish / Reset ───
    function finishProcessing() {
        progressBadge.textContent = 'Done';
        progressBadge.classList.remove('processing');
        showToast('Check complete!', 'success');
        resetButton();
    }

    function resetButton() {
        checkBtn.disabled = false;
        checkBtn.textContent = 'Check Indexation';
    }

    function resetResults() {
        currentSessionId = null;
        domainOrder = [];
        lastRenderedHash = '';

        progressBar.style.width = '0%';
        progressBadge.textContent = '0%';
        progressBadge.classList.add('processing');
        ['stat-completed', 'stat-total', 'stat-indexed', 'stat-not-indexed'].forEach(id => {
            document.getElementById(id).textContent = '0';
        });

        resultsContainer.innerHTML = '';
        resultsSection.style.display = 'none';
        errorsCard.style.display = 'none';
        errorsList.innerHTML = '';
        selectedCountEl.textContent = '0';
    }

    // ─── Utilities ───
    function esc(s) {
        return s.replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    function showToast(msg, type) {
        toast.querySelector('.toast-message').textContent = msg;
        toast.className = 'toast show' + (type === 'success' ? ' success' : '');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }
});
