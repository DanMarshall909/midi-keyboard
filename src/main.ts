import "@fontsource/orbitron/700.css";
import "@fontsource/orbitron/900.css";
import { initKeyboard3D, setThemeLighting, setKeyMaterialPreset, setCameraPreset } from "./keyboard3d";
import { applyTheme, initTheme } from "./theme";
import {
  initChannelSelect, initPatchSelect, initArrowCcSelect,
  initKeyboardEvents, initZoom, initWindowManagement, initOverlays,
  keyboardContainer,
} from "./ui";
import { GM_PATCH_NAMES } from "./constants";
import { state } from "./state";

// Wire up all UI subsystems
initChannelSelect();
initPatchSelect();
initArrowCcSelect();
initKeyboardEvents();
initZoom();
initWindowManagement();
initOverlays();
initTheme();

// Set initial title
(document.getElementById("app-title") as HTMLElement).textContent = GM_PATCH_NAMES[state.patch];

// Ensure Orbitron is loaded before the 3D scene renders LED displays
await document.fonts.load("900 1em Orbitron");

// Boot the 3D scene
initKeyboard3D(keyboardContainer);

// Apply saved theme/material/camera (must run after initKeyboard3D)
applyTheme(localStorage.getItem("theme") ?? "default");
setThemeLighting(localStorage.getItem("theme") ?? "default");
setKeyMaterialPreset(localStorage.getItem("material") ?? "classic");
setCameraPreset(localStorage.getItem("camera") ?? "default");
