import { initKeyboard3D, setThemeLighting } from "./keyboard3d";
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

// Boot the 3D scene
initKeyboard3D(keyboardContainer);

// Apply saved theme (must run after initKeyboard3D so lighting is ready)
applyTheme(localStorage.getItem("theme") ?? "default");
setThemeLighting(localStorage.getItem("theme") ?? "default");
