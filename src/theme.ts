import { setThemeLighting } from "./keyboard3d";

const swatches = document.querySelectorAll<HTMLElement>(".theme-swatch");

export function applyTheme(name: string): void {
  if (name === "default") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", name);
  }
  swatches.forEach(s => s.classList.toggle("active", s.dataset.theme === name));
  localStorage.setItem("theme", name);
  setThemeLighting(name);
}

export function initTheme(): void {
  swatches.forEach(s => s.addEventListener("click", () => {
    applyTheme(s.dataset.theme ?? "default");
    if (s.dataset.theme === "disco") flashDiscoMsg();
  }));
}

function flashDiscoMsg(): void {
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
  document.getElementById("app")!.appendChild(el);
  el.addEventListener("animationend", () => el.remove());
}
