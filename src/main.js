import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";

// ── Key → MIDI note mapping (GarageBand layout) ──────────────────────────────
// Offsets are semitones relative to the base octave root (C).
// Lower row  (z…): C D E F G A B  +  black keys on s d g h j
// Upper row  (q…): C D E F G A B C  +  black keys on 2 3 5 6 7
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
  // Piano
  ["Piano", [
    "Acoustic Grand Piano", "Bright Acoustic Piano", "Electric Grand Piano",
    "Honky-tonk Piano", "Electric Piano 1", "Electric Piano 2", "Harpsichord", "Clavi",
  ]],
  // Chromatic Perc
  ["Chromatic Perc", [
    "Celesta", "Glockenspiel", "Music Box", "Vibraphone",
    "Marimba", "Xylophone", "Tubular Bells", "Dulcimer",
  ]],
  // Organ
  ["Organ", [
    "Drawbar Organ", "Percussive Organ", "Rock Organ", "Church Organ",
    "Reed Organ", "Accordion", "Harmonica", "Tango Accordion",
  ]],
  // Guitar
  ["Guitar", [
    "Nylon Guitar", "Steel Guitar", "Jazz Guitar", "Clean Guitar",
    "Muted Guitar", "Overdriven Guitar", "Distortion Guitar", "Guitar Harmonics",
  ]],
  // Bass
  ["Bass", [
    "Acoustic Bass", "Finger Bass", "Pick Bass", "Fretless Bass",
    "Slap Bass 1", "Slap Bass 2", "Synth Bass 1", "Synth Bass 2",
  ]],
  // Strings
  ["Strings", [
    "Violin", "Viola", "Cello", "Contrabass",
    "Tremolo Strings", "Pizzicato Strings", "Orchestral Harp", "Timpani",
  ]],
  // Ensemble
  ["Ensemble", [
    "String Ensemble 1", "String Ensemble 2", "Synth Strings 1", "Synth Strings 2",
    "Choir Aahs", "Voice Oohs", "Synth Voice", "Orchestra Hit",
  ]],
  // Brass
  ["Brass", [
    "Trumpet", "Trombone", "Tuba", "Muted Trumpet",
    "French Horn", "Brass Section", "Synth Brass 1", "Synth Brass 2",
  ]],
  // Reed
  ["Reed", [
    "Soprano Sax", "Alto Sax", "Tenor Sax", "Baritone Sax",
    "Oboe", "English Horn", "Bassoon", "Clarinet",
  ]],
  // Pipe
  ["Pipe", [
    "Piccolo", "Flute", "Recorder", "Pan Flute",
    "Blown Bottle", "Shakuhachi", "Whistle", "Ocarina",
  ]],
  // Synth Lead
  ["Synth Lead", [
    "Square Lead", "Sawtooth Lead", "Calliope Lead", "Chiff Lead",
    "Charang Lead", "Voice Lead", "Fifths Lead", "Bass+Lead",
  ]],
  // Synth Pad
  ["Synth Pad", [
    "New Age Pad", "Warm Pad", "Polysynth Pad", "Choir Pad",
    "Bowed Pad", "Metallic Pad", "Halo Pad", "Sweep Pad",
  ]],
  // Synth FX
  ["Synth FX", [
    "Rain FX", "Soundtrack FX", "Crystal FX", "Atmosphere FX",
    "Brightness FX", "Goblins FX", "Echoes FX", "Sci-fi FX",
  ]],
  // Ethnic
  ["Ethnic", [
    "Sitar", "Banjo", "Shamisen", "Koto",
    "Kalimba", "Bag Pipe", "Fiddle", "Shanai",
  ]],
  // Percussive
  ["Percussive", [
    "Tinkle Bell", "Agogo", "Steel Drums", "Woodblock",
    "Taiko Drum", "Melodic Tom", "Synth Drum", "Reverse Cymbal",
  ]],
  // Sound FX
  ["Sound FX", [
    "Guitar Fret Noise", "Breath Noise", "Seashore", "Bird Tweet",
    "Telephone Ring", "Helicopter", "Applause", "Gunshot",
  ]],
];

// ── State ─────────────────────────────────────────────────────────────────────
let baseOctave   = 4;   // C4 = MIDI 60
let velocity     = 100;
let channel      = 0;   // 0-indexed (sent as channel 0 = MIDI ch 1)
let patch        = 0;   // GM program number 0–127
let connected    = false;
let arrowCc      = 10;  // CC number controlled by arrow keys (default: Pan)
let arrowCcValue = 64;  // current value — 64 = centre for Pan
let modValue     = 0;   // CC 1 (modulation), controlled by mouse wheel
const heldKeys = new Set(); // prevent key-repeat retriggering

// ── DOM refs ──────────────────────────────────────────────────────────────────
const portSelect      = document.getElementById("port-select");
const refreshBtn      = document.getElementById("refresh-btn");
const octaveDisplay   = document.getElementById("octave-display");
const octDownBtn      = document.getElementById("oct-down");
const octUpBtn        = document.getElementById("oct-up");
const velocitySlider  = document.getElementById("velocity");
const velocityDisplay = document.getElementById("velocity-display");
const channelSelect   = document.getElementById("channel-select");
const patchSelect     = document.getElementById("patch-select");
const statusEl           = document.getElementById("status");
const arrowCcSelect      = document.getElementById("arrow-cc-select");
const keyboardEl         = document.getElementById("keyboard");
const keyboardContainer  = document.getElementById("keyboard-container");

// ── Piano layout ──────────────────────────────────────────────────────────────
// 25 keys: C4..C6 (2 full octaves + top C)
// White key indices within an octave: 0 2 4 5 7 9 11
// Black key semitones within an octave: 1 3 6 8 10
const WHITE_OFFSETS = [0, 2, 4, 5, 7, 9, 11];
let WHITE_KEY_WIDTH = 50; // updated dynamically on resize

// Black key positions (left offset from start of octave in white-key units)
// C# after C(0), D# after D(1), F# after F(3), G# after G(4), A# after A(5)
const BLACK_KEYS = [
  { semitone: 1,  whitePos: 0.6 },
  { semitone: 3,  whitePos: 1.6 },
  { semitone: 6,  whitePos: 3.6 },
  { semitone: 8,  whitePos: 4.6 },
  { semitone: 10, whitePos: 5.6 },
];

// Build a reverse map: midiNote → DOM element
const noteToEl = {};

function buildKeyboard() {
  keyboardEl.innerHTML = "";

  const totalOctaves = 2;
  const totalWhiteKeys = totalOctaves * 7; // exactly 2 octaves
  keyboardEl.style.width = `${totalWhiteKeys * WHITE_KEY_WIDTH}px`;

  // White keys
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
  // Black keys (absolute positioned over white keys)
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
  const totalWhiteKeys = 14; // 2 octaves × 7 white keys
  const ASPECT = 3.6; // key height = key width * ASPECT
  const w = keyboardContainer.clientWidth;
  const h = keyboardContainer.clientHeight;
  if (w < 10 || h < 10) return; // container not laid out yet — keep CSS defaults
  // Scale to fit container while preserving aspect ratio (like object-fit: contain)
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
function midiFromKey(key) {
  const offset = KEY_MAP[key];
  if (offset === undefined) return null;
  // Upper row keys get baseOctave+1, lower row keys get baseOctave
  const octaveShift = offset >= 12 ? 1 : 0;
  return (baseOctave + octaveShift) * 12 + 12 + (offset % 12) + (offset >= 12 ? 0 : 0);
  // Simplified: offset already encodes octave difference
}

function midiNoteFromKey(key) {
  const offset = KEY_MAP[key];
  if (offset === undefined) return null;
  return baseOctave * 12 + 12 + offset;
}

async function triggerNoteOn(midi, el) {
  if (!connected) return;
  el?.classList.add("active");
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

// ── Keyboard events ───────────────────────────────────────────────────────────
window.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  // Space = momentary sustain pedal
  if (e.key === " " && !e.repeat) {
    e.preventDefault();
    sustainBtn.classList.add("active");
    if (connected) invoke("send_cc", { channel, cc: 64, value: 127 }).catch(() => {});
    return;
  }

  // F1–F9 = select octave 0–8
  if (/^F[1-9]$/.test(e.key) && !e.repeat) {
    e.preventDefault();
    baseOctave = parseInt(e.key.slice(1)) - 1;
    octaveDisplay.textContent = baseOctave;
    buildKeyboard();
    return;
  }

  // Arrow keys = step the configurable arrow CC (repeats while held)
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
    e.preventDefault();
    const delta = (e.key === "ArrowUp" || e.key === "ArrowRight") ? 5 : -5;
    arrowCcValue = Math.max(0, Math.min(127, arrowCcValue + delta));
    if (connected) invoke("send_cc", { channel, cc: arrowCc, value: arrowCcValue }).catch(() => {});
    return;
  }

  // Piano keys (no repeat)
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
  // Space = release sustain
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
  modValue = Math.max(0, Math.min(127, modValue - Math.sign(e.deltaY) * 5));
  if (connected) invoke("send_cc", { channel, cc: 1, value: modValue }).catch(() => {});
}, { passive: false });

// Release all held notes when window loses focus
window.addEventListener("blur", () => {
  sustainBtn.classList.remove("active");
  if (connected) {
    invoke("send_cc", { channel, cc: 64, value: 0 }).catch(() => {});
    modValue = 0;
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
    portSelect.innerHTML = '<option value="">-- Select MIDI Output --</option>';
    ports.forEach((name, i) => {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = name;
      portSelect.appendChild(opt);
    });
    if (ports.length === 0) { setStatus("No MIDI outputs found", "error"); return; }
    setStatus(`${ports.length} port(s) found`);

    // Auto-connect the last used port if it's still present
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
    setStatus(`Connected: ${name}`, "connected");
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

velocitySlider.addEventListener("input", () => {
  velocity = parseInt(velocitySlider.value);
  velocityDisplay.textContent = velocity;
});

// Populate channel selector
for (let i = 1; i <= 16; i++) {
  const opt = document.createElement("option");
  opt.value = i - 1;
  opt.textContent = i;
  channelSelect.appendChild(opt);
}
channelSelect.addEventListener("change", () => {
  channel = parseInt(channelSelect.value);
});

// Populate patch selector with GM optgroups
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
  if (!connected) return;
  try {
    await invoke("program_change", { channel, program: patch });
  } catch (e) {
    setStatus(String(e), "error");
  }
});

// ── CC controls ───────────────────────────────────────────────────────────────
for (const slider of document.querySelectorAll(".cc-slider")) {
  const valDisplay = slider.nextElementSibling;
  slider.addEventListener("input", async () => {
    const value = parseInt(slider.value);
    valDisplay.textContent = value;
    if (!connected) return;
    try {
      await invoke("send_cc", { channel, cc: parseInt(slider.dataset.cc), value });
    } catch (e) {
      setStatus(String(e), "error");
    }
  });
}

const sustainBtn = document.getElementById("sustain-btn");
let sustainOn = false;
sustainBtn.addEventListener("click", async () => {
  sustainOn = !sustainOn;
  sustainBtn.dataset.active = sustainOn;
  sustainBtn.classList.toggle("active", sustainOn);
  if (!connected) return;
  try {
    await invoke("send_cc", { channel, cc: 64, value: sustainOn ? 127 : 0 });
  } catch (e) {
    setStatus(String(e), "error");
  }
});

// Arrow-CC selector: common CCs + "Other" text input
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
  // Pan centres at 64; everything else starts at 0
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
    const sf   = await appWindow.scaleFactor();
    const logW = size.width / sf;
    const logH = size.height / sf;
    const overhead = window.innerHeight - keyboardContainer.clientHeight;
    const dW = Math.abs(logW - prevLogW);
    const dH = Math.abs(logH - prevLogH);

    let newW, newH;
    if (dW >= dH) {
      // User dragged horizontally — correct height
      newW = logW;
      newH = Math.round(logW / 14 * 3.6 + overhead);
    } else {
      // User dragged vertically — correct width
      newH = logH;
      newW = Math.round((logH - overhead) / 3.6 * 14);
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

// ── Panel toggle & window close ───────────────────────────────────────────────
const panelEl     = document.getElementById("panel");
const panelToggle = document.getElementById("panel-toggle");

panelToggle.addEventListener("click", () => {
  const open = panelEl.classList.toggle("open");
  panelToggle.classList.toggle("active", open);
});

document.getElementById("close-btn").addEventListener("click", () => {
  getCurrentWindow().close();
});

// Manual drag — data-tauri-drag-region alone isn't reliable without decorations
document.getElementById("titlebar").addEventListener("mousedown", (e) => {
  if (e.target.closest("button")) return;
  getCurrentWindow().startDragging();
});

// ── Status helper ─────────────────────────────────────────────────────────────
function setStatus(msg, type = "") {
  statusEl.textContent = msg;
  statusEl.className = type;
}

// ── Init ──────────────────────────────────────────────────────────────────────
octaveDisplay.textContent = baseOctave;
loadPorts();

// Build immediately with CSS defaults so keys are always visible,
// then let ResizeObserver scale to fit the actual container size.
buildKeyboard();
appWindow.innerSize().then(s => appWindow.scaleFactor().then(sf => {
  prevLogW = s.width / sf;
  prevLogH = s.height / sf;
}));

new ResizeObserver(() => {
  updateKeyDimensions();
  buildKeyboard();
}).observe(keyboardContainer);
