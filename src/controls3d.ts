import * as THREE from "three";
import { sendCC, pitchBend } from "./midi";
import { state } from "./state";
import {
  SCENE_KNOBS, KNOB_R, WKH, WKD, BODY_D, HEAD_H, HEAD_D, KEY_OFFSET_X, DISPLAY_OCTAVES, WKW, KEY_GAP,
} from "./constants";

// ── Module-level control objects (set by initSceneControls) ───────────────────
let kbModWheelSpinner: THREE.Group | null = null;
let kbPitchWheelSpinner: THREE.Group | null = null;
let kbModWheelHitbox: THREE.Mesh | null = null;
let kbPitchWheelHitbox: THREE.Mesh | null = null;
const kbKnobBodies: THREE.Mesh[] = [];
let markDirty: () => void = () => {};

export function getModWheelHitbox(): THREE.Mesh | null { return kbModWheelHitbox; }
export function getPitchWheelHitbox(): THREE.Mesh | null { return kbPitchWheelHitbox; }
export function getKnobBodies(): THREE.Mesh[] { return kbKnobBodies; }

// ── Init ──────────────────────────────────────────────────────────────────────
export function initSceneControls(
  scene: THREE.Scene,
  matHousing: THREE.MeshStandardMaterial,
  onDirty: () => void,
): void {
  markDirty = onDirty;
  kbKnobBodies.length = 0;

  const totalKeyW = DISPLAY_OCTAVES * 7 * (WKW + KEY_GAP);
  const keyLeftEdge = KEY_OFFSET_X - totalKeyW / 2;
  const panelCX = keyLeftEdge - 0.35 - 0.55 / 2;

  const modWheelY = -0.52;
  const wheelR = 1.15;
  const wheelW = 0.55;
  const pitchCX = panelCX - wheelW - 0.22;
  const markerMat = new THREE.MeshStandardMaterial({
    color: 0xaaaaaa, emissive: 0xaaaaaa, emissiveIntensity: 0.3,
    roughness: 0.1, metalness: 0.0,
  });

  function buildWheel(cx: number): { spinner: THREE.Group; hitbox: THREE.Mesh } {
    const spinner = new THREE.Group();
    const bodyGeo = new THREE.CylinderGeometry(wheelR, wheelR, wheelW, 36);
    bodyGeo.rotateZ(Math.PI / 2);
    spinner.add(new THREE.Mesh(bodyGeo,
      new THREE.MeshStandardMaterial({ color: 0x111114, roughness: 0.70, metalness: 0.18 })
    ));

    // 11 grip ribs
    const ridgeMat = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.88, metalness: 0.05 });
    const ridgeStep = wheelW / 12;
    for (let i = 0; i < 11; i++) {
      const rGeo = new THREE.CylinderGeometry(wheelR + 0.10, wheelR + 0.10, 0.038, 36);
      rGeo.rotateZ(Math.PI / 2);
      const r = new THREE.Mesh(rGeo, ridgeMat);
      r.position.x = -wheelW / 2 + ridgeStep * (i + 1);
      spinner.add(r);
    }

    // 12 o'clock marker strip
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(wheelW + 0.02, 0.13, 0.09),
      markerMat
    );
    strip.position.set(0, wheelR + 0.04, 0);
    spinner.add(strip);
    spinner.position.set(cx, modWheelY, 0);
    scene.add(spinner);

    // Housing notch
    const notch = new THREE.Mesh(
      new THREE.BoxGeometry(wheelW + 0.1, 0.3, 0.18),
      matHousing
    );
    notch.position.set(cx, -WKH / 2 + 0.03, 0);
    scene.add(notch);

    // Invisible hitbox for raycasting
    const hitbox = new THREE.Mesh(
      new THREE.BoxGeometry(wheelW + 0.2, 1.4, 1.4),
      new THREE.MeshStandardMaterial({ visible: false })
    );
    hitbox.position.set(cx, modWheelY + 0.5, 0);
    scene.add(hitbox);

    return { spinner, hitbox };
  }

  // Mod wheel
  const modObj = buildWheel(panelCX);
  kbModWheelSpinner = modObj.spinner;
  kbModWheelHitbox = modObj.hitbox;
  kbModWheelHitbox.userData = { type: "modwheel" };
  const modLabel = createControlLabel("MOD", 0.98, 0.26);
  if (modLabel) { modLabel.position.set(panelCX, -WKH / 2 + 0.012, 1.45); scene.add(modLabel); }

  // Pitch wheel
  const pitchObj = buildWheel(pitchCX);
  kbPitchWheelSpinner = pitchObj.spinner;
  kbPitchWheelHitbox = pitchObj.hitbox;
  kbPitchWheelHitbox.userData = { type: "pitchwheel" };
  const pitchLabel = createControlLabel("PITCH", 1.3, 0.26);
  if (pitchLabel) { pitchLabel.position.set(pitchCX, -WKH / 2 + 0.012, 1.45); scene.add(pitchLabel); }

  // Knobs on the raised head slab
  const knobBaseZ = -(BODY_D / 2 - HEAD_D / 2);
  const headTopY = -WKH / 2 + HEAD_H;
  const knobY = headTopY + 0.12;
  const knobSpanX = 5;
  const knobStartX = KEY_OFFSET_X - knobSpanX / 2;

  for (let i = 0; i < SCENE_KNOBS.length; i++) {
    const kd = SCENE_KNOBS[i];
    const kx = knobStartX + i * (knobSpanX / (SCENE_KNOBS.length - 1));

    const bodyGeo = new THREE.CylinderGeometry(KNOB_R * 0.84, KNOB_R, 0.20, 32);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x282828, roughness: 0.28, metalness: 0.65 });
    const body = new THREE.Mesh(bodyGeo, bodyMat) as THREE.Mesh;

    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(KNOB_R * 0.82, KNOB_R * 0.84, 0.018, 32),
      new THREE.MeshStandardMaterial({ color: 0x3c3c3c, roughness: 0.18, metalness: 0.75 })
    );
    cap.position.y = 0.11;
    body.add(cap);

    const pipCol = parseCssColorToHex("--knob-dot");
    const pipMat = new THREE.MeshStandardMaterial({
      color: pipCol, emissive: pipCol, emissiveIntensity: 0.6,
      roughness: 0.1, metalness: 0.1,
    });
    const pip = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.04, 10), pipMat);
    pip.position.set(0, 0.13, -0.27);
    body.add(pip);

    body.position.set(kx, knobY, knobBaseZ);
    body.userData = { type: "knob", knobIndex: i };
    body.rotation.y = -knobRotation(kd.value, kd.min, kd.max) * Math.PI / 180;
    scene.add(body);
    kbKnobBodies.push(body);

    const label = createControlLabel(kd.label, 0.9, 0.24);
    if (label) { label.position.set(kx, headTopY + 0.012, knobBaseZ + 0.62); scene.add(label); }
  }

  updateSceneModWheel();
}

// ── Wheel / knob update ───────────────────────────────────────────────────────
export function updateSceneModWheel(): void {
  if (!kbModWheelSpinner) return;
  kbModWheelSpinner.rotation.x = -(state.modValue / 127) * (Math.PI * 0.65);
  markDirty();
}

export function updateScenePitchWheel(): void {
  if (!kbPitchWheelSpinner) return;
  kbPitchWheelSpinner.rotation.x = -(state.pitchValue / 127) * (Math.PI * 0.55);
  markDirty();
}

// Called from mouse drag handler in keyboard3d.ts
export function handleKnobDrag(ki: number, startY: number, currentY: number, startVal: number): void {
  const kd = SCENE_KNOBS[ki];
  const newVal = Math.max(kd.min, Math.min(kd.max,
    Math.round(startVal + (startY - currentY) * (kd.max - kd.min) / 100)
  ));
  if (newVal === kd.value) return;
  kd.value = newVal;
  if (ki === 0) {
    state.velocity = newVal;
  } else if (state.connected) {
    sendCC(state.channel, kd.cc, newVal).catch(() => {});
  }
  kbKnobBodies[ki].rotation.y = -knobRotation(newVal, kd.min, kd.max) * Math.PI / 180;
  markDirty();
}

export function handleModWheelDrag(startY: number, currentY: number, startVal: number): void {
  state.modValue = Math.max(-127, Math.min(127, Math.round(startVal + (startY - currentY) * 127 / 35)));
  updateSceneModWheel();
  const midiVal = Math.round((state.modValue + 127) / 2);
  if (state.connected) sendCC(state.channel, 1, midiVal).catch(() => {});
}

export function handlePitchWheelDrag(startY: number, currentY: number, startVal: number): void {
  state.pitchValue = Math.max(-127, Math.min(127, Math.round(startVal + (startY - currentY) * 127 / 35)));
  updateScenePitchWheel();
  const bend = Math.round(state.pitchValue / 127 * 8191);
  if (state.connected) pitchBend(state.channel, bend).catch(() => {});
}

export function releasePitchWheel(): void {
  state.pitchValue = 0;
  updateScenePitchWheel();
  if (state.connected) pitchBend(state.channel, 0).catch(() => {});
}

// ── Helpers ───────────────────────────────────────────────────────────────────
export function knobRotation(value: number, min: number, max: number): number {
  return -135 + ((value - min) / (max - min)) * 270;
}

function parseCssColorToHex(varName: string): number {
  const str = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  const m = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) return (parseInt(m[1]) << 16) | (parseInt(m[2]) << 8) | parseInt(m[3]);
  const h = str.replace(/^#/, "");
  if (h.length === 6) return parseInt(h, 16);
  if (h.length === 3) return parseInt(h[0] + h[0] + h[1] + h[1] + h[2] + h[2], 16);
  return 0x7ab4ff;
}

function createControlLabel(text: string, width = 0.95, height = 0.24): THREE.Mesh | null {
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = "900 386px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = 22;
  ctx.strokeStyle = "rgba(0,0,0,0.95)";
  ctx.strokeText(text, canvas.width / 2, canvas.height / 2 + 6);
  ctx.fillStyle = "#aaaaaa77";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 6);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.anisotropy = 8;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide })
  );
  label.rotation.x = -Math.PI / 2;
  return label;
}
