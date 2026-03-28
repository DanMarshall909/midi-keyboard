import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import {
  WHITE_OFFSETS, BLACK_KEY_DEFS,
  WKW, WKH, WKD, BKW, BKH, BKD, KEY_GAP,
  DISPLAY_OCTAVES, BODY_D, HEAD_H, HEAD_D, KEY_OFFSET_X,
  SCENE_KNOBS, THEME_LIGHTS, KEY_MAP,
  KEY_MATERIAL_PRESETS, CAMERA_PRESETS,
} from "./constants";
import { state } from "./state";
import { setStatus } from "./status";
import { noteOn, noteOff } from "./midi";
import {
  initSceneControls,
  getModWheelHitbox, getPitchWheelHitbox, getKnobBodies, getLedMeshes,
  updateSceneModWheel, updateSceneLedDisplays, updateKnobColors, tickPatchLedMarquee,
  handleKnobDrag, handleModWheelDrag, handlePitchWheelDrag, releasePitchWheel,
} from "./controls3d";

// ── Scene-level Three.js objects ──────────────────────────────────────────────
let kbScene: THREE.Scene;
let kbCamera: THREE.PerspectiveCamera;
let kbRenderer: THREE.WebGLRenderer;
let kbRaycaster: THREE.Raycaster;
let kbSun: THREE.DirectionalLight;
let kbFill: THREE.DirectionalLight;
let kbAmbient: THREE.AmbientLight;
let kbDiscoLights: THREE.PointLight[] = [];
let discoMode = false;
let discoAngle = 0;
let strobeBurstStart = -1;
let strobeCountdown = 360;
let kbNeedsRender = true;

// Shared materials (no per-key cloning)
const matWhite   = new THREE.MeshStandardMaterial({ color: 0xf0f0eb, roughness: 0.35, metalness: 0.0 });
const matBlack   = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.20, metalness: 0.05 });
export const matHousing = new THREE.MeshStandardMaterial({ color: 0x3a3a3e, roughness: 0.78, metalness: 0.04 });

const noteToMesh: Record<number, THREE.Mesh> = {};
const meshToMidi = new Map<THREE.Mesh, number>();
const activeNotes = new Set<number>();

// ── Public API ────────────────────────────────────────────────────────────────
export function midiNoteFromKey(key: string): number | null {
  const offset = KEY_MAP[key];
  if (offset === undefined) return null;
  return state.baseOctave * 12 + 12 + offset;
}

export async function triggerNoteOn(midi: number): Promise<void> {
  if (!state.connected) return;
  setKeyActive(midi, true);
  try {
    await noteOn(state.channel, midi, state.velocity);
  } catch (e) {
    setStatus(e, "error");
  }
}

export async function triggerNoteOff(midi: number): Promise<void> {
  if (!state.connected) return;
  setKeyActive(midi, false);
  try {
    await noteOff(state.channel, midi);
  } catch (e) {
    setStatus(e, "error");
  }
}

export function setThemeLighting(name: string): void {
  if (!kbSun) return;
  for (const l of kbDiscoLights) kbScene.remove(l);
  kbDiscoLights = [];
  discoMode = false;
  strobeBurstStart = -1;
  strobeCountdown = 90;
  if (kbAmbient) kbAmbient.intensity = 0.55;

  const cssVars = [
    "--accent", "--accent-border", "--accent-blight", "--accent-glow", "--accent-shadow",
    "--accent-bg", "--accent-bg2", "--accent-bg3",
    "--border-app", "--border-sub", "--border-ctrl", "--border-modal",
    "--ctrl-bg", "--ctrl-hover",
    "--knob-dot", "--knob-ring",
    "--text-heading", "--text-dim", "--text-muted", "--hk-color",
    "--mod-bg", "--mod-border", "--mod-grip-t", "--mod-grip-b", "--mod-grip-bdr",
  ];
  for (const prop of cssVars) document.documentElement.style.removeProperty(prop);

  if (name === "disco") {
    discoMode = true;
    kbSun.color.set(0x303030); kbSun.intensity = 0.25;
    kbFill.color.set(0x101010); kbFill.intensity = 0.15;
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

  const cfg = THEME_LIGHTS[name] ?? THEME_LIGHTS.default;
  kbSun.color.set(cfg.sun.color); kbSun.intensity = cfg.sun.intensity;
  kbFill.color.set(cfg.fill.color); kbFill.intensity = cfg.fill.intensity;
  updateKnobColors();
  updateSceneLedDisplays();
  kbNeedsRender = true;
}

export function buildKeys3D(): void {
  for (const mesh of Object.values(noteToMesh)) {
    kbScene.remove(mesh);
    mesh.geometry.dispose();
  }
  Object.keys(noteToMesh).forEach(k => delete (noteToMesh as Record<string, unknown>)[k]);
  meshToMidi.clear();

  const displayStart = Math.max(0, Math.min(9 - DISPLAY_OCTAVES, state.baseOctave - 1));
  const totalW = DISPLAY_OCTAVES * 7 * (WKW + KEY_GAP);
  const startX = KEY_OFFSET_X - totalW / 2 + (WKW + KEY_GAP) / 2;

  const whiteGeo = new RoundedBoxGeometry(WKW, WKH, WKD, 3, 0.04);
  for (let oct = 0; oct < DISPLAY_OCTAVES; oct++) {
    const octNum = displayStart + oct;
    for (let i = 0; i < WHITE_OFFSETS.length; i++) {
      const midi = octNum * 12 + 12 + WHITE_OFFSETS[i];
      const x = startX + (oct * 7 + i) * (WKW + KEY_GAP);
      const mesh = new THREE.Mesh(whiteGeo, matWhite);
      mesh.position.set(x, 0, 0);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData = { midi, isBlack: false, baseY: 0 };
      kbScene.add(mesh);
      noteToMesh[midi] = mesh; meshToMidi.set(mesh, midi);
    }
  }

  const blackGeo = new RoundedBoxGeometry(BKW, BKH, BKD, 3, 0.04);
  const blackY = (WKH + BKH) / 2;
  const blackZ = -(WKD - BKD) / 2;
  for (let oct = 0; oct < DISPLAY_OCTAVES; oct++) {
    const octNum = displayStart + oct;
    for (const bk of BLACK_KEY_DEFS) {
      const midi = octNum * 12 + 12 + bk.semitone;
      const x = startX + (oct * 7 + bk.whitePos) * (WKW + KEY_GAP);
      const mesh = new THREE.Mesh(blackGeo, matBlack);
      mesh.position.set(x, blackY, blackZ);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData = { midi, isBlack: true, baseY: blackY };
      kbScene.add(mesh);
      noteToMesh[midi] = mesh; meshToMidi.set(mesh, midi);
    }
  }

  kbNeedsRender = true;
}

export function resizeKeyboard3D(container: HTMLElement): void {
  const w = container.clientWidth;
  const h = container.clientHeight;
  if (w < 10 || h < 10) return;
  kbRenderer.setSize(w, h);
  kbCamera.aspect = w / h;
  kbCamera.updateProjectionMatrix();
  kbNeedsRender = true;
}

// ── Init ──────────────────────────────────────────────────────────────────────
export function initKeyboard3D(container: HTMLElement): void {
  const canvas = container.querySelector<HTMLCanvasElement>("#keyboard-canvas")!;

  kbScene = new THREE.Scene();
  kbRaycaster = new THREE.Raycaster();

  kbRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  kbRenderer.setClearColor(0x000000, 0);
  kbRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  kbRenderer.shadowMap.enabled = true;
  kbRenderer.shadowMap.type = THREE.PCFShadowMap;

  const w = container.clientWidth || 700;
  const h = container.clientHeight || 200;
  kbCamera = new THREE.PerspectiveCamera(24, w / h, 0.1, 100);
  const xOffset = 2.15;
  const zOffset = 0.3;
  kbCamera.position.set(xOffset, 13, 12 + zOffset);
  kbCamera.lookAt(xOffset, -5, -2.5 + zOffset);
  kbRenderer.setSize(w, h);

  kbAmbient = new THREE.AmbientLight(0xffffff, 0.55);
  kbScene.add(kbAmbient);

  kbSun = new THREE.DirectionalLight(0xfffaf0, 1.1);
  kbSun.position.set(-18, 18, 8);
  kbSun.castShadow = true;
  kbSun.shadow.mapSize.set(1024, 1024);
  Object.assign(kbSun.shadow.camera, { left: -16, right: 16, top: 10, bottom: -10, near: 1, far: 60 });
  kbScene.add(kbSun);

  kbFill = new THREE.DirectionalLight(0xfffa00, 0.9);
  kbFill.position.set(1, 12, 8);
  kbScene.add(kbFill);

  // Piano housing
  const totalKeyW = DISPLAY_OCTAVES * 7 * (WKW + KEY_GAP);
  const wheelW = 0.55;
  const keyLeftEdge = KEY_OFFSET_X - totalKeyW / 2;
  const modCX = keyLeftEdge - 0.35 - wheelW / 2;
  const pitchCX = modCX - wheelW - 0.22;
  const bodyLeft = pitchCX - wheelW / 2 - 0.4;
  const bodyRight = KEY_OFFSET_X + totalKeyW / 2 + 0.3;
  const bodyW = bodyRight - bodyLeft;
  const bodyCX = (bodyLeft + bodyRight) / 2;
  const bodyH = 1.5;
  const bodyTop = -WKH / 2;

  const bodyMesh = new THREE.Mesh(new RoundedBoxGeometry(bodyW, bodyH, BODY_D, 4, 0.18), matHousing);
  bodyMesh.position.set(bodyCX, bodyTop - bodyH / 2, 0);
  bodyMesh.castShadow = true; bodyMesh.receiveShadow = true;
  kbScene.add(bodyMesh);

  const headZ = -(BODY_D - HEAD_D) / 2;
  const headMesh = new THREE.Mesh(new RoundedBoxGeometry(bodyW, bodyH + HEAD_H, HEAD_D, 4, 0.14), matHousing);
  headMesh.position.set(bodyCX, bodyTop - bodyH / 2 + HEAD_H / 2, headZ);
  headMesh.castShadow = true; headMesh.receiveShadow = true;
  kbScene.add(headMesh);

  const badge = createBrandBadge();
  if (badge) { badge.position.set(bodyRight - 2, bodyTop - bodyH + 0.8, BODY_D / 2 + 0.015); kbScene.add(badge); }

  buildKeys3D();
  initSceneControls(kbScene, matHousing, () => { kbNeedsRender = true; });

  setupMouseHandlers(canvas);
  startRenderLoop();
}

// ── Mouse handling ────────────────────────────────────────────────────────────
type DragInfo =
  | { type: "key" }
  | { type: "modwheel"; startY: number; startVal: number }
  | { type: "pitchwheel"; startY: number; startVal: number }
  | { type: "knob"; ki: number; startY: number; startVal: number };

function setupMouseHandlers(canvas: HTMLCanvasElement): void {
  let dragInfo: DragInfo | null = null;

  function getNdc(e: MouseEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
      y: ((e.clientY - rect.top) / rect.height) * -2 + 1,
    };
  }

  canvas.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    kbRaycaster.setFromCamera(getNdc(e), kbCamera);

    const knobBodies = getKnobBodies();
    const knobHits = kbRaycaster.intersectObjects(knobBodies, true);
    if (knobHits.length) {
      const obj = knobHits[0].object;
      const ki: number | undefined =
        obj.parent?.userData?.type === "knob" ? obj.parent.userData.knobIndex : obj.userData.knobIndex;
      if (ki !== undefined) {
        dragInfo = { type: "knob", startY: e.clientY, startVal: SCENE_KNOBS[ki].value, ki };
        return;
      }
    }

    const { patch: patchMesh, channel: channelMesh } = getLedMeshes();
    if (patchMesh && kbRaycaster.intersectObject(patchMesh, false).length) {
      (document.getElementById("patch-select") as HTMLSelectElement).showPicker();
      return;
    }
    if (channelMesh && kbRaycaster.intersectObject(channelMesh, false).length) {
      (document.getElementById("channel-select") as HTMLSelectElement).showPicker();
      return;
    }

    const mwHitbox = getModWheelHitbox();
    if (mwHitbox && kbRaycaster.intersectObject(mwHitbox, false).length) {
      dragInfo = { type: "modwheel", startY: e.clientY, startVal: state.modValue };
      return;
    }

    const pwHitbox = getPitchWheelHitbox();
    if (pwHitbox && kbRaycaster.intersectObject(pwHitbox, false).length) {
      dragInfo = { type: "pitchwheel", startY: e.clientY, startVal: state.pitchValue };
      return;
    }

    const midi = raycastMidi(e);
    if (midi !== null) { triggerNoteOn(midi); dragInfo = { type: "key" }; }
  });

  canvas.addEventListener("mousemove", (e) => {
    if (!dragInfo) return;
    if (dragInfo.type === "key") {
      if (e.buttons !== 1) return;
      const midi = raycastMidi(e);
      for (const held of [...activeNotes]) { if (held !== midi) triggerNoteOff(held); }
      if (midi !== null && !activeNotes.has(midi)) triggerNoteOn(midi);
      return;
    }
    if (dragInfo.type === "modwheel") {
      handleModWheelDrag(dragInfo.startY, e.clientY, dragInfo.startVal); return;
    }
    if (dragInfo.type === "pitchwheel") {
      handlePitchWheelDrag(dragInfo.startY, e.clientY, dragInfo.startVal); return;
    }
    if (dragInfo.type === "knob") {
      handleKnobDrag(dragInfo.ki, dragInfo.startY, e.clientY, dragInfo.startVal);
    }
  });

  function releaseAll(): void {
    if (dragInfo?.type === "key") {
      for (const midi of [...activeNotes]) triggerNoteOff(midi);
    }
    if (dragInfo?.type === "pitchwheel") releasePitchWheel();
    dragInfo = null;
  }

  canvas.addEventListener("mouseup", releaseAll);
  canvas.addEventListener("mouseleave", releaseAll);
}

// ── Render loop ───────────────────────────────────────────────────────────────
function startRenderLoop(): void {
  (function loop() {
    requestAnimationFrame(loop);
    tickPatchLedMarquee();
    if (discoMode) {
      discoAngle += 0.02;
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

      // Occasional 3-flash strobe burst (25 ms on/off)
      const now = performance.now();
      if (strobeBurstStart >= 0) {
        const elapsed = now - strobeBurstStart;
        if (elapsed >= 3 * 25 * 2) {
          kbAmbient.intensity = 0.3;
          strobeBurstStart = -1;
          strobeCountdown = 240 + Math.random() * 720;
        } else {
          kbAmbient.intensity = Math.floor(elapsed / 25) % 2 === 0 ? 1.2 : 0.3;
        }
      } else if (--strobeCountdown <= 0) {
        strobeBurstStart = performance.now();
      }

      // Cycle CSS accent vars through offset hues
      const h1 = (discoAngle * 115) % 360;
      const r = document.documentElement;
      r.style.setProperty("--accent",        `hsl(${h1},100%,65%)`);
      r.style.setProperty("--accent-border", `hsla(${h1},100%,65%,0.4)`);
      r.style.setProperty("--accent-blight", `hsla(${h1},100%,65%,0.25)`);
      r.style.setProperty("--accent-glow",   `hsla(${h1},100%,65%,0.2)`);
      r.style.setProperty("--accent-shadow", `hsla(${h1},100%,65%,0.6)`);
      r.style.setProperty("--accent-bg",     `hsla(${h1},80%,20%,0.4)`);
      r.style.setProperty("--accent-bg2",    `hsla(${h1},80%,15%,0.55)`);
      r.style.setProperty("--accent-bg3",    `hsla(${h1},80%,8%,0.9)`);
      r.style.setProperty("--border-app",    `hsla(${h1},100%,60%,0.2)`);
      r.style.setProperty("--border-sub",    `hsla(${h1},100%,60%,0.1)`);
      r.style.setProperty("--border-ctrl",   `hsla(${h1},100%,60%,0.3)`);
      r.style.setProperty("--border-modal",  `hsla(${h1},100%,60%,0.25)`);
      r.style.setProperty("--ctrl-bg",       `hsla(${h1},100%,60%,0.08)`);
      r.style.setProperty("--ctrl-hover",    `hsla(${h1},100%,60%,0.18)`);
      r.style.setProperty("--knob-dot",      `hsl(${h1},100%,70%)`);
      r.style.setProperty("--knob-ring",     `hsla(${h1},100%,65%,0.4)`);
      r.style.setProperty("--text-heading",  `hsl(${h1},100%,75%)`);
      r.style.setProperty("--text-dim",      `hsl(${h1},60%,45%)`);
      r.style.setProperty("--text-muted",    `hsl(${h1},55%,35%)`);
      r.style.setProperty("--hk-color",      `hsl(${h1},100%,65%)`);
      r.style.setProperty("--mod-bg",        `hsla(${h1},60%,12%,0.55)`);
      r.style.setProperty("--mod-border",    `hsla(${h1},100%,60%,0.2)`);
      r.style.setProperty("--mod-grip-t",    `hsl(${h1},60%,30%)`);
      r.style.setProperty("--mod-grip-b",    `hsl(${h1},60%,15%)`);
      r.style.setProperty("--mod-grip-bdr",  `hsla(${h1},100%,65%,0.4)`);
      updateKnobColors();
      updateSceneLedDisplays();
      kbNeedsRender = true;
    }
    if (!kbNeedsRender) return;
    kbNeedsRender = false;
    kbRenderer.render(kbScene, kbCamera);
  })();
}

// ── Private helpers ───────────────────────────────────────────────────────────
function setKeyActive(midi: number, on: boolean): void {
  const mesh = noteToMesh[midi];
  if (!mesh) return;
  const { isBlack, baseY } = mesh.userData as { isBlack: boolean; baseY: number };
  mesh.position.y = on ? baseY - (isBlack ? 0.18 : 0.14) : baseY;
  on ? activeNotes.add(midi) : activeNotes.delete(midi);
  kbNeedsRender = true;
}

function raycastMidi(event: MouseEvent): number | null {
  const canvas = kbRenderer.domElement;
  const rect = canvas.getBoundingClientRect();
  kbRaycaster.setFromCamera({
    x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
    y: -((event.clientY - rect.top) / rect.height) * 2 + 1,
  }, kbCamera);
  const hits = kbRaycaster.intersectObjects(Object.values(noteToMesh));
  if (!hits.length) return null;
  const black = hits.find(h => (h.object.userData as { isBlack: boolean }).isBlack);
  return meshToMidi.get((black ?? hits[0]).object as THREE.Mesh) ?? null;
}

function createBrandBadge(): THREE.Mesh | null {
  const texCanvas = document.createElement("canvas");
  texCanvas.width = 1024; texCanvas.height = 256;
  const ctx = texCanvas.getContext("2d");
  if (!ctx) return null;

  ctx.clearRect(0, 0, texCanvas.width, texCanvas.height);
  ctx.fillStyle = "rgba(8,8,10,0.82)";
  ctx.fillRect(12, 52, texCanvas.width - 24, 152);
  ctx.strokeStyle = "rgba(255,255,255,0.20)";
  ctx.lineWidth = 2;
  ctx.strokeRect(12, 52, texCanvas.width - 24, 152);

  const text = "QWERTone";
  const tracking = 5.5;
  ctx.font = "800 106px Arial Black";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#222222";

  let totalW = 0;
  for (let i = 0; i < text.length; i++)
    totalW += ctx.measureText(text[i]).width + (i < text.length - 1 ? tracking : 0);
  let x = (texCanvas.width - totalW) / 2;
  const y = texCanvas.height / 2 - 2;
  for (let i = 0; i < text.length; i++) {
    ctx.fillText(text[i], x, y);
    x += ctx.measureText(text[i]).width + tracking;
  }

  const tex = new THREE.CanvasTexture(texCanvas);
  tex.anisotropy = 4; tex.needsUpdate = true;

  const badge = new THREE.Mesh(
    new THREE.PlaneGeometry(2.95, 0.98),
    new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.34, metalness: 0.02 })
  );
  badge.castShadow = false; badge.receiveShadow = false;
  return badge;
}

export function setKeyMaterialPreset(name: string): void {
  const p = KEY_MATERIAL_PRESETS[name] ?? KEY_MATERIAL_PRESETS.classic;
  matWhite.color.set(p.white.color);   matWhite.roughness = p.white.roughness;   matWhite.metalness = p.white.metalness;
  matBlack.color.set(p.black.color);   matBlack.roughness = p.black.roughness;   matBlack.metalness = p.black.metalness;
  matHousing.color.set(p.housing.color); matHousing.roughness = p.housing.roughness; matHousing.metalness = p.housing.metalness;
  kbNeedsRender = true;
}

export function setCameraPreset(name: string): void {
  const p = CAMERA_PRESETS[name] ?? CAMERA_PRESETS.default;
  kbCamera.position.set(...p.position);
  kbCamera.lookAt(...p.lookAt);
  kbNeedsRender = true;
}

// Re-export for use by ui.ts
export { updateSceneModWheel, updateSceneLedDisplays };
