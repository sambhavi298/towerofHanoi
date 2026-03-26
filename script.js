console.log("Script running - Initializing Premium 3D Simulator...");

// --- Global Error Reporting ---
window.onerror = function (msg, url, line) {
    const errorMsg = `CRASH: ${msg} at ${line}`;
    console.error(errorMsg);
    const hud = document.getElementById("explain");
    if (hud) hud.innerText = errorMsg;
    return false;
};

// --- DOM Elements (SAFE FALLBACKS) ---
const explainText = document.getElementById("explain") || { innerText: "" };
const moveCountEl = document.getElementById("moveCount") || { innerText: "" };
const optimalEl = document.getElementById("optimal") || { innerText: "" };

// --- Animation State ---
let currentMove = null;
let moveProgress = 0;
let moveSpeed = 0.02;
let moves = [];
let optimalMoves = [];
let moveIndex = 0;
let userMoves = 0;
let isPlaying = false;
let mode = "ai"; // "ai" or "user"
let selectedDisk = null;
let selectedPeg = null;
let history = [];
let redoStack = [];
let learningMode = false;

// --- Scene Setup ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020617);

// --- Camera (STABILIZED) ---
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 10, 15);
camera.lookAt(0, 2, 0);

// --- Renderer (SHADOWS ENABLED) ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// --- Orbit Controls ---
try {
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enabled = false;
} catch (e) {
    console.warn("OrbitControls failed to load.");
}

// --- Raycaster ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// --- Cinematic Lighting ---
scene.add(new THREE.AmbientLight(0xffffff, 0.6));

const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
keyLight.position.set(5, 10, 5);
keyLight.castShadow = true;
keyLight.shadow.mapSize.width = 1024;
keyLight.shadow.mapSize.height = 1024;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0x38bdf8, 0.6);
fillLight.position.set(-5, 5, -5);
scene.add(fillLight);

const backLight = new THREE.PointLight(0x6366f1, 1.0);
backLight.position.set(0, 10, -10);
scene.add(backLight);

// --- Animated Particles ---
const particlesGeometry = new THREE.BufferGeometry();
const particlesCount = 800;
const positions = new Float32Array(particlesCount * 3);
for (let i = 0; i < particlesCount * 3; i++) positions[i] = (Math.random() - 0.5) * 40;
particlesGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
const particles = new THREE.Points(particlesGeometry, new THREE.PointsMaterial({ size: 0.05, color: 0x38bdf8 }));
scene.add(particles);

// --- Floor (SHADOW RECEIVER) ---
const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30),
    new THREE.MeshStandardMaterial({ color: 0x1f2937, metalness: 0.2, roughness: 0.7 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// --- Pegs ---
const pegs = [];
function createPeg(x) {
    const peg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.25, 0.25, 5, 32),
        new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0ea5e9, emissiveIntensity: 0.3 })
    );
    peg.position.set(x, 2.5, 0);
    peg.castShadow = true;
    peg.receiveShadow = true;
    scene.add(peg);
    pegs.push(peg);
}
createPeg(-5); createPeg(0); createPeg(5);

// --- Disks & Stacks ---
const disks = [];
let pegStacks = [[], [], []];
const diskColors = [0x6366f1, 0x8b5cf6, 0xec4899, 0xf59e0b, 0x22c55e, 0x10b981, 0x3b82f6, 0xef4444];

function createDisk(size, pegIndex, heightIndex) {
    const disk = new THREE.Mesh(
        new THREE.CylinderGeometry(size, size, 0.5, 32),
        new THREE.MeshStandardMaterial({
            color: diskColors[heightIndex % diskColors.length],
            roughness: 0.3,
            metalness: 0.5,
            emissive: 0x1e1b4b,
            emissiveIntensity: 0.3
        })
    );
    disk.position.set(pegs[pegIndex].position.x, 0.25 + heightIndex * 0.6, 0);
    disk.castShadow = true;
    disk.receiveShadow = true;
    scene.add(disk);
    disks.push(disk);
    pegStacks[pegIndex].push(disk);
}

function setMode(m) {
    mode = m;
    history = [];
    redoStack = [];
    resetGame();
}

function resetGame(nFromUI) {
    try {
        disks.forEach(d => { scene.remove(d); d.scale.set(1, 1, 1); });
        disks.length = 0;
        pegStacks = [[], [], []];

        let n = nFromUI;
        if (!n || isNaN(n)) {
            const slider = document.getElementById("diskSlider");
            n = (slider && !isNaN(parseInt(slider.value))) ? parseInt(slider.value) : 4;
        }

        moveIndex = 0;
        userMoves = 0;
        moveCountEl.innerText = 0;
        selectedDisk = null;
        selectedPeg = null;
        history = [];
        redoStack = [];

        for (let i = n; i >= 1; i--) createDisk(i * 0.7, 0, n - i);

        moves = [];
        optimalMoves = [];
        generateMoves(n, 0, 2, 1);
        optimalEl.innerText = Math.pow(2, n) - 1;

        isPlaying = (mode === "ai");
        explainText.innerText = (mode === "ai") ? "AI Mode: Watch the recursive solver solve the problem optimally." : "User Mode: Click a disk, then click a target peg to move.";
        updateProgress();
    } catch (e) {
        console.error("Critical error in resetGame:", e);
    }
}

function showExplanation(from, to, n) {
    let reason = "";
    if (n === 1) reason = "Moving smallest disk (base case)";
    else if (from === 0 && to === 2) reason = "Transferring stack to destination peg";
    else reason = "Solving subproblem and reassembling stack";

    explainText.innerText = `Step ${moveIndex + 1}\n\nMove: Peg ${from + 1} → Peg ${to + 1}\n\nAI Reason:\n${reason}`;
}

function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

function resetSelection() {
    if (selectedDisk) selectedDisk.material.emissiveIntensity = 0.3;
    pegs.forEach(p => { p.material.emissive = new THREE.Color(0x0ea5e9); p.material.emissiveIntensity = 0.3; });
    selectedDisk = null; selectedPeg = null;
}

function triggerShake() {
    const hud = document.getElementById("hud");
    if (!hud) return;
    hud.classList.remove("shake");
    void hud.offsetWidth; // trigger reflow
    hud.classList.add("shake");
    const s = document.getElementById("errorSound"); if (s) { s.currentTime = 0; s.play().catch(() => { }); }
}

function highlightValidMoves(disk) {
    pegs.forEach((peg, i) => {
        const top = pegStacks[i][pegStacks[i].length - 1];
        if (!top || top.geometry.parameters.radiusTop > disk.geometry.parameters.radiusTop) {
            peg.material.emissive = new THREE.Color(0x22c55e);
            peg.material.emissiveIntensity = 0.6;
        }
    });
}

function handleDiskClick(disk) {
    if (currentMove) return;
    let pIdx = pegStacks.findIndex(s => s.includes(disk));
    if (pIdx === -1) return;
    if (disk !== pegStacks[pIdx][pegStacks[pIdx].length - 1]) {
        explainText.innerText = "Error: You can only move the top-most disk of a tower.";
        triggerShake();
        return;
    }
    resetSelection();
    selectedDisk = disk; selectedPeg = pIdx;
    disk.material.emissive = new THREE.Color(0xffff00); disk.material.emissiveIntensity = 1.0;
    highlightValidMoves(disk);
    const s = document.getElementById("pickSound"); if (s) { s.currentTime = 0; s.play().catch(() => { }); }
}

function attemptMove(tIdx) {
    if (!selectedDisk) return;
    const sIdx = selectedPeg;
    const disk = selectedDisk;
    if (sIdx === tIdx) { resetSelection(); return; }
    const topT = pegStacks[tIdx][pegStacks[tIdx].length - 1];
    if (topT && topT.geometry.parameters.radiusTop < disk.geometry.parameters.radiusTop) {
        explainText.innerText = "Invalid Move: You cannot place a larger disk on top of a smaller one.";
        triggerShake();
        resetSelection(); return;
    }
    userMoves++; moveCountEl.innerText = userMoves;
    moveDisk(sIdx, tIdx); resetSelection();
}

function showHint() {
    const next = optimalMoves[moveIndex];
    if (next && mode === "user") {
        explainText.innerText = `Hint: Try moving the disk from Peg ${next[0] + 1} to Peg ${next[1] + 1}.`;
        pegs[next[0]].material.emissive = new THREE.Color(0xffff00);
        pegs[next[1]].material.emissive = new THREE.Color(0x22c55e);
    }
}

function undoMove() {
    if (history.length === 0 || currentMove) return;
    const [from, to] = history.pop();
    redoStack.push([from, to]);
    moveDisk(to, from, true);
}

function redoMove() {
    if (redoStack.length === 0 || currentMove) return;
    const [from, to] = redoStack.pop();
    moveDisk(from, to);
}

function getEfficiency() {
    const optimal = Math.pow(2, disks.length) - 1;
    return ((optimal / userMoves) * 100).toFixed(1);
}

function checkUserWin() {
    if (pegStacks[2].length === disks.length && mode === "user") {
        const optimal = Math.pow(2, disks.length) - 1;
        updateProgress();
        setTimeout(() => {
            explainText.innerText = `🎉 Solved!\n\nYour moves: ${userMoves}\nOptimal: ${optimal}\nEfficiency: ${getEfficiency()}%`;
            disks.forEach(d => d.scale.set(1.1, 1.1, 1.1));
            const s = document.getElementById("winSound"); if (s) { s.currentTime = 0; s.play().catch(() => { }); }
        }, 500);
    }
}

function updateProgress() {
    const total = Math.pow(2, disks.length) - 1;
    const current = (mode === "ai") ? moveIndex : userMoves;
    const percent = Math.min((current / total) * 100, 100);
    const bar = document.getElementById("progress-bar");
    if (bar) bar.style.width = percent + "%";
}

function toggleLearningMode() {
    learningMode = !learningMode;
    moveSpeed = learningMode ? 0.01 : 0.02;
    const btn = document.getElementById("learnToggle");
    if (btn) btn.innerText = `Learning Mode: ${learningMode ? "ON" : "OFF"}`;
    if (learningMode) showHint();
}

function generateMoves(n, f, t, a) {
    if (n === 1) { moves.push([f, t, 1]); optimalMoves.push([f, t, 1]); return; }
    generateMoves(n - 1, f, a, t);
    moves.push([f, t, n]); optimalMoves.push([f, t, n]);
    generateMoves(n - 1, a, t, f);
}

function moveDisk(f, t, isUndo) {
    if (pegStacks[f].length === 0) return;
    const disk = pegStacks[f].pop();
    const targetH = pegStacks[t].length;
    disk.material.emissiveIntensity = 1.0;
    pegs[f].material.emissive = new THREE.Color(0xef4444);
    pegs[t].material.emissive = new THREE.Color(0x10b981);

    if (!isUndo && mode === "user") {
        history.push([f, t]);
        redoStack = [];
    }

    currentMove = {
        disk, fromPeg: f, toPeg: t, startX: pegs[f].position.x, endX: pegs[t].position.x,
        liftHeight: 7, startY: disk.position.y, endY: 0.25 + targetH * 0.6, phase: "lift"
    };
    moveProgress = 0;
}

function animateMove() {
    const m = currentMove; const d = m.disk; moveProgress += moveSpeed;
    if (m.phase === "lift") {
        d.position.y += 0.15; if (d.position.y >= m.liftHeight) { m.phase = "move"; moveProgress = 0; }
    } else if (m.phase === "move") {
        const t = easeInOut(Math.min(moveProgress, 1.0));
        d.position.x = m.startX + (m.endX - m.startX) * t;
        d.position.y = m.liftHeight + Math.sin(t * Math.PI) * 2;
        d.rotation.y += 0.05;
        if (t >= 1.0) { d.position.x = m.endX; m.phase = "drop"; }
    } else if (m.phase === "drop") {
        d.position.y -= 0.15;
        if (d.position.y <= m.endY) {
            d.position.y = m.endY; d.material.emissiveIntensity = 0.3;
            pegs[m.fromPeg].material.emissive = new THREE.Color(0x0ea5e9);
            pegs[m.toPeg].material.emissive = new THREE.Color(0x0ea5e9);
            pegStacks[m.toPeg].push(d); currentMove = null;
            updateProgress();
            const s = document.getElementById("moveSound"); if (s) { s.currentTime = 0; s.play().catch(() => { }); }
            if (mode === "user") {
                checkUserWin();
                if (learningMode) showHint();
            }
            else if (mode === "ai" && moveIndex >= moves.length) {
                isPlaying = false;
                disks.forEach(d => d.scale.set(1.1, 1.1, 1.1));
                const s = document.getElementById("winSound"); if (s) { s.currentTime = 0; s.play().catch(() => { }); }
            }
        }
    }
}

function animate() {
    requestAnimationFrame(animate);
    if (isPlaying && !currentMove && moves[moveIndex]) {
        const [f, t, n] = moves[moveIndex];
        showExplanation(f, t, n);
        moveDisk(f, t); moveIndex++; moveCountEl.innerText = moveIndex;
    }
    if (currentMove) animateMove();
    particles.rotation.y += 0.0005;
    renderer.render(scene, camera);
}
animate();

window.addEventListener("click", (e) => {
    if (mode !== "user" || currentMove) return;
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1; mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const dInt = raycaster.intersectObjects(disks, true);
    if (dInt.length > 0) {
        let obj = dInt[0].object;
        while (obj && !disks.includes(obj) && obj.parent) obj = obj.parent;
        handleDiskClick(obj); return;
    }
    if (selectedDisk) {
        const pInt = raycaster.intersectObjects(pegs, true);
        if (pInt.length > 0) {
            let pObj = pInt[0].object;
            while (pObj && !pegs.includes(pObj) && pObj.parent) pObj = pObj.parent;
            attemptMove(pegs.indexOf(pObj));
        }
    }
});

window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// INITIALIZE
try { resetGame(); } catch (e) { console.error("Initial load failed."); }
