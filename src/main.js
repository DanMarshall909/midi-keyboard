import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";

// ── Key → MIDI note mapping (GarageBand layout) ──────────────────────────────
const KEY_MAP = {
  // Lower octave (baseOctave)
  z: 0,  s: 1,  x: 2,  d: 3,  c: 4,
  v: 5,  g: 6,  b: 7,  h: 8,  n: 9,  j: 10, m: 11,
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
let baseOctave   = 4;
let velocity     = 100;
let channel      = 0;
let patch        = 0;
let connected    = false;
let arrowCc      = 10;
let arrowCcValue = 64;
let modValue     = 0;
const heldKeys = new Set();

// ── DOM refs ──────────────────────────────────────────────────────────────────
const appTitle        = document.getElementById("app-title");
const portSelect      = document.getElementById("port-select");
const refreshBtn      = document.getElementById("refresh-btn");
const octaveDisplay   = document.getElementById("octave-display");
const octDownBtn      = document.getElementById("oct-down");
const octUpBtn        = document.getElementById("oct-up");
const channelSelect   = document.getElementById("channel-select");
const patchSelect     = document.getElementById("patch-select");
const statusEl        = document.getElementById("status");
const arrowCcSelect   = document.getElementById("arrow-cc-select");
const keyboardEl      = document.getElementById("keyboard");
const keyboardContainer = document.getElementById("keyboard-container");
const sidebarEl       = document.getElementById("sidebar");
const modTrack        = document.getElementById("mod-track");
const modFill         = document.getElementById("mod-fill");
const modGrip         = document.getElementById("mod-grip");
const modValEl        = document.getElementById("mod-val");
const sustainBtn      = document.getElementById("sustain-btn");

// ── Piano layout ──────────────────────────────────────────────────────────────
const WHITE_OFFSETS = [0, 2, 4, 5, 7, 9, 11];
let WHITE_KEY_WIDTH = 50;

const BLACK_KEYS = [
  { semitone: 1,  whitePos: 0.6 },
  { semitone: 3,  whitePos: 1.6 },
  { semitone: 6,  whitePos: 3.6 },
  { semitone: 8,  whitePos: 4.6 },
  { semitone: 10, whitePos: 5.6 },
];

const noteToEl = {};

function buildKeyboard() {
  keyboardEl.innerHTML = "";

  const totalOctaves = 2;
  const totalWhiteKeys = totalOctaves * 7;
  keyboardEl.style.width = `${totalWhiteKeys * WHITE_KEY_WIDTH}px`;

  for (let oct = 0; oct < totalOctaves; oct++) {
    for (let i = 0; i < WHITE_OFFSETS.length; i++) {
      const semitone = oct * 12 + WHITE_OFFSETS[i];
      const midi = (baseOctave + oct) * 12 + 12 + WHITE_OFFSETS[i];
      const el = document.createElement("div");
      el.className = "key-white";
      el.dataset.midi = midi;
      el.dataset.label = keyLabel(semitone, oct);
      el.textContent = el.dataset.label;
      el.addEventListener("mousedown", () => triggerNoteOn(midi, el));
      el.addEventListener("mouseup",   () => triggerNoteOff(midi, el));
      el.addEventListener("mouseleave", () => { if (el.classList.contains("active")) triggerNoteOff(midi, el); });
      keyboardEl.appendChild(el);
      noteToEl[midi] = el;
    }
  }

  for (let oct = 0; oct < totalOctaves; oct++) {
    const octaveStartX = oct * 7 * WHITE_KEY_WIDTH;
    for (const bk of BLACK_KEYS) {
      const midi = (baseOctave + oct) * 12 + 12 + bk.semitone;
      const el = document.createElement("div");
      el.className = "key-black";
      el.dataset.midi = midi;
      el.style.left = `${octaveStartX + bk.whitePos * WHITE_KEY_WIDTH - WHITE_KEY_WIDTH * 0.3}px`;
      el.addEventListener("mousedown", (e) => { e.stopPropagation(); triggerNoteOn(midi, el); });
      el.addEventListener("mouseup",   (e) => { e.stopPropagation(); triggerNoteOff(midi, el); });
      el.addEventListener("mouseleave", () => { if (el.classList.contains("active")) triggerNoteOff(midi, el); });
      keyboardEl.appendChild(el);
      noteToEl[midi] = el;
    }
  }
}

function updateKeyDimensions() {
  const totalWhiteKeys = 14;
  const ASPECT = 3.6;
  const w = keyboardContainer.clientWidth;
  const h = keyboardContainer.clientHeight;
  if (w < 10 || h < 10) return;
  WHITE_KEY_WIDTH = Math.min(w / totalWhiteKeys, (h * 0.95) / ASPECT);
  const keyH = WHITE_KEY_WIDTH * ASPECT;
  const root = document.documentElement;
  root.style.setProperty("--key-w",  `${WHITE_KEY_WIDTH}px`);
  root.style.setProperty("--key-h",  `${keyH}px`);
  root.style.setProperty("--key-bw", `${WHITE_KEY_WIDTH * 0.6}px`);
  root.style.setProperty("--key-bh", `${keyH * 0.61}px`);
}

function keyLabel(semitone, oct) {
  const names = ["C", "", "D", "", "E", "F", "", "G", "", "A", "", "B"];
  const name = names[semitone % 12];
  return name ? `${name}${baseOctave + oct}` : "";
}

// ── MIDI helpers ──────────────────────────────────────────────────────────────
function midiNoteFromKey(key) {
  const offset = KEY_MAP[key];
  if (offset === undefined) return null;
  return baseOctave * 12 + 12 + offset;
}

async function triggerNoteOn(midi, el) {
  if (!connected) return;
  el?.classList.add("active");

  // Calculate velocity color: green (low) → yellow (mid) → dark red (high)
  // Velocity 1-127 maps to hue 120° (green) → 60° (yellow) → 0° (red)
  const hue = 120 * (1 - (velocity - 1) / 126);
  const saturation = 100;
  const lightness = 45 + Math.min(20, (velocity - 1) / 126 * 15);
  const ledColor = `hsl(${hue}, ${saturation}%, ${lightness}%)`;

  // Create LED indicator
  const led = document.createElement("div");
  led.className = "key-led";
  led.style.setProperty("--led-color", ledColor);
  el?.appendChild(led);

  // Remove LED after animation completes
  setTimeout(() => led.remove(), 800);

  try {
    await invoke("note_on", { channel, note: midi, velocity });
  } catch (e) {
    setStatus(e, "error");
  }
}

async function triggerNoteOff(midi, el) {
  if (!connected) return;
  el?.classList.remove("active");
  try {
    await invoke("note_off", { channel, note: midi });
  } catch (e) {
    setStatus(e, "error");
  }
}

// ── Mod wheel (centered, ±127 range) ──────────────────────────────────────────
function updateModWheel() {
  const trackH = modTrack.clientHeight;
  const gripH  = 18;

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
  const startY   = e.clientY;
  const startVal = modValue;
  const trackH   = modTrack.clientHeight;

  function onMove(ev) {
    const dy = startY - ev.clientY; // drag up = positive
    const centerPos = (trackH - 18) / 2;
    modValue = Math.round((dy / centerPos) * 127);
    modValue = Math.max(-127, Math.min(127, modValue + startVal));
    updateModWheel();
    // Map ±127 to MIDI 0-127 for CC
    const midiValue = Math.round((modValue + 127) / 2);
    if (connected) invoke("send_cc", { channel, cc: 1, value: midiValue }).catch(() => {});
  }
  function onUp() {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup",   onUp);
  }
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup",   onUp);
});

// ── Rotary knob system ────────────────────────────────────────────────────────
function knobRotation(value, min, max) {
  return -135 + ((value - min) / (max - min)) * 270;
}

function initKnob(knobEl) {
  const val = parseInt(knobEl.dataset.value);
  const min = parseInt(knobEl.dataset.min);
  const max = parseInt(knobEl.dataset.max);
  knobEl.style.setProperty("--knob-rot", `${knobRotation(val, min, max)}deg`);
}

function makeKnobDraggable(knobEl, valEl, onChange) {
  const min = parseInt(knobEl.dataset.min);
  const max = parseInt(knobEl.dataset.max);

  knobEl.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const startY   = e.clientY;
    const startVal = parseInt(knobEl.dataset.value);

    function onMove(ev) {
      const dy = startY - ev.clientY; // drag up = increase
      const newVal = Math.max(min, Math.min(max, Math.round(startVal + dy * (max - min) / 100)));
      if (newVal === parseInt(knobEl.dataset.value)) return;
      knobEl.dataset.value = newVal;
      knobEl.style.setProperty("--knob-rot", `${knobRotation(newVal, min, max)}deg`);
      valEl.textContent = newVal;
      onChange(newVal);
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup",   onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup",   onUp);
  });
}

// Init velocity knob
const knobVel    = document.getElementById("knob-vel");
const knobVelVal = document.getElementById("knob-vel-val");
initKnob(knobVel);
makeKnobDraggable(knobVel, knobVelVal, (v) => { velocity = v; });

// Init CC knobs
const CC_KNOBS = [
  ["knob-pan",  "knob-pan-val"],
  ["knob-expr", "knob-expr-val"],
  ["knob-rev",  "knob-rev-val"],
  ["knob-cho",  "knob-cho-val"],
];
for (const [id, valId] of CC_KNOBS) {
  const el    = document.getElementById(id);
  const valEl = document.getElementById(valId);
  const cc    = parseInt(el.dataset.cc);
  initKnob(el);
  makeKnobDraggable(el, valEl, (v) => {
    if (connected) invoke("send_cc", { channel, cc, value: v }).catch(() => {});
  });
}

// ── Keyboard events ───────────────────────────────────────────────────────────
window.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  if (e.key === " " && !e.repeat) {
    e.preventDefault();
    sustainBtn.classList.add("active");
    if (connected) invoke("send_cc", { channel, cc: 64, value: 127 }).catch(() => {});
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
    if (connected) invoke("send_cc", { channel, cc: arrowCc, value: arrowCcValue }).catch(() => {});
    return;
  }

  if (e.repeat) return;
  const key = e.key.toLowerCase();
  if (heldKeys.has(key)) return;
  const midi = midiNoteFromKey(key);
  if (midi === null) return;
  e.preventDefault();
  heldKeys.add(key);
  triggerNoteOn(midi, noteToEl[midi]);
});

window.addEventListener("keyup", (e) => {
  if (e.key === " ") {
    sustainBtn.classList.remove("active");
    if (connected) invoke("send_cc", { channel, cc: 64, value: 0 }).catch(() => {});
    return;
  }
  const key = e.key.toLowerCase();
  heldKeys.delete(key);
  const midi = midiNoteFromKey(key);
  if (midi === null) return;
  e.preventDefault();
  triggerNoteOff(midi, noteToEl[midi]);
});

// Mouse wheel = modulation (CC 1)
window.addEventListener("wheel", (e) => {
  e.preventDefault();
  modValue = Math.max(-127, Math.min(127, modValue - Math.sign(e.deltaY) * 5));
  updateModWheel();
  const midiValue = Math.round((modValue + 127) / 2);
  if (connected) invoke("send_cc", { channel, cc: 1, value: midiValue }).catch(() => {});
}, { passive: false });

// Middle click = reset modulation
window.addEventListener("auxclick", (e) => {
  if (e.button !== 1) return;
  e.preventDefault();
  modValue = 0;
  updateModWheel();
  if (connected) invoke("send_cc", { channel, cc: 1, value: 64 }).catch(() => {});
});

// Release all held notes on window blur
window.addEventListener("blur", () => {
  sustainBtn.classList.remove("active");
  if (connected) {
    invoke("send_cc", { channel, cc: 64, value: 0 }).catch(() => {});
    modValue = 0;
    updateModWheel();
    invoke("send_cc", { channel, cc: 1, value: 0 }).catch(() => {});
  }
  for (const key of heldKeys) {
    const midi = midiNoteFromKey(key);
    if (midi !== null) triggerNoteOff(midi, noteToEl[midi]);
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
  if (baseOctave > 0) { baseOctave--; octaveDisplay.textContent = baseOctave; buildKeyboard(); }
});
octUpBtn.addEventListener("click", () => {
  if (baseOctave < 8) { baseOctave++; octaveDisplay.textContent = baseOctave; buildKeyboard(); }
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

// Sustain toggle button
let sustainOn = false;
sustainBtn.addEventListener("click", async () => {
  sustainOn = !sustainOn;
  sustainBtn.classList.toggle("active", sustainOn);
  if (!connected) return;
  try {
    await invoke("send_cc", { channel, cc: 64, value: sustainOn ? 127 : 0 });
  } catch (e) {
    setStatus(String(e), "error");
  }
});

// Arrow CC selector
const ARROW_CC_OPTIONS = [
  [1,  "1 – Mod Wheel"],  [7,  "7 – Volume"],    [10, "10 – Pan"],
  [11, "11 – Expression"],[64, "64 – Sustain"],   [71, "71 – Resonance"],
  [74, "74 – Brightness"],[91, "91 – Reverb"],    [93, "93 – Chorus"],
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
    const size    = await appWindow.innerSize();
    const sf      = await appWindow.scaleFactor();
    const logW    = size.width  / sf;
    const logH    = size.height / sf;
    const sidebarW = sidebarEl.offsetWidth;
    const overhead = window.innerHeight - keyboardContainer.clientHeight;
    const dW = Math.abs(logW - prevLogW);
    const dH = Math.abs(logH - prevLogH);

    let newW, newH;
    if (dW >= dH) {
      // User dragged horizontally — correct height
      newW = logW;
      const kbW = logW - sidebarW;
      newH = Math.round(kbW / 14 * 3.6 + overhead);
    } else {
      // User dragged vertically — correct width
      newH = logH;
      const kbH = logH - overhead;
      newW = Math.round(kbH / 3.6 * 14 + sidebarW);
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

appWindow.onResized(() => correctAspectRatio());

// ── Window controls ───────────────────────────────────────────────────────────
document.getElementById("close-btn").addEventListener("click", () => {
  getCurrentWindow().close();
});

document.getElementById("titlebar").addEventListener("mousedown", (e) => {
  if (e.target.closest("button")) return;
  getCurrentWindow().startDragging();
});

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

// ── Status helper ─────────────────────────────────────────────────────────────
function setStatus(msg, type = "") {
  statusEl.textContent = msg;
  statusEl.className = type;
}

// ── Init ──────────────────────────────────────────────────────────────────────
octaveDisplay.textContent = baseOctave;
appTitle.textContent = GM_PATCH_NAMES[patch];
loadPorts();
buildKeyboard();
updateModWheel();

appWindow.innerSize().then(s => appWindow.scaleFactor().then(sf => {
  prevLogW = s.width  / sf;
  prevLogH = s.height / sf;
}));

new ResizeObserver(() => {
  updateKeyDimensions();
  buildKeyboard();
}).observe(keyboardContainer);
