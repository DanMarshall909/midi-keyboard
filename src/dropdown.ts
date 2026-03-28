export interface DropdownItem { label: string; value: number; }

let rootEl: HTMLDivElement | null = null;
let searchEl: HTMLInputElement | null = null;
let listEl: HTMLDivElement | null = null;
let allItems: DropdownItem[] = [];
let currentValue = -1;
let onSelectFn: ((value: number) => void) | null = null;

// ── Build DOM (once) ──────────────────────────────────────────────────────────
function build(): void {
  rootEl = document.createElement("div");
  rootEl.id = "kb-dropdown";

  searchEl = document.createElement("input");
  searchEl.id = "kb-dropdown-search";
  searchEl.type = "text";
  searchEl.placeholder = "Search…";
  searchEl.autocomplete = "off";
  searchEl.spellcheck = false;

  listEl = document.createElement("div");
  listEl.id = "kb-dropdown-list";

  rootEl.appendChild(searchEl);
  rootEl.appendChild(listEl);
  document.body.appendChild(rootEl);

  searchEl.addEventListener("input", () => renderItems(searchEl!.value));
  searchEl.addEventListener("keydown", onKeySearch);

  // Dismiss on outside click (capture phase so it fires before anything else)
  document.addEventListener("mousedown", (e) => {
    if (rootEl && !rootEl.contains(e.target as Node)) closeDropdown();
  }, true);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDropdown();
  });
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderItems(filter: string): void {
  if (!listEl) return;
  const q = filter.trim().toLowerCase();
  const items = q ? allItems.filter(i => i.label.toLowerCase().includes(q)) : allItems;
  listEl.innerHTML = "";
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "kb-dd-item" + (item.value === currentValue ? " active" : "");
    row.dataset.value = String(item.value);
    row.textContent = item.label;
    row.addEventListener("mousedown", (e) => { e.preventDefault(); commit(item.value); });
    listEl.appendChild(row);
  }
}

function scrollToActive(): void {
  const active = listEl?.querySelector(".kb-dd-item.active") as HTMLElement | null;
  active?.scrollIntoView({ block: "nearest" });
}

// ── Keyboard nav in search box ────────────────────────────────────────────────
function onKeySearch(e: KeyboardEvent): void {
  if (!listEl) return;
  const items = listEl.querySelectorAll<HTMLElement>(".kb-dd-item");
  const activeIdx = [...items].findIndex(el => el.classList.contains("kb-focused"));
  if (e.key === "ArrowDown") {
    e.preventDefault();
    const next = activeIdx < items.length - 1 ? activeIdx + 1 : 0;
    items.forEach(el => el.classList.remove("kb-focused"));
    items[next]?.classList.add("kb-focused");
    items[next]?.scrollIntoView({ block: "nearest" });
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    const prev = activeIdx > 0 ? activeIdx - 1 : items.length - 1;
    items.forEach(el => el.classList.remove("kb-focused"));
    items[prev]?.classList.add("kb-focused");
    items[prev]?.scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter") {
    const focused = listEl.querySelector<HTMLElement>(".kb-dd-item.kb-focused");
    if (focused?.dataset.value !== undefined) commit(parseInt(focused.dataset.value));
  }
}

// ── Public API ────────────────────────────────────────────────────────────────
function commit(value: number): void {
  onSelectFn?.(value);
  closeDropdown();
}

export function openDropdown(
  items: DropdownItem[],
  selected: number,
  x: number,
  y: number,
  onSelect: (value: number) => void,
  showSearch = true,
): void {
  if (!rootEl) build();
  allItems = items;
  currentValue = selected;
  onSelectFn = onSelect;

  searchEl!.value = "";
  searchEl!.style.display = showSearch ? "" : "none";
  renderItems("");

  // Start invisible, position off-screen to measure size
  rootEl!.style.opacity = "0";
  rootEl!.style.display = "flex";

  requestAnimationFrame(() => {
    if (!rootEl) return;
    const rect = rootEl.getBoundingClientRect();
    const lx = (x + rect.width  > window.innerWidth  - 8) ? x - rect.width  : x;
    const ly = (y + rect.height > window.innerHeight - 8) ? y - rect.height : y;
    rootEl.style.left = Math.max(8, lx) + "px";
    rootEl.style.top  = Math.max(8, ly) + "px";
    rootEl.style.opacity = "1";
    scrollToActive();
    if (showSearch) searchEl!.focus();
  });
}

export function closeDropdown(): void {
  if (rootEl) rootEl.style.display = "none";
  onSelectFn = null;
}
