/**
 * main.js — App initialization: sidebar, animation toggle, infinite scroll.
 * Background animation is handled by neurascape-bg.js (loaded separately).
 */
document.addEventListener('DOMContentLoaded', function() {

    // ── Sidebar ─────────────────────────────────────────
    (function initSidebar() {
        var sidebar = document.getElementById('sidebar');
        var sidebarToggle = document.getElementById('sidebar-toggle');
        if (!sidebar || !sidebarToggle) return;

        sidebarToggle.style.zIndex = '10000';
        sidebarToggle.style.pointerEvents = 'auto';

        if (sidebarToggle.getAttribute('data-listener-attached') !== 'true') {
            var newToggle = sidebarToggle.cloneNode(true);
            if (sidebarToggle.parentNode) {
                sidebarToggle.parentNode.replaceChild(newToggle, sidebarToggle);
            }
            newToggle.setAttribute('data-listener-attached', 'true');

            newToggle.onclick = function(event) {
                event.stopPropagation();
                event.preventDefault();
                var sidebarElem = document.getElementById('sidebar');
                if (!sidebarElem) return false;

                var isOpen = sidebarElem.classList.toggle('open');
                document.body.classList.toggle('sidebar-open', isOpen);
                this.classList.toggle('active', isOpen);
                this.innerHTML = isOpen
                    ? '<i class="fa-solid fa-xmark"></i>'
                    : '<i class="fa-solid fa-bars"></i>';

                // Accessibility: update ARIA + manage tab order
                this.setAttribute('aria-expanded', isOpen.toString());
                this.setAttribute('aria-label', isOpen ? 'Close navigation menu' : 'Open navigation menu');
                sidebarElem.setAttribute('aria-hidden', (!isOpen).toString());
                var links = sidebarElem.querySelectorAll('a');
                for (var li = 0; li < links.length; li++) {
                    links[li].setAttribute('tabindex', isOpen ? '0' : '-1');
                }
                // Focus first link when opening
                if (isOpen && links.length) links[0].focus();
                return false;
            };
        }

        // Close sidebar helper (shared by click-outside and Escape)
        function closeSidebar() {
            var sb = document.getElementById('sidebar');
            var tog = document.getElementById('sidebar-toggle');
            if (!sb || !tog || !sb.classList.contains('open')) return;
            sb.classList.remove('open');
            document.body.classList.remove('sidebar-open');
            tog.classList.remove('active');
            tog.innerHTML = '<i class="fa-solid fa-bars"></i>';
            tog.setAttribute('aria-expanded', 'false');
            tog.setAttribute('aria-label', 'Open navigation menu');
            sb.setAttribute('aria-hidden', 'true');
            var links = sb.querySelectorAll('a');
            for (var li = 0; li < links.length; li++) {
                links[li].setAttribute('tabindex', '-1');
            }
        }

        document.addEventListener('click', function(e) {
            var sb = document.getElementById('sidebar');
            var tog = document.getElementById('sidebar-toggle');
            if (sb && tog && sb.classList.contains('open') &&
                !sb.contains(e.target) && e.target !== tog && !tog.contains(e.target) &&
                !e.target.closest('#animation-toggle')) {
                closeSidebar();
            }
        });

        // Escape key closes sidebar
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                var sb = document.getElementById('sidebar');
                if (sb && sb.classList.contains('open')) {
                    closeSidebar();
                    var tog = document.getElementById('sidebar-toggle');
                    if (tog) tog.focus(); // Return focus to toggle button
                }
            }
        });

        // Initialize: set tabindex=-1 on all sidebar links (sidebar starts closed)
        var sidebarLinks = sidebar.querySelectorAll('a');
        for (var si = 0; si < sidebarLinks.length; si++) {
            sidebarLinks[si].setAttribute('tabindex', '-1');
        }
    })();

    // ── Animation toggle ────────────────────────────────
    (function initAnimationToggle() {
        var animToggle = document.getElementById('animation-toggle');
        if (!animToggle) return;

        var toggleIcon = document.getElementById('animation-toggle-icon') || animToggle.querySelector('i');
        var stored = localStorage.getItem('animationsEnabled');
        var enabled = stored !== 'false';
        window.isAnimationPaused = !enabled;

        if (toggleIcon) toggleIcon.className = enabled ? 'fa-solid fa-pause' : 'fa-solid fa-play';
        animToggle.setAttribute('aria-checked', enabled.toString());
        animToggle.setAttribute('title', enabled ? 'Pause background animation' : 'Resume background animation');

        var canvas = document.getElementById('bg-canvas');
        if (canvas && window.isAnimationPaused) canvas.style.opacity = '0.2';

        animToggle.onclick = function(e) {
            e.stopPropagation();
            e.preventDefault();

            var wasEnabled = this.getAttribute('aria-checked') === 'true';
            var nowEnabled = !wasEnabled;

            localStorage.setItem('animationsEnabled', nowEnabled.toString());
            window.isAnimationPaused = !nowEnabled;

            this.setAttribute('aria-checked', nowEnabled.toString());
            if (toggleIcon) toggleIcon.className = nowEnabled ? 'fa-solid fa-pause' : 'fa-solid fa-play';
            this.setAttribute('title', nowEnabled ? 'Pause background animation' : 'Resume background animation');

            var bgCanvas = document.getElementById('bg-canvas');
            if (bgCanvas) bgCanvas.style.opacity = nowEnabled ? '1' : '0.2';

            document.dispatchEvent(new CustomEvent('animationToggled', {
                detail: { enabled: nowEnabled }
            }));
            return false;
        };
    })();

    // ── Background animation (delegated to neurascape-bg.js) ──
    if (window.NeurascapeBG) {
        var bgCanvas = document.getElementById('bg-canvas');
        if (bgCanvas) window.NeurascapeBG.init(bgCanvas);
    }

    // ── Infinite scroll (performance-optimized) ─────────
    (function initInfiniteScroll() {
        var postsContainer = document.querySelector('.posts');
        if (!postsContainer) return;

        var page = 1, loading = false, hasNext = true;
        var STAGGER_MS = 60;  // delay between each card reveal

        var loader = document.getElementById('loader');
        if (!loader) {
            loader = document.createElement('div');
            loader.id = 'loader';
            loader.className = 'loader';
            var parent = postsContainer.parentNode || document.querySelector('main');
            if (parent) parent.insertBefore(loader, postsContainer.nextSibling);
        }
        if (loader) loader.style.display = 'none';

        function hideLoader() {
            if (loader) { loader.style.display = 'none'; loader.classList.remove('pulsing'); }
        }
        function showLoader() {
            if (loader) { loader.style.display = 'block'; loader.classList.add('pulsing'); }
        }
        function removeLoader() {
            if (loader && loader.parentNode) { loader.parentNode.removeChild(loader); loader = null; }
        }
        function showEndOfPostsMessage() {
            if (postsContainer && !postsContainer.querySelector('.end-of-posts-msg')) {
                var endMsg = document.createElement('div');
                endMsg.className = 'end-of-posts-msg';
                endMsg.innerHTML = '<i class="fa fa-check-circle"></i> You\'ve reached the end of all posts.';
                postsContainer.appendChild(endMsg);
            }
            removeLoader();
        }

        /* Build a single article element from post data */
        function createPostElement(post) {
            var article = document.createElement('article');
            article.className = 'post-card fade-in';

            var imageTag = '';
            if (post.photo_filename) {
                var src = window.USING_SPACES === true && window.SPACES_URL
                    ? window.SPACES_URL + '/thumbnail/' + post.photo_filename
                    : '/static/images/thumbnail/' + post.photo_filename;
                imageTag = '<a href="/post/' + post.id + '" class="post-image-link">' +
                    '<img src="' + src + '" alt="' + post.title + '" class="post-thumb" loading="lazy">' +
                    '</a>';
            }

            var tagsHtml = '';
            if (post.tags && post.tags.length) {
                tagsHtml = '<div class="post-tags" style="display:flex;gap:0.4em;flex-wrap:wrap;margin:0.5em 0;">';
                post.tags.forEach(function(t) {
                    tagsHtml += '<span style="background:rgba(55,180,248,0.12);color:var(--primary);padding:0.2em 0.6em;border-radius:10px;font-size:0.8em;border:1px solid rgba(55,180,248,0.2);">#' + t + '</span>';
                });
                tagsHtml += '</div>';
            }

            article.innerHTML =
                '<h2><a href="/post/' + post.id + '">' + post.title + '</a></h2>' +
                imageTag + tagsHtml +
                '<p>' + post.content + '</p>' +
                '<div class="post-footer">' +
                '  <a href="/post/' + post.id + '" class="read-more-link">Read More <i class="fa-solid fa-angles-right"></i></a>' +
                (post.github_link ? '  <a href="' + post.github_link + '" target="_blank" class="github-link"><i class="fa-brands fa-github"></i> GitHub</a>' : '') +
                '</div>';

            return article;
        }

        /* Stagger-reveal an array of articles using rAF, not setTimeout */
        function revealCards(articles) {
            var i = 0;
            function revealNext() {
                if (i >= articles.length) return;
                articles[i].classList.add('visible');
                i++;
                if (i < articles.length) {
                    setTimeout(function() { requestAnimationFrame(revealNext); }, STAGGER_MS);
                }
            }
            requestAnimationFrame(revealNext);
        }

        async function loadPosts() {
            if (!hasNext || loading) return;
            loading = true;
            showLoader();

            try {
                var response = await fetch('/api/posts?page=' + page);
                if (!response.ok) throw new Error('HTTP ' + response.status);
                var data = await response.json();

                if (data.posts && data.posts.length > 0) {
                    /* Build all elements off-DOM in a DocumentFragment (single reflow) */
                    var fragment = document.createDocumentFragment();
                    var newArticles = [];
                    data.posts.forEach(function(post) {
                        var el = createPostElement(post);
                        fragment.appendChild(el);
                        newArticles.push(el);
                    });

                    /* Single DOM insertion → one reflow */
                    postsContainer.appendChild(fragment);

                    /* Stagger the reveal after the browser has painted the new elements */
                    requestAnimationFrame(function() { revealCards(newArticles); });

                    page++;
                    hasNext = !!data.has_next;
                    if (!hasNext) showEndOfPostsMessage();
                } else {
                    hasNext = false;
                    if (page === 1 && !postsContainer.querySelector('.no-posts-msg')) {
                        var msg = document.createElement('div');
                        msg.className = 'no-posts-msg';
                        msg.innerHTML = '<i class="fa fa-info-circle"></i> No posts yet.';
                        postsContainer.appendChild(msg);
                    } else {
                        showEndOfPostsMessage();
                    }
                    removeLoader();
                }
            } catch (error) {
                console.error('Infinite Scroll error:', error);
                hasNext = false;
                if (postsContainer && !postsContainer.querySelector('.error-msg')) {
                    var errMsg = document.createElement('div');
                    errMsg.className = 'error-msg';
                    errMsg.innerHTML = '<i class="fa fa-exclamation-circle"></i> Failed to load more posts.';
                    postsContainer.appendChild(errMsg);
                }
                removeLoader();
            } finally {
                loading = false;
                if (hasNext) hideLoader();
            }
        }

        // Initial load
        if (postsContainer.querySelectorAll('article').length === 0 && window.location.pathname === '/') {
            loadPosts();
        }

        // Intersection Observer: trigger loadPosts when the loader sentinel
        // enters (or is near) the viewport. No scroll listener needed.
        if ('IntersectionObserver' in window && loader) {
            var observer = new IntersectionObserver(function(entries) {
                if (entries[0].isIntersecting && hasNext && !loading) {
                    loadPosts();
                }
            }, { rootMargin: '800px' }); // Pre-fetch 800px before visible

            observer.observe(loader);

            // Patch removeLoader to also disconnect the observer
            var _origRemoveLoader = removeLoader;
            removeLoader = function() {
                observer.disconnect();
                _origRemoveLoader();
            };
        }
    })();
});
