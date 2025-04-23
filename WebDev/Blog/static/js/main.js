// Advanced Neural-Cosmic Background Animation
window.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('bg-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let width = window.innerWidth, height = window.innerHeight;

    function resize() {
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = width;
        canvas.height = height;
    }
    resize();
    window.addEventListener('resize', resize);

    // --- SPACE-LIKE STARFIELD & CURSOR ---
    // Starfield
    const STAR_COUNT = 320;
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

    // Nebula clouds
    const CLOUD_COUNT = 7;
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

    // --- NEURAL NETWORK, LINKS, DATA FLOWS, ETC ---
    // Neural Nodes with more variety
    const NODE_COUNT = 65;
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

        // Each node connects to closer nodes with higher probability
        for (let j = 0; j < NODE_COUNT; j++) {
            if (i === j) continue;

            const nodeB = nodes[j];
            const dx = nodeA.x - nodeB.x;
            const dy = nodeA.y - nodeB.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            // The closer the nodes, the higher the chance to connect
            const connectionProbability = 1 - Math.min(1, distance / (Math.min(width, height) * 0.4));

            if (Math.random() < connectionProbability * 0.3) {
                links.push({
                    from: i,
                    to: j,
                    width: Math.random() * 2.5 + 1,
                    strength: Math.random() * 0.7 + 0.3,
                    speed: Math.random() * 0.04 + 0.01,
                    offset: Math.random() * Math.PI * 2,
                    // Add particle animation along the links
                    particles: Array(Math.floor(Math.random() * 3 + 1)).fill().map(() => ({
                        position: Math.random(),
                        speed: Math.random() * 0.006 + 0.002,
                        size: Math.random() * 4 + 2
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

    // Occasionally add new data flows
    setInterval(addDataFlow, 300);

    // Cursor rays
    const cursorRays = [];
    function addCursorRay() {
        if (Math.random() < 0.2) {
            cursorRays.push({
                angle: Math.random() * Math.PI * 2,
                length: Math.random() * 100 + 50,
                width: Math.random() * 2 + 0.5,
                speed: (Math.random() * 0.02 + 0.01) * (Math.random() < 0.5 ? 1 : -1),
                alpha: Math.random() * 0.5 + 0.1
            });
        }
    }
    setInterval(addCursorRay, 200);

    // --- ANIMATION LOOP ---
    let t = 0;
    function draw() {
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
            ctx.fillStyle = `rgba(${r},${g},${b},${0.6 + 0.4 * s.z})`;
            ctx.shadowColor = `rgba(${r},${g},${b},1)`;
            ctx.shadowBlur = 12 * s.z * tw;
            ctx.fill();
            ctx.shadowBlur = 0;
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

            ctx.globalAlpha = 0.2 + 0.3 * pulse * link.strength;
            ctx.strokeStyle = linkGradient;
            ctx.lineWidth = 2 + 2 * pulse * link.strength;
            ctx.shadowColor = '#7ef9ff';
            ctx.shadowBlur = 16 + 12 * pulse * link.strength;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();

            // Update and draw particles moving along the link
            for (let particle of link.particles) {
                // Update position
                particle.position += particle.speed;
                if (particle.position > 1) particle.position = 0;

                // Calculate position along the line
                const px = a.x + (b.x - a.x) * particle.position;
                const py = a.y + (b.y - a.y) * particle.position;

                // Draw particle
                ctx.beginPath();
                ctx.arc(px, py, particle.size * pulse, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(243,249,157,${0.7 * pulse * link.strength})`;
                ctx.fill();
            }

            ctx.restore();
        }

        // Draw neural nodes with enhanced effects
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
            ctx.shadowColor = node.color.replace(/[\d.]+\)$/, '1)');
            ctx.shadowBlur = 20 * pulse * node.glowIntensity;
            ctx.globalAlpha = 0.9;
            ctx.fill();
            ctx.restore();

            // Draw white highlight
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

            // Draw trail
            ctx.beginPath();
            ctx.moveTo(x, y);
            const trailLength = 0.1;
            const trailX = flow.fromX + (flow.toX - flow.fromX) * Math.max(0, flow.progress - trailLength);
            const trailY = flow.fromY + (flow.toY - flow.fromY) * Math.max(0, flow.progress - trailLength);
            ctx.lineTo(trailX, trailY);
            ctx.strokeStyle = flow.color;
            ctx.lineWidth = flow.size * 1.5;
            ctx.globalAlpha = 0.4;
            ctx.stroke();
            ctx.globalAlpha = 1;
        }

        // Draw cursor rays
        for (let i = cursorRays.length - 3; i >= 0; i--) {
            const ray = cursorRays[i];

            // Rotate ray
            ray.angle += ray.speed;

            // Draw ray
            ctx.beginPath();
            ctx.moveTo(mouseX, mouseY);
            ctx.lineTo(
                mouseX + Math.cos(ray.angle) * ray.length,
                mouseY + Math.sin(ray.angle) * ray.length
            );
            ctx.strokeStyle = `rgba(243, 249, 157, ${ray.alpha})`;
            ctx.lineWidth = ray.width;
            ctx.shadowColor = '#f3f99d';
            ctx.shadowBlur = 10;
            ctx.stroke();
            ctx.shadowBlur = 0;

            // Remove old rays
            if (Math.random() < 0.002) {
                cursorRays.splice(i, 1);
            }
        }

        // --- CURSOR STAR (diffuse, glowing, animated) ---
        // Twinkle and pulse
        const cursorPulse = 1 + 0.15 * Math.sin(t * 2.5);
        const cursorTwinkle = 0.8 + 0.2 * Math.sin(t * 5.7);
        const baseRadius = 18;

        // Outer glow
        const grad = ctx.createRadialGradient(
            mouseX, mouseY, 0,
            mouseX, mouseY, baseRadius * 2.5 * cursorPulse
        );
        grad.addColorStop(0, 'rgba(255,255,255,0.18)');
        grad.addColorStop(0.5, 'rgba(127,249,255,0.10)');
        grad.addColorStop(1, 'rgba(127,249,255,0)');
        ctx.beginPath();
        ctx.arc(mouseX, mouseY, baseRadius * 2.5 * cursorPulse, 0, 2 * Math.PI);
        ctx.fillStyle = grad;
        ctx.fill();

        // Main star
        ctx.save();
        ctx.beginPath();
        ctx.arc(mouseX, mouseY, baseRadius * cursorPulse * cursorTwinkle, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.shadowColor = '#7ef9ff';
        ctx.shadowBlur = 25 * cursorPulse;
        ctx.fill();
        ctx.restore();

        // Subtle star spikes (soft, not lines)
        for (let i = 0; i < 6; i++) {
            const angle = i * Math.PI / 3 + t * 0.7;
            const spikeLen = baseRadius * (1.6 + 0.4 * Math.sin(t * 2 + i));
            ctx.save();
            ctx.translate(mouseX, mouseY);
            ctx.rotate(angle);
            const spikeGrad = ctx.createLinearGradient(0, 0, 0, -spikeLen);
            spikeGrad.addColorStop(0, 'rgba(255,255,255,0.18)');
            spikeGrad.addColorStop(0.5, 'rgba(127,249,255,0.08)');
            spikeGrad.addColorStop(1, 'rgba(127,249,255,0)');
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(0, -spikeLen);
            ctx.lineWidth = 3;
            ctx.strokeStyle = spikeGrad;
            ctx.globalAlpha = 0.7;
            ctx.stroke();
            ctx.restore();
        }

        t += 0.012;
        requestAnimationFrame(draw);
    }

    // Start the animation
    draw();
});

// ===========================================================================
// Enhanced Loading Animation with Brain Visualization (Functions)
// ===========================================================================

// --- CONFIGURATION ---
const LOADING_DURATION_MS = 4000; // How long the loading animation should take in milliseconds
const LOADING_FADE_OUT_MS = 800;  // Duration of the fade-out effect

// --- Helper function to generate irregular brain region shape ---
function generateBrainRegion(centerX, centerY, radiusX, radiusY, irregularity) {
    const points = [];
    const pointCount = 12; // More points for smoother shape

    for (let i = 0; i < pointCount; i++) {
        const angle = (i / pointCount) * Math.PI * 2;
        // Ensure randomRadius doesn't go below a certain threshold to prevent collapsing
        const randomRadius = Math.max(0.5, 1 - irregularity / 2 + Math.random() * irregularity);
        points.push({
            x: centerX + Math.cos(angle) * radiusX * randomRadius,
            y: centerY + Math.sin(angle) * radiusY * randomRadius
        });
    }
    return points;
}

// --- Helper function to find center of a region ---
function getRegionCenter(points) {
    if (!points || points.length === 0) return { x: 0, y: 0 };
    let sumX = 0, sumY = 0;
    for (let point of points) {
        sumX += point.x;
        sumY += point.y;
    }
    return {
        x: sumX / points.length,
        y: sumY / points.length
    };
}


/**
 * Initializes and runs the brain loading animation.
 * @param {HTMLElement} loadingContainer - The main container element for the loading animation.
 * @param {HTMLElement} mainContentElement - The main content element of the page to fade in later.
 */
function initLoadingAnimation(loadingContainer, mainContentElement) {
    if (!loadingContainer || !mainContentElement) {
        console.error("Loading container or main content element not provided for initLoadingAnimation.");
        // Fallback: Immediately show content if loader setup fails
        if(mainContentElement) mainContentElement.style.opacity = '1';
        if(loadingContainer) loadingContainer.style.display = 'none';
        return;
    }

    // --- Essential: Ensure container is visible (CSS should handle initial display: flex/block and position) ---
    // Add CSS rules for #loading-container, #brain-loading-canvas, .loading-text
    // e.g., #loading-container { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: #000; display: flex; flex-direction: column; justify-content: center; align-items: center; opacity: 1; transition: opacity 0.8s ease-out; z-index: 9999; }
    //       #brain-loading-canvas { /* Add styling if needed */ }
    //       .loading-text { color: #fff; margin-top: 20px; font-size: 1.2em; font-family: sans-serif; }
    loadingContainer.style.opacity = '1'; // Ensure it starts visible if hidden initially
    loadingContainer.style.display = 'flex'; // Or 'block', depending on your CSS layout

    // --- Create Canvas ---
    let brainCanvas = document.getElementById('brain-loading-canvas');
    if (!brainCanvas) { // Only create if it doesn't exist
        brainCanvas = document.createElement('canvas');
        brainCanvas.id = 'brain-loading-canvas';
        // Make canvas size relative or fixed as desired
        brainCanvas.width = 300; // Consider making responsive if needed
        brainCanvas.height = 300;
        loadingContainer.appendChild(brainCanvas);
    }
    const ctx = brainCanvas.getContext('2d');
    if (!ctx) {
        console.error("Failed to get 2D context for brain loading canvas.");
        // Fallback
        loadingContainer.style.display = 'none';
        mainContentElement.style.opacity = '1';
        return;
    }


    // --- Create Loading Text ---
    let loadingText = loadingContainer.querySelector('.loading-text');
     if (!loadingText) { // Only create if it doesn't exist
        loadingText = document.createElement('div');
        loadingText.className = 'loading-text';
        loadingText.innerHTML = '0%';
        loadingContainer.appendChild(loadingText);
    }


    // --- Brain Data Setup ---
    // (Using your provided structure)
    const brainRegions = [
        { name: 'frontal-lobe', points: generateBrainRegion(150, 100, 80, 70, 0.5), color: '#7ef9ff', progress: 0 }, // Cyan
        { name: 'parietal-lobe', points: generateBrainRegion(150, 140, 90, 60, 0.3), color: '#f3f99d', progress: 0 }, // Yellow
        { name: 'temporal-lobe', points: generateBrainRegion(100, 180, 60, 50, 0.7), color: '#a6fafd', progress: 0 }, // Light Cyan
        { name: 'occipital-lobe', points: generateBrainRegion(200, 180, 60, 50, 0.7), color: '#e0ffd8', progress: 0 }, // Pale Green
        { name: 'cerebellum', points: generateBrainRegion(150, 230, 100, 40, 0.2), color: '#bff8ff', progress: 0 }, // Very Light Blue
        { name: 'brain-stem', points: generateBrainRegion(150, 270, 30, 25, 0.1), color: '#d8fffa', progress: 0 }, // Pale Aqua
    ];

    const connections = [];
    for (let i = 0; i < brainRegions.length; i++) {
        for (let j = i + 1; j < brainRegions.length; j++) {
            if (Math.random() < 0.6) { // Slightly increased connection probability
                connections.push({
                    from: i, to: j, progress: 0, width: Math.random() * 1.5 + 0.5, // Thinner connections
                    pulseSpeed: Math.random() * 0.03 + 0.01, pulseOffset: Math.random() * Math.PI * 2
                });
            }
        }
    }

    const nodes = [];
    for (let region of brainRegions) {
        const regionCenter = getRegionCenter(region.points);
        const nodeCount = Math.floor(Math.random() * 4) + 4; // Slightly fewer nodes per region
        for (let i = 0; i < nodeCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const distance = Math.random() * 25 + 5; // Closer to center
            nodes.push({
                x: regionCenter.x + Math.cos(angle) * distance, y: regionCenter.y + Math.sin(angle) * distance,
                radius: Math.random() * 2 + 1.5, // Smaller nodes
                region: region.name, progress: 0,
                pulseSpeed: Math.random() * 0.05 + 0.02, pulseOffset: Math.random() * Math.PI * 2
            });
        }
    }

    // --- Drawing Function for a Brain Region ---
    function drawBrainRegion(region, progress) {
        if (!region || !region.points || region.points.length === 0) return;

        ctx.beginPath();
        ctx.moveTo(region.points[0].x, region.points[0].y);
        // Use quadratic curve for smoother region outlines
        for (let i = 1; i < region.points.length; i++) {
             const midX = (region.points[i-1].x + region.points[i].x) / 2;
             const midY = (region.points[i-1].y + region.points[i].y) / 2;
             ctx.quadraticCurveTo(region.points[i-1].x, region.points[i-1].y, midX, midY);
        }
        const lastMidX = (region.points[region.points.length-1].x + region.points[0].x) / 2;
        const lastMidY = (region.points[region.points.length-1].y + region.points[0].y) / 2;
        ctx.quadraticCurveTo(region.points[region.points.length-1].x, region.points[region.points.length-1].y, lastMidX, lastMidY);
        ctx.closePath();


        const center = getRegionCenter(region.points);
        const gradient = ctx.createRadialGradient(
            center.x, center.y, 0,
            center.x, center.y, 80 // Fixed radius for gradient spread
        );

        const activeOpacity = 0.6 * progress; // Base active glow
        const baseOpacity = 0.1; // Outline opacity when inactive
        const strokeOpacity = 0.3 + 0.5 * progress; // Outline gets brighter

        // Fill gradient - only visible when active
        gradient.addColorStop(0, region.color.replace(/[\d.]+\)$/, `${baseOpacity + activeOpacity})`));
        gradient.addColorStop(1, region.color.replace(/[\d.]+\)$/, `${baseOpacity * 0.2})`)); // Fainter edge

        ctx.fillStyle = gradient;
        ctx.strokeStyle = region.color.replace(/[\d.]+\)$/, `${strokeOpacity})`); // Control stroke opacity
        ctx.lineWidth = 1.5;

        // Add glow effect that increases with progress
        ctx.shadowColor = region.color;
        ctx.shadowBlur = 15 * progress * progress; // Exponential glow increase

        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0; // Reset shadow IMPORTANT
    }


    // --- Animation Loop ---
    let startTime = performance.now();
    let t = 0; // Time for pulsing effects
    let animationFrameId = null;

    function animateBrainLoading() {
        const currentTime = performance.now();
        const elapsedTime = currentTime - startTime;
        let loadProgress = Math.min(1, elapsedTime / LOADING_DURATION_MS); // Time-based progress

        ctx.clearRect(0, 0, brainCanvas.width, brainCanvas.height);
        loadingText.innerHTML = `${Math.floor(loadProgress * 100)}%`;

        // --- Background subtle glow ---
        const bgGradient = ctx.createRadialGradient(150, 150, 10, 150, 150, 200);
        bgGradient.addColorStop(0, 'rgba(127, 249, 255, 0.05)'); // More subtle
        bgGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = bgGradient;
        ctx.fillRect(0, 0, brainCanvas.width, brainCanvas.height);


        // --- Update and Draw Regions ---
        for (let i = 0; i < brainRegions.length; i++) {
            const region = brainRegions[i];
            const regionStartPoint = i / brainRegions.length;
            const regionEndPoint = (i + 1) / brainRegions.length;

            // Calculate the progress specific to this region lighting up
            let regionProgress = 0;
            if (loadProgress >= regionStartPoint) {
                regionProgress = (loadProgress - regionStartPoint) / (regionEndPoint - regionStartPoint);
                regionProgress = Math.min(1, regionProgress); // Clamp between 0 and 1
            }
            region.progress = regionProgress * regionProgress; // Ease-in effect for lighting up
            drawBrainRegion(region, region.progress);
        }


        // --- Update and Draw Connections ---
        for (let connection of connections) {
            const fromRegion = brainRegions[connection.from];
            const toRegion = brainRegions[connection.to];
            const connectionProgress = Math.min(fromRegion.progress, toRegion.progress); // Connection activates when both regions are somewhat active
            connection.progress = connectionProgress;

            if (connectionProgress > 0.1) { // Only draw if regions are slightly active
                const fromCenter = getRegionCenter(fromRegion.points);
                const toCenter = getRegionCenter(toRegion.points);
                const pulse = 0.7 + 0.3 * Math.sin(t * connection.pulseSpeed + connection.pulseOffset);

                const gradient = ctx.createLinearGradient(fromCenter.x, fromCenter.y, toCenter.x, toCenter.y);
                gradient.addColorStop(0, fromRegion.color.replace(/[\d.]+\)$/, `${0.4 * connectionProgress * pulse})`));
                gradient.addColorStop(1, toRegion.color.replace(/[\d.]+\)$/, `${0.4 * connectionProgress * pulse})`));

                ctx.beginPath();
                ctx.moveTo(fromCenter.x, fromCenter.y);
                ctx.lineTo(toCenter.x, toCenter.y);
                ctx.strokeStyle = gradient;
                ctx.lineWidth = connection.width * connectionProgress;
                ctx.shadowColor = '#FFF'; // White glow for connections
                ctx.shadowBlur = 8 * connectionProgress * pulse;
                ctx.stroke();
                ctx.shadowBlur = 0;

                // Connection particles (less frequent)
                 if (connectionProgress > 0.6 && Math.random() < 0.03) {
                     const particlePos = Math.random();
                     const x = fromCenter.x + (toCenter.x - fromCenter.x) * particlePos;
                     const y = fromCenter.y + (toCenter.y - fromCenter.y) * particlePos;
                     ctx.beginPath();
                     ctx.arc(x, y, 2 * pulse, 0, Math.PI * 2);
                     ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
                     ctx.shadowColor = '#ffffff';
                     ctx.shadowBlur = 8;
                     ctx.fill();
                     ctx.shadowBlur = 0;
                 }
            }
        }


        // --- Update and Draw Nodes ---
        for (let node of nodes) {
            const region = brainRegions.find(r => r.name === node.region);
            if (region && region.progress > 0.2) { // Activate nodes a bit after region starts glowing
                node.progress = region.progress;
                const pulse = 0.6 + 0.4 * Math.sin(t * node.pulseSpeed + node.pulseOffset);
                const radius = node.radius * pulse * node.progress;

                if (radius > 0.5) { // Only draw if radius is large enough
                    ctx.beginPath();
                    ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
                    ctx.fillStyle = region.color.replace(/[\d.]+\)$/, `${0.8 * node.progress})`); // Node color tied to region
                    ctx.shadowColor = region.color;
                    ctx.shadowBlur = 8 * node.progress;
                    ctx.fill();
                    ctx.shadowBlur = 0;

                    // Node highlight
                    ctx.beginPath();
                    ctx.arc(node.x, node.y, radius * 0.4, 0, Math.PI * 2);
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
                    ctx.fill();
                }
            }
        }

        // --- Random Sparks ---
        for (let region of brainRegions) {
             if (region.progress > 0.6 && Math.random() < 0.15) { // More frequent sparks
                 const center = getRegionCenter(region.points);
                 const angle = Math.random() * Math.PI * 2;
                 const distance = Math.random() * 35 + 10; // Within region
                 const x = center.x + Math.cos(angle) * distance;
                 const y = center.y + Math.sin(angle) * distance;

                 ctx.beginPath();
                 ctx.arc(x, y, Math.random() * 1.5 + 0.5, 0, Math.PI * 2); // Smaller sparks
                 ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
                 ctx.shadowColor = '#ffffff';
                 ctx.shadowBlur = 6;
                 ctx.fill();
                 ctx.shadowBlur = 0;
             }
         }


        t += 0.05; // Time step for pulsing effects

        // --- Continue or Finish ---
        if (loadProgress < 1) {
            animationFrameId = requestAnimationFrame(animateBrainLoading);
        } else {
            // Ensure 100% is displayed briefly
            loadingText.innerHTML = '100%';
            // Use setTimeout to allow 100% to show before fade starts
            setTimeout(fadeOutLoading, 300); // Short delay before fading
        }
    }

    // --- Fade Out Function ---
    function fadeOutLoading() {
        if (animationFrameId) {
             cancelAnimationFrame(animationFrameId); // Stop animation loop
             animationFrameId = null;
        }
        loadingContainer.style.transition = `opacity ${LOADING_FADE_OUT_MS}ms ease-out`;
        loadingContainer.style.opacity = '0';

        setTimeout(() => {
            loadingContainer.style.display = 'none';
            // Fade in main content - Ensure main content has a transition set in CSS
            // e.g., main { opacity: 0; transition: opacity 0.5s ease-in; }
            mainContentElement.style.opacity = '1';
        }, LOADING_FADE_OUT_MS);
    }

    // --- Start Animation ---
    animateBrainLoading();
}


// Infinite scroll for posts
function initInfiniteScroll() {
    if (document.querySelector('.posts')) {
        let page = 1, loading = false, hasNext = true;
        const postsContainer = document.querySelector('.posts');
        const loader = document.getElementById('loader');

        async function loadPosts() {
            if (!hasNext || loading) return;
            loading = true;
            loader.style.display = 'block';

            // Enhanced loading effect
            loader.classList.add('pulsing');

            try {
                const res = await fetch(`/api/posts?page=${page}`);
                const data = await res.json();

                if (data.posts.length === 0 && page === 1) {
                    // No posts at all: show loader for 1s, then show message
                    setTimeout(() => {
                        loader.style.display = 'none';
                        loader.classList.remove('pulsing');
                        const msg = document.createElement('div');
                        msg.className = 'no-posts-msg';
                        msg.innerHTML = '<i class="fa fa-info-circle"></i> No posts yet.';
                        postsContainer.appendChild(msg);
                    }, 1000);
                    hasNext = false;
                    loading = false;
                    return;
                }

                // Add each post with a staggered animation
                data.posts.forEach((post, index) => {
                    setTimeout(() => {
                        const article = document.createElement('article');
                        article.className = 'post-card fade-in';
                        article.innerHTML = `
                            <h2><a href="/post/${post.id}">${post.title}</a></h2>
                            <p class="date">${post.date_posted}</p>
                            ${post.image_filename ? `<img src="/static/images/${post.image_filename}" alt="Post image" class="post-thumb">` : ''}
                            <p>${post.content}</p>
                            ${post.github_link ? `<p class="github-link"><a href="${post.github_link}" target="_blank"><i class="fa fa-github"></i> View on GitHub</a></p>` : ''}
                        `;
                        postsContainer.appendChild(article);

                        // Trigger animation
                        setTimeout(() => {
                            article.classList.add('visible');
                        }, 50);
                    }, index * 200); // Stagger each post by 200ms
                });

                hasNext = data.has_next;
                page++;
            } catch (error) {
                console.error("Error loading posts:", error);
                const errorMsg = document.createElement('div');
                errorMsg.className = 'error-msg';
                errorMsg.innerHTML = '<i class="fa fa-exclamation-circle"></i> Failed to load posts. Please try again.';
                postsContainer.appendChild(errorMsg);
            } finally {
                // Hide loader after all posts are added
                setTimeout(() => {
                    loader.style.display = 'none';
                    loader.classList.remove('pulsing');
                    loading = false;
                }, data?.posts?.length * 200 + 300 || 500);
            }
        }

        // Initial load
        loadPosts();

        // Improved scroll detection with debounce
        let scrollTimeout;
        window.addEventListener('scroll', () => {
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => {
                if (window.innerHeight + window.scrollY > document.body.offsetHeight - 500) {
                    loadPosts();
                }
            }, 100);
        });
    }
}

// Collapsible sidebar with enhanced animation
function initSidebar() {
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const mainContent = document.querySelector('main');

    if (sidebar && sidebarToggle) {
        sidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
            sidebarToggle.classList.toggle('active');

            // Add blur effect to main content when sidebar is open
            if (sidebar.classList.contains('open')) {
                mainContent.classList.add('sidebar-open');
                mainContent.style.filter = 'blur(3px)';
                mainContent.style.transform = 'scale(0.98)';
            } else {
                mainContent.classList.remove('sidebar-open');
                mainContent.style.filter = '';
                mainContent.style.transform = '';
            }

            // Animate the toggle icon
            if (sidebar.classList.contains('open')) {
                sidebarToggle.innerHTML = '<i class="fa fa-times"></i>';
            } else {
                sidebarToggle.innerHTML = '<i class="fa fa-bars"></i>';
            }
        });

        // Close sidebar when clicking outside
        document.addEventListener('click', (e) => {
            if (sidebar.classList.contains('open') &&
                !sidebar.contains(e.target) &&
                e.target !== sidebarToggle) {
                sidebar.classList.remove('open');
                mainContent.classList.remove('sidebar-open');
                mainContent.style.filter = '';
                mainContent.style.transform = '';
                sidebarToggle.innerHTML = '<i class="fa fa-bars"></i>';
                sidebarToggle.classList.remove('active');
            }
        });
    }
}

// Page initialization
document.addEventListener('DOMContentLoaded', () => {
    // Always show loading animation on the first page load
    const isFirstVisit = !sessionStorage.getItem('visited');

    if (isFirstVisit || window.location.pathname === '/') {
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

        // Initialize loading animation
        initLoadingAnimation();

        // Set visited flag in session storage
        sessionStorage.setItem('visited', 'true');
    } else {
        // For non-first visits to non-home pages, ensure main content is visible
        const mainContent = document.querySelector('main');
        if (mainContent) {
            mainContent.style.opacity = '1';
        }
    }

    // Initialize other components
    initInfiniteScroll();
    initSidebar();
});