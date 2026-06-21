document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM fully loaded - ALL INITIALIZATIONS START HERE');

    // ------ 0. GLOBAL CONFIGURATION CHECK (From base.html) --------
    console.log('Client-side JS sees USING_SPACES:', window.USING_SPACES, 'Type:', typeof window.USING_SPACES);
    console.log('Client-side JS sees SPACES_URL:', window.SPACES_URL, 'Type:', typeof window.SPACES_URL);

    if (typeof window.USING_SPACES === 'undefined') {
        console.warn('window.USING_SPACES is undefined. Critical for image paths. Check base.html script order and Jinja templating.');
    }

    if (typeof window.SPACES_URL === 'undefined' && window.USING_SPACES === true) {
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

        let currentToggle = sidebarToggle;

        if (sidebarToggle.getAttribute('data-listener-attached') !== 'true') {
            const newToggle = sidebarToggle.cloneNode(true);

            if (sidebarToggle.parentNode) {
                sidebarToggle.parentNode.replaceChild(newToggle, sidebarToggle);
            }

            currentToggle = newToggle;
            currentToggle.setAttribute('data-listener-attached', 'true');

            currentToggle.onclick = function(event) {
                event.stopPropagation();
                event.preventDefault();

                const sidebarElem = document.getElementById('sidebar');
                if (!sidebarElem) return false;

                const isOpen = sidebarElem.classList.toggle('open');

                document.body.classList.toggle('sidebar-open', isOpen);
                this.classList.toggle('active', isOpen);

                this.innerHTML = isOpen
                    ? '<i class="fa-solid fa-xmark"></i>'
                    : '<i class="fa-solid fa-bars"></i>';

                console.log('Sidebar toggled:', isOpen);
                return false;
            };
        }

        document.addEventListener('click', function(e) {
            const currentSidebarEl = document.getElementById('sidebar');
            const activeSidebarToggle = document.getElementById('sidebar-toggle');

            if (
                currentSidebarEl &&
                activeSidebarToggle &&
                currentSidebarEl.classList.contains('open') &&
                !currentSidebarEl.contains(e.target) &&
                e.target !== activeSidebarToggle &&
                !activeSidebarToggle.contains(e.target) &&
                !e.target.closest('#animation-toggle')
            ) {
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
        let scrollDebounceTimeout = null;

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

        if (loader) {
            loader.style.display = 'none';
        }

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

            if (loaderTimeoutId) {
                clearTimeout(loaderTimeoutId);
                loaderTimeoutId = null;
            }
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

            if (sentinel && sentinel.parentNode) {
                sentinel.parentNode.removeChild(sentinel);
            }

            if (observer) {
                observer.disconnect();
                observer = null;
            }

            if (loaderTimeoutId) {
                clearTimeout(loaderTimeoutId);
                loaderTimeoutId = null;
            }

            if (scrollDebounceTimeout) {
                clearTimeout(scrollDebounceTimeout);
                scrollDebounceTimeout = null;
            }
        }

        function startLoaderTimeout() {
            if (loaderTimeoutId) {
                clearTimeout(loaderTimeoutId);
            }

            loaderTimeoutId = setTimeout(function() {
                if (loading) {
                    console.warn('Loader timeout. Forcing loading state to false.');
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

            removeLoader();
        }

        function showRetryMessage(detail) {
            if (!postsContainer) return;

            let msg = postsContainer.querySelector('.error-msg');

            if (!msg) {
                msg = document.createElement('div');
                msg.className = 'error-msg';
                msg.style.cursor = 'pointer';
                msg.setAttribute('role', 'button');
                msg.setAttribute('tabindex', '0');

                msg.addEventListener('click', function() {
                    if (msg.parentNode) {
                        msg.parentNode.removeChild(msg);
                    }

                    hasNext = true;
                    loadPosts();
                });

                msg.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();

                        if (msg.parentNode) {
                            msg.parentNode.removeChild(msg);
                        }

                        hasNext = true;
                        loadPosts();
                    }
                });

                postsContainer.appendChild(msg);
            }

            msg.innerHTML =
                '<i class="fa fa-exclamation-circle"></i> Failed to load more posts' +
                (detail ? ' (' + detail + ')' : '') +
                ' — tap to retry.';
        }

        function nearViewport() {
            const probe = sentinel && sentinel.parentNode ? sentinel : postsContainer;
            const rect = probe.getBoundingClientRect();

            return rect.top < window.innerHeight + 900;
        }

        function maybeLoadMore() {
            if (hasNext && !loading && nearViewport()) {
                loadPosts();
            }
        }

        function scheduleLoadCheck() {
            if (!hasNext || loading) return;

            if (scrollDebounceTimeout) {
                clearTimeout(scrollDebounceTimeout);
            }

            scrollDebounceTimeout = setTimeout(function() {
                requestAnimationFrame(maybeLoadMore);
            }, 120);
        }

        async function loadPosts() {
            if (!hasNext || loading) return;

            console.log(`Infinite Scroll: Loading posts from offset ${offset}`);

            loading = true;
            showLoader();
            startLoaderTimeout();

            try {
                const response = await fetch(`/api/posts?offset=${offset}&limit=${limit}`);

                if (loaderTimeoutId) {
                    clearTimeout(loaderTimeoutId);
                    loaderTimeoutId = null;
                }

                if (!response.ok) {
                    const body = await response.text().catch(function() {
                        return '';
                    });

                    console.error(
                        `Infinite Scroll: /api/posts?offset=${offset}&limit=${limit} responded ${response.status}.`,
                        body.slice(0, 500)
                    );

                    throw new Error(`HTTP ${response.status}`);
                }

                const data = await response.json();

                console.log(`Infinite Scroll: API response for offset ${offset}:`, data);

                if (data.posts && data.posts.length > 0) {
                    const existingError = postsContainer.querySelector('.error-msg');

                    if (existingError && existingError.parentNode) {
                        existingError.parentNode.removeChild(existingError);
                    }

                    data.posts.forEach(function(post, idx) {
                        const article = document.createElement('article');
                        article.className = 'post-card fade-in';

                        let imageTag = '';

                        if (post.photo_filename) {
                            const thumbClass = post.photo_is_inline_fallback
                                ? 'post-thumb inline-fallback-thumb'
                                : 'post-thumb';

                            if (window.USING_SPACES === true && window.SPACES_URL) {
                                imageTag = `<a href="/post/${post.id}" class="post-image-link"><img src="${window.SPACES_URL}/thumbnail/${post.photo_filename}" alt="${post.title}" class="${thumbClass}"></a>`;
                            } else {
                                imageTag = `<a href="/post/${post.id}" class="post-image-link"><img src="/static/images/thumbnail/${post.photo_filename}" alt="${post.title}" class="${thumbClass}"></a>`;
                            }
                        }

                        article.innerHTML = `
                            <h2><a href="/post/${post.id}">${post.title}</a></h2>
                            ${imageTag}
                            <div class="post-excerpt">${post.content}</div>
                            <div class="post-footer">
                                <a href="/post/${post.id}" class="read-more-link">Read More <i class="fa-solid fa-angles-right"></i></a>
                                ${post.github_link ? `<a href="${post.github_link}" target="_blank" class="github-link"><i class="fa-brands fa-github"></i> View on GitHub</a>` : ''}
                            </div>`;

                        postsContainer.appendChild(article);

                        setTimeout(function() {
                            article.classList.add('visible');
                        }, 50 * idx);
                    });

                    offset = Number.isInteger(data.next_offset)
                        ? data.next_offset
                        : offset + data.posts.length;

                    hasNext = !!data.has_next;

                    if (!hasNext) {
                        console.log('Infinite Scroll: No more posts after this batch.');
                        showEndOfPostsMessage();
                    }
                } else {
                    hasNext = false;

                    console.log('Infinite Scroll: API returned no posts for this offset.');

                    if (offset === 0) {
                        if (!postsContainer.querySelector('.no-posts-msg')) {
                            const msg = document.createElement('div');
                            msg.className = 'no-posts-msg';
                            msg.innerHTML = '<i class="fa fa-info-circle"></i> No posts yet.';
                            postsContainer.appendChild(msg);
                        }

                        removeLoader();
                    } else {
                        showEndOfPostsMessage();
                    }
                }
            } catch (error) {
                console.error('Infinite Scroll: Error loading posts:', error);

                if (loaderTimeoutId) {
                    clearTimeout(loaderTimeoutId);
                    loaderTimeoutId = null;
                }

                hasNext = false;
                showRetryMessage(error && error.message ? error.message : 'unknown error');
                hideLoader();
            } finally {
                loading = false;

                if (hasNext) {
                    hideLoader();

                    // Re-check after the DOM/layout has updated. This handles tall screens
                    // and production layout cases where the observer does not retrigger.
                    requestAnimationFrame(maybeLoadMore);
                }
            }
        }

        // Use IntersectionObserver when available, but always keep scroll,
        // resize, and pageshow fallbacks. This prevents production from getting
        // stuck after the first batch if the sentinel does not retrigger.
        if ('IntersectionObserver' in window) {
            observer = new IntersectionObserver(function(entries) {
                if (entries.some(function(entry) {
                    return entry.isIntersecting;
                })) {
                    scheduleLoadCheck();
                }
            }, {
                rootMargin: '900px 0px 900px 0px',
                threshold: 0
            });

            observer.observe(sentinel);
            console.log('Infinite scroll: IntersectionObserver attached.');
        } else {
            console.log('Infinite scroll: IntersectionObserver unavailable; using scroll fallback.');
        }

        window.addEventListener('scroll', scheduleLoadCheck, { passive: true });
        window.addEventListener('resize', scheduleLoadCheck);
        window.addEventListener('pageshow', scheduleLoadCheck);

        const initialPostElements = postsContainer.querySelectorAll('article');
        offset = initialPostElements.length;

        if (initialPostElements.length === 0 && window.location.pathname === '/') {
            console.log('Infinite Scroll: No initial posts on home page. Loading from offset 0.');
            loadPosts();
        } else if (initialPostElements.length > 0) {
            console.log(`Infinite Scroll: ${initialPostElements.length} initial posts found. Loading from offset ${offset}.`);
            requestAnimationFrame(maybeLoadMore);
        }
    }

    function initLoadingAnimation(container, mainContent) {
        console.log('Loading animation setup function called.');
    }

    function checkForMorePosts() {
        console.log('checkForMorePosts called. Review if its logic is still needed separately from initInfiniteScroll.');
    }

    // ------- CALL INITIALIZATION FUNCTIONS --------
    initBackgroundCanvas();
    initSidebar();
    initAnimationToggle();
    initInfiniteScroll();

    const isFirstVisit = !sessionStorage.getItem('visited');

    if (isFirstVisit && window.location.pathname !== '/loading') {
        sessionStorage.setItem('visited', 'true');
        console.log('First visit (not /loading) - flag set.');
    }

    console.log('All JavaScript initializations have been set up.');
});