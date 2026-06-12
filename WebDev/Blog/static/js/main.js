document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM fully loaded - ALL INITIALIZATIONS START HERE');

    // ------ 0. GLOBAL CONFIGURATION CHECK (From base.html) --------
    console.log('Client-side JS sees USING_SPACES:', window.USING_SPACES, 'Type:', typeof window.USING_SPACES);
    console.log('Client-side JS sees SPACES_URL:', window.SPACES_URL, 'Type:', typeof window.SPACES_URL);

    if (typeof window.USING_SPACES === 'undefined') {
        console.warn('window.USING_SPACES is undefined. Critical for image paths. Check base.html script order and Jinja templating.');
    }
    if (typeof window.SPACES_URL === 'undefined' && window.USING_SPACES === true) { // SPACES_URL is needed if USING_SPACES is true
        console.warn('window.SPACES_URL is undefined but USING_SPACES is true. Critical for image paths. Check base.html script order and Jinja templating.');
    }

    // ------- 1. DEFINE ALL INITIALIZATION FUNCTIONS --------

    function initBackgroundCanvas() {
        console.log('Initializing background canvas properties');
        const bgCanvas = document.getElementById('bg-canvas');
        if (bgCanvas) {
            bgCanvas.style.pointerEvents = 'none';
        } else {
            console.warn('Background canvas element (#bg-canvas) not found.');
        }
    }

    function initSidebar() {
        console.log('Initializing sidebar');
        const sidebar = document.getElementById('sidebar');
        const sidebarToggle = document.getElementById('sidebar-toggle');

        if (!sidebar || !sidebarToggle) {
            console.warn('Sidebar or toggle button not found. Sidebar functionality may be affected.');
            return;
        }

        sidebarToggle.style.zIndex = '10000';
        sidebarToggle.style.pointerEvents = 'auto';

        // To ensure only one click listener, we can remove and re-add or use a flag
        // A simple way is to replace the element if it might have old listeners from previous script versions
        let currentToggle = sidebarToggle;
        if (sidebarToggle.getAttribute('data-listener-attached') !== 'true') {
            const newToggle = sidebarToggle.cloneNode(true);
            if (sidebarToggle.parentNode) {
                sidebarToggle.parentNode.replaceChild(newToggle, sidebarToggle);
            }
            currentToggle = newToggle; // Work with the new or existing toggle
            currentToggle.setAttribute('data-listener-attached', 'true');

            currentToggle.onclick = function(event) {
                event.stopPropagation();
                event.preventDefault();
                const sidebarElem = document.getElementById('sidebar');
                if (!sidebarElem) return false;

                const isOpen = sidebarElem.classList.toggle('open');
                document.body.classList.toggle('sidebar-open', isOpen);
                this.classList.toggle('active', isOpen);
                this.innerHTML = isOpen ?
                    '<i class="fa-solid fa-xmark"></i>' :
                    '<i class="fa-solid fa-bars"></i>';
                console.log('Sidebar toggled:', isOpen);
                return false;
            };
        }


        document.addEventListener('click', (e) => {
            const currentSidebarEl = document.getElementById('sidebar');
            const activeSidebarToggle = document.getElementById('sidebar-toggle'); // Get the current toggle in DOM

            if (currentSidebarEl && activeSidebarToggle && currentSidebarEl.classList.contains('open') &&
                !currentSidebarEl.contains(e.target) &&
                e.target !== activeSidebarToggle && !activeSidebarToggle.contains(e.target) &&
                !e.target.closest('#animation-toggle')) {
                currentSidebarEl.classList.remove('open');
                document.body.classList.remove('sidebar-open');
                activeSidebarToggle.classList.remove('active');
                activeSidebarToggle.innerHTML = '<i class="fa-solid fa-bars"></i>';
            }
        });
    }

    function initAnimationToggle() {
        console.log('Initializing animation toggle');
        const animToggle = document.getElementById('animation-toggle');
        if (!animToggle) {
            console.warn('Animation toggle button not found.');
            return;
        }

        const toggleIcon = document.getElementById('animation-toggle-icon') || animToggle.querySelector('i');

        const animationsStoredPreference = localStorage.getItem('animationsEnabled');
        const animationsEnabled = animationsStoredPreference !== 'false';
        window.isAnimationPaused = !animationsEnabled;

        if (toggleIcon) {
            toggleIcon.className = animationsEnabled ? 'fa-solid fa-pause' : 'fa-solid fa-play';
        }
        animToggle.setAttribute('aria-checked', animationsEnabled.toString());
        animToggle.setAttribute('title', animationsEnabled ? 'Pause background animation' : 'Resume background animation');

        const canvas = document.getElementById('bg-canvas');
        if (canvas && window.isAnimationPaused) {
            canvas.style.opacity = '0.2';
        }

        animToggle.onclick = function(e) {
            e.stopPropagation();
            e.preventDefault();

            const isCurrentlyEnabled = this.getAttribute('aria-checked') === 'true';
            const newIsEnabledState = !isCurrentlyEnabled;

            localStorage.setItem('animationsEnabled', newIsEnabledState.toString());
            window.isAnimationPaused = !newIsEnabledState;

            this.setAttribute('aria-checked', newIsEnabledState.toString());
            if (toggleIcon) {
                toggleIcon.className = newIsEnabledState ? 'fa-solid fa-pause' : 'fa-solid fa-play';
            }
            this.setAttribute('title', newIsEnabledState ? 'Pause background animation' : 'Resume background animation');

            const bgCanvas = document.getElementById('bg-canvas');
            if (bgCanvas) {
                bgCanvas.style.opacity = newIsEnabledState ? '1' : '0.2';
            }

            document.dispatchEvent(new CustomEvent('animationToggled', {
                detail: { enabled: newIsEnabledState }
            }));
            console.log('Animation toggle clicked, new state:', newIsEnabledState);
            return false;
        };
    }

    // NOTE: the old inline canvas animation (initBackgroundAnimation) is
    // retired. The background is now fully owned by static/js/neurascape-bg.js
    // (v2), initialised from base.html. It listens for the 'animationToggled'
    // event dispatched by initAnimationToggle() above, so the pause button
    // keeps working with zero changes here.

    function initInfiniteScroll() {
        console.log('Initializing infinite scroll');
        const postsContainer = document.querySelector('.posts');
        if (!postsContainer) {
            console.warn('Posts container (.posts) not found. Infinite scroll will not be initialized.');
            return;
        }

        let offset = 0;
        const limit = 10;
        let loading = false;
        let hasNext = true;
        let observer = null;
        const maxLoadTime = 5000;
        let loaderTimeoutId = null;

        let loader = document.getElementById('loader');
        if (!loader) {
            console.warn('Loader element (#loader) not found. Creating it dynamically for infinite scroll.');
            loader = document.createElement('div');
            loader.id = 'loader';
            loader.className = 'loader';
            if (postsContainer.parentNode) {
                postsContainer.parentNode.insertBefore(loader, postsContainer.nextSibling);
            } else if (document.querySelector('main')) {
                document.querySelector('main').appendChild(loader);
            }
        }
        if (loader) loader.style.display = 'none';

        // Invisible 1px sentinel placed after the loader. The observer watches
        // this instead of the loader itself, because the loader is display:none
        // while idle and hidden elements never report an intersection.
        const sentinel = document.createElement('div');
        sentinel.className = 'scroll-sentinel';
        sentinel.style.cssText = 'height:1px;width:100%;pointer-events:none;';
        if (loader && loader.parentNode) {
            loader.parentNode.insertBefore(sentinel, loader.nextSibling);
        } else if (postsContainer.parentNode) {
            postsContainer.parentNode.insertBefore(sentinel, postsContainer.nextSibling);
        }

        function hideLoader() {
            if (loader) {
                loader.style.display = 'none';
                loader.classList.remove('pulsing');
            }
            if (loaderTimeoutId) clearTimeout(loaderTimeoutId);
        }

        function showLoader() {
            if (loader) {
                loader.style.display = 'block';
                loader.classList.add('pulsing');
            }
        }

        function removeLoader() {
            if (loader && loader.parentNode) {
                loader.parentNode.removeChild(loader);
                loader = null;
            }
            if (sentinel.parentNode) sentinel.parentNode.removeChild(sentinel);
            if (observer) { observer.disconnect(); observer = null; }
            if (loaderTimeoutId) clearTimeout(loaderTimeoutId);
        }

        function startLoaderTimeout() {
            if (loaderTimeoutId) clearTimeout(loaderTimeoutId);
            loaderTimeoutId = setTimeout(() => {
                if (loading) {
                    console.warn("Loader timeout. Forcing loading state to false.");
                    loading = false;
                    hideLoader();
                }
            }, maxLoadTime);
        }

        function showEndOfPostsMessage() {
            if (postsContainer && !postsContainer.querySelector('.end-of-posts-msg')) {
                const endMsg = document.createElement('div');
                endMsg.className = 'end-of-posts-msg';
                endMsg.innerHTML = '<i class="fa fa-check-circle"></i> You\'ve reached the end of all posts.';
                postsContainer.appendChild(endMsg);
            }
            removeLoader(); // Remove loader + sentinel once the end is definitively reached
        }

        // A failed page no longer kills pagination silently — the error box
        // says what happened and a tap retries the same page.
        function showRetryMessage(detail) {
            if (!postsContainer) return;
            let msg = postsContainer.querySelector('.error-msg');
            if (!msg) {
                msg = document.createElement('div');
                msg.className = 'error-msg';
                msg.style.cursor = 'pointer';
                msg.setAttribute('role', 'button');
                msg.addEventListener('click', () => {
                    if (msg.parentNode) msg.parentNode.removeChild(msg);
                    hasNext = true;
                    loadPosts();
                });
                postsContainer.appendChild(msg);
            }
            msg.innerHTML = '<i class="fa fa-exclamation-circle"></i> Failed to load more posts' +
                            (detail ? ' (' + detail + ')' : '') + ' — tap to retry.';
        }

        function nearViewport() {
            const probe = sentinel.parentNode ? sentinel : postsContainer;
            return probe.getBoundingClientRect().top < window.innerHeight + 600;
        }

        function maybeLoadMore() {
            if (hasNext && !loading && nearViewport()) loadPosts();
        }

        async function loadPosts() {
            if (!hasNext || loading) return;

            console.log(`Infinite Scroll: Loading posts from offset ${offset}`);
            loading = true;
            showLoader();
            startLoaderTimeout();

            try {
                const response = await fetch(`/api/posts?offset=${offset}&limit=${limit}`);
                if (loaderTimeoutId) clearTimeout(loaderTimeoutId);

                if (!response.ok) {
                    // Surface the server's words — a 500 here usually means one
                    // post on this page broke serialization server-side.
                    const body = await response.text().catch(() => '');
                    console.error(`Infinite Scroll: /api/posts?offset=${offset}&limit=${limit} responded ${response.status}.`,
                        body.slice(0, 500));
                    throw new Error(`HTTP ${response.status}`);
                }
                const data = await response.json();
                console.log(`Infinite Scroll: API response for offset ${offset}:`, data);

                if (data.posts && data.posts.length > 0) {
                    data.posts.forEach((post, idx) => {
                        const article = document.createElement('article');
                        article.className = 'post-card fade-in';
                        let imageTag = '';
                        if (post.photo_filename) {
                            if (window.USING_SPACES === true && window.SPACES_URL) {
                                imageTag = `<a href="/post/${post.id}" class="post-image-link"><img src="${window.SPACES_URL}/thumbnail/${post.photo_filename}" alt="${post.title}" class="post-thumb"></a>`;
                            } else {
                                imageTag = `<a href="/post/${post.id}" class="post-image-link"><img src="/static/images/thumbnail/${post.photo_filename}" alt="${post.title}" class="post-thumb"></a>`;
                            }
                        }
                        // The API returns pre-rendered, sanitized HTML (with its
                        // own <p> tags), so wrap in a div — not another <p>.
                        article.innerHTML = `
                            <h2><a href="/post/${post.id}">${post.title}</a></h2>
                            ${imageTag}
                            <div class="post-excerpt">${post.content}</div>
                            <div class="post-footer">
                                <a href="/post/${post.id}" class="read-more-link">Read More <i class="fa-solid fa-angles-right"></i></a>
                                ${post.github_link ? `<a href="${post.github_link}" target="_blank" class="github-link"><i class="fa-brands fa-github"></i> View on GitHub</a>` : ''}
                            </div>`;
                        postsContainer.appendChild(article);
                        setTimeout(() => article.classList.add('visible'), 50 * idx);
                    });
                    offset = Number.isInteger(data.next_offset)
                        ? data.next_offset
                        : offset + data.posts.length;

                    hasNext = !!data.has_next;
                    if (!hasNext) {
                        console.log("Infinite Scroll: No more posts after this page.");
                        showEndOfPostsMessage();
                    }
                } else {
                    hasNext = false;
                    console.log("Infinite Scroll: API returned no posts for this page.");
                    if (offset === 0) { // No posts at all
                        if (!postsContainer.querySelector('.no-posts-msg')) {
                            const msg = document.createElement('div');
                            msg.className = 'no-posts-msg';
                            msg.innerHTML = '<i class="fa fa-info-circle"></i> No posts yet.';
                            postsContainer.appendChild(msg);
                        }
                        removeLoader();
                    } else { // Was loading subsequent pages and found no more
                        showEndOfPostsMessage();
                    }
                }
            } catch (error) {
                console.error("Infinite Scroll: Error loading posts:", error);
                if (loaderTimeoutId) clearTimeout(loaderTimeoutId);
                hasNext = false;        // paused until the user taps retry
                showRetryMessage(error && error.message);
                hideLoader();
            } finally {
                loading = false;
                if (hasNext) {
                    hideLoader();
                    // The fill check: on a tall screen one page may not create
                    // any scrollable space, so no scroll/intersection change
                    // would ever fire. Keep loading until the viewport is
                    // genuinely filled or the posts run out.
                    maybeLoadMore();
                }
            }
        }

        // Trigger: IntersectionObserver on the sentinel with a generous
        // prefetch margin; falls back to a debounced scroll listener.
        if ('IntersectionObserver' in window) {
            observer = new IntersectionObserver((entries) => {
                if (entries.some(e => e.isIntersecting)) maybeLoadMore();
            }, { rootMargin: '600px 0px' });
            observer.observe(sentinel);
            console.log("Infinite scroll: IntersectionObserver attached.");
        } else {
            let scrollDebounceTimeout;
            window.addEventListener('scroll', () => {
                if (!hasNext || loading) return;
                clearTimeout(scrollDebounceTimeout);
                scrollDebounceTimeout = setTimeout(maybeLoadMore, 150);
            });
            console.log("Infinite scroll: scroll listener attached (no IntersectionObserver).");
        }

        // Initial load / continue check
        const initialPostElements = postsContainer.querySelectorAll('article');

        offset = initialPostElements.length;

        if (initialPostElements.length === 0 && window.location.pathname === '/') {
            console.log('Infinite Scroll: No initial posts on home page. Loading from offset 0.');
            loadPosts();
        } else if (initialPostElements.length > 0) {
            console.log(`Infinite Scroll: ${initialPostElements.length} initial posts found. Loading from offset ${offset}.`);
            maybeLoadMore();
        }
    }

    function initLoadingAnimation(container, mainContent) {
        console.log('Loading animation setup function called (if defined elsewhere).');
        // This function was in your original structure, assumed to be part of the full page load animation.
        // If it was tied to `loader.js`, ensure that `loader.js` is still included and functioning as expected for the `/loading` route.
    }

    function checkForMorePosts() {
        // This function was present in your original script.
        // Its primary purpose now is likely covered by initInfiniteScroll's initial checks.
        // If it has unique logic, it can be kept, otherwise, it might be simplified or removed.
        // For now, just logging its call.
        console.log('checkForMorePosts called. Review if its logic is still needed separately from initInfiniteScroll.');
        // The original logic for this function is now better integrated into initInfiniteScroll.
    }

    // ------- CALL INITIALIZATION FUNCTIONS --------
    // The order here matters!
    initBackgroundCanvas(); // Set up canvas properties
    initSidebar();          // Set up sidebar interactions
    initAnimationToggle();  // Set up animation play/pause (NeurascapeBG reacts to its event)
    initInfiniteScroll();   // Handle dynamic post loading

    const isFirstVisit = !sessionStorage.getItem('visited');
    if (isFirstVisit && window.location.pathname !== '/loading') { // Avoid flag setting if loader.js will handle it
        sessionStorage.setItem('visited', 'true');
        console.log('First visit (not /loading) - flag set.');
    }
    console.log('All JavaScript initializations have been set up.');
});
