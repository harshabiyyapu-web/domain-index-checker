/**
 * Domain Index Checker - Frontend JavaScript
 * Features: Domain checking, Google/Wayback buttons, Favorites with localStorage
 */

document.addEventListener('DOMContentLoaded', () => {
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

    const favoritesSection = document.getElementById('favorites-section');
    const favoritesList = document.getElementById('favorites-list');
    const favoritesCount = document.getElementById('favorites-count');
    const copyFavoritesBtn = document.getElementById('copy-favorites-btn');
    const clearFavoritesBtn = document.getElementById('clear-favorites-btn');

    const resultsSection = document.getElementById('results-section');
    const indexedList = document.getElementById('indexed-list');
    const notIndexedList = document.getElementById('not-indexed-list');
    const indexedCount = document.getElementById('indexed-count');
    const notIndexedCount = document.getElementById('not-indexed-count');

    const errorsCard = document.getElementById('errors-card');
    const errorsList = document.getElementById('errors-list');
    const errorsCount = document.getElementById('errors-count');

    const copyIndexedBtn = document.getElementById('copy-indexed-btn');
    const copyNotIndexedBtn = document.getElementById('copy-not-indexed-btn');

    const toast = document.getElementById('toast');

    let pollingInterval = null;
    let isProcessing = false;

    // Favorites storage
    const FAVORITES_KEY = 'domain_checker_favorites';

    function getFavorites() {
        try {
            const saved = localStorage.getItem(FAVORITES_KEY);
            return saved ? JSON.parse(saved) : [];
        } catch {
            return [];
        }
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
            showToast(`Added "${domain}" to favorites`, 'success');
        }
    }

    function removeFromFavorites(domain) {
        let favorites = getFavorites();
        favorites = favorites.filter(f => f.domain !== domain);
        saveFavorites(favorites);
        showToast(`Removed "${domain}" from favorites`, 'success');
    }

    function isFavorite(domain) {
        return getFavorites().some(f => f.domain === domain);
    }

    function updateFavoritesUI() {
        const favorites = getFavorites();
        favoritesCount.textContent = favorites.length;

        if (favorites.length > 0) {
            favoritesSection.style.display = 'block';
            favoritesList.innerHTML = favorites.map((item, index) => createFavoriteDomainItem(item, index + 1)).join('');
            attachFavoriteActions();
        } else {
            favoritesSection.style.display = 'none';
            favoritesList.innerHTML = '<div class="empty-state">No favorite domains yet</div>';
        }
    }

    function createFavoriteDomainItem(item, number) {
        return `
            <div class="domain-item" data-domain="${escapeHtml(item.domain)}">
                <span class="domain-number">${number}</span>
                <div class="domain-info">
                    <span class="domain-name">${escapeHtml(item.domain)}</span>
                    ${item.count > 0 ? `<span class="domain-count">${item.count} result${item.count !== 1 ? 's' : ''}</span>` : ''}
                </div>
                <div class="domain-actions">
                    <button class="action-btn google" onclick="openGoogleSearch('${escapeHtml(item.domain)}')" title="Search site: on Google">
                        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/>
                            <path d="M16 16L20 20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                        </svg>
                    </button>
                    <button class="action-btn wayback" onclick="openWaybackMachine('${escapeHtml(item.domain)}')" title="Check Wayback Machine">
                        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
                            <path d="M12 6V12L16 14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                        </svg>
                    </button>
                    <button class="action-btn ahrefs" onclick="openAhrefs('${escapeHtml(item.domain)}')" title="Check Ahrefs Backlinks">
                        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M13 10V3L4 14h7v7l9-11h-7z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                    <button class="action-btn remove" data-domain="${escapeHtml(item.domain)}" title="Remove from favorites">
                        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    }

    function attachFavoriteActions() {
        document.querySelectorAll('.favorites-section .action-btn.remove').forEach(btn => {
            btn.onclick = () => removeFromFavorites(btn.dataset.domain);
        });
    }

    // Initialize favorites on load
    updateFavoritesUI();

    // Update domain count on input
    domainsInput.addEventListener('input', updateDomainCount);

    function updateDomainCount() {
        const domains = domainsInput.value.split('\n').filter(d => d.trim());
        domainCount.textContent = `${domains.length} domain${domains.length !== 1 ? 's' : ''}`;
    }

    // Clear button
    clearBtn.addEventListener('click', () => {
        domainsInput.value = '';
        updateDomainCount();
        domainsInput.focus();
    });

    // Clear favorites button
    clearFavoritesBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all favorites?')) {
            saveFavorites([]);
            showToast('All favorites cleared', 'success');
        }
    });

    // Check button
    checkBtn.addEventListener('click', startCheck);

    async function startCheck() {
        const domainsText = domainsInput.value.trim();

        if (!domainsText) {
            showToast('Please enter at least one domain', 'error');
            return;
        }

        const domains = domainsText.split('\n').filter(d => d.trim());

        if (domains.length === 0) {
            showToast('Please enter at least one domain', 'error');
            return;
        }

        // Disable button and show processing state
        checkBtn.disabled = true;
        checkBtn.innerHTML = `
            <span class="btn-icon">
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" class="spin">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" stroke-dasharray="40" stroke-dashoffset="10"/>
                </svg>
            </span>
            Processing...
        `;
        isProcessing = true;

        // Reset results
        resetResults();

        // Show progress section
        progressSection.style.display = 'block';
        resultsSection.style.display = 'grid';

        // Scroll to progress
        progressSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

        try {
            const response = await fetch('/check', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    domains: domainsText,
                    max_workers: parseInt(workersSelect.value)
                })
            });

            if (!response.ok) {
                throw new Error('Failed to start processing');
            }

            // Start polling for progress
            startPolling();

        } catch (error) {
            showToast('Error starting check: ' + error.message, 'error');
            resetButton();
        }
    }

    function startPolling() {
        pollingInterval = setInterval(async () => {
            try {
                const response = await fetch('/progress');
                const data = await response.json();

                updateProgress(data);

                if (!data.in_progress && data.completed > 0) {
                    stopPolling();
                    finishProcessing();
                }
            } catch (error) {
                console.error('Polling error:', error);
            }
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

        // Update stats
        statTotal.textContent = total;
        statCompleted.textContent = completed;
        statIndexed.textContent = indexed.length;
        statNotIndexed.textContent = not_indexed.length;

        // Update progress bar
        const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
        progressBar.style.width = `${percent}%`;
        progressBadge.textContent = `${percent}%`;

        // Update counts
        indexedCount.textContent = indexed.length;
        notIndexedCount.textContent = not_indexed.length;
        errorsCount.textContent = errors.length;

        // Update indexed list with numbering, buttons, and favorites
        if (indexed.length > 0) {
            indexedList.innerHTML = indexed.map((item, index) => createIndexedDomainItem(item, index + 1)).join('');
            attachIndexedActions();
        } else {
            indexedList.innerHTML = '<div class="empty-state">No indexed domains found yet</div>';
        }

        // Update not indexed list
        if (not_indexed.length > 0) {
            notIndexedList.innerHTML = not_indexed.map((domain, index) => `
                <div class="domain-item">
                    <span class="domain-number">${index + 1}</span>
                    <div class="domain-info">
                        <span class="domain-name">${escapeHtml(domain)}</span>
                    </div>
                </div>
            `).join('');
        } else {
            notIndexedList.innerHTML = '<div class="empty-state">No unindexed domains found yet</div>';
        }

        // Update errors
        if (errors.length > 0) {
            errorsCard.style.display = 'block';
            errorsList.innerHTML = errors.map(item => `
                <div class="domain-item">
                    <span class="domain-name">${escapeHtml(item.domain)}</span>
                    <span class="error-message">${escapeHtml(item.error)}</span>
                </div>
            `).join('');
        } else {
            errorsCard.style.display = 'none';
        }
    }

    function createIndexedDomainItem(item, number) {
        const isFav = isFavorite(item.domain);
        return `
            <div class="domain-item" data-domain="${escapeHtml(item.domain)}" data-count="${item.count}">
                <span class="domain-number">${number}</span>
                <div class="domain-info">
                    <span class="domain-name">${escapeHtml(item.domain)}</span>
                    <span class="domain-count">${item.count} result${item.count !== 1 ? 's' : ''}</span>
                </div>
                <div class="domain-actions">
                    <button class="action-btn google" onclick="openGoogleSearch('${escapeHtml(item.domain)}')" title="Search site: on Google">
                        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/>
                            <path d="M16 16L20 20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                        </svg>
                    </button>
                    <button class="action-btn wayback" onclick="openWaybackMachine('${escapeHtml(item.domain)}')" title="Check Wayback Machine">
                        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
                            <path d="M12 6V12L16 14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                        </svg>
                    </button>
                    <button class="action-btn ahrefs" onclick="openAhrefs('${escapeHtml(item.domain)}')" title="Check Ahrefs Backlinks">
                        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M13 10V3L4 14h7v7l9-11h-7z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                    <button class="action-btn favorite ${isFav ? 'active' : ''}" data-domain="${escapeHtml(item.domain)}" data-count="${item.count}" title="${isFav ? 'Remove from favorites' : 'Add to favorites'}">
                        <svg viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    }

    function attachIndexedActions() {
        document.querySelectorAll('#indexed-list .action-btn.favorite').forEach(btn => {
            btn.onclick = () => {
                const domain = btn.dataset.domain;
                const count = parseInt(btn.dataset.count) || 0;
                if (isFavorite(domain)) {
                    removeFromFavorites(domain);
                    btn.classList.remove('active');
                    btn.querySelector('svg').setAttribute('fill', 'none');
                    btn.title = 'Add to favorites';
                } else {
                    addToFavorites(domain, count);
                    btn.classList.add('active');
                    btn.querySelector('svg').setAttribute('fill', 'currentColor');
                    btn.title = 'Remove from favorites';
                }
            };
        });
    }

    function finishProcessing() {
        isProcessing = false;
        progressBadge.textContent = 'Complete';
        progressBadge.classList.remove('processing');
        showToast('All domains checked successfully!', 'success');
        resetButton();
    }

    function resetButton() {
        checkBtn.disabled = false;
        checkBtn.innerHTML = `
            <span class="btn-icon">
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M21 21L16.65 16.65M19 11C19 15.4183 15.4183 19 11 19C6.58172 19 3 15.4183 3 11C3 6.58172 6.58172 3 11 3C15.4183 3 19 6.58172 19 11Z" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
            </span>
            Check Indexation
        `;
    }

    function resetResults() {
        progressBar.style.width = '0%';
        progressBadge.textContent = '0%';
        progressBadge.classList.add('processing');
        statCompleted.textContent = '0';
        statTotal.textContent = '0';
        statIndexed.textContent = '0';
        statNotIndexed.textContent = '0';
        indexedCount.textContent = '0';
        notIndexedCount.textContent = '0';
        errorsCount.textContent = '0';
        indexedList.innerHTML = '<div class="empty-state">No indexed domains found yet</div>';
        notIndexedList.innerHTML = '<div class="empty-state">No unindexed domains found yet</div>';
        errorsCard.style.display = 'none';
        errorsList.innerHTML = '';
    }

    // Copy functionality
    copyIndexedBtn.addEventListener('click', () => {
        copyDomainList('indexed');
    });

    copyNotIndexedBtn.addEventListener('click', () => {
        copyDomainList('not-indexed');
    });

    copyFavoritesBtn.addEventListener('click', () => {
        const favorites = getFavorites();
        if (favorites.length === 0) {
            showToast('No favorites to copy', 'error');
            return;
        }
        const text = favorites.map(f => f.domain).join('\n');
        navigator.clipboard.writeText(text);
        showToast(`${favorites.length} favorite${favorites.length !== 1 ? 's' : ''} copied to clipboard!`, 'success');
    });

    async function copyDomainList(type) {
        try {
            const response = await fetch('/progress');
            const data = await response.json();

            let domains = [];
            if (type === 'indexed') {
                domains = data.indexed.map(item => item.domain);
            } else {
                domains = data.not_indexed;
            }

            if (domains.length === 0) {
                showToast('No domains to copy', 'error');
                return;
            }

            const text = domains.join('\n');
            await navigator.clipboard.writeText(text);
            showToast(`${domains.length} domain${domains.length !== 1 ? 's' : ''} copied to clipboard!`, 'success');
        } catch (error) {
            showToast('Failed to copy: ' + error.message, 'error');
        }
    }

    // Toast notification
    function showToast(message, type = 'info') {
        toast.querySelector('.toast-message').textContent = message;
        toast.className = 'toast show';
        if (type === 'success') {
            toast.classList.add('success');
        }

        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }

    // Utility function to escape HTML
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Add spinning animation for loading icon
    const style = document.createElement('style');
    style.textContent = `
        .spin {
            animation: spin 1s linear infinite;
        }
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
    `;
    document.head.appendChild(style);
});

// Global functions for onclick handlers
function openGoogleSearch(domain) {
    window.open(`https://www.google.com/search?q=site:${encodeURIComponent(domain)}`, '_blank');
}

function openWaybackMachine(domain) {
    // Remove any protocol if present
    domain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    window.open(`https://web.archive.org/web/*/http://www.${domain}`, '_blank');
}

function openAhrefs(domain) {
    // Remove any protocol if present
    domain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    window.open(`https://ahrefs.com/backlink-checker/?input=${encodeURIComponent(domain)}&mode=subdomains`, '_blank');
}
