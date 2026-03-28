const statusEl = document.getElementById("status") as HTMLElement;

export function setStatus(msg: unknown, type = ""): void {
  statusEl.textContent = String(msg);
  statusEl.className = type;
}
