document.addEventListener('DOMContentLoaded', function() {
  console.log('DOM fully loaded - ensuring critical elements are ready');

  // 1. Force pointerEvents to none on the canvas to prevent click interference
  const bgCanvas = document.getElementById('bg-canvas');
  if (bgCanvas) {
    bgCanvas.style.pointerEvents = 'none';
  }

  // 2. Add an inline event handler directly to the sidebar toggle
  //    This bypasses any potential event binding issues
  const sidebarToggle = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('sidebar');

  if (sidebarToggle && sidebar) {
    // Replace the element to clear any existing handlers
    const newToggle = sidebarToggle.cloneNode(true);
    if (sidebarToggle.parentNode) {
      sidebarToggle.parentNode.replaceChild(newToggle, sidebarToggle);
    }

    // Add onclick handler directly to HTML element
    newToggle.setAttribute('onclick', `
      event.stopPropagation();
      event.preventDefault();
      const sidebar = document.getElementById('sidebar');
      const isOpen = sidebar.classList.toggle('open');
      document.body.classList.toggle('sidebar-open', isOpen);
      this.classList.toggle('active', isOpen);
      this.innerHTML = isOpen
        ? '<i class="fa-solid fa-xmark"></i>'
        : '<i class="fa-solid fa-bars"></i>';
      return false;
    `);

    // Set critical styles
    newToggle.style.zIndex = '10000';
    newToggle.style.pointerEvents = 'auto';
  }

  // 3. Fix infinite scroll initialization if it's on the page
  if (document.querySelector('.posts')) {
    // Force initialization of infinite scroll
    const postElements = document.querySelectorAll('.posts');
    if (postElements.length > 0) {
      console.log('Forcing infinite scroll initialization');
      setTimeout(initInfiniteScroll, 100);
    }
  }
});

// Advanced Neural-Cosmic Background Animation
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM fully loaded - starting initialization in defined order');

    // ------- 1. CORE INITIALIZATION --------
    // Initialize all critical components in a specific order
    initSidebar();
    initAnimationToggle();
    initInfiniteScroll();
    initBackgroundAnimation();

    // Function to ensure sidebar toggle works properly
    function initSidebar() {
        console.log('Initializing sidebar');
        const sidebar = document.getElementById('sidebar');
        const sidebarToggle = document.getElementById('sidebar-toggle');

        if (!sidebar || !sidebarToggle) return;

        // Fix critical z-index and pointer-events issues
        sidebarToggle.style.zIndex = '10000'; // Higher than anything else
        sidebarToggle.style.pointerEvents = 'auto';

        // Remove any existing listeners to prevent duplicates
        const toggleSidebar = (e) => {
            // Immediately stop event propagation
            e.stopPropagation();
            e.preventDefault();

            // Toggle sidebar classes
            const isOpen = sidebar.classList.toggle('open');
            document.body.classList.toggle('sidebar-open', isOpen);
            sidebarToggle.classList.toggle('active', isOpen);

            // Update icon
            sidebarToggle.innerHTML = isOpen
                ? '<i class="fa-solid fa-xmark"></i>'
                : '<i class="fa-solid fa-bars"></i>';

            console.log('Sidebar toggled:', isOpen);
            return false;
        };

        // Apply direct event handler
        sidebarToggle.onclick = toggleSidebar;

        // Handle document clicks for closing the sidebar
        document.addEventListener('click', (e) => {
            // Don't close if clicking inside sidebar, on toggle button, or on animation toggle
            if (
                sidebar.classList.contains('open') &&
                !sidebar.contains(e.target) &&
                e.target !== sidebarToggle &&
                !sidebarToggle.contains(e.target) &&
                !e.target.closest('#animation-toggle')
            ) {
                sidebar.classList.remove('open');
                document.body.classList.remove('sidebar-open');
                sidebarToggle.classList.remove('active');
                sidebarToggle.innerHTML = '<i class="fa-solid fa-bars"></i>';
            }
        });
    }

    // Function to initialize animation toggle
    function initAnimationToggle() {
        console.log('Initializing animation toggle');
        const animToggle = document.getElementById('animation-toggle');
        if (!animToggle) return;

        const toggleIcon = document.getElementById('animation-toggle-icon') ||
                          animToggle.querySelector('i');

        // Set initial state based on localStorage preference
        const animationsEnabled = localStorage.getItem('animationsEnabled') !== 'false';
        window.isAnimationPaused = !animationsEnabled;

        if (toggleIcon) {
            toggleIcon.className = animationsEnabled ?
                'fa-solid fa-pause' : 'fa-solid fa-play';

            animToggle.setAttribute('aria-checked', animationsEnabled.toString());
            animToggle.setAttribute('title',
                animationsEnabled ? 'Pause background animation' : 'Resume background animation');
        }

        // Apply initial canvas opacity
        const canvas = document.getElementById('bg-canvas');
        if (canvas && window.isAnimationPaused) {
            canvas.style.opacity = '0.2';
        }

        // Animation toggle handler
        function toggleAnimation(e) {
            // Immediately stop event propagation
            e.stopPropagation();
            e.preventDefault();

            const isEnabled = animToggle.getAttribute('aria-checked') === 'true';
            const newState = !isEnabled;

            // Save to localStorage
            localStorage.setItem('animationsEnabled', newState);

            // Update toggle button
            animToggle.setAttribute('aria-checked', newState.toString());
            if (toggleIcon) {
                toggleIcon.className = newState ?
                    'fa-solid fa-pause' : 'fa-solid fa-play';
                animToggle.setAttribute('title',
                    newState ? 'Pause background animation' : 'Resume background animation');
            }

            // Update animation state
            window.isAnimationPaused = !newState;

            // Update canvas
            const canvas = document.getElementById('bg-canvas');
            if (canvas) {
                canvas.style.opacity = newState ? '1' : '0.2';
            }

            // Trigger a custom event that the animation code can listen for
            document.dispatchEvent(new CustomEvent('animationToggled', {
                detail: { enabled: newState }
            }));

            console.log('Animation toggle clicked, new state:', newState);
            return false;
        }

        // Add click event handler
        animToggle.onclick = toggleAnimation;
    }

    // Initialize the background animation
    function initBackgroundAnimation() {
        console.log('Initializing background animation');
        const canvas = document.getElementById('bg-canvas');
        if (!canvas) return;

        // Ensure canvas doesn't block mouse events
        canvas.style.pointerEvents = 'none';

        const ctx = canvas.getContext('2d');
        let width = window.innerWidth, height = window.innerHeight;

        // --- ANIMATION STATE & PERFORMANCE VARIABLES ---
        let animationFrameId = null;
        let isPageVisible = true;
        let lastFrameTime = 0;
        const TARGET_FRAMERATE = 30; // Cap at 30fps to save resources
        const FRAME_DELAY = 1000 / TARGET_FRAMERATE;
        let devicePerformance = 'high'; // Will be set based on device capability

        // Resize handling
        function resize() {
            width = window.innerWidth;
            height = window.innerHeight;
            canvas.width = width;
            canvas.height = height;
        }
        resize();
        window.addEventListener('resize', resize);

        // --- PAGE VISIBILITY HANDLING ---
        document.addEventListener('visibilitychange', () => {
            isPageVisible = document.visibilityState === 'visible';

            if (isPageVisible && !window.isAnimationPaused) {
                // Resume animation if page becomes visible and not manually paused
                if (!animationFrameId) {
                    lastFrameTime = performance.now();
                    animationFrameId = requestAnimationFrame(draw);
                }
            } else {
                // Pause animation when page is hidden
                if (animationFrameId) {
                    cancelAnimationFrame(animationFrameId);
                    animationFrameId = null;
                }
            }
        });

        // Listen for animation toggle events
        document.addEventListener('animationToggled', (e) => {
            window.isAnimationPaused = !e.detail.enabled;

            if (window.isAnimationPaused) {
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
                if (canvas) canvas.style.opacity = '0.2'; // Dim the canvas when paused
            } else {
                if (canvas) canvas.style.opacity = '1'; // Restore full opacity
                if (!animationFrameId && isPageVisible) {
                    lastFrameTime = performance.now();
                    animationFrameId = requestAnimationFrame(draw);
                }
            }
        });

        // --- DEVICE PERFORMANCE DETECTION ---
        function detectDevicePerformance() {
            // Simple performance estimation based on user agent and hardware concurrency
            const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
            const cpuCores = navigator.hardwareConcurrency || 2;

            if (isMobile || cpuCores <= 2) {
                devicePerformance = 'low';
            } else if (cpuCores <= 4) {
                devicePerformance = 'medium';
            } else {
                devicePerformance = 'high';
            }

            console.log(`Device performance level: ${devicePerformance}`);
        }
        detectDevicePerformance();

        // --- SPACE-LIKE STARFIELD & CURSOR ---
        // Adjust star count based on device performance
        const getStarCount = () => {
            switch(devicePerformance) {
                case 'low': return 80;
                case 'medium': return 120;
                default: return 160;
            }
        };

        // Starfield
        const STAR_COUNT = getStarCount();
        const STAR_COLORS = [
            [255,255,255], // white
            [200,220,255], // blue
            [255,220,200], // yellowish
            [255,180,180], // reddish
        ];
        const stars = [];
        for (let i = 0; i < STAR_COUNT; i++) {
            const color = STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)];
            stars.push({
                x: Math.random() * width,
                y: Math.random() * height,
                z: Math.random() * 0.9 + 0.1, // depth
                r: Math.random() * 1.8 + 0.6,
                twinkle: Math.random() * Math.PI * 2,
                twinkleSpeed: Math.random() * 0.03 + 0.01,
                color,
            });
        }

        // Adjust cloud count based on device performance
        const getCloudCount = () => {
            switch(devicePerformance) {
                case 'low': return 1;
                case 'medium': return 2;
                default: return 3;
            }
        };

        // Nebula clouds
        const CLOUD_COUNT = getCloudCount();
        const clouds = [];
        for (let i = 0; i < CLOUD_COUNT; i++) {
            const hue = Math.random() * 360;
            clouds.push({
                x: width * (0.1 + Math.random() * 0.8),
                y: height * (0.1 + Math.random() * 0.8),
                radius: Math.min(width, height) * (0.13 + Math.random() * 0.18),
                color: `hsla(${hue}, 80%, 70%, ${Math.random() * 0.06 + 0.04})`,
                drift: {
                    x: (Math.random() - 0.5) * 0.08,
                    y: (Math.random() - 0.5) * 0.04
                },
                pulse: Math.random() * Math.PI * 2
            });
        }

        // Cursor star
        let mouseX = width/2, mouseY = height/2;
        let targetMouseX = width/2, targetMouseY = height/2;
        document.addEventListener('mousemove', e => {
            targetMouseX = e.clientX;
            targetMouseY = e.clientY;
        });

        // Adjust node count based on device performance
        const getNodeCount = () => {
            switch(devicePerformance) {
                case 'low': return 15;
                case 'medium': return 25;
                default: return 35;
            }
        };

        // --- NEURAL NETWORK, LINKS, DATA FLOWS, ETC ---
        // Neural Nodes with more variety
        const NODE_COUNT = getNodeCount();
        const nodes = [];
        const nodeColors = [
            'rgba(127, 249, 255, 0.9)', // cyan
            'rgba(243, 249, 157, 0.9)', // yellow
            'rgba(137, 207, 240, 0.9)', // light blue
            'rgba(230, 255, 230, 0.9)', // light green
            'rgba(255, 255, 255, 0.9)' // white
        ];

        for (let i = 0; i < NODE_COUNT; i++) {
            // Create a curved neural network pattern that spans the visible area
            const angle = Math.random() * 2 * Math.PI;
            const r = (Math.random() * 0.5 + 0.2) * Math.min(width, height);
            const xSpread = width * 0.9;
            const ySpread = height * 0.8;

            // Use parametric equations to create a more organized pattern
            let cx, cy;
            if (Math.random() < 0.7) {
                // Neural pattern
                const t = Math.random() * Math.PI * 2;
                cx = width / 2 + Math.cos(t * 2.5) * Math.sin(t * 3) * xSpread * 0.4;
                cy = height / 2 + Math.sin(t * 2) * ySpread * 0.35;
            } else {
                // Some random nodes for variety
                cx = width * (0.1 + Math.random() * 0.8);
                cy = height * (0.1 + Math.random() * 0.8);
            }

            // Node properties
            nodes.push({
                x: cx,
                y: cy,
                r: Math.random() * 10 + 7,
                pulse: Math.random() * Math.PI * 2,
                pulseSpeed: Math.random() * 0.03 + 0.01,
                color: nodeColors[Math.floor(Math.random() * nodeColors.length)],
                glowIntensity: Math.random() * 0.5 + 0.5
            });
        }

        // Enhanced Neural Links with thickness variety
        const links = [];
        for (let i = 0; i < NODE_COUNT; i++) {
            const nodeA = nodes[i];

            // Adjust connection probability based on device performance
            const getConnectionFactor = () => {
                switch(devicePerformance) {
                    case 'low': return 0.15;
                    case 'medium': return 0.25;
                    default: return 0.3;
                }
            };

            // Each node connects to closer nodes with higher probability
            for (let j = 0; j < NODE_COUNT; j++) {
                if (i === j) continue;

                const nodeB = nodes[j];
                const dx = nodeA.x - nodeB.x;
                const dy = nodeA.y - nodeB.y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                // The closer the nodes, the higher the chance to connect
                const connectionProbability = 1 - Math.min(1, distance / (Math.min(width, height) * 0.4));

                if (Math.random() < connectionProbability * getConnectionFactor()) {
                    links.push({
                        from: i,
                        to: j,
                        width: Math.random() * 1.8 + 0.8,
                        strength: Math.random() * 0.7 + 0.3,
                        speed: Math.random() * 0.04 + 0.01,
                        offset: Math.random() * Math.PI * 2,
                        particles: Array(Math.floor(Math.random() * 2 + 1)).fill().map(() => ({
                            position: Math.random(),
                            speed: Math.random() * 0.005 + 0.001,
                            size: Math.random() * 3 + 1
                        }))
                    });
                }
            }
        }

        // Data flow particles
        const dataFlows = [];

        // Function to add new data flow between random nodes
        function addDataFlow() {
            if (nodes.length < 2) return;

            // Skip adding new flows if paused or low device performance
            if (window.isAnimationPaused || !isPageVisible || devicePerformance === 'low') return;

            // Limit flows more aggressively on medium performance devices
            if (devicePerformance === 'medium' && dataFlows.length > 5) return;

            const fromIndex = Math.floor(Math.random() * nodes.length);
            let toIndex;
            do {
                toIndex = Math.floor(Math.random() * nodes.length);
            } while (toIndex === fromIndex);

            const fromNode = nodes[fromIndex];
            const toNode = nodes[toIndex];

            dataFlows.push({
                fromX: fromNode.x,
                fromY: fromNode.y,
                toX: toNode.x,
                toY: toNode.y,
                progress: 0,
                speed: Math.random() * 0.01 + 0.003,
                size: Math.random() * 3 + 2,
                color: fromNode.color
            });
        }

        // Adjust data flow interval based on device performance
        const getDataFlowInterval = () => {
            switch(devicePerformance) {
                case 'low': return 800;
                case 'medium': return 500;
                default: return 300;
            }
        };

        // Occasionally add new data flows
        let dataFlowInterval = setInterval(addDataFlow, getDataFlowInterval());

        // --- ANIMATION LOOP ---
        let t = 0;
        function draw(timestamp) {
            // Throttle frame rate for better performance
            const elapsed = timestamp - lastFrameTime;
            if (elapsed < FRAME_DELAY) {
                animationFrameId = requestAnimationFrame(draw);
                return;
            }

            lastFrameTime = timestamp - (elapsed % FRAME_DELAY);

            // Skip drawing if paused or page hidden
            if (window.isAnimationPaused || !isPageVisible) {
                animationFrameId = null;
                return;
            }

            ctx.clearRect(0, 0, width, height);

            // Draw cosmic nebula clouds
            for (let cloud of clouds) {
                // Update cloud position with gentle drift
                cloud.x += cloud.drift.x;
                cloud.y += cloud.drift.y;

                // Wrap around screen
                if (cloud.x < -cloud.radius) cloud.x = width + cloud.radius;
                if (cloud.x > width + cloud.radius) cloud.x = -cloud.radius;
                if (cloud.y < -cloud.radius) cloud.y = height + cloud.radius;
                if (cloud.y > height + cloud.radius) cloud.y = -cloud.radius;

                // Pulsating effect
                const pulseScale = 0.9 + 0.1 * Math.sin(t * 0.4 + cloud.pulse);

                // Draw cloud
                for (let j = 0; j < 3; j++) {
                    const offsetX = Math.cos(j * 2 * Math.PI / 3 + cloud.pulse) * cloud.radius * 0.18;
                    const offsetY = Math.sin(j * 2 * Math.PI / 3 + cloud.pulse) * cloud.radius * 0.18;
                    const grad = ctx.createRadialGradient(
                        cloud.x + offsetX, cloud.y + offsetY, 0,
                        cloud.x + offsetX, cloud.y + offsetY, cloud.radius * pulseScale * (0.8 + 0.2 * Math.random())
                    );
                    grad.addColorStop(0, cloud.color.replace(/[\d.]+\)$/, '0.12)'));
                    grad.addColorStop(1, cloud.color.replace(/[\d.]+\)$/, '0)'));
                    ctx.beginPath();
                    ctx.arc(cloud.x + offsetX, cloud.y + offsetY, cloud.radius * pulseScale, 0, Math.PI * 2);
                    ctx.fillStyle = grad;
                    ctx.fill();
                }
            }

            // Easy mouse position for smoother movement
            mouseX += (targetMouseX - mouseX) * 0.05;
            mouseY += (targetMouseY - mouseY) * 0.05;

            // Draw animated starfield with improved parallax
            for (let i = 0; i < STAR_COUNT; i++) {
                let s = stars[i];

                // Enhanced parallax effect based on depth
                let px = s.x + (mouseX - width/2) * s.z * 0.06;
                let py = s.y + (mouseY - height/2) * s.z * 0.06;

                // Wrap stars around the screen
                if (px < 0) px += width;
                if (px > width) px -= width;
                if (py < 0) py += height;
                if (py > height) py -= height;

                // More dynamic twinkling
                let tw = 0.7 + 0.5 * Math.sin(t * s.twinkleSpeed * 3 + s.twinkle);

                // Larger stars have more glow
                const starRadius = s.r * tw;
                const glowRadius = starRadius * (3 + 2 * s.z);

                // Draw star glow
                const [r,g,b] = s.color;
                const grad = ctx.createRadialGradient(
                    px, py, 0,
                    px, py, glowRadius
                );
                grad.addColorStop(0, `rgba(${r},${g},${b},${0.3 * s.z * tw})`);
                grad.addColorStop(1, 'rgba(200,220,255,0)');

                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(px, py, glowRadius, 0, 2 * Math.PI);
                ctx.fill();

                // Draw star core
                ctx.beginPath();
                ctx.arc(px, py, starRadius, 0, 2 * Math.PI);
                ctx.fillStyle = `rgba(${r},${g},${b},${0.8 + 0.2 * s.z})`;
                ctx.fill();
            }

            // Draw neural links with enhanced effects
            for (let link of links) {
                let a = nodes[link.from], b = nodes[link.to];
                let pulse = 0.5 + 0.5 * Math.sin(t * link.speed * 3 + link.offset);

                // Draw main link with gradient
                ctx.save();

                // Create gradient along the link path
                const linkGradient = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
                linkGradient.addColorStop(0, `rgba(127,249,255,${0.2 + 0.2 * pulse * link.strength})`);
                linkGradient.addColorStop(0.5, `rgba(180,250,255,${0.3 + 0.3 * pulse * link.strength})`);
                linkGradient.addColorStop(1, `rgba(243,249,157,${0.2 + 0.2 * pulse * link.strength})`);

                ctx.strokeStyle = linkGradient;
                ctx.lineWidth = 2 + 2 * pulse * link.strength;
                ctx.shadowBlur = 16 + 12 * pulse * link.strength;
                ctx.shadowColor = `rgba(255,255,255,${0.4 * pulse * link.strength})`;
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.stroke();

                // Skip particle effects on low performance devices
                if (devicePerformance !== 'low') {
                    // Update and draw particles moving along the link
                    for (let particle of link.particles) {
                        // Update position
                        particle.position += particle.speed;
                        if (particle.position > 1) particle.position = 0;

                        let px = a.x + (b.x - a.x) * particle.position;
                        let py = a.y + (b.y - a.y) * particle.position;

                        let particleColor = `rgba(243,249,157,${0.5 + 0.4 * pulse})`;

                        ctx.beginPath();
                        ctx.arc(px, py, particle.size, 0, Math.PI * 2);
                        ctx.fillStyle = particleColor;
                        ctx.shadowBlur = 12;
                        ctx.fill();
                    }
                }

                ctx.restore();
            }

            for (let node of nodes) {
                let pulse = 0.7 + 0.3 * Math.sin(t * node.pulseSpeed * 3 + node.pulse);

                // Draw outer glow
                const nodeGradient = ctx.createRadialGradient(
                    node.x, node.y, 0,
                    node.x, node.y, node.r * 3 * pulse
                );

                const nodeColor = node.color;
                nodeGradient.addColorStop(0, nodeColor);
                nodeGradient.addColorStop(0.5, nodeColor.replace(/[\d.]+\)$/, `${0.3 * node.glowIntensity})`));
                nodeGradient.addColorStop(1, nodeColor.replace(/[\d.]+\)$/, '0)'));

                ctx.beginPath();
                ctx.arc(node.x, node.y, node.r * 3 * pulse, 0, 2 * Math.PI);
                ctx.fillStyle = nodeGradient;
                ctx.fill();

                // Draw node core
                ctx.save();
                ctx.beginPath();
                ctx.arc(node.x, node.y, node.r * pulse, 0, 2 * Math.PI);
                ctx.fillStyle = node.color;
                ctx.fill();
                ctx.restore();

                //Draw white highlight
                ctx.beginPath();
                ctx.arc(node.x, node.y, node.r * 0.6 * pulse, 0, 2 * Math.PI);
                ctx.fillStyle = `rgba(255, 255, 255, ${0.3 + 0.2 * pulse})`;
                ctx.fill();
            }

            // Draw data flow particles
            for (let i = dataFlows.length - 1; i >= 0; i--) {
                const flow = dataFlows[i];

                // Update progress
                flow.progress += flow.speed;
                if (flow.progress >= 1) {
                    // Remove completed flows
                    dataFlows.splice(i, 1);
                    continue;
                }

                // Calculate current position
                const x = flow.fromX + (flow.toX - flow.fromX) * flow.progress;
                const y = flow.fromY + (flow.toY - flow.fromY) * flow.progress;

                // Draw particle with trail
                ctx.beginPath();
                ctx.arc(x, y, flow.size, 0, Math.PI * 2);
                ctx.fillStyle = flow.color;
                ctx.shadowColor = flow.color;
                ctx.shadowBlur = 15;
                ctx.fill();

                // Skip trails on low performance devices
                if (devicePerformance !== 'low') {
                    // Draw trail
                    ctx.beginPath();
                    ctx.moveTo(x, y);
                    const trailLength = 0.1;
                    const trailX = flow.fromX + (flow.toX - flow.fromX) * Math.max(0, flow.progress - trailLength);
                    const trailY = flow.fromY + (flow.toY - flow.fromY) * Math.max(0, flow.progress - trailLength);
                    ctx.lineTo(trailX, trailY);
                    ctx.strokeStyle = flow.color;
                    ctx.lineWidth = flow.size * 1.5;
                    ctx.stroke();
                }
            }

            // Cursor Star
            // Twinkle and pulse
            const cursorPulse = 1 + 0.15 * Math.sin(t * 2.5);
            const cursorTwinkle = 0.8 + 0.2 * Math.sin(t * 5.7);
            const baseRadius = 10;

            ctx.beginPath();
            ctx.arc(mouseX, mouseY, baseRadius * 2.5 * cursorPulse, 0, 2 * Math.PI);
            ctx.fillStyle = 'rgba(210,195,240,0.1)';
            ctx.fill();
            ctx.beginPath();
            ctx.arc(mouseX, mouseY, baseRadius * cursorPulse * cursorTwinkle, 0, 2 * Math.PI);
            ctx.fillStyle = 'rgba(210,195,240,0.85)';
            ctx.shadowColor = '#7ef9ff';
            ctx.shadowBlur = 25 * cursorPulse;
            ctx.fill(); // Draw cursor core

            // Update time at a rate appropriate for the frame rate
            // Slower on low-performance devices
            const timeStep = devicePerformance === 'low' ? 0.007 : 0.01;
            t += timeStep;

            // Continue animation
            animationFrameId = requestAnimationFrame(draw);
        }

        // Always show loading animation on the first page load
        const isFirstVisit = !sessionStorage.getItem('visited');

        if (isFirstVisit || window.location.pathname === '/loading') {
            // Create loading container if it doesn't exist
            if (!document.getElementById('loading-container')) {
                const loadingContainer = document.createElement('div');
                loadingContainer.id = 'loading-container';
                document.body.prepend(loadingContainer);

                // Hide main content initially
                const mainContent = document.querySelector('main');
                if (mainContent) {
                    mainContent.style.opacity = '0';
                    mainContent.style.transition = 'opacity 1s ease-in-out';
                }
            }

            // Check if animations are enabled in user preferences
            const animationsEnabled = localStorage.getItem('animationsEnabled') !== 'false';

            if (animationsEnabled) {
                // Initialize loading animation with the main content element
                initLoadingAnimation(
                    document.getElementById('loading-container'),
                    document.querySelector('main')
                );
            } else {
                // Skip animation if user has disabled animations
                const loadingContainer = document.getElementById('loading-container');
                if (loadingContainer) loadingContainer.style.display = 'none';

                const mainContent = document.querySelector('main');
                if (mainContent) mainContent.style.opacity = '1';
            }

            // Set visited flag in session storage
            sessionStorage.setItem('visited', 'true');
        } else {
            // For non-first visits to non-home pages, ensure main content is visible
            const mainContent = document.querySelector('main');
            if (mainContent) {
                mainContent.style.opacity = '1';
            }
        }

        // Set canvas opacity based on animation setting
        if (canvas && window.isAnimationPaused) {
            canvas.style.opacity = '0.2';
        }

        // Start the animation (if not paused)
        if (!window.isAnimationPaused && isPageVisible) {
            lastFrameTime = performance.now();
            animationFrameId = requestAnimationFrame(draw);
        }

        // Clean up when navigating away or when component unmounts
        return () => {
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
            }
            if (dataFlowInterval) {
                clearInterval(dataFlowInterval);
            }
        };
    }

    // ------- 2. UTILITY FUNCTIONS --------
    // Infinite scroll for posts
    function initInfiniteScroll() {
        console.log('Initializing infinite scroll');
        if (document.querySelector('.posts')) {
            let page = 1, loading = false, hasNext = true, maxLoadTime = 3000;
            const postsContainer = document.querySelector('.posts');
            const loader = document.getElementById('loader');

           // Ensure the loader exists
            if (!loader) return;

            // Function to safely hide loader
            function hideLoader() {
                if (loader) {
                    loader.style.display = 'none';
                    loader.classList.remove('pulsing');
                }
            }

            // Function to safely remove loader
            function removeLoader() {
                if (loader) {
                    hideLoader();
                    setTimeout(() => {
                        try {
                            if (loader.parentNode) {
                                loader.parentNode.removeChild(loader);
                            }
                        } catch (e) {
                            console.log("Loader already removed");
                        }
                    }, 100);
                }
            }

            // Add a spinner timeout to ensure it doesn't spin forever
            function addLoaderTimeout() {
                if (loader) {
                    return setTimeout(() => {
                        if (loading) {
                            console.log("Loader timeout reached");
                            loading = false;
                            hideLoader();
                        }
                    }, maxLoadTime);
                }
                return null;
            }

            async function loadPosts() {
                // Don't proceed if already loading or no more posts
                if (!hasNext || loading) return;

                loading = true;
                if (loader) {
                    loader.style.display = 'block';
                    loader.classList.add('pulsing');
                }

                // Set a timeout to hide loader if request takes too long
                const loaderTimeout = addLoaderTimeout();

                try {
                    const res = await fetch(`/api/posts?page=${page}`);
                    const data = await res.json();

                    // Clear timeout as we got a response
                    if (loaderTimeout) clearTimeout(loaderTimeout);

                    // No posts returned - end of content
                    if (!data.posts || data.posts.length === 0) {
                        console.log("No more posts to load");
                        hasNext = false;
                        loading = false;

                        // First page with no posts - show a message
                        if (page === 1) {
                            hideLoader();
                            const msg = document.createElement('div');
                            msg.className = 'no-posts-msg';
                            msg.innerHTML = '<i class="fa fa-info-circle"></i> No posts yet.';
                            postsContainer.appendChild(msg);
                        } else {
                            // End of posts reached - add a message and remove loader
                            const endMsg = document.createElement('div');
                            endMsg.className = 'end-of-posts-msg';
                            endMsg.innerHTML = '<i class="fa fa-check-circle"></i> You\'ve reached the end of posts.';
                            postsContainer.appendChild(endMsg);
                            removeLoader();
                        }
                        return;
                    }

                    // Process the returned posts
                    data.posts.forEach((post, index) => {
                        const article = document.createElement('article');
                        article.className = 'post-card fade-in';

                        // Create the image tag with conditional path
                        let imageTag = '';
                        if (post.image_filename) {
                            if (window.USING_SPACES) {
                                imageTag = `<a href="/post/${post.id}" class="post-image-link"><img src="${window.SPACES_URL}/thumbnail/${post.image_filename}" alt="${post.title}" class="post-thumb"></a>`;
                            } else {
                                imageTag = `<a href="/post/${post.id}" class="post-image-link"><img src="/static/images/thumbnail/${post.image_filename}" alt="${post.title}" class="post-thumb"></a>`;
                            }
                        }
                        article.innerHTML = `
                            <h2><a href="/post/${post.id}">${post.title}</a></h2>
                            ${imageTag}
                            <p>${post.content}</p>
                            <div class="post-footer">
                                <a href="/post/${post.id}" class="read-more-link">Read More <i class="fa-solid fa-angles-right"></i></a>
                                ${post.github_link ? `<a href="${post.github_link}" target="_blank" class="github-link"><i class="fa fa-github"></i> View on GitHub</a>` : ''}
                            </div>
                        `;
                        postsContainer.appendChild(article);

                        // Trigger animation with a small delay
                        setTimeout(() => {
                            article.classList.add('visible');
                        }, 50);
                    });

                    // Use the has_next flag from API response
                    hasNext = !!data.has_next;

                    // If no more posts, show end message and remove loader
                    if (!hasNext) {
                        console.log("No more posts available (has_next: false)");
                        const endMsg = document.createElement('div');
                        endMsg.className = 'end-of-posts-msg';
                        endMsg.innerHTML = '<i class="fa fa-check-circle"></i> You\'ve reached the end of posts.';
                        postsContainer.appendChild(endMsg);
                        removeLoader();
                    } else {
                        // Increment page for next load
                        page++;
                    }
                } catch (error) {
                    console.error("Error loading posts:", error);
                    const errorMsg = document.createElement('div');
                    errorMsg.className = 'error-msg';
                    errorMsg.innerHTML = '<i class="fa fa-exclamation-circle"></i> Failed to load posts. Please try again.';
                    postsContainer.appendChild(errorMsg);

                    // Clear timeout if error occurs
                    if (loaderTimeout) clearTimeout(loaderTimeout);
                } finally {
                    // Hide loader and reset loading state with a delay proportional to posts loaded
                    const delay = Math.min((data?.posts?.length || 0) * 100 + 300, 1000);
                    setTimeout(() => {
                        loading = false;
                        if (hasNext) {
                            hideLoader();
                        }
                    }, delay);
                }
            }

            // Initial load
            loadPosts();

            // Improved scroll detection with debounce
            let scrollTimeout;
            window.addEventListener('scroll', () => {
                clearTimeout(scrollTimeout);
                scrollTimeout = setTimeout(() => {
                    const scrollPosition = window.innerHeight + window.scrollY;
                    const documentHeight = document.body.offsetHeight;

                    // Trigger loading more posts when near the bottom (500px threshold)
                    if (scrollPosition > documentHeight - 500) {
                        loadPosts();
                    }
                }, 100);
            });
        }
    }

    // ------- 3. OPTIONAL LOADING ANIMATIONS --------
    // Initialize loading animation if needed
    function initLoadingAnimation(container, mainContent) {
        // This function should be defined elsewhere or imported
        // It's called by the background animation code
        console.log('Loading animation would start here if defined');
    }

    // ------- 4. ADDITIONAL INITIALIZATION --------
    // Show loading hint for first-time visitors
    const isFirstVisit = !sessionStorage.getItem('visited');
    if (isFirstVisit) {
        sessionStorage.setItem('visited', 'true');
        console.log('First visit - initialization complete');
    } else {
        console.log('Return visit - initialization complete');
    }
});