import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { GM_PATCHES, GM_PATCH_NAMES, ARROW_CC_OPTIONS } from "./constants";
import { state } from "./state";
import { setStatus } from "./status";
import { sendCC, programChange, getMidiPorts, connectPort, disconnect, pitchBend } from "./midi";
import { midiNoteFromKey, triggerNoteOn, triggerNoteOff, buildKeys3D, updateSceneModWheel, updateSceneLedDisplays, resizeKeyboard3D } from "./keyboard3d";

const appWindow = getCurrentWindow();

// ── DOM refs ──────────────────────────────────────────────────────────────────
const appTitle       = document.getElementById("app-title")     as HTMLElement;
const portSelect     = document.getElementById("port-select")   as HTMLSelectElement;
const refreshBtn     = document.getElementById("refresh-btn")   as HTMLButtonElement;
const channelSelect  = document.getElementById("channel-select") as HTMLSelectElement;
const patchSelect    = document.getElementById("patch-select")  as HTMLSelectElement;
const arrowCcSelect  = document.getElementById("arrow-cc-select") as HTMLSelectElement;
export const keyboardContainer = document.getElementById("keyboard-container") as HTMLElement;
const titlebar       = document.getElementById("titlebar")      as HTMLElement;
const zoomInBtn      = document.getElementById("zoom-in")       as HTMLButtonElement;
const zoomOutBtn     = document.getElementById("zoom-out")      as HTMLButtonElement;
const zoomDisplay    = document.getElementById("zoom-display")  as HTMLElement;
const helpOverlay    = document.getElementById("help-overlay")  as HTMLElement;
const configOverlay  = document.getElementById("config-overlay") as HTMLElement;

// ── Port management ───────────────────────────────────────────────────────────
export async function loadPorts(): Promise<void> {
  try {
    const ports = await getMidiPorts();
    portSelect.innerHTML = '<option value="">-- Port --</option>';
    ports.forEach((name, i) => {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = name;
      portSelect.appendChild(opt);
    });
    if (ports.length === 0) { setStatus("No MIDI outputs", "error"); return; }
    setStatus(`${ports.length} port(s)`);
    const lastPort = localStorage.getItem("lastMidiPort");
    if (lastPort) {
      const idx = ports.indexOf(lastPort);
      if (idx !== -1) { portSelect.value = String(idx); portSelect.dispatchEvent(new Event("change")); }
    }
  } catch (e) {
    setStatus(e, "error");
  }
}

portSelect.addEventListener("change", async () => {
  const idx = portSelect.value;
  if (idx === "") {
    await disconnect();
    state.connected = false;
    setStatus("Disconnected");
    return;
  }
  try {
    const name = await connectPort(parseInt(idx));
    state.connected = true;
    setStatus(`✓ ${name}`, "connected");
    localStorage.setItem("lastMidiPort", name);
    await programChange(state.channel, state.patch);
  } catch (e) {
    state.connected = false;
    setStatus(e, "error");
  }
});

refreshBtn.addEventListener("click", loadPorts);

// ── Channel selector ──────────────────────────────────────────────────────────
export function initChannelSelect(): void {
  for (let i = 1; i <= 16; i++) {
    const opt = document.createElement("option");
    opt.value = String(i - 1);
    opt.textContent = String(i);
    channelSelect.appendChild(opt);
  }
  channelSelect.addEventListener("change", () => {
    state.channel = parseInt(channelSelect.value);
    updateSceneLedDisplays();
  });
}

// ── Patch selector ────────────────────────────────────────────────────────────
export function initPatchSelect(): void {
  let programNumber = 0;
  for (const [groupName, patches] of GM_PATCHES) {
    const group = document.createElement("optgroup");
    group.label = groupName;
    for (const name of patches) {
      const opt = document.createElement("option");
      opt.value = String(programNumber);
      opt.textContent = `${programNumber + 1}. ${name}`;
      group.appendChild(opt);
      programNumber++;
    }
    patchSelect.appendChild(group);
  }
  patchSelect.addEventListener("change", async () => {
    state.patch = parseInt(patchSelect.value);
    appTitle.textContent = GM_PATCH_NAMES[state.patch];
    updateSceneLedDisplays();
    if (!state.connected) return;
    try {
      await programChange(state.channel, state.patch);
    } catch (e) {
      setStatus(e, "error");
    }
  });
}

// ── Arrow CC selector ─────────────────────────────────────────────────────────
export function initArrowCcSelect(): void {
  for (const [num, label] of ARROW_CC_OPTIONS) {
    const opt = document.createElement("option");
    opt.value = String(num);
    opt.textContent = label;
    arrowCcSelect.appendChild(opt);
  }
  arrowCcSelect.value = String(state.arrowCc);
  arrowCcSelect.addEventListener("change", () => {
    state.arrowCc = parseInt(arrowCcSelect.value);
    state.arrowCcValue = state.arrowCc === 10 ? 64 : 0;
  });
}

// ── Keyboard events ───────────────────────────────────────────────────────────
export function initKeyboardEvents(): void {
  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === " " && !e.repeat) {
      e.preventDefault();
      if (state.connected) sendCC(state.channel, 64, 127).catch(() => {});
      return;
    }

    if (/^F[1-9]$/.test(e.key) && !e.repeat) {
      e.preventDefault();
      state.baseOctave = parseInt(e.key.slice(1)) - 1;
      buildKeys3D();
      return;
    }

    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
      e.preventDefault();
      const delta = (e.key === "ArrowUp" || e.key === "ArrowRight") ? 5 : -5;
      state.arrowCcValue = Math.max(0, Math.min(127, state.arrowCcValue + delta));
      if (state.connected) sendCC(state.channel, state.arrowCc, state.arrowCcValue).catch(() => {});
      return;
    }

    if (e.repeat) return;
    const key = e.key.toLowerCase();
    if (state.heldKeys.has(key)) return;
    const midi = midiNoteFromKey(key);
    if (midi === null) return;
    e.preventDefault();
    state.heldKeys.add(key);
    state.heldKeyNotes.set(key, midi);
    triggerNoteOn(midi);
  });

  window.addEventListener("keyup", (e) => {
    if (e.key === " ") {
      if (state.connected) sendCC(state.channel, 64, 0).catch(() => {});
      return;
    }
    const key = e.key.toLowerCase();
    state.heldKeys.delete(key);
    const midi = state.heldKeyNotes.get(key);
    state.heldKeyNotes.delete(key);
    if (midi === undefined) return;
    e.preventDefault();
    triggerNoteOff(midi);
  });

  // Scroll wheel = modulation (CC 1)
  window.addEventListener("wheel", (e) => {
    e.preventDefault();
    state.modValue = Math.max(-127, Math.min(127, state.modValue - Math.sign(e.deltaY) * 18));
    updateSceneModWheel();
    if (state.connected) sendCC(state.channel, 1, Math.round((state.modValue + 127) / 2)).catch(() => {});
  }, { passive: false });

  // Middle click = reset modulation
  window.addEventListener("auxclick", (e) => {
    if (e.button !== 1) return;
    e.preventDefault();
    e.stopPropagation();
    state.modValue = 0;
    updateSceneModWheel();
    if (state.connected) sendCC(state.channel, 1, 64).catch(() => {});
  });

  // Window blur — release all held notes
  window.addEventListener("blur", () => {
    if (state.connected) {
      sendCC(state.channel, 64, 0).catch(() => {});
      state.modValue = 0;
      updateSceneModWheel();
      sendCC(state.channel, 1, 0).catch(() => {});
    }
    for (const key of state.heldKeys) {
      const midi = midiNoteFromKey(key);
      if (midi !== null) triggerNoteOff(midi);
    }
    state.heldKeys.clear();
  });
}

// ── Zoom controls ─────────────────────────────────────────────────────────────
let zoomLevel = parseFloat(localStorage.getItem("zoomLevel") ?? "1") || 1;
let baseWidth = 860;
let baseHeight = 200;
let isZooming = false;

function updateZoomDisplay(): void {
  zoomDisplay.textContent = Math.round(zoomLevel * 100) + "%";
}

async function applyZoom(): Promise<void> {
  if (isZooming) return;
  isZooming = true;
  try {
    const appEl = document.getElementById("app")!;
    await appWindow.setSize(new LogicalSize(
      Math.round(baseWidth * zoomLevel),
      Math.round(baseHeight * zoomLevel)
    ));
    appEl.style.transform = `scale(${zoomLevel})`;
    appEl.style.transformOrigin = "top left";
    localStorage.setItem("zoomLevel", zoomLevel.toFixed(2));
  } finally {
    isZooming = false;
  }
}

export function initZoom(): void {
  window.addEventListener("load", () => {
    const appEl = document.getElementById("app")!;
    appEl.style.transform = "scale(1)";
    baseWidth = appEl.offsetWidth;
    baseHeight = appEl.offsetHeight;
    applyZoom();
    loadPorts();
  });

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
  updateZoomDisplay();
}

// ── Aspect-ratio enforcement ──────────────────────────────────────────────────
let aspectCorrecting = false;
let prevLogW = 0;
let prevLogH = 0;

async function correctAspectRatio(): Promise<void> {
  if (aspectCorrecting) return;
  aspectCorrecting = true;
  try {
    const size = await appWindow.innerSize();
    const sf = await appWindow.scaleFactor();
    const logW = size.width / sf;
    const logH = size.height / sf;
    const RATIO = 14 / 3.6;
    const dW = Math.abs(logW - prevLogW);
    const dH = Math.abs(logH - prevLogH);
    let newW: number, newH: number;
    if (dW >= dH) {
      newW = logW;
      newH = Math.round(logW / RATIO + titlebar.offsetHeight);
    } else {
      newH = logH;
      newW = Math.round((logH - titlebar.offsetHeight) * RATIO);
    }
    prevLogW = newW; prevLogH = newH;
    if (Math.abs(newW - logW) > 2 || Math.abs(newH - logH) > 2)
      await appWindow.setSize(new LogicalSize(newW, newH));
  } finally {
    setTimeout(() => { aspectCorrecting = false; }, 150);
  }
}

export function initWindowManagement(): void {
  document.getElementById("close-btn")!.addEventListener("click", () => getCurrentWindow().close());

  appWindow.innerSize().then(s => appWindow.scaleFactor().then(sf => {
    prevLogW = s.width / sf;
    prevLogH = s.height / sf;
  }));

  appWindow.onResized(() => { if (!isZooming) correctAspectRatio(); });

  new ResizeObserver(() => {
    resizeKeyboard3D(keyboardContainer);
  }).observe(keyboardContainer);
}

// ── Overlays ──────────────────────────────────────────────────────────────────
export function initOverlays(): void {
  document.getElementById("help-btn")!.addEventListener("click", () => helpOverlay.classList.toggle("hidden"));
  document.getElementById("help-close")!.addEventListener("click", () => helpOverlay.classList.add("hidden"));
  helpOverlay.addEventListener("click", (e) => { if (e.target === helpOverlay) helpOverlay.classList.add("hidden"); });

  document.getElementById("config-btn")!.addEventListener("click", () => configOverlay.classList.toggle("hidden"));
  document.getElementById("config-close")!.addEventListener("click", () => configOverlay.classList.add("hidden"));
  configOverlay.addEventListener("click", (e) => { if (e.target === configOverlay) configOverlay.classList.add("hidden"); });
}

