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

    function initBackgroundAnimation() {
        console.log('Initializing background animation');
        const canvas = document.getElementById('bg-canvas');
        if (!canvas) {
            console.warn('Background canvas #bg-canvas not found for animation.');
            return;
        }

        // Ensure canvas doesn't block mouse events (already done in initBackgroundCanvas, but good to be sure)
        canvas.style.pointerEvents = 'none';

        const ctx = canvas.getContext('2d');
        let width = window.innerWidth, height = window.innerHeight;
        let animationFrameId = null;
        let isPageVisible = document.visibilityState === 'visible';
        let lastFrameTime = 0;
        const TARGET_FRAMERATE = 30;
        const FRAME_DELAY = 1000 / TARGET_FRAMERATE;
        let devicePerformance = 'high';

        function resize() {
            width = window.innerWidth;
            height = window.innerHeight;
            if(canvas) { // Check if canvas still exists
                canvas.width = width;
                canvas.height = height;
            }
        }
        resize();
        window.addEventListener('resize', resize);

        document.addEventListener('visibilitychange', () => {
            isPageVisible = document.visibilityState === 'visible';
            if (isPageVisible && !window.isAnimationPaused && !animationFrameId) {
                lastFrameTime = performance.now();
                animationFrameId = requestAnimationFrame(draw);
            } else if (!isPageVisible && animationFrameId) {
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
            }
        });

        document.addEventListener('animationToggled', (e) => {
            // window.isAnimationPaused is set by initAnimationToggle
            const bgCanvasForToggle = document.getElementById('bg-canvas'); // Re-fetch
            if (window.isAnimationPaused) {
                if (animationFrameId) cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
                if (bgCanvasForToggle) bgCanvasForToggle.style.opacity = '0.2';
            } else {
                if (bgCanvasForToggle) bgCanvasForToggle.style.opacity = '1';
                if (!animationFrameId && isPageVisible) {
                    lastFrameTime = performance.now();
                    animationFrameId = requestAnimationFrame(draw);
                }
            }
        });

        function detectDevicePerformance() {
            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            const cpuCores = navigator.hardwareConcurrency || 2;
            if (isMobile || cpuCores <= 2) devicePerformance = 'low';
            else if (cpuCores <= 4) devicePerformance = 'medium';
            else devicePerformance = 'high';
            console.log(`Device performance level: ${devicePerformance}`);
        }
        detectDevicePerformance();

        const getStarCount = () => (devicePerformance === 'low' ? 80 : devicePerformance === 'medium' ? 120 : 160);
        const STAR_COUNT = getStarCount();
        const STAR_COLORS = [[255,255,255],[200,220,255],[255,220,200],[255,180,180]];
        const stars = Array.from({ length: STAR_COUNT }, () => {
            const color = STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)];
            return {
                x: Math.random() * width, y: Math.random() * height, z: Math.random() * 0.9 + 0.1,
                r: Math.random() * 1.8 + 0.6, twinkle: Math.random() * Math.PI * 2,
                twinkleSpeed: Math.random() * 0.03 + 0.01, color,
            };
        });

        const getCloudCount = () => (devicePerformance === 'low' ? 1 : devicePerformance === 'medium' ? 2 : 3);
        const CLOUD_COUNT = getCloudCount();
        const clouds = Array.from({ length: CLOUD_COUNT }, () => {
            const hue = Math.random() * 360;
            return {
                x: width * (0.1 + Math.random() * 0.8), y: height * (0.1 + Math.random() * 0.8),
                radius: Math.min(width, height) * (0.13 + Math.random() * 0.18),
                color: `hsla(${hue}, 80%, 70%, ${Math.random() * 0.06 + 0.04})`,
                drift: { x: (Math.random() - 0.5) * 0.08, y: (Math.random() - 0.5) * 0.04 },
                pulse: Math.random() * Math.PI * 2
            };
        });

        let mouseX = width / 2, mouseY = height / 2;
        let targetMouseX = width / 2, targetMouseY = height / 2;
        document.addEventListener('mousemove', e => { targetMouseX = e.clientX; targetMouseY = e.clientY; });

        const getNodeCount = () => (devicePerformance === 'low' ? 15 : devicePerformance === 'medium' ? 25 : 35);
        const NODE_COUNT = getNodeCount();
        const nodes = [];
        const nodeColors = ['rgba(127,249,255,0.9)','rgba(243,249,157,0.9)','rgba(137,207,240,0.9)','rgba(230,255,230,0.9)','rgba(255,255,255,0.9)'];
        for (let i = 0; i < NODE_COUNT; i++) {
            const xSpread = width * 0.9, ySpread = height * 0.8;
            let cx, cy;
            if (Math.random() < 0.7) {
                const t = Math.random() * Math.PI * 2;
                cx = width / 2 + Math.cos(t * 2.5) * Math.sin(t * 3) * xSpread * 0.4;
                cy = height / 2 + Math.sin(t * 2) * ySpread * 0.35;
            } else {
                cx = width * (0.1 + Math.random() * 0.8); cy = height * (0.1 + Math.random() * 0.8);
            }
            nodes.push({
                x: cx, y: cy, r: Math.random() * 10 + 7, pulse: Math.random() * Math.PI * 2,
                pulseSpeed: Math.random() * 0.03 + 0.01, color: nodeColors[Math.floor(Math.random() * nodeColors.length)],
                glowIntensity: Math.random() * 0.5 + 0.5
            });
        }

        const links = [];
        const getConnectionFactor = () => (devicePerformance === 'low' ? 0.15 : devicePerformance === 'medium' ? 0.25 : 0.3);
        for (let i = 0; i < NODE_COUNT; i++) {
            for (let j = 0; j < NODE_COUNT; j++) {
                if (i === j) continue;
                const nodeA = nodes[i], nodeB = nodes[j];
                const distance = Math.sqrt(Math.pow(nodeA.x - nodeB.x, 2) + Math.pow(nodeA.y - nodeB.y, 2));
                const connectionProbability = 1 - Math.min(1, distance / (Math.min(width, height) * 0.4));
                if (Math.random() < connectionProbability * getConnectionFactor()) {
                    links.push({
                        from: i, to: j, width: Math.random() * 1.8 + 0.8, strength: Math.random() * 0.7 + 0.3,
                        speed: Math.random() * 0.04 + 0.01, offset: Math.random() * Math.PI * 2,
                        particles: Array.from({ length: Math.floor(Math.random() * 2 + 1) }, () => ({
                            position: Math.random(), speed: Math.random() * 0.005 + 0.001, size: Math.random() * 3 + 1
                        }))
                    });
                }
            }
        }

        const dataFlows = [];
        const getDataFlowInterval = () => (devicePerformance === 'low' ? 800 : devicePerformance === 'medium' ? 500 : 300);
        function addDataFlow() {
            if (nodes.length < 2 || window.isAnimationPaused || !isPageVisible || devicePerformance === 'low') return;
            if (devicePerformance === 'medium' && dataFlows.length > 5) return; // Limit flows on medium perf
            const fromIndex = Math.floor(Math.random() * nodes.length);
            let toIndex;
            do { toIndex = Math.floor(Math.random() * nodes.length); } while (toIndex === fromIndex);
            dataFlows.push({
                fromX: nodes[fromIndex].x, fromY: nodes[fromIndex].y, toX: nodes[toIndex].x, toY: nodes[toIndex].y,
                progress: 0, speed: Math.random() * 0.01 + 0.003, size: Math.random() * 3 + 2, color: nodes[fromIndex].color
            });
        }
        let dataFlowInterval = setInterval(addDataFlow, getDataFlowInterval());

        let t = 0;
        function draw(timestamp) {
            if (!canvas) return; // Canvas might have been removed from DOM
            if (window.isAnimationPaused || !isPageVisible) {
                animationFrameId = null; return;
            }
            const elapsed = timestamp - lastFrameTime;
            if (elapsed < FRAME_DELAY && animationFrameId) { // Ensure animationFrameId is checked
                animationFrameId = requestAnimationFrame(draw); return;
            }
            lastFrameTime = timestamp - (elapsed % FRAME_DELAY);

            ctx.clearRect(0, 0, width, height);

            clouds.forEach(cloud => {
                cloud.x += cloud.drift.x; cloud.y += cloud.drift.y;
                if (cloud.x < -cloud.radius) cloud.x = width + cloud.radius; if (cloud.x > width + cloud.radius) cloud.x = -cloud.radius;
                if (cloud.y < -cloud.radius) cloud.y = height + cloud.radius; if (cloud.y > height + cloud.radius) cloud.y = -cloud.radius;
                const pulseScale = 0.9 + 0.1 * Math.sin(t * 0.4 + cloud.pulse);
                for (let j = 0; j < 3; j++) {
                    const offsetX = Math.cos(j * 2 * Math.PI / 3 + cloud.pulse) * cloud.radius * 0.18;
                    const offsetY = Math.sin(j * 2 * Math.PI / 3 + cloud.pulse) * cloud.radius * 0.18;
                    const grad = ctx.createRadialGradient(cloud.x + offsetX, cloud.y + offsetY, 0, cloud.x + offsetX, cloud.y + offsetY, cloud.radius * pulseScale * (0.8 + 0.2 * Math.random()));
                    grad.addColorStop(0, cloud.color.replace(/[\d.]+\)$/, '0.12)')); grad.addColorStop(1, cloud.color.replace(/[\d.]+\)$/, '0)'));
                    ctx.beginPath(); ctx.arc(cloud.x + offsetX, cloud.y + offsetY, cloud.radius * pulseScale, 0, Math.PI * 2); ctx.fillStyle = grad; ctx.fill();
                }
            });

            mouseX += (targetMouseX - mouseX) * 0.05; mouseY += (targetMouseY - mouseY) * 0.05;

            stars.forEach(s => {
                let px = s.x + (mouseX - width / 2) * s.z * 0.06, py = s.y + (mouseY - height / 2) * s.z * 0.06;
                if (px < 0) px += width; if (px > width) px -= width; if (py < 0) py += height; if (py > height) py -= height;
                let tw = 0.7 + 0.5 * Math.sin(t * s.twinkleSpeed * 3 + s.twinkle);
                const starRadius = s.r * tw, glowRadius = starRadius * (3 + 2 * s.z);
                const [r, g, b] = s.color;
                const grad = ctx.createRadialGradient(px, py, 0, px, py, glowRadius);
                grad.addColorStop(0, `rgba(${r},${g},${b},${0.3 * s.z * tw})`); grad.addColorStop(1, 'rgba(200,220,255,0)');
                ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(px, py, glowRadius, 0, 2 * Math.PI); ctx.fill();
                ctx.beginPath(); ctx.arc(px, py, starRadius, 0, 2 * Math.PI); ctx.fillStyle = `rgba(${r},${g},${b},${0.8 + 0.2 * s.z})`; ctx.fill();
            });

            links.forEach(link => {
                let a = nodes[link.from], b = nodes[link.to];
                let pulse = 0.5 + 0.5 * Math.sin(t * link.speed * 3 + link.offset);
                ctx.save();
                const linkGradient = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
                linkGradient.addColorStop(0, `rgba(127,249,255,${0.2 + 0.2 * pulse * link.strength})`);
                linkGradient.addColorStop(0.5, `rgba(180,250,255,${0.3 + 0.3 * pulse * link.strength})`);
                linkGradient.addColorStop(1, `rgba(243,249,157,${0.2 + 0.2 * pulse * link.strength})`);
                ctx.strokeStyle = linkGradient; ctx.lineWidth = 2 + 2 * pulse * link.strength;
                ctx.shadowBlur = 16 + 12 * pulse * link.strength; ctx.shadowColor = `rgba(255,255,255,${0.4 * pulse * link.strength})`;
                ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
                if (devicePerformance !== 'low') {
                    link.particles.forEach(particle => {
                        particle.position += particle.speed; if (particle.position > 1) particle.position = 0;
                        let px = a.x + (b.x - a.x) * particle.position, py = a.y + (b.y - a.y) * particle.position;
                        ctx.beginPath(); ctx.arc(px, py, particle.size, 0, Math.PI * 2); ctx.fillStyle = `rgba(243,249,157,${0.5 + 0.4 * pulse})`; ctx.shadowBlur = 12; ctx.fill();
                    });
                }
                ctx.restore();
            });

            nodes.forEach(node => {
                let pulse = 0.7 + 0.3 * Math.sin(t * node.pulseSpeed * 3 + node.pulse);
                const nodeGradient = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, node.r * 3 * pulse);
                nodeGradient.addColorStop(0, node.color); nodeGradient.addColorStop(0.5, node.color.replace(/[\d.]+\)$/, `${0.3 * node.glowIntensity})`)); nodeGradient.addColorStop(1, node.color.replace(/[\d.]+\)$/, '0)'));
                ctx.beginPath(); ctx.arc(node.x, node.y, node.r * 3 * pulse, 0, 2 * Math.PI); ctx.fillStyle = nodeGradient; ctx.fill();
                ctx.save(); ctx.beginPath(); ctx.arc(node.x, node.y, node.r * pulse, 0, 2 * Math.PI); ctx.fillStyle = node.color; ctx.fill(); ctx.restore();
                ctx.beginPath(); ctx.arc(node.x, node.y, node.r * 0.6 * pulse, 0, 2 * Math.PI); ctx.fillStyle = `rgba(255,255,255,${0.3 + 0.2 * pulse})`; ctx.fill();
            });

            for (let i = dataFlows.length - 1; i >= 0; i--) {
                const flow = dataFlows[i]; flow.progress += flow.speed;
                if (flow.progress >= 1) { dataFlows.splice(i, 1); continue; }
                const x = flow.fromX + (flow.toX - flow.fromX) * flow.progress, y = flow.fromY + (flow.toY - flow.fromY) * flow.progress;
                ctx.beginPath(); ctx.arc(x, y, flow.size, 0, Math.PI * 2); ctx.fillStyle = flow.color; ctx.shadowColor = flow.color; ctx.shadowBlur = 15; ctx.fill();
                if (devicePerformance !== 'low') {
                    ctx.beginPath(); ctx.moveTo(x, y);
                    const trailX = flow.fromX + (flow.toX - flow.fromX) * Math.max(0, flow.progress - 0.1);
                    const trailY = flow.fromY + (flow.toY - flow.fromY) * Math.max(0, flow.progress - 0.1);
                    ctx.lineTo(trailX, trailY); ctx.strokeStyle = flow.color; ctx.lineWidth = flow.size * 1.5; ctx.stroke();
                }
            }

            const cursorPulse = 1 + 0.15 * Math.sin(t * 2.5), cursorTwinkle = 0.8 + 0.2 * Math.sin(t * 5.7), baseRadius = 10;
            ctx.beginPath(); ctx.arc(mouseX, mouseY, baseRadius * 2.5 * cursorPulse, 0, 2 * Math.PI); ctx.fillStyle = 'rgba(210,195,240,0.1)'; ctx.fill();
            ctx.beginPath(); ctx.arc(mouseX, mouseY, baseRadius * cursorPulse * cursorTwinkle, 0, 2 * Math.PI); ctx.fillStyle = 'rgba(210,195,240,0.85)'; ctx.shadowColor = '#7ef9ff'; ctx.shadowBlur = 25 * cursorPulse; ctx.fill();

            t += (devicePerformance === 'low' ? 0.007 : 0.01);
            animationFrameId = requestAnimationFrame(draw);
        }

        // Initial call to start animation if not paused
        if (!window.isAnimationPaused && isPageVisible) {
            lastFrameTime = performance.now();
            animationFrameId = requestAnimationFrame(draw);
        }

        // Handle loading screen logic (if it was part of the original background animation setup)
        const isFirstVisit = !sessionStorage.getItem('visited');
        if (isFirstVisit || window.location.pathname === '/loading') {
            if (!document.getElementById('loading-container') && window.location.pathname === '/loading') { // Only create if on loading page
                const loadingContainer = document.createElement('div');
                loadingContainer.id = 'loading-container';
                // Add content to loadingContainer as needed, or let loader.js handle it
                document.body.prepend(loadingContainer);
            }
            // Assuming loader.js handles the actual loading animation and redirection
            // Set visited flag in session storage will be handled by loader.js after animation
        } else {
            const mainContent = document.querySelector('main');
            if (mainContent) mainContent.style.opacity = '1';
        }
    }

    function initInfiniteScroll() {
        console.log('Initializing infinite scroll');
        const postsContainer = document.querySelector('.posts');
        if (!postsContainer) {
            console.warn('Posts container (.posts) not found. Infinite scroll will not be initialized.');
            return;
        }

        let page = 1;
        let loading = false;
        let hasNext = true;
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
        if(loader) loader.style.display = 'none';


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
            removeLoader(); // Remove loader once end is definitively reached
        }

        async function loadPosts() {
            if (!hasNext || loading) return;

            console.log(`Infinite Scroll: Loading page ${page}`);
            loading = true;
            showLoader();
            startLoaderTimeout();

            try {
                const response = await fetch(`/api/posts?page=${page}`);
                if (loaderTimeoutId) clearTimeout(loaderTimeoutId);

                if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
                const data = await response.json();
                console.log(`Infinite Scroll: API response for page ${page}:`, data);

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
                        article.innerHTML = `
                            <h2><a href="/post/${post.id}">${post.title}</a></h2>
                            ${imageTag}
                            <p>${post.content}</p> <div class="post-footer">
                                <a href="/post/${post.id}" class="read-more-link">Read More <i class="fa-solid fa-angles-right"></i></a>
                                ${post.github_link ? `<a href="${post.github_link}" target="_blank" class="github-link"><i class="fa-brands fa-github"></i> View on GitHub</a>` : ''}
                            </div>`;
                        postsContainer.appendChild(article);
                        setTimeout(() => article.classList.add('visible'), 50 * idx);
                    });
                    page++;
                    hasNext = !!data.has_next; // Ensure boolean
                    if (!hasNext) {
                        console.log("Infinite Scroll: No more posts after this page.");
                        showEndOfPostsMessage();
                    }
                } else {
                    hasNext = false;
                    console.log("Infinite Scroll: API returned no posts for this page.");
                    if (page === 1) { // No posts at all
                         if (!postsContainer.querySelector('.no-posts-msg')) {
                            const msg = document.createElement('div');
                            msg.className = 'no-posts-msg';
                            msg.innerHTML = '<i class="fa fa-info-circle"></i> No posts yet.';
                            postsContainer.appendChild(msg);
                         }
                    } else { // Was loading subsequent pages and found no more
                        showEndOfPostsMessage();
                    }
                    removeLoader();
                }
            } catch (error) {
                console.error("Infinite Scroll: Error loading posts:", error);
                if (loaderTimeoutId) clearTimeout(loaderTimeoutId);
                hasNext = false;
                 if (postsContainer && !postsContainer.querySelector('.error-msg')) {
                    const errorMsg = document.createElement('div');
                    errorMsg.className = 'error-msg';
                    errorMsg.innerHTML = '<i class="fa fa-exclamation-circle"></i> Failed to load more posts.';
                    postsContainer.appendChild(errorMsg);
                }
                removeLoader(); // Stop trying on error
            } finally {
                loading = false;
                if (hasNext) hideLoader(); // Hide loader if there might be more, otherwise it's removed
            }
        }

        // Initial check/load logic for infinite scroll
        const initialPostElements = postsContainer.querySelectorAll('article');
        if (initialPostElements.length === 0 && window.location.pathname === '/') {
            console.log('Infinite Scroll: No initial posts on home page. Attempting to load page 1.');
            loadPosts();
        } else if (initialPostElements.length > 0) {
            console.log(`Infinite Scroll: ${initialPostElements.length} initial posts found. Checking for more.`);
            fetch('/api/posts?page=' + (postsContainer.dataset.initialPageCount ? parseInt(postsContainer.dataset.initialPageCount) + 1 : 2) )
                .then(res => res.json())
                .then(data => {
                    if (!data.posts || data.posts.length === 0 || !data.has_next) {
                        hasNext = false;
                        showEndOfPostsMessage();
                    } else {
                        page = (postsContainer.dataset.initialPageCount ? parseInt(postsContainer.dataset.initialPageCount) + 1 : 2);
                        console.log(`Infinite Scroll: More posts available. Next page to load on scroll: ${page}`);
                    }
                }).catch(err => console.error("Infinite Scroll: Error checking for more initial posts:", err));
        }

        let scrollDebounceTimeout;
        window.addEventListener('scroll', () => {
            if (!hasNext || loading) return;
            clearTimeout(scrollDebounceTimeout);
            scrollDebounceTimeout = setTimeout(() => {
                const scrollPosition = window.innerHeight + window.scrollY;
                const documentHeight = document.documentElement.scrollHeight;
                if (scrollPosition >= documentHeight - 600) {
                    loadPosts();
                }
            }, 150);
        });
        console.log("Infinite scroll event listener attached.");
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
    initAnimationToggle();  // Set up animation play/pause
    initBackgroundAnimation(); // Start the background visuals
    initInfiniteScroll();   // Handle dynamic post loading

    const isFirstVisit = !sessionStorage.getItem('visited');
    if (isFirstVisit && window.location.pathname !== '/loading') { // Avoid flag setting if loader.js will handle it
        sessionStorage.setItem('visited', 'true');
        console.log('First visit (not /loading) - flag set.');
    }
    console.log('All JavaScript initializations have been set up.');
});