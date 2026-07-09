/* =============================================
   search.js — Live typeahead search overlay.

   Progressive enhancement over the sidebar's plain
   <a href="/search"> link: if this script fails to
   load, the link still works as a normal page.

   Triggers: sidebar search link click, Cmd/Ctrl+K,
   and "/" when not typing in an input.
   ============================================= */
(function () {
    'use strict';

    var DEBOUNCE_MS = 250;
    var MIN_CHARS = 2;
    var LIMIT = 8;

    var TYPE_META = {
        post:       { label: 'Posts',    icon: 'fa-meteor' },
        review:     { label: 'Reviews',  icon: 'fa-star-half-stroke' },
        video:      { label: 'Videos',   icon: 'fa-photo-film' },
        music_item: { label: 'Music',    icon: 'fa-compact-disc' },
        project:    { label: 'Projects', icon: 'fa-sun' }
    };
    var TYPE_ORDER = ['post', 'review', 'video', 'music_item', 'project'];

    var backdrop, input, resultsList, statusEl, viewAllLink;
    var trigger = null;          // element that opened the overlay (focus return)
    var abortController = null;  // in-flight request cancellation
    var debounceTimer = null;
    var items = [];              // flat list of result <a> elements
    var activeIndex = -1;

    /* ── DOM construction ─────────────────────────────────────────────── */

    function buildOverlay() {
        backdrop = document.createElement('div');
        backdrop.className = 'search-overlay-backdrop';
        backdrop.innerHTML =
            '<div class="search-overlay" role="dialog" aria-modal="true" aria-label="Site search">' +
            '  <div class="search-overlay-inputwrap">' +
            '    <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>' +
            '    <input type="text" class="search-overlay-input" placeholder="Scan the Neurascape…"' +
            '           role="combobox" aria-expanded="false" aria-autocomplete="list"' +
            '           aria-controls="search-overlay-results" autocomplete="off" spellcheck="false">' +
            '    <span class="search-overlay-hint" aria-hidden="true">esc</span>' +
            '  </div>' +
            '  <ul class="search-overlay-results" id="search-overlay-results" role="listbox"></ul>' +
            '  <div class="search-overlay-status" hidden></div>' +
            '  <div class="search-overlay-footer" hidden>' +
            '    <a href="/search">View all results →</a>' +
            '  </div>' +
            '</div>';
        document.body.appendChild(backdrop);

        input = backdrop.querySelector('.search-overlay-input');
        resultsList = backdrop.querySelector('.search-overlay-results');
        statusEl = backdrop.querySelector('.search-overlay-status');
        viewAllLink = backdrop.querySelector('.search-overlay-footer a');

        input.addEventListener('input', onInput);
        input.addEventListener('keydown', onKeydown);

        // Click-outside closes (mousedown so text-selection drags don't close).
        backdrop.addEventListener('mousedown', function (e) {
            if (e.target === backdrop) close();
        });

        // Focus trap: Tab cycles between the input and the View-all link.
        backdrop.addEventListener('keydown', function (e) {
            if (e.key !== 'Tab') return;
            var focusables = [input];
            if (!backdrop.querySelector('.search-overlay-footer').hidden) {
                focusables.push(viewAllLink);
            }
            var idx = focusables.indexOf(document.activeElement);
            e.preventDefault();
            var next = e.shiftKey ? idx - 1 : idx + 1;
            if (next < 0) next = focusables.length - 1;
            if (next >= focusables.length) next = 0;
            focusables[next].focus();
        });
    }

    /* ── Open / close ─────────────────────────────────────────────────── */

    function open(fromEl) {
        if (!backdrop) buildOverlay();
        trigger = fromEl || document.activeElement;
        backdrop.classList.add('open');
        input.value = '';
        clearResults();
        showStatus('Type at least ' + MIN_CHARS + ' characters to scan…');
        input.focus();
    }

    function close() {
        if (!backdrop) return;
        backdrop.classList.remove('open');
        if (abortController) abortController.abort();
        if (debounceTimer) clearTimeout(debounceTimer);
        // Return focus to whatever opened the overlay (a11y).
        if (trigger && typeof trigger.focus === 'function') trigger.focus();
        trigger = null;
    }

    function isOpen() {
        return backdrop && backdrop.classList.contains('open');
    }

    /* ── Rendering (textContent only — never innerHTML for API data, with
          the single exception of the snippet field, which the server
          guarantees is escaped apart from its own <mark> tags) ─────────── */

    function clearResults() {
        resultsList.innerHTML = '';
        backdrop.querySelector('.search-overlay-footer').hidden = true;
        items = [];
        activeIndex = -1;
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
    }

    function showStatus(msg) {
        statusEl.textContent = msg;
        statusEl.hidden = false;
    }

    function hideStatus() {
        statusEl.hidden = true;
    }

    function render(data) {
        clearResults();
        hideStatus();

        if (!data.results || data.results.length === 0) {
            showStatus('Nothing matched “' + data.query + '” in the Neurascape.');
            return;
        }

        // Group results by type, in a stable order.
        var groups = {};
        data.results.forEach(function (r) {
            (groups[r.type] = groups[r.type] || []).push(r);
        });

        var idCounter = 0;
        TYPE_ORDER.forEach(function (type) {
            if (!groups[type]) return;
            var meta = TYPE_META[type];

            var groupLi = document.createElement('li');
            groupLi.className = 'search-overlay-group';
            groupLi.setAttribute('role', 'presentation');
            groupLi.textContent = meta.label;
            resultsList.appendChild(groupLi);

            groups[type].forEach(function (r) {
                var li = document.createElement('li');
                li.setAttribute('role', 'presentation');

                var a = document.createElement('a');
                a.className = 'search-overlay-item';
                a.id = 'search-overlay-item-' + (idCounter++);
                a.setAttribute('role', 'option');
                a.setAttribute('aria-selected', 'false');
                a.href = r.url;

                var icon = document.createElement('i');
                icon.className = 'fa-solid ' + meta.icon;
                icon.setAttribute('aria-hidden', 'true');
                a.appendChild(icon);
                a.appendChild(document.createTextNode(r.title));

                if (r.meta) {
                    var metaSpan = document.createElement('span');
                    metaSpan.className = 'item-meta';
                    metaSpan.textContent = r.meta;
                    a.appendChild(metaSpan);
                }

                a.addEventListener('mousemove', function () {
                    setActive(items.indexOf(a));
                });

                li.appendChild(a);
                resultsList.appendChild(li);
                items.push(a);
            });
        });

        viewAllLink.href = '/search?q=' + encodeURIComponent(input.value.trim());
        backdrop.querySelector('.search-overlay-footer').hidden = false;
        input.setAttribute('aria-expanded', 'true');
        setActive(0);
    }

    function setActive(index) {
        if (index < 0 || index >= items.length) return;
        if (activeIndex >= 0 && items[activeIndex]) {
            items[activeIndex].classList.remove('active');
            items[activeIndex].setAttribute('aria-selected', 'false');
        }
        activeIndex = index;
        var el = items[activeIndex];
        el.classList.add('active');
        el.setAttribute('aria-selected', 'true');
        input.setAttribute('aria-activedescendant', el.id);
        el.scrollIntoView({ block: 'nearest' });
    }

    /* ── Fetching ─────────────────────────────────────────────────────── */

    function onInput() {
        if (debounceTimer) clearTimeout(debounceTimer);
        var q = input.value.trim();
        if (q.length < MIN_CHARS) {
            if (abortController) abortController.abort();
            clearResults();
            showStatus('Type at least ' + MIN_CHARS + ' characters to scan…');
            return;
        }
        debounceTimer = setTimeout(function () { doSearch(q); }, DEBOUNCE_MS);
    }

    function doSearch(q) {
        if (abortController) abortController.abort();
        abortController = new AbortController();
        showStatus('Scanning…');

        fetch('/api/search?q=' + encodeURIComponent(q) + '&limit=' + LIMIT, {
            signal: abortController.signal,
            headers: { 'Accept': 'application/json' }
        })
            .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            })
            .then(function (data) {
                // Ignore stale responses typed past.
                if (input.value.trim() !== q) return;
                render(data);
            })
            .catch(function (err) {
                if (err.name === 'AbortError') return;
                clearResults();
                showStatus('Search hit a snag — try again.');
            });
    }

    /* ── Keyboard handling ────────────────────────────────────────────── */

    function onKeydown(e) {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive(Math.min(activeIndex + 1, items.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive(Math.max(activeIndex - 1, 0));
        } else if (e.key === 'Enter') {
            if (activeIndex >= 0 && items[activeIndex]) {
                e.preventDefault();
                window.location.href = items[activeIndex].href;
            } else if (input.value.trim().length >= MIN_CHARS) {
                e.preventDefault();
                window.location.href = '/search?q=' + encodeURIComponent(input.value.trim());
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            close();
        }
    }

    /* ── Global triggers ──────────────────────────────────────────────── */

    document.addEventListener('keydown', function (e) {
        // Cmd/Ctrl+K — anywhere.
        if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
            e.preventDefault();
            isOpen() ? close() : open();
            return;
        }
        // "/" — only when not typing in a field.
        if (e.key === '/' && !isOpen()) {
            var t = e.target;
            var typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
                               t.tagName === 'SELECT' || t.isContentEditable);
            if (!typing) {
                e.preventDefault();
                open();
            }
            return;
        }
        if (e.key === 'Escape' && isOpen()) close();
    });

    // Sidebar link + top-right corner button: intercept click to open the
    // overlay instead of navigating. Without JS both fall through to /search
    // as plain links (progressive enhancement).
    document.addEventListener('DOMContentLoaded', function () {
        ['search-nav-link', 'search-corner-btn'].forEach(function (id) {
            var link = document.getElementById(id);
            if (link) {
                link.addEventListener('click', function (e) {
                    e.preventDefault();
                    open(link);
                });
            }
        });
    });
})();
