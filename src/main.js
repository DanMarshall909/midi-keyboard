import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

// ── Key → MIDI note mapping (GarageBand layout) ──────────────────────────────
const KEY_MAP = {
    // Lower octave (baseOctave)
    z: 0, s: 1, x: 2, d: 3, c: 4,
    v: 5, g: 6, b: 7, h: 8, n: 9, j: 10, m: 11,
    // Upper octave (baseOctave + 1)
    q: 12, 2: 13, w: 14, 3: 15, e: 16,
    r: 17, 5: 18, t: 19, 6: 20, y: 21, 7: 22, u: 23,
};

// ── General MIDI patch names (program 0–127) ──────────────────────────────────
const GM_PATCHES = [
    ["Piano", [
        "Acoustic Grand Piano", "Bright Acoustic Piano", "Electric Grand Piano",
        "Honky-tonk Piano", "Electric Piano 1", "Electric Piano 2", "Harpsichord", "Clavi",
    ]],
    ["Chromatic Perc", [
        "Celesta", "Glockenspiel", "Music Box", "Vibraphone",
        "Marimba", "Xylophone", "Tubular Bells", "Dulcimer",
    ]],
    ["Organ", [
        "Drawbar Organ", "Percussive Organ", "Rock Organ", "Church Organ",
        "Reed Organ", "Accordion", "Harmonica", "Tango Accordion",
    ]],
    ["Guitar", [
        "Nylon Guitar", "Steel Guitar", "Jazz Guitar", "Clean Guitar",
        "Muted Guitar", "Overdriven Guitar", "Distortion Guitar", "Guitar Harmonics",
    ]],
    ["Bass", [
        "Acoustic Bass", "Finger Bass", "Pick Bass", "Fretless Bass",
        "Slap Bass 1", "Slap Bass 2", "Synth Bass 1", "Synth Bass 2",
    ]],
    ["Strings", [
        "Violin", "Viola", "Cello", "Contrabass",
        "Tremolo Strings", "Pizzicato Strings", "Orchestral Harp", "Timpani",
    ]],
    ["Ensemble", [
        "String Ensemble 1", "String Ensemble 2", "Synth Strings 1", "Synth Strings 2",
        "Choir Aahs", "Voice Oohs", "Synth Voice", "Orchestra Hit",
    ]],
    ["Brass", [
        "Trumpet", "Trombone", "Tuba", "Muted Trumpet",
        "French Horn", "Brass Section", "Synth Brass 1", "Synth Brass 2",
    ]],
    ["Reed", [
        "Soprano Sax", "Alto Sax", "Tenor Sax", "Baritone Sax",
        "Oboe", "English Horn", "Bassoon", "Clarinet",
    ]],
    ["Pipe", [
        "Piccolo", "Flute", "Recorder", "Pan Flute",
        "Blown Bottle", "Shakuhachi", "Whistle", "Ocarina",
    ]],
    ["Synth Lead", [
        "Square Lead", "Sawtooth Lead", "Calliope Lead", "Chiff Lead",
        "Charang Lead", "Voice Lead", "Fifths Lead", "Bass+Lead",
    ]],
    ["Synth Pad", [
        "New Age Pad", "Warm Pad", "Polysynth Pad", "Choir Pad",
        "Bowed Pad", "Metallic Pad", "Halo Pad", "Sweep Pad",
    ]],
    ["Synth FX", [
        "Rain FX", "Soundtrack FX", "Crystal FX", "Atmosphere FX",
        "Brightness FX", "Goblins FX", "Echoes FX", "Sci-fi FX",
    ]],
    ["Ethnic", [
        "Sitar", "Banjo", "Shamisen", "Koto",
        "Kalimba", "Bag Pipe", "Fiddle", "Shanai",
    ]],
    ["Percussive", [
        "Tinkle Bell", "Agogo", "Steel Drums", "Woodblock",
        "Taiko Drum", "Melodic Tom", "Synth Drum", "Reverse Cymbal",
    ]],
    ["Sound FX", [
        "Guitar Fret Noise", "Breath Noise", "Seashore", "Bird Tweet",
        "Telephone Ring", "Helicopter", "Applause", "Gunshot",
    ]],
];

const GM_PATCH_NAMES = GM_PATCHES.flatMap(([, names]) => names);

// ── State ─────────────────────────────────────────────────────────────────────
let baseOctave = 4;
let velocity = 100;
let channel = 0;
let patch = 0;
let connected = false;
let arrowCc = 10;
let arrowCcValue = 64;
let modValue = 0;
const heldKeys = new Set();

// ── DOM refs ──────────────────────────────────────────────────────────────────
const appTitle = document.getElementById("app-title");
const portSelect = document.getElementById("port-select");
const refreshBtn = document.getElementById("refresh-btn");
const octaveDisplay = document.getElementById("octave-display");
const octDownBtn = document.getElementById("oct-down");
const octUpBtn = document.getElementById("oct-up");
const channelSelect = document.getElementById("channel-select");
const patchSelect = document.getElementById("patch-select");
const statusEl = document.getElementById("status");
const arrowCcSelect = document.getElementById("arrow-cc-select");
const keyboardContainer = document.getElementById("keyboard-container");
const titlebar = document.getElementById("titlebar");
const knobsRow = document.getElementById("knobs-row");
const sidebar = document.getElementById("sidebar");
const modTrack = document.getElementById("mod-track");
const modFill = document.getElementById("mod-fill");
const modGrip = document.getElementById("mod-grip");
const modValEl = document.getElementById("mod-val");

// ── 3D Keyboard ───────────────────────────────────────────────────────────────
const WHITE_OFFSETS = [0, 2, 4, 5, 7, 9, 11];
const BLACK_KEY_DEFS = [
    { semitone: 1, whitePos: 0.5 },
    { semitone: 3, whitePos: 1.5 },
    { semitone: 6, whitePos: 3.5 },
    { semitone: 8, whitePos: 4.5 },
    { semitone: 10, whitePos: 5.5 },
];

// Key dimensions (Three.js units)
const WKW = 1.85, WKH = 0.22, WKD = 5.8;   // white key width/height/depth
const BKW = 1.1, BKH = 0.55, BKD = 3.4;   // black key
const KEY_GAP = 0.06;

// Shared materials — no per-key cloning
const matWhite = new THREE.MeshStandardMaterial({ color: 0xf0f0eb, roughness: 0.35, metalness: 0.0 });
const matBlack = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.2, metalness: 0.05 });

const noteToMesh = {};
const meshToMidi = new Map();
const activeNotes = new Set();
let kbNeedsRender = true;

let kbScene, kbCamera, kbRenderer, kbRaycaster;
let kbSun, kbFill, kbAmbient;
let kbDiscoLights = [];
let discoMode = false;
let discoAngle = 0;
let strobeBurstStart = -1;  // performance.now() timestamp, -1 = idle
let strobeCountdown = 360;  // frames until next burst

const THEME_LIGHTS = {
    default:   { sun: { color: 0xfffaf0, intensity: 1.1 }, fill: { color: 0x00e8ff, intensity: 0.9 } },
    midnight:  { sun: { color: 0xd0d8ff, intensity: 0.65 }, fill: { color: 0x203070, intensity: 0.35 } },
    synthwave: { sun: { color: 0xff00ff, intensity: 1.3 }, fill: { color: 0x00ffff, intensity: 1.0 } },
    ember:     { sun: { color: 0xff9900, intensity: 1.4 }, fill: { color: 0xff4400, intensity: 0.7 } },
    matrix:    { sun: { color: 0x00ff66, intensity: 1.2 }, fill: { color: 0x00aa44, intensity: 0.15 } },
};

function setThemeLighting(name) {
    if (!kbSun) return; // scene not yet initialized
    // Tear down any existing disco lights and clear inline CSS overrides
    for (const l of kbDiscoLights) kbScene.remove(l);
    kbDiscoLights = [];
    discoMode = false;
    strobeBurstStart = -1;
    strobeCountdown = 90;
    if (kbAmbient) kbAmbient.intensity = 0.55;
    for (const prop of [
        '--accent','--accent-border','--accent-blight','--accent-glow','--accent-shadow',
        '--accent-bg','--accent-bg2','--accent-bg3',
        '--border-app','--border-sub','--border-ctrl','--border-modal',
        '--ctrl-bg','--ctrl-hover',
        '--knob-dot','--knob-ring',
        '--text-heading','--text-dim','--text-muted','--hk-color',
        '--mod-bg','--mod-border','--mod-grip-t','--mod-grip-b','--mod-grip-bdr',
    ]) {
        document.documentElement.style.removeProperty(prop);
    }

    if (name === 'disco') {
        discoMode = true;
        kbSun.color.set(0x303030);
        kbSun.intensity = 0.25;
        kbFill.color.set(0x101010);
        kbFill.intensity = 0.15;
        kbAmbient.intensity = 0.3;
        for (let i = 0; i < 4; i++) {
            const pl = new THREE.PointLight(0xffffff, 3.5, 22);
            pl.castShadow = false;
            kbScene.add(pl);
            kbDiscoLights.push(pl);
        }
        kbNeedsRender = true;
        return;
    }

    const cfg = THEME_LIGHTS[name] || THEME_LIGHTS.default;
    kbSun.color.set(cfg.sun.color);
    kbSun.intensity = cfg.sun.intensity;
    kbFill.color.set(cfg.fill.color);
    kbFill.intensity = cfg.fill.intensity;
    kbNeedsRender = true;
}

function initKeyboard3D() {
    const canvas = document.getElementById("keyboard-canvas");
    const container = keyboardContainer;

    kbScene = new THREE.Scene();
    kbRaycaster = new THREE.Raycaster();

    // Renderer
    kbRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    kbRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
    kbRenderer.shadowMap.enabled = true;
    kbRenderer.shadowMap.type = THREE.PCFShadowMap;

    // Camera — low perspective angle, player's-eye view
    const w = container.clientWidth || 700;
    const h = container.clientHeight || 200;
    kbCamera = new THREE.PerspectiveCamera(25, w / h, 0.1, 100);
    kbCamera.position.set(0, 15, 10);
    kbCamera.lookAt(0, 0, 0);
    kbRenderer.setSize(w, h);

    // Lighting
    kbAmbient = new THREE.AmbientLight(0xffffff, 0.55);
    kbScene.add(kbAmbient);

    kbSun = new THREE.DirectionalLight(0xff0000, 10.1);
    kbSun.position.set(-12, 12, -8);
    kbSun.castShadow = true;
    kbSun.shadow.mapSize.set(1024, 1024);
    kbSun.shadow.camera.left = -18;
    kbSun.shadow.camera.right = 18;
    kbSun.shadow.camera.top = 10;
    kbSun.shadow.camera.bottom = -10;
    kbSun.shadow.camera.near = 1;
    kbSun.shadow.camera.far = 40;
    kbScene.add(kbSun);

    kbFill = new THREE.DirectionalLight(0x00ff, 12.9);
    kbFill.position.set(12, 12, -8);
    kbScene.add(kbFill);

    // Keyboard frame / fallboard
    const frameGeo = new THREE.BoxGeometry(14 * (WKW + KEY_GAP) + 0.4, 0.18, WKD + 0.6);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x111118, roughness: 0.6 });
    const frame = new THREE.Mesh(frameGeo, frameMat);
    frame.position.set(0, -WKH / 2 - 0.09, 0);
    frame.receiveShadow = true;
    kbScene.add(frame);

    buildKeys3D();

    // Mouse events via raycasting
    canvas.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        const midi = raycastMidi(e);
        if (midi !== null) triggerNoteOn(midi);
    });
    canvas.addEventListener("mouseup", () => {
        for (const midi of [...activeNotes]) triggerNoteOff(midi);
    });
    canvas.addEventListener("mouseleave", () => {
        for (const midi of [...activeNotes]) triggerNoteOff(midi);
    });
    canvas.addEventListener("mousemove", (e) => {
        // slide: release keys no longer under cursor while dragging
        if (e.buttons !== 1) return;
        const midi = raycastMidi(e);
        for (const held of [...activeNotes]) {
            if (held !== midi) triggerNoteOff(held);
        }
        if (midi !== null && !activeNotes.has(midi)) triggerNoteOn(midi);
    });

    // On-demand render loop; disco mode forces continuous animation
    (function loop() {
        requestAnimationFrame(loop);
        if (discoMode) {
            discoAngle += 0.02;
            // Slowly drifting orbit center
            const cx = Math.sin(discoAngle * 0.31) * 6.5;
            const cz = Math.cos(discoAngle * 0.19) * 3.5;
            for (let i = 0; i < kbDiscoLights.length; i++) {
                const a = discoAngle + i * (Math.PI / 2);
                kbDiscoLights[i].position.set(
                    cx + Math.cos(a) * 9,
                    5.5 + Math.sin(discoAngle * 1.7 + i) * 1.5,
                    cz + Math.sin(a) * 5
                );
                kbDiscoLights[i].color.setHSL(((discoAngle * 25 + i * 90) % 360) / 360, 1, 0.5);
            }
            // Occasional 3-flash strobe burst
            // Occasional 3-flash strobe burst, flashes 25 ms apart
            const now = performance.now();
            if (strobeBurstStart >= 0) {
                const elapsed = now - strobeBurstStart;
                const burstDuration = 3 * 25 * 2; // 3 flashes × (25ms on + 25ms off)
                if (elapsed >= burstDuration) {
                    kbAmbient.intensity = 0.3;
                    strobeBurstStart = -1;
                    strobeCountdown = 240 + Math.random() * 720;
                } else {
                    const slot = Math.floor(elapsed / 25);
                    kbAmbient.intensity = (slot % 2 === 0) ? 1.2 : 0.3;
                }
            } else if (--strobeCountdown <= 0) {
                strobeBurstStart = performance.now();
            }
            // Cycle every themed CSS variable through offset hues
            const h1 = (discoAngle * 15) % 360;
            const h2 = (h1 + 120) % 360;
            const h3 = (h1 + 240) % 360;
            const r = document.documentElement;
            r.style.setProperty('--accent',        `hsl(${h1},100%,65%)`);
            r.style.setProperty('--accent-border', `hsla(${h1},100%,65%,0.4)`);
            r.style.setProperty('--accent-blight', `hsla(${h1},100%,65%,0.25)`);
            r.style.setProperty('--accent-glow',   `hsla(${h1},100%,65%,0.2)`);
            r.style.setProperty('--accent-shadow', `hsla(${h1},100%,65%,0.6)`);
            r.style.setProperty('--accent-bg',     `hsla(${h1},80%,20%,0.4)`);
            r.style.setProperty('--accent-bg2',    `hsla(${h1},80%,15%,0.55)`);
            r.style.setProperty('--accent-bg3',    `hsla(${h1},80%,8%,0.9)`);
            r.style.setProperty('--border-app',    `hsla(${h1},100%,60%,0.2)`);
            r.style.setProperty('--border-sub',    `hsla(${h1},100%,60%,0.1)`);
            r.style.setProperty('--border-ctrl',   `hsla(${h1},100%,60%,0.3)`);
            r.style.setProperty('--border-modal',  `hsla(${h1},100%,60%,0.25)`);
            r.style.setProperty('--ctrl-bg',       `hsla(${h1},100%,60%,0.08)`);
            r.style.setProperty('--ctrl-hover',    `hsla(${h1},100%,60%,0.18)`);
            r.style.setProperty('--knob-dot',      `hsl(${h1},100%,70%)`);
            r.style.setProperty('--knob-ring',     `hsla(${h1},100%,65%,0.4)`);
            r.style.setProperty('--text-heading',  `hsl(${h1},100%,75%)`);
            r.style.setProperty('--text-dim',      `hsl(${h1},60%,45%)`);
            r.style.setProperty('--text-muted',    `hsl(${h1},55%,35%)`);
            r.style.setProperty('--hk-color',      `hsl(${h1},100%,65%)`);
            r.style.setProperty('--mod-bg',        `hsla(${h1},60%,12%,0.55)`);
            r.style.setProperty('--mod-border',    `hsla(${h1},100%,60%,0.2)`);
            r.style.setProperty('--mod-grip-t',    `hsl(${h1},60%,30%)`);
            r.style.setProperty('--mod-grip-b',    `hsl(${h1},60%,15%)`);
            r.style.setProperty('--mod-grip-bdr',  `hsla(${h1},100%,65%,0.4)`);
            kbNeedsRender = true;
        }
        if (!kbNeedsRender) return;
        kbNeedsRender = false;
        kbRenderer.render(kbScene, kbCamera);
    })();
}

function buildKeys3D() {
    // Remove and dispose old meshes
    for (const mesh of Object.values(noteToMesh)) {
        kbScene.remove(mesh);
        mesh.geometry.dispose();
    }
    Object.keys(noteToMesh).forEach(k => delete noteToMesh[k]);
    meshToMidi.clear();

    const totalOctaves = 2;
    const totalWhite = totalOctaves * 7;
    const totalW = totalWhite * (WKW + KEY_GAP);
    const startX = -totalW / 2 + (WKW + KEY_GAP) / 2;

    // White keys — shared geometry, shared material
    const whiteGeo = new RoundedBoxGeometry(WKW, WKH, WKD, 3, 0.055);
    for (let oct = 0; oct < totalOctaves; oct++) {
        for (let i = 0; i < WHITE_OFFSETS.length; i++) {
            const midi = (baseOctave + oct) * 12 + 12 + WHITE_OFFSETS[i];
            const x = startX + (oct * 7 + i) * (WKW + KEY_GAP);
            const mesh = new THREE.Mesh(whiteGeo, matWhite);
            mesh.position.set(x, 0, 0);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.userData = { midi, isBlack: false, baseY: 0 };
            kbScene.add(mesh);
            noteToMesh[midi] = mesh;
            meshToMidi.set(mesh, midi);
        }
    }

    // Black keys — shared geometry, shared material
    const blackGeo = new RoundedBoxGeometry(BKW, BKH, BKD, 3, 0.055);
    const blackY = (WKH + BKH) / 2;
    const blackZ = -(WKD - BKD) / 2;
    for (let oct = 0; oct < totalOctaves; oct++) {
        for (const bk of BLACK_KEY_DEFS) {
            const midi = (baseOctave + oct) * 12 + 12 + bk.semitone;
            const x = startX + (oct * 7 + bk.whitePos) * (WKW + KEY_GAP);
            const mesh = new THREE.Mesh(blackGeo, matBlack);
            mesh.position.set(x, blackY, blackZ);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.userData = { midi, isBlack: true, baseY: blackY };
            kbScene.add(mesh);
            noteToMesh[midi] = mesh;
            meshToMidi.set(mesh, midi);
        }
    }

    kbNeedsRender = true;
}

function setKeyActive(midi, on) {
    const mesh = noteToMesh[midi];
    if (!mesh) return;
    const { isBlack, baseY } = mesh.userData;
    if (on) {
        mesh.position.y = baseY - (isBlack ? 0.18 : 0.14);
        activeNotes.add(midi);
    } else {
        mesh.position.y = baseY;
        activeNotes.delete(midi);
    }
    kbNeedsRender = true;
}

function raycastMidi(event) {
    const canvas = kbRenderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    kbRaycaster.setFromCamera({ x, y }, kbCamera);
    const hits = kbRaycaster.intersectObjects(Object.values(noteToMesh));
    if (!hits.length) return null;
    // Black keys take priority
    const black = hits.find(h => h.object.userData.isBlack);
    return meshToMidi.get((black || hits[0]).object) ?? null;
}

function resizeKeyboard3D() {
    const w = keyboardContainer.clientWidth;
    const h = keyboardContainer.clientHeight;
    if (w < 10 || h < 10) return;
    kbRenderer.setSize(w, h);
    kbCamera.aspect = w / h;
    kbCamera.updateProjectionMatrix();
    kbNeedsRender = true;
}

// ── MIDI helpers ──────────────────────────────────────────────────────────────
function midiNoteFromKey(key) {
    const offset = KEY_MAP[key];
    if (offset === undefined) return null;
    return baseOctave * 12 + 12 + offset;
}

async function triggerNoteOn(midi) {
    if (!connected) return;
    setKeyActive(midi, true);
    try {
        await invoke("note_on", { channel, note: midi, velocity });
    } catch (e) {
        setStatus(e, "error");
    }
}

async function triggerNoteOff(midi) {
    if (!connected) return;
    setKeyActive(midi, false);
    try {
        await invoke("note_off", { channel, note: midi });
    } catch (e) {
        setStatus(e, "error");
    }
}

// ── Mod wheel (centered, ±127 range) ──────────────────────────────────────────
function updateModWheel() {
    const trackH = modTrack.clientHeight || 80;  // fallback to default height if layout not ready
    const gripH = 18;

    // Center position for value 0
    const centerPos = (trackH - gripH) / 2;

    if (modValue >= 0) {
        // Positive: fill upward from center
        const fillHeight = (modValue / 127) * centerPos;
        modFill.style.height = `${fillHeight}px`;
        modFill.style.bottom = `${centerPos}px`;
    } else {
        // Negative: fill downward from center
        const fillHeight = (-modValue / 127) * centerPos;
        modFill.style.height = `${fillHeight}px`;
        modFill.style.bottom = "0";
    }

    // Grip position (centered at 0, extends ±127)
    const gripPos = centerPos + (modValue / 127) * centerPos;
    modGrip.style.bottom = `${Math.max(0, Math.min(trackH - gripH, gripPos))}px`;
    modValEl.textContent = modValue;
}

modTrack.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startVal = modValue;
    const trackH = modTrack.clientHeight;

    function onMove(ev) {
        const dy = startY - ev.clientY; // drag up = positive
        const centerPos = (trackH - 18) / 2;
        const sensitivity = 0.35; // finer granularity (3x more precision)
        modValue = Math.round((dy / centerPos) * 127 * sensitivity);
        modValue = Math.max(-127, Math.min(127, modValue + startVal));
        updateModWheel();
        // Map ±127 to MIDI 0-127 for CC
        const midiValue = Math.round((modValue + 127) / 2);
        if (connected) invoke("send_cc", { channel, cc: 1, value: midiValue }).catch(() => { });
    }
    function onUp() {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
});

// ── Rotary knob system ────────────────────────────────────────────────────────
function knobRotation(value, min, max) {
    return -135 + ((value - min) / (max - min)) * 270;
}

// ── 3D Knob rendering ─────────────────────────────────────────────────────────
const knob3DMap = new WeakMap();
const allKnob3DData = [];

function parseCssColorToHex(varName) {
    const str = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    const m = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (m) return (parseInt(m[1]) << 16) | (parseInt(m[2]) << 8) | parseInt(m[3]);
    const h = str.replace(/^#/, '');
    if (h.length === 6) return parseInt(h, 16);
    if (h.length === 3) return parseInt(h[0] + h[0] + h[1] + h[1] + h[2] + h[2], 16);
    return 0x7ab4ff;
}

function refreshKnob3DColors() {
    const col = parseCssColorToHex('--knob-dot');
    for (const data of allKnob3DData) {
        data.pipMat.color.setHex(col);
        data.pipMat.emissive.setHex(col);
        data.pipMat.needsUpdate = true;
        data.renderer.render(data.scene, data.camera);
    }
}

function initKnob3D(canvasEl) {
    const CSS_SIZE = 36;
    canvasEl.style.width = CSS_SIZE + 'px';
    canvasEl.style.height = CSS_SIZE + 'px';

    const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(CSS_SIZE, CSS_SIZE);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
    camera.position.set(0, 4.2, 1.5);
    camera.lookAt(0, 0, 0);

    const ambient = new THREE.AmbientLight(0xffffff, 0.50);
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
    keyLight.position.set(2, 4, 2);
    const rimLight = new THREE.DirectionalLight(0x4466cc, 0.35);
    rimLight.position.set(-1.5, 2, -2);
    scene.add(ambient, keyLight, rimLight);

    // Tapered cylinder body
    const bodyGeo = new THREE.CylinderGeometry(0.60, 0.70, 0.28, 32);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x282828, roughness: 0.28, metalness: 0.65 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    scene.add(body);

    // Flat top cap — slightly lighter
    const capGeo = new THREE.CylinderGeometry(0.59, 0.60, 0.025, 32);
    const capMat = new THREE.MeshStandardMaterial({ color: 0x3c3c3c, roughness: 0.18, metalness: 0.75 });
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.position.y = 0.15;
    scene.add(cap);

    // Indicator pip on top face, child of body so it rotates with it
    const pipGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.055, 10);
    const pipCol = parseCssColorToHex('--knob-dot');
    const pipMat = new THREE.MeshStandardMaterial({
        color: pipCol, emissive: pipCol, emissiveIntensity: 0.55,
        roughness: 0.1, metalness: 0.1,
    });
    const pip = new THREE.Mesh(pipGeo, pipMat);
    pip.position.set(0, 0.19, 0.38);
    body.add(pip);

    const data = { renderer, scene, camera, body, pipMat };
    knob3DMap.set(canvasEl, data);
    allKnob3DData.push(data);
    return data;
}

function setKnob3DAngle(knobEl, value) {
    const data = knob3DMap.get(knobEl);
    if (!data) return;
    const min = parseInt(knobEl.dataset.min);
    const max = parseInt(knobEl.dataset.max);
    data.body.rotation.y = knobRotation(value, min, max) * Math.PI / 180;
    data.renderer.render(data.scene, data.camera);
}

function initKnob(knobEl) {
    const val = parseInt(knobEl.dataset.value);
    initKnob3D(knobEl);
    setKnob3DAngle(knobEl, val);
}

function makeKnobDraggable(knobEl, valEl, onChange) {
    const min = parseInt(knobEl.dataset.min);
    const max = parseInt(knobEl.dataset.max);

    knobEl.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const startY = e.clientY;
        const startVal = parseInt(knobEl.dataset.value);

        function onMove(ev) {
            const dy = startY - ev.clientY; // drag up = increase
            const newVal = Math.max(min, Math.min(max, Math.round(startVal + dy * (max - min) / 100)));
            if (newVal === parseInt(knobEl.dataset.value)) return;
            knobEl.dataset.value = newVal;
            setKnob3DAngle(knobEl, newVal);
            valEl.textContent = newVal;
            onChange(newVal);
        }
        function onUp() {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
        }
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
    });
}

// Init velocity knob
const knobVel = document.getElementById("knob-vel");
const knobVelVal = document.getElementById("knob-vel-val");
initKnob(knobVel);
makeKnobDraggable(knobVel, knobVelVal, (v) => { velocity = v; });

// Init CC knobs
const CC_KNOBS = [
    ["knob-pan", "knob-pan-val"],
    ["knob-expr", "knob-expr-val"],
    ["knob-rev", "knob-rev-val"],
    ["knob-cho", "knob-cho-val"],
];
for (const [id, valId] of CC_KNOBS) {
    const el = document.getElementById(id);
    const valEl = document.getElementById(valId);
    const cc = parseInt(el.dataset.cc);
    initKnob(el);
    makeKnobDraggable(el, valEl, (v) => {
        if (connected) invoke("send_cc", { channel, cc, value: v }).catch(() => { });
    });
}

// ── Keyboard events ───────────────────────────────────────────────────────────
window.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === " " && !e.repeat) {
        e.preventDefault();
        if (connected) invoke("send_cc", { channel, cc: 64, value: 127 }).catch(() => { });
        return;
    }

    if (/^F[1-9]$/.test(e.key) && !e.repeat) {
        e.preventDefault();
        baseOctave = parseInt(e.key.slice(1)) - 1;
        octaveDisplay.textContent = baseOctave;
        buildKeyboard();
        return;
    }

    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
        const delta = (e.key === "ArrowUp" || e.key === "ArrowRight") ? 5 : -5;
        arrowCcValue = Math.max(0, Math.min(127, arrowCcValue + delta));
        if (connected) invoke("send_cc", { channel, cc: arrowCc, value: arrowCcValue }).catch(() => { });
        return;
    }

    if (e.repeat) return;
    const key = e.key.toLowerCase();
    if (heldKeys.has(key)) return;
    const midi = midiNoteFromKey(key);
    if (midi === null) return;
    e.preventDefault();
    heldKeys.add(key);
    triggerNoteOn(midi);
});

window.addEventListener("keyup", (e) => {
    if (e.key === " ") {
        if (connected) invoke("send_cc", { channel, cc: 64, value: 0 }).catch(() => { });
        return;
    }
    const key = e.key.toLowerCase();
    heldKeys.delete(key);
    const midi = midiNoteFromKey(key);
    if (midi === null) return;
    e.preventDefault();
    triggerNoteOff(midi);
});

// Mouse wheel = modulation (CC 1)
window.addEventListener("wheel", (e) => {
    e.preventDefault();
    modValue = Math.max(-127, Math.min(127, modValue - Math.sign(e.deltaY) * 5));
    updateModWheel();
    const midiValue = Math.round((modValue + 127) / 2);
    if (connected) invoke("send_cc", { channel, cc: 1, value: midiValue }).catch(() => { });
}, { passive: false });

// Middle click = reset modulation
window.addEventListener("auxclick", (e) => {
    if (e.button !== 1) return;
    e.preventDefault();
    e.stopPropagation();
    modValue = 0;
    updateModWheel();
    if (connected) invoke("send_cc", { channel, cc: 1, value: 64 }).catch(() => { });
});

// Release all held notes on window blur
window.addEventListener("blur", () => {
    if (connected) {
        invoke("send_cc", { channel, cc: 64, value: 0 }).catch(() => { });
        modValue = 0;
        updateModWheel();
        invoke("send_cc", { channel, cc: 1, value: 0 }).catch(() => { });
    }
    for (const key of heldKeys) {
        const midi = midiNoteFromKey(key);
        if (midi !== null) triggerNoteOff(midi);
    }
    heldKeys.clear();
});

// ── Port management ───────────────────────────────────────────────────────────
async function loadPorts() {
    try {
        const ports = await invoke("get_midi_ports");
        portSelect.innerHTML = '<option value="">-- Port --</option>';
        ports.forEach((name, i) => {
            const opt = document.createElement("option");
            opt.value = i;
            opt.textContent = name;
            portSelect.appendChild(opt);
        });
        if (ports.length === 0) { setStatus("No MIDI outputs", "error"); return; }
        setStatus(`${ports.length} port(s)`);

        const lastPort = localStorage.getItem("lastMidiPort");
        if (lastPort) {
            const idx = ports.indexOf(lastPort);
            if (idx !== -1) {
                portSelect.value = idx;
                portSelect.dispatchEvent(new Event("change"));
            }
        }
    } catch (e) {
        setStatus(String(e), "error");
    }
}

portSelect.addEventListener("change", async () => {
    const idx = portSelect.value;
    if (idx === "") {
        await invoke("disconnect");
        connected = false;
        setStatus("Disconnected");
        return;
    }
    try {
        const name = await invoke("connect_port", { portIndex: parseInt(idx) });
        connected = true;
        setStatus(`✓ ${name}`, "connected");
        localStorage.setItem("lastMidiPort", name);
        await invoke("program_change", { channel, program: patch });
    } catch (e) {
        connected = false;
        setStatus(String(e), "error");
    }
});

refreshBtn.addEventListener("click", loadPorts);

// ── Controls ──────────────────────────────────────────────────────────────────
octDownBtn.addEventListener("click", () => {
    if (baseOctave > 0) { baseOctave--; octaveDisplay.textContent = baseOctave; buildKeys3D(); }
});
octUpBtn.addEventListener("click", () => {
    if (baseOctave < 8) { baseOctave++; octaveDisplay.textContent = baseOctave; buildKeys3D(); }
});

// Channel selector
for (let i = 1; i <= 16; i++) {
    const opt = document.createElement("option");
    opt.value = i - 1;
    opt.textContent = i;
    channelSelect.appendChild(opt);
}
channelSelect.addEventListener("change", () => {
    channel = parseInt(channelSelect.value);
});

// Patch selector
let programNumber = 0;
for (const [groupName, patches] of GM_PATCHES) {
    const group = document.createElement("optgroup");
    group.label = groupName;
    for (const name of patches) {
        const opt = document.createElement("option");
        opt.value = programNumber;
        opt.textContent = `${programNumber + 1}. ${name}`;
        group.appendChild(opt);
        programNumber++;
    }
    patchSelect.appendChild(group);
}

patchSelect.addEventListener("change", async () => {
    patch = parseInt(patchSelect.value);
    appTitle.textContent = GM_PATCH_NAMES[patch];
    if (!connected) return;
    try {
        await invoke("program_change", { channel, program: patch });
    } catch (e) {
        setStatus(String(e), "error");
    }
});

// Arrow CC selector
const ARROW_CC_OPTIONS = [
    [1, "1 – Mod Wheel"], [7, "7 – Volume"], [10, "10 – Pan"],
    [11, "11 – Expression"], [64, "64 – Sustain"], [71, "71 – Resonance"],
    [74, "74 – Brightness"], [91, "91 – Reverb"], [93, "93 – Chorus"],
];
for (const [num, label] of ARROW_CC_OPTIONS) {
    const opt = document.createElement("option");
    opt.value = num;
    opt.textContent = label;
    arrowCcSelect.appendChild(opt);
}
arrowCcSelect.value = String(arrowCc);
arrowCcSelect.addEventListener("change", () => {
    arrowCc = parseInt(arrowCcSelect.value);
    arrowCcValue = arrowCc === 10 ? 64 : 0;
});

// ── Aspect-ratio enforcement ──────────────────────────────────────────────────
const appWindow = getCurrentWindow();
let aspectCorrecting = false;
let prevLogW = 0;
let prevLogH = 0;

async function correctAspectRatio() {
    if (aspectCorrecting) return;
    aspectCorrecting = true;
    try {
        const size = await appWindow.innerSize();
        const sf = await appWindow.scaleFactor();
        const logW = size.width / sf;
        const logH = size.height / sf;
        const sidebarW = sidebar.offsetWidth;
        const vertOverhead = titlebar.offsetHeight + knobsRow.offsetHeight;
        const RATIO = 14 / 3.6;
        const dW = Math.abs(logW - prevLogW);
        const dH = Math.abs(logH - prevLogH);

        let newW, newH;
        if (dW >= dH) {
            // User dragged horizontally — correct height
            newW = logW;
            newH = Math.round((logW - sidebarW) / RATIO + vertOverhead);
        } else {
            // User dragged vertically — correct width
            newH = logH;
            newW = Math.round((logH - vertOverhead) * RATIO + sidebarW);
        }

        prevLogW = newW;
        prevLogH = newH;

        if (Math.abs(newW - logW) > 2 || Math.abs(newH - logH) > 2) {
            await appWindow.setSize(new LogicalSize(newW, newH));
        }
    } finally {
        setTimeout(() => { aspectCorrecting = false; }, 150);
    }
}

appWindow.onResized(() => { if (!isZooming) correctAspectRatio(); });

// ── Window controls ───────────────────────────────────────────────────────────
document.getElementById("close-btn").addEventListener("click", () => {
    getCurrentWindow().close();
});

// ── Zoom controls ─────────────────────────────────────────────────────────────
let zoomLevel = parseFloat(localStorage.getItem("zoomLevel")) || 1;
let baseWidth = 860;
let baseHeight = 320;
let isZooming = false;

const appEl = document.getElementById("app");

async function applyZoom() {
    if (isZooming) return;
    isZooming = true;

    try {
        const newWidth = Math.round(baseWidth * zoomLevel);
        const newHeight = Math.round(baseHeight * zoomLevel);
        await appWindow.setSize(new LogicalSize(newWidth, newHeight));
        appEl.style.transform = `scale(${zoomLevel})`;
        appEl.style.transformOrigin = "top left";
        localStorage.setItem("zoomLevel", zoomLevel.toFixed(2));
    } finally {
        isZooming = false;
    }
}

// Apply saved zoom level on startup after window is ready
window.addEventListener("load", () => {
    // Measure app element at 1x scale to get true base dimensions
    appEl.style.transform = "scale(1)";
    baseWidth = appEl.offsetWidth;
    baseHeight = appEl.offsetHeight;
    applyZoom();
    loadPorts();
});

// Zoom controls (in config modal)
const zoomInBtn = document.getElementById("zoom-in");
const zoomOutBtn = document.getElementById("zoom-out");
const zoomDisplay = document.getElementById("zoom-display");

function updateZoomDisplay() {
    zoomDisplay.textContent = Math.round(zoomLevel * 100) + "%";
}

zoomInBtn.addEventListener("click", () => {
    zoomLevel = Math.min(2, zoomLevel + 0.1);
    applyZoom();
    updateZoomDisplay();
});

zoomOutBtn.addEventListener("click", () => {
    zoomLevel = Math.max(0.5, zoomLevel - 0.1);
    applyZoom();
    updateZoomDisplay();
});

// ── Theme switcher ────────────────────────────────────────────────────────────
const swatches = document.querySelectorAll(".theme-swatch");

function applyTheme(name) {
    if (name === "default") {
        document.documentElement.removeAttribute("data-theme");
    } else {
        document.documentElement.setAttribute("data-theme", name);
    }
    swatches.forEach(s => s.classList.toggle("active", s.dataset.theme === name));
    localStorage.setItem("theme", name);
    setThemeLighting(name);
    refreshKnob3DColors();
}

swatches.forEach(s => s.addEventListener("click", () => applyTheme(s.dataset.theme)));

// Apply saved theme on startup
applyTheme(localStorage.getItem("theme") || "default");

// ── Help overlay ──────────────────────────────────────────────────────────────
const helpOverlay = document.getElementById("help-overlay");
document.getElementById("help-btn").addEventListener("click", () => {
    helpOverlay.classList.toggle("hidden");
});
document.getElementById("help-close").addEventListener("click", () => {
    helpOverlay.classList.add("hidden");
});
helpOverlay.addEventListener("click", (e) => {
    if (e.target === helpOverlay) helpOverlay.classList.add("hidden");
});

const configOverlay = document.getElementById("config-overlay");
document.getElementById("config-btn").addEventListener("click", () => {
    configOverlay.classList.toggle("hidden");
});
document.getElementById("config-close").addEventListener("click", () => {
    configOverlay.classList.add("hidden");
});
configOverlay.addEventListener("click", (e) => {
    if (e.target === configOverlay) configOverlay.classList.add("hidden");
});

// ── Status helper ─────────────────────────────────────────────────────────────
function setStatus(msg, type = "") {
    statusEl.textContent = msg;
    statusEl.className = type;
}

// ── Init ──────────────────────────────────────────────────────────────────────
octaveDisplay.textContent = baseOctave;
appTitle.textContent = GM_PATCH_NAMES[patch];
updateZoomDisplay();
initKeyboard3D();
updateModWheel();

appWindow.innerSize().then(s => appWindow.scaleFactor().then(sf => {
    prevLogW = s.width / sf;
    prevLogH = s.height / sf;
}));

new ResizeObserver(() => {
    resizeKeyboard3D();
    updateModWheel();
}).observe(keyboardContainer);
