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
let baseOctave = 3;
let velocity = 100;
let channel = 0;
let patch = 0;
let connected = false;
let arrowCc = 10;
let arrowCcValue = 64;
let modValue = 0;
let pitchValue = 0;   // -127 to +127, springs back to 0 on release
const heldKeys = new Set();

// ── DOM refs ──────────────────────────────────────────────────────────────────
const appTitle = document.getElementById("app-title");
const portSelect = document.getElementById("port-select");
const refreshBtn = document.getElementById("refresh-btn");
const channelSelect = document.getElementById("channel-select");
const patchSelect = document.getElementById("patch-select");
const statusEl = document.getElementById("status");
const arrowCcSelect = document.getElementById("arrow-cc-select");
const keyboardContainer = document.getElementById("keyboard-container");
const titlebar = document.getElementById("titlebar");

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
const WKW = 1.05, WKH = 0.18, WKD = 4.2;   // white key width/height/depth
const BKW = 0.63, BKH = 0.24, BKD = 2.5;   // black key
const KEY_GAP = 0.05;
const DISPLAY_OCTAVES = 2;                   // total octaves shown in the 3D view
const BODY_D = WKD + 1.0;                  // depth of the main deck
const HEAD_H = 0.7;                         // extra height of the raised rear head
const HEAD_D = 1.5;                         // front-to-back depth of the head slab

// Instrument left-panel offset: keys are shifted right so mod wheel + left panel fit
const KEY_OFFSET_X = 3.0;

// In-scene control data
const SCENE_KNOBS = [
    { id: 'vel', cc: -1, min: 1, max: 127, value: 100, label: 'VEL' },
    { id: 'pan', cc: 10, min: 0, max: 127, value: 64, label: 'PAN' },
    { id: 'expr', cc: 11, min: 0, max: 127, value: 127, label: 'EXP' },
    { id: 'rev', cc: 91, min: 0, max: 127, value: 0, label: 'REV' },
    { id: 'cho', cc: 93, min: 0, max: 127, value: 0, label: 'CHO' },
];
let kbModWheelSpinner = null;
let kbModWheelHitbox = null;
let kbPitchWheelSpinner = null;
let kbPitchWheelHitbox = null;
const kbKnobBodies = [];   // THREE.Mesh per knob (for raycasting + rotation)

// Shared materials — no per-key cloning
const matWhite = new THREE.MeshStandardMaterial({ color: 0xf0f0eb, roughness: 0.35, metalness: 0.0 });
const matBlack = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.20, metalness: 0.05 });
const matWhiteDim = new THREE.MeshStandardMaterial({ color: 0xb0b0a8, roughness: 0.50, metalness: 0.0 });
const matBlackDim = new THREE.MeshStandardMaterial({ color: 0x282828, roughness: 0.30, metalness: 0.05 });
const matHousing = new THREE.MeshStandardMaterial({ color: 0x3a3a3e, roughness: 0.78, metalness: 0.04 });

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
    default: { sun: { color: 0xfffaf0, intensity: 1.1 }, fill: { color: 0x00e8ff, intensity: 0.9 } },
    midnight: { sun: { color: 0xd0d8ff, intensity: 0.65 }, fill: { color: 0x203070, intensity: 0.35 } },
    synthwave: { sun: { color: 0xff00ff, intensity: 1.3 }, fill: { color: 0x00ffff, intensity: 1.0 } },
    ember: { sun: { color: 0xff9900, intensity: 1.4 }, fill: { color: 0xff4400, intensity: 0.7 } },
    matrix: { sun: { color: 0x00ff66, intensity: 1.2 }, fill: { color: 0x00aa44, intensity: 0.15 } },
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
        '--accent', '--accent-border', '--accent-blight', '--accent-glow', '--accent-shadow',
        '--accent-bg', '--accent-bg2', '--accent-bg3',
        '--border-app', '--border-sub', '--border-ctrl', '--border-modal',
        '--ctrl-bg', '--ctrl-hover',
        '--knob-dot', '--knob-ring',
        '--text-heading', '--text-dim', '--text-muted', '--hk-color',
        '--mod-bg', '--mod-border', '--mod-grip-t', '--mod-grip-b', '--mod-grip-bdr',
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
    kbRenderer.setClearColor(0x000000, 0);
    kbRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
    kbRenderer.shadowMap.enabled = true;
    kbRenderer.shadowMap.type = THREE.PCFShadowMap;

    // Camera — elevated front angle showing full keyboard depth
    const w = container.clientWidth || 700;
    const h = container.clientHeight || 200;
    kbCamera = new THREE.PerspectiveCamera(24, w / h, 0.1, 100);
    const xOffset = 2.15; // slight right offset looks better with mod wheel on left
    kbCamera.position.set(xOffset, 13, 12);
    kbCamera.lookAt(xOffset, 0, -0.25);
    kbRenderer.setSize(w, h);

    // Lighting
    kbAmbient = new THREE.AmbientLight(0xffffff, 0.55);
    kbScene.add(kbAmbient);

    kbSun = new THREE.DirectionalLight(0xfffaf0, 1.1);
    kbSun.position.set(-18, 18, 8);
    kbSun.castShadow = true;
    kbSun.shadow.mapSize.set(1024, 1024);
    kbSun.shadow.camera.left = -16;
    kbSun.shadow.camera.right = 16;
    kbSun.shadow.camera.top = 10;
    kbSun.shadow.camera.bottom = -10;
    kbSun.shadow.camera.near = 1;
    kbSun.shadow.camera.far = 60;
    kbScene.add(kbSun);

    kbFill = new THREE.DirectionalLight(0xfffa0, 0.9);
    kbFill.position.set(1, 12, 8);
    kbScene.add(kbFill);

    // ── Piano housing (built once; keys rebuilt per octave change) ────────────
    const totalKeyW = DISPLAY_OCTAVES * 7 * (WKW + KEY_GAP);
    // ── Instrument body ───────────────────────────────────────────────────────
    // Spans key area plus mod wheel to the left
    const wheelW = 0.55;
    const keyLeftEdge = KEY_OFFSET_X - totalKeyW / 2;
    const modCX   = keyLeftEdge - 0.35 - wheelW / 2;  // matches initSceneControls
    const pitchCX = modCX - wheelW - 0.22;             // pitch wheel left of mod
    const bodyLeft = pitchCX - wheelW / 2 - 0.4;
    const bodyRight = KEY_OFFSET_X + totalKeyW / 2 + 0.3;
    const bodyW = bodyRight - bodyLeft;
    const bodyCX = (bodyLeft + bodyRight) / 2;
    const bodyH = 1.5;
    const bodyTop = -WKH / 2;          // flush with key bottoms

    // Main deck
    const bodyMesh = new THREE.Mesh(
        new RoundedBoxGeometry(bodyW, bodyH, BODY_D, 4, 0.18),
        matHousing
    );
    bodyMesh.position.set(bodyCX, bodyTop - bodyH / 2, 0);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    kbScene.add(bodyMesh);

    // Raised head at rear (negative Z = away from player)
    const headZ = -(BODY_D - HEAD_D) / 2;
    const headMesh = new THREE.Mesh(
        new RoundedBoxGeometry(bodyW, bodyH + HEAD_H, HEAD_D, 4, 0.14),
        matHousing
    );
    headMesh.position.set(bodyCX, bodyTop - bodyH / 2 + HEAD_H / 2, headZ);
    headMesh.castShadow = true;
    headMesh.receiveShadow = true;
    kbScene.add(headMesh);

    buildKeys3D();
    initSceneControls();

    // ── Unified mouse handling for keys, mod wheel, and knobs ────────────────
    let dragInfo = null;

    function getCanvasNDC(e) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
            y: ((e.clientY - rect.top) / rect.height) * -2 + 1,
        };
    }

    canvas.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const ndc = getCanvasNDC(e);
        kbRaycaster.setFromCamera(ndc, kbCamera);

        // Priority 1: knobs
        const knobHits = kbRaycaster.intersectObjects(kbKnobBodies, true);
        if (knobHits.length) {
            const body = knobHits[0].object.parent?.userData?.type === 'knob'
                ? knobHits[0].object.parent
                : knobHits[0].object;
            const ki = body.userData.knobIndex ?? knobHits[0].object.userData.knobIndex;
            if (ki !== undefined) {
                dragInfo = { type: 'knob', startY: e.clientY, startVal: SCENE_KNOBS[ki].value, ki };
                return;
            }
        }

        // Priority 2: mod wheel
        if (kbModWheelHitbox) {
            const mwHits = kbRaycaster.intersectObject(kbModWheelHitbox, false);
            if (mwHits.length) {
                dragInfo = { type: 'modwheel', startY: e.clientY, startVal: modValue };
                return;
            }
        }

        // Priority 3: pitch wheel
        if (kbPitchWheelHitbox) {
            const pwHits = kbRaycaster.intersectObject(kbPitchWheelHitbox, false);
            if (pwHits.length) {
                dragInfo = { type: 'pitchwheel', startY: e.clientY, startVal: pitchValue };
                return;
            }
        }

        // Priority 3: keys
        const midi = raycastMidi(e);
        if (midi !== null) {
            triggerNoteOn(midi);
            dragInfo = { type: 'key' };
        }
    });

    canvas.addEventListener("mousemove", (e) => {
        if (!dragInfo) return;

        if (dragInfo.type === 'key') {
            if (e.buttons !== 1) return;
            const midi = raycastMidi(e);
            for (const held of [...activeNotes]) {
                if (held !== midi) triggerNoteOff(held);
            }
            if (midi !== null && !activeNotes.has(midi)) triggerNoteOn(midi);
            return;
        }

        if (dragInfo.type === 'modwheel') {
            const dy = dragInfo.startY - e.clientY;
            modValue = Math.max(-127, Math.min(127, Math.round(dragInfo.startVal + dy * 127 / 35)));
            updateSceneModWheel();
            const midiVal = Math.round((modValue + 127) / 2);
            if (connected) invoke("send_cc", { channel, cc: 1, value: midiVal }).catch(() => { });
            return;
        }

        if (dragInfo.type === 'pitchwheel') {
            const dy = dragInfo.startY - e.clientY;
            pitchValue = Math.max(-127, Math.min(127, Math.round(dragInfo.startVal + dy * 127 / 35)));
            updateScenePitchWheel();
            const bend = Math.round(pitchValue / 127 * 8191);
            if (connected) invoke("pitch_bend", { channel, value: bend }).catch(() => { });
            return;
        }

        if (dragInfo.type === 'knob') {
            const { ki, startY, startVal } = dragInfo;
            const kd = SCENE_KNOBS[ki];
            const newVal = Math.max(kd.min, Math.min(kd.max,
                Math.round(startVal + (startY - e.clientY) * (kd.max - kd.min) / 100)
            ));
            if (newVal === kd.value) return;
            kd.value = newVal;
            if (ki === 0) { velocity = newVal; }
            else if (connected) invoke("send_cc", { channel, cc: kd.cc, value: newVal }).catch(() => { });
            const rot = -knobRotation(newVal, kd.min, kd.max) * Math.PI / 180;
            kbKnobBodies[ki].rotation.y = rot;
            kbNeedsRender = true;
        }
    });

    canvas.addEventListener("mouseup", () => {
        if (dragInfo?.type === 'key') {
            for (const midi of [...activeNotes]) triggerNoteOff(midi);
        }
        if (dragInfo?.type === 'pitchwheel') {
            pitchValue = 0;
            updateScenePitchWheel();
            if (connected) invoke("pitch_bend", { channel, value: 0 }).catch(() => { });
        }
        dragInfo = null;
    });

    canvas.addEventListener("mouseleave", () => {
        if (dragInfo?.type === 'key') {
            for (const midi of [...activeNotes]) triggerNoteOff(midi);
        }
        if (dragInfo?.type === 'pitchwheel') {
            pitchValue = 0;
            updateScenePitchWheel();
            if (connected) invoke("pitch_bend", { channel, value: 0 }).catch(() => { });
        }
        dragInfo = null;
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
            const h1 = (discoAngle * 115) % 360;
            const h2 = (h1 + 120) % 360;
            const h3 = (h1 + 240) % 360;
            const r = document.documentElement;
            r.style.setProperty('--accent', `hsl(${h1},100%,65%)`);
            r.style.setProperty('--accent-border', `hsla(${h1},100%,65%,0.4)`);
            r.style.setProperty('--accent-blight', `hsla(${h1},100%,65%,0.25)`);
            r.style.setProperty('--accent-glow', `hsla(${h1},100%,65%,0.2)`);
            r.style.setProperty('--accent-shadow', `hsla(${h1},100%,65%,0.6)`);
            r.style.setProperty('--accent-bg', `hsla(${h1},80%,20%,0.4)`);
            r.style.setProperty('--accent-bg2', `hsla(${h1},80%,15%,0.55)`);
            r.style.setProperty('--accent-bg3', `hsla(${h1},80%,8%,0.9)`);
            r.style.setProperty('--border-app', `hsla(${h1},100%,60%,0.2)`);
            r.style.setProperty('--border-sub', `hsla(${h1},100%,60%,0.1)`);
            r.style.setProperty('--border-ctrl', `hsla(${h1},100%,60%,0.3)`);
            r.style.setProperty('--border-modal', `hsla(${h1},100%,60%,0.25)`);
            r.style.setProperty('--ctrl-bg', `hsla(${h1},100%,60%,0.08)`);
            r.style.setProperty('--ctrl-hover', `hsla(${h1},100%,60%,0.18)`);
            r.style.setProperty('--knob-dot', `hsl(${h1},100%,70%)`);
            r.style.setProperty('--knob-ring', `hsla(${h1},100%,65%,0.4)`);
            r.style.setProperty('--text-heading', `hsl(${h1},100%,75%)`);
            r.style.setProperty('--text-dim', `hsl(${h1},60%,45%)`);
            r.style.setProperty('--text-muted', `hsl(${h1},55%,35%)`);
            r.style.setProperty('--hk-color', `hsl(${h1},100%,65%)`);
            r.style.setProperty('--mod-bg', `hsla(${h1},60%,12%,0.55)`);
            r.style.setProperty('--mod-border', `hsla(${h1},100%,60%,0.2)`);
            r.style.setProperty('--mod-grip-t', `hsl(${h1},60%,30%)`);
            r.style.setProperty('--mod-grip-b', `hsl(${h1},60%,15%)`);
            r.style.setProperty('--mod-grip-bdr', `hsla(${h1},100%,65%,0.4)`);
            kbNeedsRender = true;
        }
        if (!kbNeedsRender) return;
        kbNeedsRender = false;
        kbRenderer.render(kbScene, kbCamera);
    })();
}

function buildKeys3D() {
    // Remove and dispose old key meshes only
    for (const mesh of Object.values(noteToMesh)) {
        kbScene.remove(mesh);
        mesh.geometry.dispose();
    }
    Object.keys(noteToMesh).forEach(k => delete noteToMesh[k]);
    meshToMidi.clear();

    // Show DISPLAY_OCTAVES octaves centred on the active pair
    const displayStart = Math.max(0, Math.min(9 - DISPLAY_OCTAVES, baseOctave - 1));
    const totalWhite = DISPLAY_OCTAVES * 7;
    const totalW = totalWhite * (WKW + KEY_GAP);
    const startX = KEY_OFFSET_X - totalW / 2 + (WKW + KEY_GAP) / 2;

    // White keys
    const whiteGeo = new RoundedBoxGeometry(WKW, WKH, WKD, 3, 0.04);
    for (let oct = 0; oct < DISPLAY_OCTAVES; oct++) {
        const octNum = displayStart + oct;
        const active = octNum === baseOctave || octNum === baseOctave + 1;
        for (let i = 0; i < WHITE_OFFSETS.length; i++) {
            const midi = octNum * 12 + 12 + WHITE_OFFSETS[i];
            const x = startX + (oct * 7 + i) * (WKW + KEY_GAP);
            const mesh = new THREE.Mesh(whiteGeo, active ? matWhite : matWhiteDim);
            mesh.position.set(x, 0, 0);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.userData = { midi, isBlack: false, baseY: 0 };
            kbScene.add(mesh);
            noteToMesh[midi] = mesh;
            meshToMidi.set(mesh, midi);
        }
    }

    // Black keys
    const blackGeo = new RoundedBoxGeometry(BKW, BKH, BKD, 3, 0.04);
    const blackY = (WKH + BKH) / 2;
    const blackZ = -(WKD - BKD) / 2;
    for (let oct = 0; oct < DISPLAY_OCTAVES; oct++) {
        const octNum = displayStart + oct;
        const active = octNum === baseOctave || octNum === baseOctave + 1;
        for (const bk of BLACK_KEY_DEFS) {
            const midi = octNum * 12 + 12 + bk.semitone;
            const x = startX + (oct * 7 + bk.whitePos) * (WKW + KEY_GAP);
            const mesh = new THREE.Mesh(blackGeo, active ? matBlack : matBlackDim);
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

// ── Knob rotation helper ───────────────────────────────────────────────────────
function knobRotation(value, min, max) {
    return -135 + ((value - min) / (max - min)) * 270;
}

function parseCssColorToHex(varName) {
    const str = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    const m = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (m) return (parseInt(m[1]) << 16) | (parseInt(m[2]) << 8) | parseInt(m[3]);
    const h = str.replace(/^#/, '');
    if (h.length === 6) return parseInt(h, 16);
    if (h.length === 3) return parseInt(h[0] + h[0] + h[1] + h[1] + h[2] + h[2], 16);
    return 0x7ab4ff;
}

// ── In-scene mod wheel + knobs ────────────────────────────────────────────────
function initSceneControls() {
    const totalKeyW = DISPLAY_OCTAVES * 7 * (WKW + KEY_GAP);
    const keyLeftEdge = KEY_OFFSET_X - totalKeyW / 2;
    const panelCX = keyLeftEdge - 0.35 - 0.55 / 2;  // wheel snug left of keys


    // ── Shared wheel dimensions ───────────────────────────────────────────────
    const modWheelY = -0.4;
    const wheelR    = 1.15;
    const wheelW    = 0.55;
    const pitchCX   = panelCX - wheelW - 0.22;  // pitch wheel left of mod wheel
    const markerMat = new THREE.MeshStandardMaterial({
        color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.9,
        roughness: 0.1, metalness: 0.0,
    });

    function buildWheel(cx) {
        const spinner = new THREE.Group();
        const bodyGeo = new THREE.CylinderGeometry(wheelR, wheelR, wheelW, 36);
        bodyGeo.rotateZ(Math.PI / 2);
        spinner.add(new THREE.Mesh(bodyGeo,
            new THREE.MeshStandardMaterial({ color: 0x111114, roughness: 0.70, metalness: 0.18 })
        ));
        // 11 ribs
        const ridgeMat = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.88, metalness: 0.05 });
        const ridgeCount = 11;
        const ridgeStep = wheelW / (ridgeCount + 1);
        for (let i = 0; i < ridgeCount; i++) {
            const rGeo = new THREE.CylinderGeometry(wheelR + 0.10, wheelR + 0.10, 0.038, 36);
            rGeo.rotateZ(Math.PI / 2);
            const r = new THREE.Mesh(rGeo, ridgeMat);
            r.position.x = -wheelW / 2 + ridgeStep * (i + 1);
            spinner.add(r);
        }
        // Bright center-marker stripe at 12 o'clock (top of wheel, zero position)
        const stripGeo = new THREE.CylinderGeometry(wheelR + 0.12, wheelR + 0.12, 0.06, 36);
        stripGeo.rotateZ(Math.PI / 2);
        spinner.add(new THREE.Mesh(stripGeo, markerMat));

        spinner.position.set(cx, modWheelY, 0);
        kbScene.add(spinner);

        // Housing center-notch — small bright tab on the body surface above center
        const notch = new THREE.Mesh(
            new THREE.BoxGeometry(wheelW + 0.1, 0.06, 0.18),
            markerMat
        );
        notch.position.set(cx, -WKH / 2 + 0.03, 0);
        kbScene.add(notch);

        // Hitbox
        const hitbox = new THREE.Mesh(
            new THREE.BoxGeometry(wheelW + 0.2, 1.4, 1.4),
            new THREE.MeshStandardMaterial({ visible: false })
        );
        hitbox.position.set(cx, modWheelY + 0.5, 0);
        kbScene.add(hitbox);

        return { spinner, hitbox };
    }

    // ── Mod wheel (CC 1 — modulation, stays put) ──────────────────────────────
    const modWheelObj = buildWheel(panelCX);
    kbModWheelSpinner = modWheelObj.spinner;
    kbModWheelHitbox  = modWheelObj.hitbox;
    kbModWheelHitbox.userData = { type: 'modwheel' };

    // ── Pitch wheel (pitch bend — springs to centre on release) ───────────────
    const pitchWheelObj = buildWheel(pitchCX);
    kbPitchWheelSpinner = pitchWheelObj.spinner;
    kbPitchWheelHitbox  = pitchWheelObj.hitbox;
    kbPitchWheelHitbox.userData = { type: 'pitchwheel' };

    // ── 5 Knobs — sit on top of the raised head slab ─────────────────────────
    const knobBaseZ = -(BODY_D / 2 - HEAD_D / 2);          // centre of head slab
    const headTopY = -WKH / 2 + HEAD_H;                   // top surface of head
    const knobY = headTopY + 0.12;                      // just above head surface
    const knobSpanX = 5;
    const knobStartX = KEY_OFFSET_X - knobSpanX / 2;

    for (let i = 0; i < SCENE_KNOBS.length; i++) {
        const kd = SCENE_KNOBS[i];
        const kx = knobStartX + i * (knobSpanX / (SCENE_KNOBS.length - 1));

        const bodyGeo = new THREE.CylinderGeometry(0.42, 0.50, 0.20, 32);
        const bodyMat = new THREE.MeshStandardMaterial({ color: 0x282828, roughness: 0.28, metalness: 0.65 });
        const body = new THREE.Mesh(bodyGeo, bodyMat);

        const capGeo = new THREE.CylinderGeometry(0.41, 0.42, 0.018, 32);
        const capMat = new THREE.MeshStandardMaterial({ color: 0x3c3c3c, roughness: 0.18, metalness: 0.75 });
        const cap = new THREE.Mesh(capGeo, capMat);
        cap.position.y = 0.11;
        body.add(cap);

        const pipCol = parseCssColorToHex('--knob-dot');
        const pipMat = new THREE.MeshStandardMaterial({
            color: pipCol, emissive: pipCol, emissiveIntensity: 0.6,
            roughness: 0.1, metalness: 0.1,
        });
        const pip = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.04, 10), pipMat);
        pip.position.set(0, 0.13, -0.27);
        body.add(pip);

        body.position.set(kx, knobY, knobBaseZ);
        body.userData = { type: 'knob', knobIndex: i };
        // Apply initial rotation
        const initRot = knobRotation(kd.value, kd.min, kd.max);
        body.rotation.y = -initRot * Math.PI / 180;

        kbScene.add(body);
        kbKnobBodies.push(body);
    }

    updateSceneModWheel();
}

function updateSceneModWheel() {
    if (!kbModWheelSpinner) return;
    kbModWheelSpinner.rotation.x = -(modValue / 127) * (Math.PI * 0.65);
    kbNeedsRender = true;
}

function updateScenePitchWheel() {
    if (!kbPitchWheelSpinner) return;
    kbPitchWheelSpinner.rotation.x = -(pitchValue / 127) * (Math.PI * 0.55);
    kbNeedsRender = true;
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
        buildKeys3D();
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
    modValue = Math.max(-127, Math.min(127, modValue - Math.sign(e.deltaY) * 18));
    updateSceneModWheel();
    const midiValue = Math.round((modValue + 127) / 2);
    if (connected) invoke("send_cc", { channel, cc: 1, value: midiValue }).catch(() => { });
}, { passive: false });

// Middle click = reset modulation
window.addEventListener("auxclick", (e) => {
    if (e.button !== 1) return;
    e.preventDefault();
    e.stopPropagation();
    modValue = 0;
    updateSceneModWheel();
    if (connected) invoke("send_cc", { channel, cc: 1, value: 64 }).catch(() => { });
});

// Release all held notes on window blur
window.addEventListener("blur", () => {
    if (connected) {
        invoke("send_cc", { channel, cc: 64, value: 0 }).catch(() => { });
        modValue = 0;
        updateSceneModWheel();
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
        const vertOverhead = titlebar.offsetHeight;
        const RATIO = 14 / 3.6;
        const dW = Math.abs(logW - prevLogW);
        const dH = Math.abs(logH - prevLogH);

        let newW, newH;
        if (dW >= dH) {
            // User dragged horizontally — correct height
            newW = logW;
            newH = Math.round(logW / RATIO + vertOverhead);
        } else {
            // User dragged vertically — correct width
            newH = logH;
            newW = Math.round((logH - vertOverhead) * RATIO);
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
let baseHeight = 200;
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
}

swatches.forEach(s => s.addEventListener("click", () => {
    applyTheme(s.dataset.theme);
    if (s.dataset.theme === "disco") flashDiscoMsg();
}));

function flashDiscoMsg() {
    const el = document.createElement("div");
    el.textContent = "OH YEAH BAYBEE!";
    Object.assign(el.style, {
        position: "absolute", inset: "0", display: "flex",
        alignItems: "center", justifyContent: "center",
        fontFamily: '"Courier New", monospace', fontWeight: "bold",
        fontSize: "32px", letterSpacing: "0.12em",
        color: "hsl(306 100% 70%)",
        textShadow: "0 0 8px hsl(306 100% 60%), 0 0 24px hsl(306 100% 40%)",
        zIndex: "200", pointerEvents: "none",
        animation: "disco-msg 1.4s ease-out forwards",
    });
    document.getElementById("app").appendChild(el);
    el.addEventListener("animationend", () => el.remove());
}

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
appTitle.textContent = GM_PATCH_NAMES[patch];
updateZoomDisplay();
initKeyboard3D();
setThemeLighting(localStorage.getItem("theme") || "default");

appWindow.innerSize().then(s => appWindow.scaleFactor().then(sf => {
    prevLogW = s.width / sf;
    prevLogH = s.height / sf;
}));

new ResizeObserver(() => {
    resizeKeyboard3D();
}).observe(keyboardContainer);
