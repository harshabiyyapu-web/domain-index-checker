/**
 * Domain Index Checker v2 - Enhanced JavaScript
 * Features: Theme toggle, Bulk open, Colored buttons, Favorites
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
    const workersSelect = document.getElementById('workers');

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

    // Favorites
    const FAVORITES_KEY = 'domain_checker_favorites';

    function getFavorites() {
        try {
            return JSON.parse(localStorage.getItem(FAVORITES_KEY)) || [];
        } catch { return []; }
    }

    function saveFavorites(favorites) {
        localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
        updateFavoritesUI();
    }

    function addToFavorites(domain, count = 0) {
        const favorites = getFavorites();
        if (!favorites.some(f => f.domain === domain)) {
            favorites.push({ domain, count });
            saveFavorites(favorites);
            showToast(`Added to favorites`, 'success');
        }
    }

    function removeFromFavorites(domain) {
        saveFavorites(getFavorites().filter(f => f.domain !== domain));
        showToast(`Removed from favorites`, 'success');
    }

    function isFavorite(domain) {
        return getFavorites().some(f => f.domain === domain);
    }

    function updateFavoritesUI() {
        const favorites = getFavorites();
        favoritesCount.textContent = favorites.length;

        if (favorites.length > 0) {
            favoritesSection.style.display = 'block';
            favoritesList.innerHTML = favorites.map((item, i) => createDomainItem(item.domain, item.count, i + 1, true)).join('');
            attachActions(favoritesList, true);
        } else {
            favoritesSection.style.display = 'none';
        }
    }

    updateFavoritesUI();

    // Domain count
    domainsInput?.addEventListener('input', () => {
        const count = domainsInput.value.split('\n').filter(d => d.trim()).length;
        domainCount.textContent = `${count} domain${count !== 1 ? 's' : ''}`;
    });

    clearBtn?.addEventListener('click', () => {
        domainsInput.value = '';
        domainCount.textContent = '0 domains';
    });

    clearFavoritesBtn?.addEventListener('click', () => {
        if (confirm('Clear all favorites?')) saveFavorites([]);
    });

    // Check button
    checkBtn?.addEventListener('click', startCheck);

    async function startCheck() {
        const text = domainsInput.value.trim();
        if (!text) return showToast('Enter domains first', 'error');

        checkBtn.disabled = true;
        checkBtn.textContent = 'Processing...';
        bulkWaybackIndex = 0;

        resetResults();
        progressSection.style.display = 'block';
        indexedSection.style.display = 'block';
        notIndexedSection.style.display = 'block';

        try {
            const res = await fetch('/check', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ domains: text, max_workers: parseInt(workersSelect.value) })
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed');
            }

            startPolling();
        } catch (e) {
            showToast(e.message, 'error');
            resetButton();
        }
    }

    function startPolling() {
        pollingInterval = setInterval(async () => {
            try {
                const data = await (await fetch('/progress')).json();
                updateProgress(data);
                if (!data.in_progress && data.completed > 0) {
                    stopPolling();
                    finishProcessing();
                }
            } catch (e) { console.error(e); }
        }, 500);
    }

    function stopPolling() {
        clearInterval(pollingInterval);
        pollingInterval = null;
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

        // Indexed list
        if (indexed.length > 0) {
            indexedList.innerHTML = indexed.map((item, i) => createDomainItem(item.domain, item.count, i + 1, false)).join('');
            attachActions(indexedList, false);
            bulkActions.style.display = 'block';
            updateBulkInfo();
        } else {
            indexedList.innerHTML = '<div class="empty-state">No indexed domains yet</div>';
        }

        // Not indexed list
        if (not_indexed.length > 0) {
            notIndexedList.innerHTML = not_indexed.map((d, i) => `
                <div class="domain-item">
                    <span class="domain-number">${i + 1}</span>
                    <div class="domain-info"><span class="domain-name">${esc(d)}</span></div>
                </div>
            `).join('');
        } else {
            notIndexedList.innerHTML = '<div class="empty-state">No unindexed domains yet</div>';
        }

        // Errors
        if (errors.length > 0) {
            errorsCard.style.display = 'block';
            errorsList.innerHTML = errors.map(e => `
                <div class="domain-item">
                    <span class="domain-name">${esc(e.domain)}</span>
                    <span class="error-message">${esc(e.error)}</span>
                </div>
            `).join('');
        } else {
            errorsCard.style.display = 'none';
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
        progressBar.style.width = '0%';
        progressBadge.textContent = '0%';
        progressBadge.classList.add('processing');
        ['stat-completed', 'stat-total', 'stat-indexed', 'stat-not-indexed'].forEach(id => {
            document.getElementById(id).textContent = '0';
        });
        indexedList.innerHTML = '<div class="empty-state">No indexed domains yet</div>';
        notIndexedList.innerHTML = '<div class="empty-state">No unindexed domains yet</div>';
        errorsCard.style.display = 'none';
        bulkActions.style.display = 'none';
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

    // Copy functions
    copyIndexedBtn?.addEventListener('click', () => copyList(currentIndexedDomains.map(d => d.domain)));
    copyNotIndexedBtn?.addEventListener('click', async () => {
        const data = await (await fetch('/progress')).json();
        copyList(data.not_indexed);
    });
    copyFavoritesBtn?.addEventListener('click', () => copyList(getFavorites().map(f => f.domain)));

    function copyList(domains) {
        if (!domains.length) return showToast('Nothing to copy', 'error');
        navigator.clipboard.writeText(domains.join('\n'));
        showToast(`${domains.length} copied!`, 'success');
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
