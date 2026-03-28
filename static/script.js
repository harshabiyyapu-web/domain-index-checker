/**
 * Domain Index Checker v3 - Session-based, no caching
 * Features: Theme toggle, Bulk open, Colored buttons, Favorites, Session-based results
 */

document.addEventListener('DOMContentLoaded', () => {
    // Theme Toggle
    const themeToggle = document.getElementById('theme-toggle');
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);

    themeToggle?.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('theme', next);
    });

    // DOM Elements
    const domainsInput = document.getElementById('domains-input');
    const domainCount = document.getElementById('domain-count');
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

    const bulkActions = document.getElementById('bulk-actions');
    const bulkWaybackBtn = document.getElementById('bulk-wayback-btn');
    const bulkInfo = document.getElementById('bulk-info');

    const favoritesSection = document.getElementById('favorites-section');
    const favoritesList = document.getElementById('favorites-list');
    const favoritesCount = document.getElementById('favorites-count');
    const copyFavoritesBtn = document.getElementById('copy-favorites-btn');
    const clearFavoritesBtn = document.getElementById('clear-favorites-btn');

    const indexedSection = document.getElementById('indexed-section');
    const indexedList = document.getElementById('indexed-list');
    const indexedCount = document.getElementById('indexed-count');
    const copyIndexedBtn = document.getElementById('copy-indexed-btn');

    const notIndexedSection = document.getElementById('not-indexed-section');
    const notIndexedList = document.getElementById('not-indexed-list');
    const notIndexedCount = document.getElementById('not-indexed-count');
    const copyNotIndexedBtn = document.getElementById('copy-not-indexed-btn');

    const errorsCard = document.getElementById('errors-card');
    const errorsList = document.getElementById('errors-list');
    const errorsCount = document.getElementById('errors-count');

    const toast = document.getElementById('toast');

    let pollingInterval = null;
    let currentIndexedDomains = [];
    let bulkWaybackIndex = 0;

    // Incremental rendering counters — reset per search
    let renderedIndexedCount = 0;
    let renderedNotIndexedCount = 0;
    let renderedErrorsCount = 0;

    // Current active session ID — ensures we only display results from the active search
    let currentSessionId = null;

    // Not-indexed cache (so we don't need to re-fetch from server for copy)
    let currentNotIndexedDomains = [];

    let savedDomainsCache = [];

    async function fetchSavedDomains() {
        try {
            const res = await (await fetch('/api/saved_domains')).json();
            savedDomainsCache = res.saved || [];
            updateFavoritesUI();
        } catch (e) {
            console.error('Failed to load saved domains', e);
        }
    }

    async function addToFavorites(domain, count = 0) {
        if (!isFavorite(domain)) {
            savedDomainsCache.push({ domain, count });
            updateFavoritesUI();
            try {
                await fetch('/api/saved_domains/bulk', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ domains: [{ domain, count }] })
                });
                showToast(`Saved ${domain}`, 'success');
            } catch { showToast('Failed to save', 'error'); }
        }
    }

    async function removeFromFavorites(domain) {
        savedDomainsCache = savedDomainsCache.filter(f => f.domain !== domain);
        updateFavoritesUI();
        try {
            await fetch(`/api/saved_domains/${encodeURIComponent(domain)}`, { method: 'DELETE' });
            showToast(`Removed ${domain}`, 'success');
        } catch { showToast('Failed to remove', 'error'); }
    }

    function isFavorite(domain) {
        return savedDomainsCache.some(f => f.domain === domain);
    }

    function updateFavoritesUI() {
        const favorites = savedDomainsCache;
        favoritesCount.textContent = favorites.length;

        if (favorites.length > 0) {
            favoritesList.innerHTML = favorites.map((item, i) => createDomainItem(item.domain, item.count, i + 1, true)).join('');
            attachActions(favoritesList, true);
        } else {
            favoritesList.innerHTML = '<div class="empty-state">No saved domains yet</div>';
        }
    }

    fetchSavedDomains();

    // Domain count
    domainsInput?.addEventListener('input', () => {
        const count = domainsInput.value.split('\n').filter(d => d.trim()).length;
        domainCount.textContent = `${count} domain${count !== 1 ? 's' : ''}`;
    });

    clearBtn?.addEventListener('click', () => {
        domainsInput.value = '';
        domainCount.textContent = '0 domains';
    });

    clearFavoritesBtn?.addEventListener('click', async () => {
        if (confirm('Clear all saved domains?')) {
            for (const item of savedDomainsCache) {
                await fetch(`/api/saved_domains/${encodeURIComponent(item.domain)}`, { method: 'DELETE' });
            }
            savedDomainsCache = [];
            updateFavoritesUI();
            showToast('Cleared all saved list', 'success');
        }
    });

    // Check button
    checkBtn?.addEventListener('click', startCheck);

    async function startCheck() {
        const text = domainsInput.value.trim();
        if (!text) return showToast('Enter domains first', 'error');

        // Stop any existing polling from a previous search
        stopPolling();

        checkBtn.disabled = true;
        checkBtn.textContent = 'Processing...';
        bulkWaybackIndex = 0;

        // Fully clear all previous results from the UI
        resetResults();
        progressSection.style.display = 'block';
        indexedSection.style.display = 'block';
        notIndexedSection.style.display = 'block';

        try {
            const res = await fetch('/check', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ domains: text, delay: parseInt(delaySelect.value) })
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed');
            }

            const responseData = await res.json();

            // Store the session_id — only poll for THIS session
            currentSessionId = responseData.session_id;

            startPolling();
        } catch (e) {
            showToast(e.message, 'error');
            resetButton();
        }
    }

    function startPolling() {
        // Capture the session id at poll-start time
        const sessionId = currentSessionId;

        pollingInterval = setInterval(async () => {
            // If the session has changed (new search started), stop this poller
            if (sessionId !== currentSessionId) {
                clearInterval(pollingInterval);
                return;
            }

            try {
                const data = await (await fetch(`/progress?session_id=${encodeURIComponent(sessionId)}`)).json();

                // Double-check session hasn't changed while we were fetching
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
        if (pollingInterval) {
            clearInterval(pollingInterval);
            pollingInterval = null;
        }
    }

    function updateProgress(data) {
        const { total, completed, indexed, not_indexed, errors } = data;

        statTotal.textContent = total;
        statCompleted.textContent = completed;
        statIndexed.textContent = indexed.length;
        statNotIndexed.textContent = not_indexed.length;

        const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
        progressBar.style.width = `${pct}%`;
        progressBadge.textContent = `${pct}%`;

        indexedCount.textContent = indexed.length;
        notIndexedCount.textContent = not_indexed.length;
        errorsCount.textContent = errors.length;

        currentIndexedDomains = indexed;
        currentNotIndexedDomains = not_indexed;

        // Indexed list — append only new items
        if (indexed.length > renderedIndexedCount) {
            if (renderedIndexedCount === 0) indexedList.innerHTML = '';
            const newItems = indexed.slice(renderedIndexedCount);

            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = newItems.map((item, i) => createDomainItem(item.domain, item.count, renderedIndexedCount + i + 1, false)).join('');
            attachActions(tempDiv, false);

            while (tempDiv.firstChild) {
                indexedList.appendChild(tempDiv.firstChild);
            }

            renderedIndexedCount = indexed.length;
            bulkActions.style.display = 'block';
            updateBulkInfo();
        }

        // Not indexed list — append only new items
        if (not_indexed.length > renderedNotIndexedCount) {
            if (renderedNotIndexedCount === 0) notIndexedList.innerHTML = '';
            const newItems = not_indexed.slice(renderedNotIndexedCount);
            const html = newItems.map((d, i) => `
                <div class="domain-item">
                    <span class="domain-number">${renderedNotIndexedCount + i + 1}</span>
                    <div class="domain-info"><span class="domain-name">${esc(d)}</span></div>
                </div>
            `).join('');
            notIndexedList.insertAdjacentHTML('beforeend', html);
            renderedNotIndexedCount = not_indexed.length;
        }

        // Errors — append only new items
        if (errors.length > renderedErrorsCount) {
            if (renderedErrorsCount === 0) {
                errorsCard.style.display = 'block';
                errorsList.innerHTML = '';
            }
            const newItems = errors.slice(renderedErrorsCount);
            const html = newItems.map(e => `
                <div class="domain-item">
                    <span class="domain-name">${esc(e.domain)}</span>
                    <span class="error-message">${esc(e.error)}</span>
                </div>
            `).join('');
            errorsList.insertAdjacentHTML('beforeend', html);
            renderedErrorsCount = errors.length;
        }
    }

    function createDomainItem(domain, count, num, isFavSection) {
        const fav = isFavorite(domain);
        return `
            <div class="domain-item" data-domain="${esc(domain)}" data-count="${count}">
                <span class="domain-number">${num}</span>
                <div class="domain-info">
                    <span class="domain-name">${esc(domain)}</span>
                    ${count > 0 ? `<span class="domain-count">${count}</span>` : ''}
                </div>
                <div class="domain-actions">
                    <button class="action-btn google" title="Google site:">G</button>
                    <button class="action-btn wayback" title="Wayback">W</button>
                    <button class="action-btn ahrefs" title="Ahrefs">A</button>
                    <button class="action-btn favorite ${fav ? 'active' : ''}" title="Favorite">★</button>
                    <button class="action-btn open-all" title="Open All 3">ALL</button>
                    ${isFavSection ? '<button class="action-btn remove" title="Remove">✕</button>' : ''}
                </div>
            </div>
        `;
    }

    function attachActions(container, isFavSection) {
        container.querySelectorAll('.domain-item').forEach(item => {
            const domain = item.dataset.domain;
            const count = parseInt(item.dataset.count) || 0;

            item.querySelector('.google')?.addEventListener('click', () => openGoogle(domain));
            item.querySelector('.wayback')?.addEventListener('click', () => openWayback(domain));
            item.querySelector('.ahrefs')?.addEventListener('click', () => openAhrefs(domain));
            item.querySelector('.open-all')?.addEventListener('click', () => openAll(domain));

            item.querySelector('.favorite')?.addEventListener('click', (e) => {
                if (isFavorite(domain)) {
                    removeFromFavorites(domain);
                    e.target.classList.remove('active');
                } else {
                    addToFavorites(domain, count);
                    e.target.classList.add('active');
                }
            });

            item.querySelector('.remove')?.addEventListener('click', () => removeFromFavorites(domain));
        });
    }

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
        // Invalidate the current session so old pollers stop
        currentSessionId = null;

        // Reset all in-memory state
        currentIndexedDomains = [];
        currentNotIndexedDomains = [];
        renderedIndexedCount = 0;
        renderedNotIndexedCount = 0;
        renderedErrorsCount = 0;

        // Reset UI
        progressBar.style.width = '0%';
        progressBadge.textContent = '0%';
        progressBadge.classList.add('processing');
        ['stat-completed', 'stat-total', 'stat-indexed', 'stat-not-indexed'].forEach(id => {
            document.getElementById(id).textContent = '0';
        });
        indexedList.innerHTML = '<div class="empty-state">No indexed domains yet</div>';
        notIndexedList.innerHTML = '<div class="empty-state">No unindexed domains yet</div>';
        errorsList.innerHTML = '';
        errorsCard.style.display = 'none';
        bulkActions.style.display = 'none';

        // Hide result sections until new data comes in
        indexedSection.style.display = 'none';
        notIndexedSection.style.display = 'none';
    }

    // Bulk Wayback
    bulkWaybackBtn?.addEventListener('click', () => {
        const batch = currentIndexedDomains.slice(bulkWaybackIndex, bulkWaybackIndex + 5);
        batch.forEach(item => openWayback(item.domain));
        bulkWaybackIndex += 5;
        if (bulkWaybackIndex >= currentIndexedDomains.length) bulkWaybackIndex = 0;
        updateBulkInfo();
    });

    function updateBulkInfo() {
        const total = currentIndexedDomains.length;
        const start = bulkWaybackIndex + 1;
        const end = Math.min(bulkWaybackIndex + 5, total);
        bulkInfo.textContent = `Next: ${start}-${end} of ${total}`;
    }

    const saveAllIndexedBtn = document.getElementById('save-all-indexed-btn');

    saveAllIndexedBtn?.addEventListener('click', async () => {
        if (currentIndexedDomains.length === 0) return showToast('No domains to save', 'error');
        saveAllIndexedBtn.disabled = true;
        saveAllIndexedBtn.textContent = 'Saving...';
        try {
            await fetch('/api/saved_domains/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ domains: currentIndexedDomains })
            });
            showToast('Saved all indexed domains!', 'success');
            await fetchSavedDomains();
        } catch {
            showToast('Failed to save domains', 'error');
        } finally {
            saveAllIndexedBtn.disabled = false;
            saveAllIndexedBtn.textContent = 'Save All';
        }
    });

    // Copy functions — use local cached data, no extra API calls
    copyIndexedBtn?.addEventListener('click', () => copyList(currentIndexedDomains.map(d => d.domain)));
    copyNotIndexedBtn?.addEventListener('click', () => copyList(currentNotIndexedDomains));
    copyFavoritesBtn?.addEventListener('click', () => copyList(savedDomainsCache.map(f => f.domain)));

    async function copyList(domains) {
        if (!domains.length) return showToast('Nothing to copy', 'error');
        const text = domains.join('\n');
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
            } else {
                const textArea = document.createElement("textarea");
                textArea.value = text;
                textArea.style.position = "fixed";
                textArea.style.left = "-999999px";
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                document.execCommand('copy');
                textArea.remove();
            }
            showToast(`${domains.length} copied!`, 'success');
        } catch (err) {
            console.error(err);
            showToast('Failed to copy', 'error');
        }
    }

    // Utilities
    function esc(s) { return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

    function showToast(msg, type) {
        toast.querySelector('.toast-message').textContent = msg;
        toast.className = 'toast show' + (type === 'success' ? ' success' : '');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }
});

// Global functions
function openGoogle(d) { window.open(`https://www.google.com/search?q=site:${encodeURIComponent(d)}`, '_blank'); }
function openWayback(d) { window.open(`https://web.archive.org/web/*/http://www.${d.replace(/^https?:\/\//, '')}`, '_blank'); }
function openAhrefs(d) { window.open(`https://ahrefs.com/backlink-checker/?input=${encodeURIComponent(d)}&mode=subdomains`, '_blank'); }
function openAll(d) { openGoogle(d); openWayback(d); openAhrefs(d); }
