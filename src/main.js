import { invoke } from "@tauri-apps/api/core";

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
  i: 24, // C two octaves up
};

// ── State ─────────────────────────────────────────────────────────────────────
let baseOctave = 4;   // C4 = MIDI 60
let velocity   = 100;
let channel    = 0;   // 0-indexed (sent as channel 0 = MIDI ch 1)
let connected  = false;
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
const statusEl        = document.getElementById("status");
const keyboardEl      = document.getElementById("keyboard");

// ── Piano layout ──────────────────────────────────────────────────────────────
// 25 keys: C4..C6 (2 full octaves + top C)
// White key indices within an octave: 0 2 4 5 7 9 11
// Black key semitones within an octave: 1 3 6 8 10
const WHITE_OFFSETS = [0, 2, 4, 5, 7, 9, 11];
const WHITE_KEY_WIDTH = 50; // px, must match CSS

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
  const totalWhiteKeys = totalOctaves * 7 + 1; // +1 for top C
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
  // Top C
  const topMidi = (baseOctave + 2) * 12 + 12;
  const topEl = document.createElement("div");
  topEl.className = "key-white";
  topEl.dataset.midi = topMidi;
  topEl.textContent = `C${baseOctave + 2}`;
  topEl.addEventListener("mousedown", () => triggerNoteOn(topMidi, topEl));
  topEl.addEventListener("mouseup",   () => triggerNoteOff(topMidi, topEl));
  topEl.addEventListener("mouseleave", () => { if (topEl.classList.contains("active")) triggerNoteOff(topMidi, topEl); });
  keyboardEl.appendChild(topEl);
  noteToEl[topMidi] = topEl;

  // Black keys (absolute positioned over white keys)
  for (let oct = 0; oct < totalOctaves; oct++) {
    const octaveStartX = oct * 7 * WHITE_KEY_WIDTH;
    for (const bk of BLACK_KEYS) {
      const midi = (baseOctave + oct) * 12 + 12 + bk.semitone;
      const el = document.createElement("div");
      el.className = "key-black";
      el.dataset.midi = midi;
      el.style.left = `${octaveStartX + bk.whitePos * WHITE_KEY_WIDTH - 15}px`;
      el.addEventListener("mousedown", (e) => { e.stopPropagation(); triggerNoteOn(midi, el); });
      el.addEventListener("mouseup",   (e) => { e.stopPropagation(); triggerNoteOff(midi, el); });
      el.addEventListener("mouseleave", () => { if (el.classList.contains("active")) triggerNoteOff(midi, el); });
      keyboardEl.appendChild(el);
      noteToEl[midi] = el;
    }
  }
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
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  const key = e.key.toLowerCase();
  if (heldKeys.has(key)) return;
  const midi = midiNoteFromKey(key);
  if (midi === null) return;
  e.preventDefault();
  heldKeys.add(key);
  triggerNoteOn(midi, noteToEl[midi]);
});

window.addEventListener("keyup", (e) => {
  const key = e.key.toLowerCase();
  heldKeys.delete(key);
  const midi = midiNoteFromKey(key);
  if (midi === null) return;
  e.preventDefault();
  triggerNoteOff(midi, noteToEl[midi]);
});

// Release all held notes when window loses focus
window.addEventListener("blur", () => {
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
    if (ports.length === 0) setStatus("No MIDI outputs found", "error");
    else setStatus(`${ports.length} port(s) found`);
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

// ── Status helper ─────────────────────────────────────────────────────────────
function setStatus(msg, type = "") {
  statusEl.textContent = msg;
  statusEl.className = type;
}

// ── Init ──────────────────────────────────────────────────────────────────────
octaveDisplay.textContent = baseOctave;
buildKeyboard();
loadPorts();
