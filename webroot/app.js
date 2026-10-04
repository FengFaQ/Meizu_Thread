const FILE_PATH = "/data/user/0/com.omarea.vtools/files/threads.json";
// 本模块（魅族线程 v3.0）
const MODDIR = "/data/adb/modules/Meizu_Thread";
const WEBUI = MODDIR + "/webui.sh";
const DEFAULT_THREADS = MODDIR + "/default_threads.json";
const MODE_LABELS = { 0: "硬亲和", 1: "软迁移", 2: "硬迁移" };
const RT_LABELS = { 0: "调度器默认", 1: "实时" };
const LS_SCALE_KEY = "threads_editor_ui_scale";
const LS_THEME_KEY = "threads_editor_theme";
const LS_CPUSET_ORDER_KEY = "threads_editor_cpuset_order";
const LS_APP_ORDER_KEY = "threads_editor_app_order";
const LS_BG_FILE_KEY = "threads_editor_bg_file";
const BG_FILE_PREFIX = "bg-image-";
const LS_FROSTED_KEY = "threads_editor_frosted";
const LS_MIN_FROSTED_KEY = "threads_editor_min_frosted";
const LS_TRANSLUCENT_KEY = "threads_editor_translucent";
const LS_BG_BLUR_KEY = "threads_editor_bg_blur";
const LS_BG_BLUR_PCT_KEY = "threads_editor_bg_blur_pct";
const LS_CARD_OPACITY_KEY = "threads_editor_card_opacity";
const LS_CONTRAST_KEY = "threads_editor_contrast";

const KEYBOARD_COVER_PADDING = 12;
const TOAST_DURATION = 2600;

const FP_ROOT = "/sdcard";
const LS_FP_LAST_DIR = "threads_editor_fp_last_dir";
const FP_SHORTCUTS = [
  { label: "内部存储", path: FP_ROOT },
  { label: "下载", path: FP_ROOT + "/Download" },
];

const CPUSET_FIELD_CARDS = [
  { id: "heaviest_thread", label: "heaviest_thread" },
  { id: "heavy_thread", label: "heavy_thread" },
  { id: "unity_main", label: "unity_main" },
  { id: "main_thread", label: "main_thread" },
  { id: "comm", label: "comm" },
  { id: "trashy", label: "trashy" },
  { id: "ni", label: "ni" },
  { id: "other", label: "other" },
];

const DEFAULT_CPUSET_ORDER = [
  "ni", "heaviest_thread", "heavy_thread", "unity_main", "main_thread", "comm", "trashy", "other",
];

const APP_CPUSET_FIELD_CARDS = [
  { id: "app_main", label: "main" },
  { id: "app_render", label: "render" },
  { id: "app_other", label: "other" },
  { id: "webview", label: "webview" },
  { id: "children", label: "children" },
];

const DEFAULT_APP_ORDER = [
  "app_main", "app_render", "app_other", "webview", "children",
];

let data = [];
let editingIndex = null;
let dirty = false;
let editorRefs = {};
let editorFields = [];
let navStack = ["list"];

let darkModeRefs = {
  frosted: null,
  minFrosted: null,
  minFrostedWrap: null,
  translucent: null,
  bgBlur: null,
  blurRange: null,
  blurLabel: null,
  blurRow: null,
  opacityRange: null,
  opacityLabel: null,
  opacityRow: null,
  contrast: null,
  bgImport: null,
  bgRemove: null,
  bgPreview: null,
};

let fullH = window.innerHeight;
let editing = false;
let kbdOpenState = false;
let kbdScrollTimer = null;
let editingTimer = null;

let activeDrag = null;

let bgLayer = null;

let totalCoreCount = 0;
let coreCountLoaded = false;
const coreCountSubscribers = [];

const corePickerInstances = [];

let fpState = null;
let closingPicker = false;
let settingsBuilt = false;

function $(sel) { return document.querySelector(sel); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k === "html") n.innerHTML = v;
    else if (k === "style") Object.assign(n.style, v);
    else if (k === "dataset") Object.assign(n.dataset, v);
    else if (k === "on") for (const ev in v) n.addEventListener(ev, v[ev]);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2).toLowerCase(), v);
    else n.setAttribute(k, v);
  }
  for (const kid of kids) {
    if (kid == null || kid === false) continue;
    n.appendChild(typeof kid === "string" || typeof kid === "number"
      ? document.createTextNode(String(kid))
      : kid);
  }
  return n;
}
function setStatus(text) { $("#status").textContent = text; }
function showToast(text) {
  const el = $("#toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove("show"), TOAST_DURATION);
}

function showDialogUI(message, opts) {
  const overlay = $("#dialog");
  const messageEl = $("#dialog-message");
  const okBtn = $("#dialog-ok");
  const cancelBtn = $("#dialog-cancel");
  messageEl.textContent = String(message);
  okBtn.textContent = opts.okText || "确定";
  cancelBtn.textContent = opts.cancelText || "取消";
  cancelBtn.style.display = opts.cancel ? "" : "none";
  overlay.style.display = "flex";
  return new Promise((resolve) => {
    const cleanup = (result) => {
      overlay.style.display = "none";
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      overlay.removeEventListener("click", onBackdrop);
      document.removeEventListener("keydown", onKey);
      resolve(result);
    };
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onBackdrop = (e) => { if (e.target === overlay) cleanup(false); };
    const onKey = (e) => { if (e.key === "Escape") cleanup(false); };
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    overlay.addEventListener("click", onBackdrop);
    document.addEventListener("keydown", onKey);
  });
}

function uiAlert(message, opts = {}) {
  blurActiveElement();
  return showDialogUI(message, { cancel: false, okText: opts.okText });
}

function uiConfirm(message, opts = {}) {
  blurActiveElement();
  return showDialogUI(message, { cancel: true, okText: opts.okText, cancelText: opts.cancelText });
}

function markDirty() {
  dirty = true;
  setStatus("有未保存的修改");
}

function isEditableEl(el) {
  if (!el || !el.tagName) return false;
  if (el.tagName === "TEXTAREA") return true;
  if (el.tagName === "INPUT") {
    const t = (el.type || "text").toLowerCase();
    return ["text","search","url","tel","email","number","password",
            "date","datetime-local","time","month","week"].includes(t);
  }
  return false;
}
function blurActiveElement() {
  const ae = document.activeElement;
  if (isEditableEl(ae)) ae.blur();
}
function hasFixedAncestor(el) {
  let n = el;
  while (n && n !== document.body) {
    if (window.getComputedStyle(n).position === "fixed") return true;
    n = n.parentElement;
  }
  return false;
}
function getVisibleHeight() {
  if (window.visualViewport && typeof window.visualViewport.height === "number") {
    return window.visualViewport.height;
  }
  return window.innerHeight;
}

const KSU_EXEC_TIMEOUT = 20000;

function ksuExec(command, options = {}, timeoutMs = KSU_EXEC_TIMEOUT) {
  return new Promise((resolve) => {
    if (typeof window.ksu === "undefined" || typeof window.ksu.exec !== "function") {
      resolve({ errno: -1, stdout: "", stderr: "window.ksu.exec 不可用" });
      return;
    }
    const callbackFuncName = `exec_callback_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    options.cwd = options.cwd || ".";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      delete window[callbackFuncName];
      resolve(result);
    };
    window[callbackFuncName] = (errno, stdout, stderr) => {
      finish({ errno, stdout, stderr });
    };
    const timer = setTimeout(() => {
      finish({ errno: -1, stdout: "", stderr: `ksu.exec 执行超时（${Math.round(timeoutMs / 1000)}s）` });
    }, timeoutMs);
    try {
      window.ksu.exec(command, JSON.stringify(options), callbackFuncName);
    } catch (e) {
      finish({ errno: -1, stdout: "", stderr: String(e) });
    }
  });
}

function scrollInputIntoViewIfCovered(el, behavior) {
  if (!el) return;
  if (hasFixedAncestor(el)) return;

  if (computeKbdHeight() <= 8) return;
  const vh = getVisibleHeight();
  const rect = el.getBoundingClientRect();
  if (rect.height > vh * 0.55) return;

  const bottomLimit = vh - KEYBOARD_COVER_PADDING;
  const covered = rect.bottom - bottomLimit;

  if (covered > 8) {
    const scroller = getActiveScreen();
    if (scroller) {

      const maxScroll = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
      const target = Math.min(covered, Math.max(maxScroll, 0));
      if (target > 2) {
        try {
          scroller.scrollBy({ top: target, behavior: behavior || "smooth" });
        } catch (e) {
          scroller.scrollTop += target;
        }
      }
    }
  }
}

function computeKbdHeight() {
  if (window.visualViewport && typeof window.visualViewport.height === "number") {
    const vDiff = Math.round(window.innerHeight - window.visualViewport.height);
    if (vDiff > 4) return vDiff;
  }
  if (editing && fullH - window.innerHeight > 4) {
    return Math.round(fullH - window.innerHeight);
  }
  return 0;
}

function syncKeyboardLayout() {
  const kbd = computeKbdHeight();
  const open = kbd > 8;
  if (open !== kbdOpenState) {
    kbdOpenState = open;
    document.documentElement.classList.toggle("kbd-open", open);
  }
  document.documentElement.style.setProperty("--kbd-up", (open ? kbd : 0) + "px");
  if (open) {
    document.documentElement.style.setProperty("--full-h", fullH + "px");

    document.documentElement.style.setProperty("--screen-h", Math.round(getVisibleHeight()) + "px");
  } else {
    document.documentElement.style.removeProperty("--full-h");
    document.documentElement.style.removeProperty("--screen-h");
  }
  const ae = document.activeElement;
  if (open && isEditableEl(ae) && !hasFixedAncestor(ae)) {
    clearTimeout(kbdScrollTimer);
    kbdScrollTimer = setTimeout(() => scrollInputIntoViewIfCovered(ae, "smooth"), 60);
  }
}

function maybeEndEditing() {
  if (!isEditableEl(document.activeElement) && window.innerHeight >= fullH - 2) {
    editing = false;
    fullH = window.innerHeight;
    syncKeyboardLayout();
  } else {
    clearTimeout(editingTimer);
    editingTimer = setTimeout(maybeEndEditing, 200);
  }
}

document.addEventListener("pointerdown", (e) => {
  if (isEditableEl(e.target) && computeKbdHeight() <= 8) {
    fullH = window.innerHeight;
  }
}, { passive: true });
document.addEventListener("focusin", (e) => {
  if (!isEditableEl(e.target)) return;
  clearTimeout(editingTimer);
  if (computeKbdHeight() <= 8) fullH = window.innerHeight;
  editing = true;
  syncKeyboardLayout();
  setTimeout(() => scrollInputIntoViewIfCovered(e.target, "smooth"), 120);
});
document.addEventListener("focusout", () => {
  clearTimeout(editingTimer);
  editingTimer = setTimeout(maybeEndEditing, 300);
});

let viewportRaf = null;
function onViewportChanged() {

  if (viewportRaf) return;
  viewportRaf = requestAnimationFrame(() => {
    viewportRaf = null;
    syncKeyboardLayout();
    syncBgPreviewRatio();
    applyBgZoom();
    updateBgPreviewBlur();
  });
}
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", onViewportChanged);
  window.visualViewport.addEventListener("scroll", onViewportChanged);
}
window.addEventListener("resize", onViewportChanged);
window.addEventListener("orientationchange", () => {
  fullH = window.innerHeight;
  syncKeyboardLayout();
});

function getActiveScreen() {
  for (const n of ["list", "editor", "raw", "settings"]) {
    const s = document.getElementById("screen-" + n);
    if (s && s.style.display !== "none") return s;
  }
  return document.getElementById("screen-list");
}
function scrollToTop() {
  window.scrollTo(0, 0);
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;

  ["list", "editor", "raw", "settings"].forEach((n) => {
    const s = document.getElementById("screen-" + n);
    if (s) s.scrollTop = 0;
  });
  setTimeout(() => {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    const active = getActiveScreen();
    if (active) active.scrollTop = 0;
  }, 30);
}
function showScreenInternal(name) {
  blurActiveElement();

  const target = document.getElementById("screen-" + name);
  if (target) target.scrollTop = 0;
  ["list", "editor", "raw", "settings"].forEach((n) => {
    $("#screen-" + n).style.display = n === name ? "" : "none";
  });
  scrollToTop();
}
function navigateTo(name) {
  if (navStack[navStack.length - 1] !== name) {
    navStack.push(name);
    history.pushState({ screen: name }, "");
  }
  showScreenInternal(name);
}
function navigateBack() {
  if (history.state && history.state.screen) {
    history.back();
  } else {
    navStack = ["list"];
    showScreenInternal("list");
  }
}
window.addEventListener("popstate", () => {

  if (closingPicker) {
    closingPicker = false;
    return;
  }
  if ($("#fp-overlay").style.display !== "none") {
    closeFilePicker();
    return;
  }
  if (navStack.length > 1) navStack.pop();
  const target = navStack[navStack.length - 1] || "list";
  showScreenInternal(target);
});

function readStoredOrder(key, cards, defaults) {
  const validIds = cards.map((c) => c.id);
  try {
    const stored = localStorage.getItem(key);
    if (stored) {
      const arr = JSON.parse(stored);
      if (Array.isArray(arr)) {
        const filtered = arr.filter((id) => validIds.includes(id));
        defaults.forEach((id) => {
          if (!filtered.includes(id)) filtered.push(id);
        });
        if (filtered.length) return filtered;
      }
    }
  } catch (e) {}
  return [...defaults];
}
function writeStoredOrder(key, cards, defaults, order) {
  const validIds = cards.map((c) => c.id);
  const clean = order.filter((id) => validIds.includes(id));
  defaults.forEach((id) => {
    if (!clean.includes(id)) clean.push(id);
  });
  localStorage.setItem(key, JSON.stringify(clean));
}
function getCpusetOrder() {
  return readStoredOrder(LS_CPUSET_ORDER_KEY, CPUSET_FIELD_CARDS, DEFAULT_CPUSET_ORDER);
}
function getAppOrder() {
  return readStoredOrder(LS_APP_ORDER_KEY, APP_CPUSET_FIELD_CARDS, DEFAULT_APP_ORDER);
}
function saveCpusetOrder(order) {
  writeStoredOrder(LS_CPUSET_ORDER_KEY, CPUSET_FIELD_CARDS, DEFAULT_CPUSET_ORDER, order);
}
function saveAppOrder(order) {
  writeStoredOrder(LS_APP_ORDER_KEY, APP_CPUSET_FIELD_CARDS, DEFAULT_APP_ORDER, order);
}
function readSortOrder(list) {
  if (!list) return [];
  return [...list.querySelectorAll("[data-sort-id]")].map((r) => r.dataset.sortId);
}

function enableDragSort(container, onChange) {
  const LONG_PRESS_MS = 380;
  let row = null;
  let placeholder = null;
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let offsetX = 0;
  let offsetY = 0;
  let curX = 0;
  let curY = 0;
  let dragW = 0;
  let dragH = 0;
  let timer = null;
  let dragging = false;

  if (container) container.style.position = "relative";

  function clearTimer() {
    if (timer) { clearTimeout(timer); timer = null; }
  }

  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target.closest(".sort-arrow")) return;
    const r = e.target.closest("[data-sort-id]");
    if (!r || r.classList.contains("is-fixed") || activeDrag) return;

    const fromHandle = !!e.target.closest(".sort-handle");
    const rect = r.getBoundingClientRect();
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;

    activeDrag = { pointerId, onMove, end, dragging: false };

    if (fromHandle) {
      if (e.cancelable) e.preventDefault();
      beginDrag(r);
    } else {
      clearTimer();
      timer = setTimeout(() => beginDrag(r), LONG_PRESS_MS);
    }
  }

  function beginDrag(r) {
    if (dragging) return;
    clearTimer();
    dragging = true;
    row = r;
    if (activeDrag) activeDrag.dragging = true;

    const cr = container.getBoundingClientRect();
    const rect = row.getBoundingClientRect();
    dragW = rect.width;
    dragH = rect.height;
    curX = rect.left - cr.left;
    curY = rect.top - cr.top;

    placeholder = document.createElement("div");
    placeholder.className = "sort-row sort-placeholder";
    placeholder.style.height = dragH + "px";
    row.parentNode.insertBefore(placeholder, row);

    row.classList.add("dragging");
    row.style.position = "absolute";
    row.style.left = curX + "px";
    row.style.top = curY + "px";
    row.style.width = dragW + "px";
    row.style.margin = "0";
    row.style.zIndex = "1000";

    try { if (navigator.vibrate) navigator.vibrate(12); } catch (err) {}
  }

  function onMove(e) {
    if (!dragging) {
      if (Math.abs(e.clientX - startX) > 8 || Math.abs(e.clientY - startY) > 8) {
        clearTimer();
      }
      return;
    }

    const cr = container.getBoundingClientRect();
    curX = e.clientX - offsetX - cr.left;
    curY = e.clientY - offsetY - cr.top;
    row.style.left = curX + "px";
    row.style.top = curY + "px";

    const px = cr.left + curX + dragW / 2;
    const py = cr.top + curY + dragH / 2;
    const rows = [...container.querySelectorAll("[data-sort-id]")].filter((r) => r !== row);
    if (!rows.length) return;

    let target = null;
    let after = false;
    const firstRect = rows[0].getBoundingClientRect();
    const lastRect = rows[rows.length - 1].getBoundingClientRect();

    if (py < firstRect.top + firstRect.height / 2) {
      target = rows[0];
      after = false;
    } else if (py > lastRect.top + lastRect.height / 2) {
      target = rows[rows.length - 1];
      after = true;
    } else {
      const under = document.elementFromPoint(px, py);
      target = under ? under.closest("[data-sort-id]") : null;
      if (target) {
        const tRect = target.getBoundingClientRect();
        after = py > tRect.top + tRect.height / 2;
      }
    }

    if (target) {
      if (after) {
        if (target.nextElementSibling !== placeholder) {
          const before = captureRects();
          container.insertBefore(placeholder, target.nextElementSibling);
          flip(before);
        }
      } else {
        if (placeholder.nextElementSibling !== target) {
          const before = captureRects();
          container.insertBefore(placeholder, target);
          flip(before);
        }
      }
    }
  }

  function end() {
    clearTimer();
    const wasDragging = dragging;
    if (!wasDragging) {
      activeDrag = null;
      pointerId = null;
      return;
    }
    dragging = false;
    if (activeDrag) activeDrag.dragging = false;
    settle();
    row = null;
    placeholder = null;
    pointerId = null;
    activeDrag = null;
    if (onChange) onChange();
  }

  function settle() {
    if (!row || !placeholder) return;
    const fromLeft = curX;
    const fromTop = curY;

    placeholder.parentNode.insertBefore(row, placeholder);
    placeholder.remove();

    row.classList.remove("dragging");
    row.style.position = "";
    row.style.left = "";
    row.style.top = "";
    row.style.width = "";
    row.style.margin = "";
    row.style.zIndex = "";
    row.style.pointerEvents = "";

    const cr = container.getBoundingClientRect();
    const nr = row.getBoundingClientRect();
    const dx = fromLeft - (nr.left - cr.left);
    const dy = fromTop - (nr.top - cr.top);
    if (dx || dy) {
      row.style.transition = "none";
      row.style.transform = `translate(${dx}px, ${dy}px)`;
      void row.getBoundingClientRect();
      row.style.transition = "transform 260ms cubic-bezier(.22,.61,.36,1), box-shadow .18s ease, border-color .18s ease";
      row.style.transform = "";
    }
  }

  function captureRects() {
    const map = new Map();
    container.querySelectorAll("[data-sort-id]").forEach((r) => {
      if (r === row) return;
      map.set(r, r.getBoundingClientRect());
    });
    return map;
  }

  function flip(before) {
    container.querySelectorAll("[data-sort-id]").forEach((r) => {
      if (r === row) return;
      const b = before.get(r);
      if (!b) return;
      const a = r.getBoundingClientRect();
      const dx = b.left - a.left;
      const dy = b.top - a.top;
      if (!dx && !dy) return;
      r.style.transition = "none";
      r.style.transform = `translate(${dx}px, ${dy}px)`;
      void r.getBoundingClientRect();
      r.style.transition = "transform 220ms cubic-bezier(.22,.61,.36,1), box-shadow .18s ease, border-color .18s ease";
      r.style.transform = "";
    });
  }

  container.addEventListener("pointerdown", onPointerDown);
  container.addEventListener("contextmenu", (e) => {
    if (dragging) e.preventDefault();
  });
}

window.addEventListener("pointermove", (e) => {
  if (!activeDrag || e.pointerId !== activeDrag.pointerId) return;
  activeDrag.onMove(e);
});
window.addEventListener("pointerup", (e) => {
  if (!activeDrag || e.pointerId !== activeDrag.pointerId) return;
  activeDrag.end();
});
window.addEventListener("pointercancel", (e) => {
  if (!activeDrag || e.pointerId !== activeDrag.pointerId) return;
  activeDrag.end();
});
window.addEventListener("touchmove", (e) => {
  if (activeDrag && activeDrag.dragging) e.preventDefault();
}, { passive: false });

function getTheme() {
  const v = localStorage.getItem(LS_THEME_KEY);
  return v === "light" || v === "dark" ? v : "system";
}
function applyTheme(theme) {
  if (theme === "light" || theme === "dark") {
    document.documentElement.setAttribute("data-theme", theme);
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}
function isDarkMode() {
  const theme = getTheme();
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
}
function getUiScale() {
  const v = parseFloat(localStorage.getItem(LS_SCALE_KEY));
  return Number.isFinite(v) && v >= 0.8 && v <= 1.5 ? v : 1;
}
function applyUiScale(scale) {
  if (scale === 1) {
    document.documentElement.style.zoom = "";
  } else {
    document.documentElement.style.zoom = String(scale);
  }
}

function getBgFile() { return localStorage.getItem(LS_BG_FILE_KEY) || ""; }
function hasBgImage() { return !!getBgFile(); }
function bgImageSource() {
  const file = getBgFile();
  return file ? "./" + file : "";
}
let moduleWebroot = null;
function getModuleWebroot() {
  if (moduleWebroot !== null) return moduleWebroot;
  moduleWebroot = "";
  try {
    if (window.ksu && typeof window.ksu.moduleInfo === "function") {
      const info = JSON.parse(window.ksu.moduleInfo() || "{}");
      if (info && info.moduleDir) moduleWebroot = String(info.moduleDir).replace(/\/+$/, "") + "/webroot";
    }
  } catch (err) {
    moduleWebroot = "";
  }
  return moduleWebroot;
}

function getFrosted() { return localStorage.getItem(LS_FROSTED_KEY) === "1"; }
function applyFrosted(on) {
  document.documentElement.setAttribute("data-frosted", on && !isDarkMode() ? "1" : "0");
}
function getMinFrosted() { return localStorage.getItem(LS_MIN_FROSTED_KEY) === "1"; }
function applyMinFrosted(on) {
  document.documentElement.setAttribute("data-min-frosted", on && getFrosted() && !isDarkMode() ? "1" : "0");
}
function getTranslucent() { return localStorage.getItem(LS_TRANSLUCENT_KEY) === "1"; }
function applyTranslucent(on) {
  document.documentElement.setAttribute("data-translucent", on && !isDarkMode() ? "1" : "0");
}
function getBgBlur() { return localStorage.getItem(LS_BG_BLUR_KEY) === "1"; }
function getBgBlurPct() {
  const v = parseFloat(localStorage.getItem(LS_BG_BLUR_PCT_KEY));
  return Number.isFinite(v) && v >= 10 && v <= 40 ? v : 14;
}
function calcZoomFor(minDim) {
  const blur = getBgBlurPct();
  if (!(minDim > 0) || blur <= 0) return 1;
  return 1 + (2 * blur + 2) / minDim;
}
function applyBgBlur(on) {
  document.documentElement.style.setProperty("--bg-blur", on && !isDarkMode() ? getBgBlurPct() + "px" : "0px");
  applyBgZoom();
}
function applyBgZoom() {
  const active = getBgBlur() && !isDarkMode();
  const minDim = Math.min(window.innerWidth, window.innerHeight);
  document.documentElement.style.setProperty("--bg-zoom", active ? calcZoomFor(minDim) : 1);
}
function getCardOpacity() {
  const v = parseFloat(localStorage.getItem(LS_CARD_OPACITY_KEY));
  return Number.isFinite(v) && v >= 20 && v <= 90 ? v : 60;
}
function applyCardOpacity(v) {
  document.documentElement.style.setProperty("--card-opacity", v + "%");
}
function getContrast() { return localStorage.getItem(LS_CONTRAST_KEY) === "1"; }
function applyContrast(on) {
  document.documentElement.setAttribute("data-contrast", on && !isDarkMode() ? "1" : "0");
}

function ensureBgLayer() {
  if (bgLayer) return;
  bgLayer = el("div", { id: "bg-layer" });
  document.body.appendChild(bgLayer);
}
function applyBgImage(source) {
  ensureBgLayer();
  bgLayer.style.backgroundImage = source && !isDarkMode() ? `url(${source})` : "";
}
function syncEffectControls() {
  const dark = isDarkMode();
  const hasBg = hasBgImage();
  const showBlur = !dark && getBgBlur() && hasBg;
  const showOpacity = !dark && getTranslucent();
  const showMinFrosted = !dark && getFrosted();

  if (darkModeRefs.frosted) darkModeRefs.frosted.disabled = dark;
  if (darkModeRefs.minFrosted) darkModeRefs.minFrosted.disabled = dark || !getFrosted();
  if (darkModeRefs.minFrostedWrap) darkModeRefs.minFrostedWrap.style.display = showMinFrosted ? "" : "none";
  if (darkModeRefs.translucent) darkModeRefs.translucent.disabled = dark;
  if (darkModeRefs.contrast) darkModeRefs.contrast.disabled = dark;
  if (darkModeRefs.bgBlur) darkModeRefs.bgBlur.disabled = dark;
  if (darkModeRefs.blurRange) darkModeRefs.blurRange.disabled = dark || !getBgBlur();
  if (darkModeRefs.blurLabel) darkModeRefs.blurLabel.style.display = showBlur ? "" : "none";
  if (darkModeRefs.blurRow) darkModeRefs.blurRow.style.display = showBlur ? "" : "none";
  if (darkModeRefs.opacityRange) darkModeRefs.opacityRange.disabled = dark || !getTranslucent();
  if (darkModeRefs.opacityLabel) darkModeRefs.opacityLabel.style.display = showOpacity ? "" : "none";
  if (darkModeRefs.opacityRow) darkModeRefs.opacityRow.style.display = showOpacity ? "" : "none";
  if (darkModeRefs.bgImport) darkModeRefs.bgImport.disabled = dark;
  if (darkModeRefs.bgRemove) darkModeRefs.bgRemove.disabled = dark;
  if (darkModeRefs.bgPreview) darkModeRefs.bgPreview.style.opacity = dark ? "0.45" : "";
  updateBgPreviewBlur();
}
function applyDarkModeDisable() {
  applyFrosted(getFrosted());
  applyMinFrosted(getMinFrosted());
  applyTranslucent(getTranslucent());
  applyContrast(getContrast());
  applyBgBlur(getBgBlur());
  applyBgImage(bgImageSource());
  syncEffectControls();
}

function setEffectsGroupVisibility(on) {
  const eg = $("#effects-group");
  if (eg) eg.style.display = on ? "" : "none";
  const bw = $("#bg-blur-wrap");
  if (bw) bw.style.display = on ? "" : "none";
}
const BG_IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"];
function imageExtOf(name) {
  const lower = String(name).toLowerCase();
  return BG_IMAGE_EXTS.find((ext) => lower.endsWith(ext)) || ".png";
}
async function applyBgImageFile(fullPath) {
  const webroot = getModuleWebroot();
  if (!webroot) return false;
  const fileName = BG_FILE_PREFIX + Date.now() + imageExtOf(fullPath);
  const target = webroot + "/" + fileName;
  const tmp = webroot + "/." + fileName + ".tmp";
  setStatus("正在应用背景图…");
  const script = [
    `mkdir -p ${shQuote(webroot)} 2>/dev/null || exit 1`,
    `rm -f ${shQuote(webroot + "/." + BG_FILE_PREFIX)}* >/dev/null 2>&1`,
    `cp -f ${shQuote(fullPath)} ${shQuote(tmp)} 2>/dev/null || exit 1`,
    `rm -f ${shQuote(webroot + "/" + BG_FILE_PREFIX)}* >/dev/null 2>&1`,
    `mv -f ${shQuote(tmp)} ${shQuote(target)} || exit 1`,
    `chmod 644 ${shQuote(target)} >/dev/null 2>&1`,
    `echo __DONE__`,
  ].join("\n");
  const res = await ksuExec(script, {}, 60000);
  if (res.errno !== 0 || !(res.stdout || "").includes("__DONE__")) {
    setStatus("背景图应用失败");
    await uiAlert(`复制背景图失败：\n${fullPath}\n${res.stderr || ""}`.trimEnd());
    return false;
  }
  localStorage.setItem(LS_BG_FILE_KEY, fileName);
  const source = bgImageSource();
  applyBgImage(source);
  updateBgPreviewEl($("#bg-preview"), source);
  setEffectsGroupVisibility(true);
  setStatus("背景图已应用");
  showToast("背景图已设置");
  return true;
}
function importBgImage() {
  if (typeof window.ksu === "undefined" || typeof window.ksu.exec !== "function") {
    showToast("未检测到 Root WebUI 接口，无法选择背景图");
    return;
  }
  if (!getModuleWebroot()) {
    uiAlert(`未获取到模块目录，无法保存背景图。\n请在 KernelSU / APatch 的模块 WebUI 中打开本页面。`);
    return;
  }
  blurActiveElement();
  openFilePicker({
    mode: "open",
    binary: true,
    title: "选择背景图片",
    filterExt: BG_IMAGE_EXTS,
    startPath: FP_ROOT,
    onConfirm: (text, fullPath) => applyBgImageFile(fullPath),
  });
}
async function validateBgFile() {
  const file = getBgFile();
  if (!file) return;
  const webroot = getModuleWebroot();
  if (!webroot) return;
  const res = await ksuExec(`[ -f ${shQuote(webroot + "/" + file)} ] && echo __OK__`);
  if ((res.stdout || "").includes("__OK__")) return;
  localStorage.removeItem(LS_BG_FILE_KEY);
  applyBgImage(bgImageSource());
  updateBgPreviewEl($("#bg-preview"), bgImageSource());
  setEffectsGroupVisibility(hasBgImage());
  syncEffectControls();
}
async function removeBgImage() {
  const file = getBgFile();
  const webroot = file ? getModuleWebroot() : "";
  try {
    localStorage.removeItem(LS_BG_FILE_KEY);
    applyBgImage("");
    updateBgPreviewEl($("#bg-preview"), "");
    setEffectsGroupVisibility(false);
    syncEffectControls();
    showToast("已移除背景图");
  } catch (err) {
    showToast("移除背景失败：" + err.message);
  }
  if (file && webroot) {
    await ksuExec(`rm -f ${shQuote(webroot + "/" + file)} >/dev/null 2>&1`);
  }
}
function updateBgPreviewEl(el, source) {
  if (!el) return;
  const img = el.querySelector(".bg-preview-img");
  const empty = el.querySelector(".bg-preview-empty");
  if (source) {
    if (img) img.style.backgroundImage = `url(${source})`;
    el.classList.add("has");
    if (empty) empty.style.display = "none";
  } else {
    if (img) img.style.backgroundImage = "";
    el.classList.remove("has");
    if (empty) empty.style.display = "";
  }
}
function updateBgPreviewBlur() {
  const el = $("#bg-preview");
  if (!el) return;
  const img = el.querySelector(".bg-preview-img");
  if (!img) return;
  const on = getBgBlur() && !isDarkMode();
  img.style.filter = on ? `blur(${getBgBlurPct()}px)` : "";
  const minDim = Math.min(el.clientWidth || 120, el.clientHeight || 260);
  img.style.transform = on ? `scale(${calcZoomFor(minDim)})` : "";
}
function getDeviceAspectRatio() {
  const landscape = !!(window.matchMedia && window.matchMedia("(orientation: landscape)").matches);
  if (window.screen && window.screen.width > 0 && window.screen.height > 0) {
    const screenLandscape = window.screen.width >= window.screen.height;
    if (screenLandscape === landscape) {
      return window.screen.width / window.screen.height;
    }
  }
  return window.innerWidth / window.innerHeight;
}
function syncBgPreviewRatio() {
  const el = $("#bg-preview");
  if (!el) return;
  el.style.setProperty("--preview-ratio", getDeviceAspectRatio());
}

function settingCheckbox(label, checked, onChange) {
  const input = el("input", { type: "checkbox", checked, on: { change: () => onChange(input.checked) } });
  const wrap = el("div", { class: "field field-checkbox" }, el("label", null, input, " " + label));
  return { wrap, input };
}
function makeScaleRow({ min, max, step, value, format, onChange }) {
  const val = el("span", { class: "scale-value", text: format(value) });
  const range = el("input", {
    type: "range", min: String(min), max: String(max), step: String(step), value: String(value),
    on: { input: () => { const v = parseFloat(range.value); val.textContent = format(v); onChange(v); } },
  });
  return { row: el("div", { class: "scale-row" }, range, val), range };
}
function buildBackgroundGroup() {
  const group = el("div", { class: "settings-group bg-card" },
    el("div", { class: "settings-group-title", text: "自定义背景与卡片效果" }));

  const previewImg = el("div", { class: "bg-preview-img" });
  const previewEmpty = el("span", { class: "bg-preview-empty", text: "未设置背景图" });
  const preview = el("div", { class: "bg-preview", id: "bg-preview" }, previewImg, previewEmpty);
  preview.style.setProperty("--preview-ratio", getDeviceAspectRatio());
  updateBgPreviewEl(preview, bgImageSource());
  group.appendChild(preview);
  darkModeRefs.bgPreview = preview;

  group.appendChild(el("div", { class: "hint", text: "选择一张图片作为整个界面的背景，图片会复制到模块目录；可开启背景模糊，深色模式下自动禁用" }));

  const importBtn = el("button", { type: "button", class: "btn-secondary", text: "导入背景图", style: { marginTop: "0" }, onClick: importBgImage });
  const removeBtn = el("button", { type: "button", class: "btn-secondary", text: "移除背景", style: { marginTop: "0" }, onClick: removeBgImage });
  const btnRow = el("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "center" } }, importBtn, removeBtn);
  group.appendChild(btnRow);
  darkModeRefs.bgImport = importBtn;
  darkModeRefs.bgRemove = removeBtn;

  const bgBlur = settingCheckbox("背景模糊", getBgBlur(), (on) => {
    localStorage.setItem(LS_BG_BLUR_KEY, on ? "1" : "0");
    applyBgBlur(on);
    syncEffectControls();
    showToast(on ? "已开启背景模糊" : "已关闭背景模糊");
  });
  darkModeRefs.bgBlur = bgBlur.input;
  darkModeRefs.blurLabel = el("div", { class: "hint", text: "背景模糊程度" });

  const blurScale = makeScaleRow({
    min: 10, max: 40, step: 1,
    value: getBgBlurPct(),
    format: (v) => Math.round(v) + "%",
    onChange: (v) => {
      localStorage.setItem(LS_BG_BLUR_PCT_KEY, String(Math.round(v)));
      if (getBgBlur() && !isDarkMode()) applyBgBlur(true);
      updateBgPreviewBlur();
    },
  });
  darkModeRefs.blurRange = blurScale.range;
  darkModeRefs.blurRow = blurScale.row;

  const blurWrap = el("div", { id: "bg-blur-wrap", style: { display: hasBgImage() ? "" : "none" } },
    bgBlur.wrap, darkModeRefs.blurLabel, blurScale.row);
  group.appendChild(blurWrap);

  const effectsSection = el("div", { id: "effects-group", style: { display: hasBgImage() ? "" : "none" } });
  group.appendChild(effectsSection);
  buildEffectsControls(effectsSection);

  return group;
}
function buildEffectsControls(container) {
  container.appendChild(el("div", { class: "settings-group-title", text: "卡片样式" }));

  const frosted = settingCheckbox("毛玻璃", getFrosted(), (on) => {
    localStorage.setItem(LS_FROSTED_KEY, on ? "1" : "0");
    if (on) {
      localStorage.setItem(LS_TRANSLUCENT_KEY, "0");
      translucent.input.checked = false;
    }
    applyFrosted(on);
    applyMinFrosted(getMinFrosted());
    applyTranslucent(getTranslucent());
    syncEffectControls();
    showToast(on ? "已开启毛玻璃" : "已关闭毛玻璃");
  });
  container.appendChild(frosted.wrap);
  darkModeRefs.frosted = frosted.input;

  const minFrosted = settingCheckbox("极简毛玻璃", getMinFrosted(), (on) => {
    localStorage.setItem(LS_MIN_FROSTED_KEY, on ? "1" : "0");
    applyMinFrosted(on);
    syncEffectControls();
    showToast(on ? "已开启极简毛玻璃" : "已关闭极简毛玻璃");
  });
  minFrosted.wrap.appendChild(el("div", { class: "hint", text: "开启后流畅度大幅度提升但观感可能略有不同" }));
  container.appendChild(minFrosted.wrap);
  darkModeRefs.minFrosted = minFrosted.input;
  darkModeRefs.minFrostedWrap = minFrosted.wrap;

  const translucent = settingCheckbox("半透明", getTranslucent(), (on) => {
    localStorage.setItem(LS_TRANSLUCENT_KEY, on ? "1" : "0");
    if (on) {
      localStorage.setItem(LS_FROSTED_KEY, "0");
      frosted.input.checked = false;
    }
    applyTranslucent(on);
    applyFrosted(getFrosted());
    applyMinFrosted(getMinFrosted());
    syncEffectControls();
    showToast(on ? "已开启半透明卡片" : "已关闭半透明卡片");
  });
  container.appendChild(translucent.wrap);
  darkModeRefs.translucent = translucent.input;

  darkModeRefs.opacityLabel = el("div", { class: "hint", text: "卡片不透明度" });
  container.appendChild(darkModeRefs.opacityLabel);

  const opacityScale = makeScaleRow({
    min: 20, max: 90, step: 5,
    value: getCardOpacity(),
    format: (v) => Math.round(v) + "%",
    onChange: (v) => {
      localStorage.setItem(LS_CARD_OPACITY_KEY, String(Math.round(v)));
      applyCardOpacity(v);
    },
  });
  container.appendChild(opacityScale.row);
  darkModeRefs.opacityRange = opacityScale.range;
  darkModeRefs.opacityRow = opacityScale.row;

  const contrast = settingCheckbox("高对比度", getContrast(), (on) => {
    localStorage.setItem(LS_CONTRAST_KEY, on ? "1" : "0");
    applyContrast(on);
    syncEffectControls();
    showToast(on ? "已开启高对比度" : "已关闭高对比度");
  });
  contrast.wrap.appendChild(el("div", { class: "hint", text: "在毛玻璃 / 半透明等卡片样式下提升文字可读性" }));
  container.appendChild(contrast.wrap);
  darkModeRefs.contrast = contrast.input;

  syncEffectControls();
}

function renderSortBlock(label, cards, getOrder, saveOrder, fixedLabels, fixedAtTop) {
  const block = el("div", { class: "sort-block" },
    el("div", { class: "sort-block-title", text: label }));

  const makeFixedList = () => {
    const list = el("div", { class: "sort-fixed-list" });
    fixedLabels.forEach((f) => list.appendChild(el("div", { class: "sort-row is-fixed" }, el("span", { class: "sort-label", text: f }))));
    return list;
  };

  let fixedTop = null;
  let fixedBottom = null;
  if (fixedLabels.length) {
    if (fixedAtTop) {
      fixedTop = makeFixedList();
      block.appendChild(fixedTop);
    } else {
      fixedBottom = makeFixedList();
    }
  }

  const list = el("div", { class: "sort-list" });

  function renderList() {
    list.innerHTML = "";
    getOrder().forEach((id) => {
      const card = cards.find((c) => c.id === id);
      if (!card) return;
      const upBtn = el("button", { type: "button", class: "sort-arrow", dataset: { dir: "up" }, text: "↑" });
      const downBtn = el("button", { type: "button", class: "sort-arrow", dataset: { dir: "down" }, text: "↓" });
      list.appendChild(el("div", { class: "sort-row", dataset: { sortId: id } },
        el("span", { class: "sort-handle", text: "≡" }),
        el("span", { class: "sort-label", text: card.label }),
        el("span", { class: "sort-arrows" }, upBtn, downBtn)));
    });
  }
  renderList();
  block.appendChild(list);

  if (fixedBottom) block.appendChild(fixedBottom);

  list.addEventListener("click", (e) => {
    const btn = e.target.closest(".sort-arrow");
    if (!btn) return;
    const row = btn.closest("[data-sort-id]");
    if (!row) return;
    if (btn.dataset.dir === "up" && row.previousElementSibling) {
      list.insertBefore(row, row.previousElementSibling);
    } else if (btn.dataset.dir === "down" && row.nextElementSibling) {
      list.insertBefore(row.nextElementSibling, row);
    } else {
      return;
    }
    saveOrder(readSortOrder(list));
    showToast("已保存");
  });

  enableDragSort(list, () => {
    saveOrder(readSortOrder(list));
    showToast("已保存");
  });

  return { block, renderList };
}

function buildSortSettingsGroup() {
  const group = el("div", { class: "settings-group" },
    el("div", { class: "settings-group-title", text: "查看 / 编辑页字段排序" }),
    el("div", { class: "hint", text: "长按卡片拖动排序，也可用 ↑ ↓ 调整。" }));

  const cpusetBlock = renderSortBlock(
    "cpuset（游戏）",
    CPUSET_FIELD_CARDS, getCpusetOrder, saveCpusetOrder,
    ["规则名称 friendly", "匹配分类 categories", "匹配包名 packages", "配置模式"],
    true
  );
  group.appendChild(cpusetBlock.block);

  const appBlock = renderSortBlock(
    "app_cpuset（普通应用）",
    APP_CPUSET_FIELD_CARDS, getAppOrder, saveAppOrder,
    ["配置模式", "匹配包名 packages", "规则名称 friendly"],
    true
  );
  group.appendChild(appBlock.block);

  group.appendChild(el("button", {
    type: "button", class: "btn-secondary", text: "恢复默认顺序",
    onClick: () => {
      localStorage.removeItem(LS_CPUSET_ORDER_KEY);
      localStorage.removeItem(LS_APP_ORDER_KEY);
      cpusetBlock.renderList();
      appBlock.renderList();
      showToast("已恢复默认顺序");
    },
  }));

  return group;
}

function buildSettingsForm() {
  const form = $("#settings-form");
  form.innerHTML = "";

  const currentScale = getUiScale();
  const scaleValue = el("span", { class: "scale-value", text: Math.round(currentScale * 100) + "%" });
  const scaleRange = el("input", {
    type: "range", min: "0.8", max: "1.5", step: "0.05", value: String(currentScale),
    on: {
      input: () => { const v = parseFloat(scaleRange.value); scaleValue.textContent = Math.round(v * 100) + "%"; applyUiScale(v); },
      change: () => localStorage.setItem(LS_SCALE_KEY, scaleRange.value),
    },
  });
  const scaleGroup = el("div", { class: "settings-group" },
    el("div", { class: "settings-group-title", text: "界面缩放" }),
    el("div", { class: "scale-row" }, scaleRange, scaleValue),
    el("div", { class: "hint", text: "调整整个界面的显示比例，适配不同屏幕或字体阅读习惯" }));
  form.appendChild(scaleGroup);

  const themeSeg = el("div", { class: "seg" });
  const currentTheme = getTheme();
  [["system", "跟随系统"], ["light", "浅色"], ["dark", "深色"]].forEach(([val, label]) => {
    const b = el("button", {
      type: "button",
      class: "seg-btn" + (val === currentTheme ? " active" : ""),
      text: label,
      onClick: () => {
        localStorage.setItem(LS_THEME_KEY, val);
        applyTheme(val);
        applyDarkModeDisable();
        themeSeg.querySelectorAll(".seg-btn").forEach((x) => x.classList.toggle("active", x === b));
      },
    });
    themeSeg.appendChild(b);
  });
  const themeGroup = el("div", { class: "settings-group" },
    el("div", { class: "settings-group-title", text: "深色 / 浅色模式" }),
    themeSeg,
    el("div", { class: "hint", text: "选择「跟随系统」会根据设备当前的深色/浅色模式自动切换；深色模式下卡片效果与自定义背景自动禁用" }));
  form.appendChild(themeGroup);
  form.appendChild(buildBackgroundGroup());
  form.appendChild(buildSortSettingsGroup());
  applyDarkModeDisable();
}

function ensureSettingsFormBuilt() {
  if (settingsBuilt) return;
  settingsBuilt = true;
  buildSettingsForm();
}

function toTagArray(v) {
  if (Array.isArray(v)) return v.filter((x) => x !== null && x !== undefined && x !== "").map(String);
  if (typeof v === "string") return v.trim() ? [v.trim()] : [];
  if (v === null || v === undefined) return [];
  return [String(v)];
}

function migrateOldConfigRule(rule) {
  if (!rule.cpuset) return rule;
  
  const cs = rule.cpuset;
  
  delete cs.rr;
  
  if (cs.heavy_thread && !cs.heaviest_thread) {
    cs.heaviest_thread = cs.heavy_thread;
    delete cs.heavy_thread;
  }
  
  if (cs.heavy_cores && !cs.heaviest_cores) {
    cs.heaviest_cores = cs.heavy_cores;
    delete cs.heavy_cores;
  }
  
  if (cs.ni && Array.isArray(cs.ni)) {
    const heaviestThreads = splitSemiToTags(cs.heaviest_thread);
    cs.ni = cs.ni.filter(name => {
      const lowerName = name.toLowerCase();
      if (lowerName === "heavythread") return false;
      return !heaviestThreads.some(ht => ht.toLowerCase() === lowerName);
    });
    if (cs.ni.length === 0) delete cs.ni;
  }
  
  return rule;
}

function normalizeRules(arr) {
  if (!Array.isArray(arr)) return [];
  const filtered = arr.filter((x) => x && typeof x === "object" && !Array.isArray(x));
  
  const isOldVersion = filtered.some(rule => rule.cpuset && rule.cpuset.hasOwnProperty("rr"));
  
  if (isOldVersion) {
    return filtered.map(migrateOldConfigRule);
  }
  
  return filtered;
}
function splitSemiToTags(v) {
  if (Array.isArray(v)) return toTagArray(v);
  if (typeof v !== "string") return [];
  return v.split(/[;；]/).map((s) => s.trim()).filter(Boolean);
}

function createTagEditor(initialTags = [], placeholder = "输入后按回车添加") {
  const chips = el("div", { class: "tag-chips" });
  const input = el("input", { type: "text", enterkeyhint: "enter", placeholder, class: "tag-input" });
  const wrap = el("div", { class: "tag-editor" }, chips, input);

  let tags = toTagArray(initialTags);

  function renderChips() {
    chips.innerHTML = "";
    tags.forEach((t, i) => {
      const del = el("button", {
        type: "button", class: "chip-del", text: "×",
        onClick: () => { tags.splice(i, 1); renderChips(); markDirty(); },
      });
      chips.appendChild(el("span", { class: "chip" }, t, del));
    });
  }

  function addFromInput() {
    const v = input.value.trim();
    if (v) {
      v.split(/[,，;；]/).map((s) => s.trim()).filter(Boolean).forEach((s) => {
        if (!tags.includes(s)) tags.push(s);
      });
      markDirty();
    }
    input.value = "";
    renderChips();
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === "," || e.key === "，") {
      e.preventDefault();
      addFromInput();
    }
  });
  input.addEventListener("blur", () => { if (input.value.trim()) addFromInput(); });

  renderChips();
  return { el: wrap, getTags: () => { addFromInput(); return [...tags]; } };
}

function subscribeCoreCount(fn) {
  coreCountSubscribers.push(fn);
  return () => {
    const i = coreCountSubscribers.indexOf(fn);
    if (i >= 0) coreCountSubscribers.splice(i, 1);
  };
}
function notifyCoreCount(n) {
  totalCoreCount = n;
  coreCountLoaded = true;
  coreCountSubscribers.slice().forEach((fn) => { try { fn(n); } catch (e) {} });
}
function getTotalCores() { return coreCountLoaded ? totalCoreCount : 8; }

function parseCoreRangeString(v) {
  const set = new Set();
  if (v == null) return set;
  String(v).split(/[\s,，;；]+/).forEach((part) => {
    const m = part.match(/^(\d+)\s*(?:-\s*(\d+))?$/);
    if (!m) return;
    const a = parseInt(m[1], 10);
    const b = m[2] ? parseInt(m[2], 10) : a;
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) set.add(i);
  });
  return set;
}
function formatCoreSetToRanges(set) {
  const arr = [...set].filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!arr.length) return "";
  const parts = [];
  let start = arr[0], prev = arr[0];
  for (let i = 1; i <= arr.length; i++) {
    const cur = arr[i];
    if (cur !== prev + 1) {
      parts.push(start === prev ? String(start) : start + "-" + prev);
      start = cur;
    }
    prev = cur;
  }
  return parts.join(",");
}
async function loadCpuTopology() {
  if (typeof window.ksu === "undefined" || typeof window.ksu.exec !== "function") return;
  try {
    const res = await ksuExec("cat /sys/devices/system/cpu/possible /sys/devices/system/cpu/present 2>/dev/null");
    const lines = String(res.stdout || "").split("\n");
    for (const line of lines) {
      let max = -1;
      line.trim().split(/[\s,]+/).forEach((part) => {
        const m = part.match(/^(\d+)(?:-(\d+))?$/);
        if (!m) return;
        const e = m[2] ? parseInt(m[2], 10) : parseInt(m[1], 10);
        if (e > max) max = e;
      });
      if (max >= 0) { notifyCoreCount(max + 1); return; }
    }
  } catch (err) {}
}

function resetCorePickers() {
  corePickerInstances.splice(0).forEach((inst) => {
    try { if (inst.destroy) inst.destroy(); else inst.close(); } catch (e) {}
  });
}

function createCorePicker(initialValue, opts = {}) {
  const selected = parseCoreRangeString(initialValue);
  const emptyText = opts.emptyText || "点击选择核心";

  const valueSpan = el("span", { class: "core-picker-value" });
  const summary = el("button", { type: "button", class: "core-picker-summary" }, valueSpan);
  const box = el("div", { class: "core-picker-box" }, summary);

  const countEl = el("span", { class: "core-picker-count" });
  const mkAction = (text) => el("button", { type: "button", class: "core-picker-action", text });
  const allBtn = mkAction("全选");
  const clearBtn = mkAction("清空");
  const foldBtn = mkAction("收起");
  const actions = el("div", { class: "core-picker-actions" }, allBtn, clearBtn, foldBtn);
  const toolbar = el("div", { class: "core-picker-toolbar" }, countEl, actions);
  const grid = el("div", { class: "core-grid" });
  const panel = el("div", { class: "core-picker-panel" }, toolbar, grid,
    el("div", { class: "hint core-picker-hint", text: "点击单个核心即可切换选中状态" }));
  box.appendChild(panel);

  const inputEl = el("input", { type: "hidden" });
  const wrap = el("div", { class: "field core-picker-field" },
    opts.label ? el("label", { text: opts.label }) : null,
    inputEl, box,
    opts.hint ? el("div", { class: "hint core-picker-hint", text: opts.hint }) : null);

  function scrollExpandedIntoView() {
    if (!opened || !wrap.isConnected) return;
    if (hasFixedAncestor(wrap)) return;
    const vh = getVisibleHeight();
    const rect = wrap.getBoundingClientRect();
    if (rect.top >= 0 && rect.bottom <= vh) return;
    let delta = 0;
    if (rect.top < 0) {
      delta = rect.top - 12;
    } else if (rect.bottom > vh) {
      delta = rect.bottom - vh + 12;
    }
    if (delta && Math.abs(delta) > 8) {
      const scroller = getActiveScreen();
      if (scroller) {
        const maxScroll = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
        const target = Math.min(delta, Math.max(maxScroll, 0));
        if (target > 2) {
          try {
            scroller.scrollBy({ top: target, behavior: "smooth" });
          } catch (e) {
            scroller.scrollTop += target;
          }
        }
      }
    }
  }

  function renderValue() {
    const v = formatCoreSetToRanges(selected);
    inputEl.value = v;
    valueSpan.textContent = v || emptyText;
    valueSpan.classList.toggle("empty", !v);
  }
  function renderGrid() {
    grid.innerHTML = "";
    const n = getTotalCores();

    grid.style.gridTemplateColumns = n > 0 && n <= 12
      ? `repeat(${n}, minmax(0, 1fr))`
      : "";
    for (let i = 0; i < n; i++) {
      grid.appendChild(el("button", {
        type: "button",
        class: "core-chip" + (selected.has(i) ? " on" : ""),
        dataset: { core: String(i) },
        text: String(i),
      }));
    }
    countEl.textContent = "共 " + n + " 个核心 · 已选 " + selected.size;
    renderValue();
  }

  let opened = false;
  let expandTimer = null;
  let unsubCoreCount = null;

  const instance = {
    close() { setOpened(false); },
    isOpen() { return opened; },
    destroy() { if (unsubCoreCount) { unsubCoreCount(); unsubCoreCount = null; } },
  };
  corePickerInstances.push(instance);

  function setOpened(v) {
    const nowOpen = !!v;
    if (nowOpen) {

      corePickerInstances.forEach((inst) => {
        if (inst !== instance && inst.isOpen()) inst.close();
      });
    }
    opened = nowOpen;
    box.classList.toggle("open", opened);
    clearTimeout(expandTimer);
    if (opened) {
      renderGrid();
      expandTimer = setTimeout(() => scrollExpandedIntoView(), 530);
    }
  }
  summary.addEventListener("click", () => setOpened(true));
  foldBtn.addEventListener("click", () => setOpened(false));

  panel.addEventListener("transitionend", (e) => {
    if (e.propertyName === "max-height" && opened && wrap.isConnected) {
      scrollExpandedIntoView();
    }
  });

  allBtn.addEventListener("click", () => {
    for (let i = 0; i < getTotalCores(); i++) selected.add(i);
    renderGrid();
    markDirty();
  });
  clearBtn.addEventListener("click", () => {
    selected.clear();
    renderGrid();
    markDirty();
  });

  grid.addEventListener("click", (e) => {
    const chip = e.target.closest(".core-chip");
    if (!chip) return;
    const idx = Number(chip.dataset.core);
    if (!Number.isFinite(idx)) return;
    if (selected.has(idx)) selected.delete(idx);
    else selected.add(idx);
    renderGrid();
    markDirty();
  });

  unsubCoreCount = subscribeCoreCount(() => { if (wrap.isConnected) renderGrid(); });

  renderGrid();
  return { wrap, input: inputEl };
}

function fieldText(id, label, value, placeholder, hintText) {
  const input = el("input", {
    type: "text", value: value || "", placeholder: placeholder || "", id: "f_" + id,
    on: { input: markDirty },
  });
  const wrap = el("div", { class: "field" },
    el("label", { text: label }), input,
    hintText ? el("div", { class: "hint", text: hintText }) : null);
  return { wrap, input };
}
function fieldWrap(label, child, hintText) {
  return el("div", { class: "field" },
    el("label", { text: label }), child,
    hintText ? el("div", { class: "hint", text: hintText }) : null);
}
function checkboxField(label, checked, hintText) {
  const input = el("input", { type: "checkbox", checked, on: { change: markDirty } });
  const wrap = el("div", { class: "field field-checkbox" },
    el("label", null, input, " " + label),
    hintText ? el("div", { class: "hint", text: hintText }) : null);
  return { wrap, input };
}
function trackField(wrap, configured) {
  editorFields.push({ wrap, configured: !!configured });
}
function wrapCard(content, title) {
  return el("div", { class: "form-card" },
    title ? el("div", { class: "form-card-title", text: title }) : null,
    content);
}

function matchSummary(item) {
  const cats = toTagArray(item.categories);
  const pkgs = toTagArray(item.packages);
  if (cats.length) return "分类: " + cats.join(", ");
  if (pkgs.length) return "包名: " + pkgs.join(", ");
  return "未设置匹配规则";
}
function buildCard(item, idx) {
  const mkBtn = (act, cls, text) => el("button", {
    class: "icon-btn" + (cls ? " " + cls : ""), dataset: { act, idx: String(idx) }, text,
  });
  return el("div", { class: "card" },
    el("div", { class: "card-main" },
      el("div", { class: "card-title", text: item.friendly || "(未命名)" }),
      el("div", { class: "card-sub", text: matchSummary(item) })),
    el("div", { class: "card-actions" },
      mkBtn("view", "", "查看"), mkBtn("edit", "", "编辑"), mkBtn("del", "danger", "删除")));
}
function buildListSection(titleHtml, modeClass, items) {
  const section = el("div", { class: "list-section" },
    el("div", { class: "list-section-title" + (modeClass ? " " + modeClass : ""), html: `${titleHtml}<span class="count">${items.length}</span>` }));
  items.forEach(({ item, idx }, i) => {
    const card = buildCard(item, idx);
    card.style.animationDelay = Math.min(i * 35, 300) + "ms";
    section.appendChild(card);
  });
  return section;
}
function renderList() {
  const container = $("#list");
  container.innerHTML = "";
  if (!data.length) {
    container.innerHTML = '<div class="empty">暂无配置项，点击右下角「＋」添加一条规则</div>';
    return;
  }
  const cpusetItems = [];
  const appCpusetItems = [];
  const unsetItems = [];
  data.forEach((item, idx) => {
    if (item.cpuset) cpusetItems.push({ item, idx });
    else if (item.app_cpuset) appCpusetItems.push({ item, idx });
    else unsetItems.push({ item, idx });
  });
  if (cpusetItems.length) {
    container.appendChild(buildListSection("🧩 用户线程 · cpuset（细致）", "mode-cpuset", cpusetItems));
  }
  if (appCpusetItems.length) {
    container.appendChild(buildListSection("📱 用户线程 · app_cpuset（轻量）", "mode-app", appCpusetItems));
  }
  if (unsetItems.length) {
    container.appendChild(buildListSection("⚠️ 未配置", "mode-unset", unsetItems));
  }
}

function openEditor(idx, mode) {
  editingIndex = idx;
  const item = idx === null ? {} : JSON.parse(JSON.stringify(data[idx]));

  navigateTo("editor");
  requestAnimationFrame(() => {
    buildEditorForm(item);
    setEditorMode(mode || "edit");
  });
}
function setEditorMode(mode) {
  const isView = mode === "view";
  $("#editor-title").textContent = isView ? "查看规则" : "编辑规则";
  $("#btn-editor-save").style.display = isView ? "none" : "";

  const form = $("#editor-form");
  form.dataset.view = isView ? "1" : "0";
  form.querySelectorAll("input, textarea, select, button").forEach((el) => {
    el.disabled = isView;
  });
  form.querySelectorAll(".tag-input, .chip-del, .comm-del-btn, .add-comm-btn").forEach((el) => {
    el.style.display = isView ? "none" : "";
  });
  editorFields.forEach((f) => {
    f.wrap.style.display = isView && !f.configured ? "none" : "";
  });
}

function buildEditorForm(item) {
  resetCorePickers();
  editorRefs = {};
  editorFields = [];
  const form = $("#editor-form");
  form.innerHTML = "";

  const baseCard = wrapCard(null, "基本规则");
  const friendly = fieldText("friendly", "规则名称 friendly", item.friendly || "", "规则名称", "仅用于在列表中辨识这条规则，不影响匹配逻辑");
  baseCard.appendChild(friendly.wrap);
  editorRefs.friendly = friendly.input;
  trackField(friendly.wrap, true);

  const catTag = createTagEditor(item.categories || [], "匹配分类");
  const pkgTag = createTagEditor(item.packages || [], "应用包名");
  const catWrap = fieldWrap("匹配分类 categories", catTag.el, "适用于游戏库内置分类匹配（针对游戏），categories 与 packages 命中其一即可");
  const pkgWrap = fieldWrap("匹配包名 packages", pkgTag.el, "适用于按应用包名匹配");
  baseCard.appendChild(catWrap);
  baseCard.appendChild(pkgWrap);
  editorRefs.categories = catTag;
  editorRefs.packages = pkgTag;
  trackField(catWrap, (item.categories || []).length > 0);
  trackField(pkgWrap, (item.packages || []).length > 0);

  const isApp = !!item.app_cpuset && !item.cpuset;
  const modeWrap = el("div", { class: "field", html: `
    <label>配置模式</label>
    <div class="seg">
      <button type="button" class="seg-btn" data-mode="cpuset">游戏 cpuset</button>
      <button type="button" class="seg-btn" data-mode="app_cpuset">普通应用 app_cpuset</button>
    </div>
    <div class="hint">游戏用 cpuset，设置项更细致；普通应用用 app_cpuset，设置项更少、性能开销更低</div>` });
  baseCard.appendChild(modeWrap);
  trackField(modeWrap, true);

  form.appendChild(baseCard);

  const cpusetSection = el("div", { id: "cpuset-section" });
  const appSection = el("div", { id: "app-section" });
  buildCpusetSection(cpusetSection, item.cpuset || {});
  buildAppSection(appSection, item.app_cpuset || {});
  form.appendChild(cpusetSection);
  form.appendChild(appSection);

  function setMode(mode) {
    modeWrap.querySelectorAll(".seg-btn").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
    cpusetSection.style.display = mode === "cpuset" ? "" : "none";
    appSection.style.display = mode === "app_cpuset" ? "" : "none";
    editorRefs.mode = mode;
  }
  modeWrap.querySelectorAll(".seg-btn").forEach((b) => {
    b.addEventListener("click", () => { setMode(b.dataset.mode); markDirty(); });
  });
  setMode(isApp ? "app_cpuset" : "cpuset");
}

function buildCpusetSection(container, cs) {
  container.innerHTML = "";
  getCpusetOrder().forEach((id) => buildCpusetCard(container, id, cs));
}
function addPickerCard(container, cs, key, label, hint) {
  const picker = createCorePicker(cs[key], { label, emptyText: "点击选择核心", hint });
  const card = wrapCard(picker.wrap);
  container.appendChild(card);
  editorRefs[key] = picker.input;
  trackField(card, !!cs[key]);
}
function addTagCard(container, cs, key, label, placeholder, hint) {
  const tag = createTagEditor(cs[key] || [], placeholder);
  const card = wrapCard(fieldWrap(label, tag.el, hint));
  container.appendChild(card);
  editorRefs[key] = tag;
  trackField(card, (cs[key] || []).length > 0);
}
function buildCpusetCard(container, id, cs) {
  switch (id) {
    case "heaviest_thread": {
      const card = wrapCard(buildHeaviestThreadCard(cs));
      container.appendChild(card);
      trackField(card, splitSemiToTags(cs.heaviest_thread).length > 0 || !!cs.heaviest_cores);
      break;
    }
    case "heavy_thread": {
      const card = wrapCard(buildHeavyThreadCard(cs));
      container.appendChild(card);
      trackField(card, splitSemiToTags(cs.heavy_thread).length > 0 || !!cs.heavy_cores);
      break;
    }
    case "unity_main":
      return addPickerCard(container, cs, "unity_main", "unity_main（UnityMain 线程可用核心）[不再推荐]", "该字段仍然生效但不再推荐使用，建议使用 heaviest_thread 替代");
    case "main_thread":
      return addPickerCard(container, cs, "main_thread", "main_thread（主线程可用核心）", "指定运行主线程的 CPU 核心");
    case "other":
      return addPickerCard(container, cs, "other", "other（其它线程可用核心）", "未命中其它规则的线程可用的 CPU 核心");
    case "comm": {
      const card = wrapCard(buildCommCard(cs));
      container.appendChild(card);
      const hasComm = cs.comm ? Object.entries(cs.comm).some(([, names]) => (names || []).length > 0) : false;
      trackField(card, hasComm);
      break;
    }
    case "trashy":
      return addTagCard(container, cs, "trashy", "trashy（限制的垃圾线程）", "垃圾线程名", "通过 cpuctl（cpu.uclamp.max）对线程限制，需 Linux Kernel 5+");
    case "ni":
      return addTagCard(container, cs, "ni", "ni（提升优先级线程）", "设置线程的nice值为`-10`，提高争夺CPU资源的能力");
  }
}

function buildHeaviestThreadCard(cs) {
  const tagE = createTagEditor(splitSemiToTags(cs.heaviest_thread), "重负载线程名");
  const hcPicker = createCorePicker(cs.heaviest_cores, {
    label: "heaviest_cores（重负载线程可用核心）",
    emptyText: "点击选择核心",
    hint: "heaviest_thread：重负载线程名支持匹配多个，命中多个时只选择负载最高的那个；heaviest_cores：重负载线程可用的 CPU 核心",
  });
  editorRefs.heaviest_thread = tagE;
  editorRefs.heaviest_cores = hcPicker.input;
  return el("div", { class: "field" },
    el("label", { text: "heaviest_thread（负载最重线程名）" }), tagE.el, hcPicker.wrap);
}

function buildHeavyThreadCard(cs) {
  const tagE = createTagEditor(splitSemiToTags(cs.heavy_thread), "第二重负载线程名");
  const hcPicker = createCorePicker(cs.heavy_cores, {
    label: "heavy_cores（第二重负载线程可用核心）",
    emptyText: "点击选择核心",
    hint: "heavy_thread：第二重负载线程名支持匹配多个线程，命中多个时只选择负载最高的那个；heavy_cores：第二重负载线程可用的 CPU 核心",
  });
  editorRefs.heavy_thread = tagE;
  editorRefs.heavy_cores = hcPicker.input;
  return el("div", { class: "field" },
    el("label", { text: "heavy_thread（第二重负载线程名）" }), tagE.el, hcPicker.wrap);
}

function buildCommCard(cs) {
  const commRows = el("div", { id: "comm-rows" });
  const addBtn = el("button", {
    type: "button", class: "btn-secondary add-comm-btn", text: "＋ 添加核心分组",
    onClick: () => { addCommRow(commRows, "", []); markDirty(); },
  });
  const commWrap = el("div", { class: "field" },
    el("label", { text: "comm（核心 → 线程名列表映射）" }),
    el("div", { class: "hint", text: "每一组指定一个核心范围及分配给它的线程名前缀列表" }),
    commRows, addBtn);
  editorRefs.commRows = commRows;
  editorRefs.commRowRefs = [];
  const entries = cs.comm ? Object.entries(cs.comm) : [];
  if (entries.length === 0) {
    addCommRow(commRows, "", []);
  } else {
    entries.forEach(([core, names]) => addCommRow(commRows, core, names));
  }
  return commWrap;
}

function addCommRow(container, core, names) {
  const picker = createCorePicker(core || "", { label: "核心范围", emptyText: "点击选择核心" });
  const tagE = createTagEditor(names || [], "线程名前缀");
  const row = el("div", { class: "comm-row" }, picker.wrap, tagE.el,
    el("div", { class: "comm-row-del" },
      el("button", {
        type: "button", class: "icon-btn danger small comm-del-btn", text: "删除",
        onClick: () => {
          row.remove();
          editorRefs.commRowRefs = editorRefs.commRowRefs.filter((r) => r.row !== row);
          markDirty();
        },
      })));
  container.appendChild(row);
  editorRefs.commRowRefs.push({ row, coreInput: picker.input, tagE });
}

function buildAppSection(container, ac) {
  container.innerHTML = "";
  getAppOrder().forEach((id) => buildAppCpusetCard(container, id, ac));
}
function addAppPickerCard(container, ac, key, label, hint) {
  const picker = createCorePicker(ac[key], { label, emptyText: "点击选择核心", hint });
  const card = wrapCard(picker.wrap);
  container.appendChild(card);
  editorRefs["app_" + key] = picker.input;
  trackField(card, !!ac[key]);
}
function buildAppCpusetCard(container, id, ac) {
  switch (id) {
    case "app_main":
      return addAppPickerCard(container, ac, "main", "main（主线程可用核心）", "主线程使用的核心");
    case "app_render":
      return addAppPickerCard(container, ac, "render", "render（渲染线程可用核心）", "渲染线程使用的核心");
    case "app_other":
      return addAppPickerCard(container, ac, "other", "other（其它线程可用核心）", "其它线程使用的核心");
    case "webview": {
      const cb = checkboxField("检测 webview 沙盒进程中的渲染线程", ac.webview !== false, "是否检测 webview 沙盒进程");
      const card = wrapCard(cb.wrap);
      container.appendChild(card);
      editorRefs.webview = cb.input;
      trackField(card, true);
      break;
    }
    case "children": {
      const cb = checkboxField("检测子进程", ac.children !== false, "是否检测子进程");
      const card = wrapCard(cb.wrap);
      container.appendChild(card);
      editorRefs.children = cb.input;
      trackField(card, true);
      break;
    }
  }
}

function getNextUnnamedNumber() {
  const existingNumbers = data
    .map(rule => {
      const match = (rule.friendly || "").match(/^未命名(\d+)$/);
      return match ? parseInt(match[1], 10) : 0;
    })
    .filter(n => n > 0);
  
  if (existingNumbers.length === 0) return 1;
  return Math.max(...existingNumbers) + 1;
}

async function collectFormData() {
  let friendlyVal = editorRefs.friendly.value.trim();
  if (!friendlyVal) {
    friendlyVal = `未命名${getNextUnnamedNumber()}`;
  }
  const obj = { friendly: friendlyVal };

  const categories = editorRefs.categories.getTags();
  const packages = editorRefs.packages.getTags();
  if (categories.length) obj.categories = categories;
  if (packages.length) obj.packages = packages;
  if (!categories.length && !packages.length) {
    if (!(await uiConfirm("未设置 categories 或 packages，此规则将无法匹配任何应用，确定继续吗？"))) return null;
  }

  if (editorRefs.mode === "cpuset") {
    const cs = {};
    const hvtTags = editorRefs.heaviest_thread.getTags();
    const hvc = editorRefs.heaviest_cores.value.trim();
    const htTags = editorRefs.heavy_thread.getTags();
    const hc = editorRefs.heavy_cores.value.trim();
    const um = editorRefs.unity_main.value.trim();
    const mt = editorRefs.main_thread.value.trim();
    const ot = editorRefs.other.value.trim();
    if (hvtTags.length) cs.heaviest_thread = hvtTags.join(";");
    if (hvc) cs.heaviest_cores = hvc;
    if (htTags.length) cs.heavy_thread = htTags.join(";");
    if (hc) cs.heavy_cores = hc;
    if (um) cs.unity_main = um;
    if (mt) cs.main_thread = mt;
    if (ot) cs.other = ot;

    const trashy = editorRefs.trashy.getTags();
    const ni = editorRefs.ni.getTags();
    if (trashy.length) cs.trashy = trashy;
    
    if (ni.length) {
      const allHeavyThreads = [...hvtTags, ...htTags];
      const duplicates = ni.filter(name => 
        allHeavyThreads.some(ht => ht.toLowerCase() === name.toLowerCase())
      );
      
      if (duplicates.length > 0) {
        const duplicateList = duplicates.join('、');
        if (!(await uiConfirm(`检测到重复声明的线程「${duplicateList}」。\nni策略默认包含 heaviest_thread 和 heavy_thread 命中的线程，无需重复声明。\n确定要继续保存吗？`))) {
          return null;
        }
      }
      cs.ni = ni;
    }

    const comm = {};
    editorRefs.commRowRefs.forEach(({ coreInput, tagE }) => {
      const core = coreInput.value.trim();
      const names = tagE.getTags();
      if (core && names.length) comm[core] = names;
    });
    if (Object.keys(comm).length) cs.comm = comm;

    if (Object.keys(cs).length === 0) {
      await uiAlert("cpuset 配置不能为空，请至少填写一项");
      return null;
    }
    obj.cpuset = cs;
  } else {
    const ac = {};
    const main = editorRefs.app_main.value.trim();
    const render = editorRefs.app_render.value.trim();
    const other = editorRefs.app_other.value.trim();
    if (main) ac.main = main;
    if (render) ac.render = render;
    if (other) ac.other = other;
    ac.webview = editorRefs.webview.checked;
    ac.children = editorRefs.children.checked;
    if (!main && !render && !other) {
      await uiAlert("app_cpuset 配置不能为空，请至少填写一项");
      return null;
    }
    obj.app_cpuset = ac;
  }
  return obj;
}

async function readFileContent(fullPath) {
  const res = await ksuExec(`cat ${shQuote(fullPath)} 2>/dev/null`);
  return res.errno === 0 ? (res.stdout || "").trim() : "";
}

function showDefaultHint(text) {
  const box = $("#default-hint");
  if (!box) return;
  if (!text) { box.style.display = "none"; return; }
  $("#default-hint-text").textContent = text;
  box.style.display = "";
}

// 载入模块自带的默认用户线程（由彗星应用线程 + 魅族线程转换而来）
async function loadDefaultThreads(silent) {
  const def = await readFileContent(DEFAULT_THREADS);
  if (!def) {
    if (!silent) await uiAlert("模块内未找到 default_threads.json");
    return false;
  }
  try {
    const parsed = JSON.parse(def);
    data = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? [parsed]
      : normalizeRules(parsed);
    dirty = true;
    renderList();
    setStatus(`已载入模块默认 ${data.length} 条（未保存）`);
    showDefaultHint(`已载入模块自带的默认用户线程 ${data.length} 条（魅族线程）。点「保存」写入 Scene 才会生效。`);
    return true;
  } catch (e) {
    if (!silent) await uiAlert("默认配置解析失败：" + e);
    return false;
  }
}

async function loadFromFile() {
  setStatus("正在读取…");
  const text = await readFileContent(FILE_PATH);
  let loadedDefault = false;

  if (!text) {
    // Scene 尚未配置 → 自动载入模块默认（只进编辑器，不写盘，等用户点保存）
    loadedDefault = await loadDefaultThreads(true);
    if (!loadedDefault) {
      data = [];
      setStatus("未找到现有配置文件，保存时将自动创建");
      showDefaultHint("");
    }
  } else {
    try {
      const parsed = JSON.parse(text);
      data = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? [parsed]
        : normalizeRules(parsed);
      setStatus(`已加载 ${data.length} 条规则`);
      showDefaultHint("");
    } catch (e) {
      data = [];
      await uiAlert("threads.json 内容不是合法 JSON，已在编辑器中重置为空列表\n（原文件不会被覆盖，除非你点击「保存到文件」）");
      setStatus("原文件解析失败");
    }
  }
  dirty = loadedDefault;
  renderList();
}

async function writeJsonFileAtomic(fullPath, json, opts = {}) {
  const script = [
    `F=${shQuote(fullPath)}`,
    ...(opts.preserveOwner ? [
      `OWNER=$(stat -c '%u' "$F" 2>/dev/null)`,
      `GROUP=$(stat -c '%g' "$F" 2>/dev/null)`,
      `CTX=$(ls -Z "$F" 2>/dev/null)`,
      `CTX=\${CTX%% *}`,
    ] : []),
    `mkdir -p "$(dirname "$F")" 2>/dev/null`,
    `[ -f "$F" ] && cp "$F" "$F.bak" 2>/dev/null`,
    `printf '%s' ${shQuote(json)} > "$F.tmp"`,
    `mv -f "$F.tmp" "$F" || { rm -f "$F.tmp"; echo '__FAIL__ 写入失败' >&2; exit 0; }`,
    ...(opts.preserveOwner ? [
      `if [ -n "$OWNER" ] && [ -n "$GROUP" ]; then chown "$OWNER:$GROUP" "$F"; fi`,
      `case "$CTX" in *:*) chcon "$CTX" "$F" 2>/dev/null ;; esac`,
    ] : []),
    `echo __DONE__`,
  ].join("\n");
  const res = await ksuExec(script);
  return { ok: res.errno === 0 && (res.stdout || "").includes("__DONE__"), stderr: res.stderr || res.stdout || "" };
}

async function persistToFile() {
  setStatus("正在保存…");
  const { ok, stderr } = await writeJsonFileAtomic(FILE_PATH, JSON.stringify(data, null, 2), { preserveOwner: true });
  if (ok) {
    dirty = false;
    setStatus("已保存 · " + new Date().toLocaleTimeString());
    showToast("保存成功");
  } else {
    setStatus("保存失败");
    await uiAlert("保存失败：\n" + (stderr || "未知错误"));
  }
}

function shQuote(s) { return "'" + String(s).replace(/'/g, `'\\''`) + "'"; }
function matchesFilter(name, filter) {
  if (!filter) return true;
  const exts = Array.isArray(filter) ? filter : [filter];
  const lower = String(name).toLowerCase();
  return exts.some((ext) => lower.endsWith(String(ext).toLowerCase()));
}
function joinPath(dir, name) { return (dir === "/" ? "" : dir) + "/" + name; }
function clampToRoot(path) {
  const p = (path || FP_ROOT).replace(/\/+$/, "") || "/";
  if (p === FP_ROOT || p.startsWith(FP_ROOT + "/")) return p;
  return FP_ROOT;
}
function parentPath(path) {
  const p = path.replace(/\/+$/, "");
  const idx = p.lastIndexOf("/");
  if (idx <= 0) return "/";
  return p.slice(0, idx);
}

async function fpListDir(path) {
  const cmd = [
    `D=${shQuote(path)}`,
    `if [ ! -d "$D" ]; then echo __ERR__NODIR; exit 0; fi`,
    `cd "$D" 2>/dev/null || { echo __ERR__CD; exit 0; }`,
    `for f in * .*; do`,
    `  [ "$f" = "." ] && continue`,
    `  [ "$f" = ".." ] && continue`,
    `  [ -e "$f" ] || continue`,
    `  if [ -d "$f" ]; then echo "D|$f"; else echo "F|$f"; fi`,
    `done`,
  ].join("\n");
  const res = await ksuExec(cmd);
  const rawLines = (res.stdout || "").split("\n").map((l) => l.replace(/\r$/, "")).filter(Boolean);
  if (rawLines.includes("__ERR__NODIR") || rawLines.includes("__ERR__CD") || res.errno !== 0) {
    return { error: res.stderr || "目录不存在或无法访问" };
  }
  const dirs = [];
  const files = [];
  rawLines.forEach((l) => {
    const i = l.indexOf("|");
    if (i < 0) return;
    const name = l.slice(i + 1);
    if (!name) return;
    (l[0] === "D" ? dirs : files).push(name);
  });
  dirs.sort((a, b) => a.localeCompare(b));
  files.sort((a, b) => a.localeCompare(b));
  return { dirs, files };
}

function renderFpShortcuts() {
  const wrap = $("#fp-shortcuts");
  wrap.innerHTML = "";
  FP_SHORTCUTS.forEach((sc) => {
    wrap.appendChild(el("button", { type: "button", class: "fp-shortcut-btn", text: sc.label, onClick: () => fpNavigate(sc.path) }));
  });
}
function renderFpPath(path) {
  const wrap = $("#fp-path");
  wrap.innerHTML = "";
  wrap.appendChild(el("span", { class: "fp-path-seg", text: "内部存储", onClick: () => fpNavigate(FP_ROOT) }));
  const rest = path === FP_ROOT ? "" : path.slice(FP_ROOT.length);
  let acc = FP_ROOT;
  rest.split("/").filter(Boolean).forEach((p) => {
    acc += "/" + p;
    const target = acc;
    wrap.appendChild(el("span", { class: "fp-path-sep", text: "›" }));
    wrap.appendChild(el("span", { class: "fp-path-seg", text: p, onClick: () => fpNavigate(target) }));
  });
}
function renderFpList(path, dirs, files) {
  const list = $("#fp-list");
  list.innerHTML = "";
  if (path !== FP_ROOT) {
    list.appendChild(el("div", {
      class: "fp-row is-parent",
      html: `<span class="fp-row-icon">⬆️</span><span class="fp-row-name">.. 上一级目录</span>`,
      onClick: () => fpNavigate(parentPath(path)),
    }));
  }
  dirs.forEach((name) => {
    list.appendChild(el("div", {
      class: "fp-row is-dir",
      html: `<span class="fp-row-icon">📁</span><span class="fp-row-name">${escapeHtml(name)}</span>`,
      onClick: () => fpNavigate(joinPath(path, name)),
    }));
  });
  files.forEach((name) => {
    const matches = matchesFilter(name, fpState.filterExt);
    const row = el("div", {
      class: "fp-row is-file" + (matches ? "" : " is-disabled"),
      html: `<span class="fp-row-icon">📄</span><span class="fp-row-name">${escapeHtml(name)}</span>`,
    });
    if (fpState.mode === "open") {
      if (matches) row.addEventListener("click", () => (fpState.binary ? fpConfirmPickBinary(joinPath(path, name)) : fpConfirmOpen(joinPath(path, name))));
    } else {
      row.addEventListener("click", () => { $("#fp-filename").value = name; });
    }
    list.appendChild(row);
  });
  if (!dirs.length && !files.length) {
    list.appendChild(el("div", { class: "fp-empty", text: "此目录为空" }));
  }
}

async function fpNavigate(path) {
  const normalized = clampToRoot(path);
  fpState.path = normalized;
  localStorage.setItem(LS_FP_LAST_DIR, normalized);
  renderFpPath(normalized);
  const list = $("#fp-list");
  list.innerHTML = '<div class="fp-loading">正在读取目录…</div>';
  const res = await fpListDir(normalized);
  if (res.error) {
    list.innerHTML = `<div class="fp-error">${escapeHtml(res.error)}</div>`;
    return;
  }
  renderFpList(normalized, res.dirs, res.files);
}
async function fpConfirmOpen(fullPath) {
  const text = await readFileContent(fullPath);
  if (!text) {
    showToast("读取文件失败：文件为空或不存在");
    return;
  }
  const cb = fpState.onConfirm;
  closeFilePicker();
  await cb(text, fullPath);
}
async function fpConfirmPickBinary(fullPath) {
  const cb = fpState.onConfirm;
  closeFilePicker();
  await cb("", fullPath);
}

function openFilePicker(opts) {
  try {
    if (typeof window.ksu === "undefined" || typeof window.ksu.exec !== "function") {
      showToast("未检测到 Root WebUI 接口，无法使用文件选择器");
      return;
    }
    const startPath = clampToRoot(localStorage.getItem(LS_FP_LAST_DIR) || opts.startPath || FP_ROOT);
    fpState = {
      mode: opts.mode,
      binary: !!opts.binary,
      filterExt: opts.filterExt || null,
      onConfirm: opts.onConfirm,
      path: startPath,
    };
    $("#fp-title").textContent = opts.title || (opts.mode === "save" ? "选择保存位置" : "选择文件");
    $("#fp-savebar").style.display = opts.mode === "save" ? "flex" : "none";
    $("#fp-filename").value = opts.defaultName || "";
    renderFpShortcuts();
    $("#fp-overlay").style.display = "block";
    history.pushState({ picker: true }, "");
    fpNavigate(startPath);
  } catch (err) {
    showToast("打开文件选择器失败：" + err.message);
  }
}
function closeFilePicker() {
  blurActiveElement();
  $("#fp-overlay").style.display = "none";
  fpState = null;

  if (history.state && history.state.picker) {
    closingPicker = true;
    history.back();
  }
}

function importFromFile() {
  openFilePicker({
    mode: "open",
    title: "导入 - 选择 JSON 文件",
    filterExt: ".json",
    startPath: FP_ROOT,
    onConfirm: async (text, fullPath) => {
      try {
        let parsed;
        try {
          parsed = JSON.parse(text);
          if (!Array.isArray(parsed)) throw new Error("最外层必须是数组 []");
        } catch (e) {
          setStatus("导入失败");
          await uiAlert("导入的文件不是合法的规则 JSON：\n" + e.message);
          return;
        }
        const clean = normalizeRules(parsed);
        if (clean.length !== parsed.length) {
          showToast(`已忽略 ${parsed.length - clean.length} 条非法条目`);
        }
        const name = fullPath.slice(fullPath.lastIndexOf("/") + 1);
        if (dirty && !(await uiConfirm(`当前列表有未保存的修改，导入「${name}」（共 ${clean.length} 条规则）将覆盖当前列表，确定继续吗？`))) {
          return;
        }
        data = clean;
        renderList();
        markDirty();
        showToast("导入成功");
        setStatus(`已导入 ${clean.length} 条规则，尚未保存到 threads.json`);
      } catch (err) {
        showToast("导入失败：" + err.message);
      }
    }
  });
}

async function exportToPath(fullPath) {
  setStatus("正在导出…");
  const { ok, stderr } = await writeJsonFileAtomic(fullPath, JSON.stringify(data, null, 2));
  if (ok) {
    setStatus("已导出到 " + fullPath);
    showToast("导出成功");
  } else {
    setStatus("导出失败");
    await uiAlert("导出失败：\n" + (stderr || "未知错误"));
  }
}
function exportToFile() {
  const t = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const defaultName = `threads_export_${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}_${pad(t.getHours())}${pad(t.getMinutes())}.json`;
  openFilePicker({
    mode: "save",
    title: "导出 - 选择保存位置",
    filterExt: ".json",
    startPath: FP_ROOT,
    defaultName,
    onConfirm: (fullPath) => exportToPath(fullPath),
  });
}

$("#list").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const idx = Number(btn.dataset.idx);
  const act = btn.dataset.act;
  if (act === "view") {
    openEditor(idx, "view");
  } else if (act === "edit") {
    openEditor(idx, "edit");
  } else if (act === "del") {
    if (await uiConfirm(`确定删除规则「${data[idx].friendly || "(未命名)"}」吗？`)) {
      data.splice(idx, 1);
      renderList();
      markDirty();
    }
  }
});

$("#btn-back").addEventListener("click", () => navigateBack());
$("#btn-editor-save").addEventListener("click", async () => {
  blurActiveElement();
  const obj = await collectFormData();
  if (!obj) return;
  if (editingIndex === null) {
    data.push(obj);
    editingIndex = data.length - 1;
  } else {
    data[editingIndex] = obj;
  }
  renderList();
  markDirty();
  showToast("已保存");
  navigateBack();
});
$("#btn-add").addEventListener("click", () => openEditor(null));

$("#btn-raw").addEventListener("click", () => {

  navigateTo("raw");
  requestAnimationFrame(() => {
    $("#raw-textarea").value = JSON.stringify(data, null, 2);
  });
});
$("#btn-raw-back").addEventListener("click", () => navigateBack());
$("#btn-raw-apply").addEventListener("click", async () => {
  try {
    const parsed = JSON.parse($("#raw-textarea").value);
    if (!Array.isArray(parsed)) throw new Error("最外层必须是数组 []");
    data = normalizeRules(parsed);
    renderList();
    markDirty();
    navigateBack();
  } catch (e) {
    await uiAlert("JSON 格式错误：\n" + e.message);
  }
});

$("#fp-close").addEventListener("click", closeFilePicker);
$("#fp-confirm").addEventListener("click", async () => {
  try {
    let name = $("#fp-filename").value.trim();
    if (!name) { await uiAlert("请输入文件名"); return; }
    const ext = Array.isArray(fpState.filterExt) ? fpState.filterExt[0] : fpState.filterExt;
    if (ext && !name.toLowerCase().endsWith(String(ext).toLowerCase())) name += ext;
    const fullPath = joinPath(fpState.path, name);
    const existsRes = await ksuExec(`[ -e ${shQuote(fullPath)} ] && echo E`);
    if ((existsRes.stdout || "").includes("E") && !(await uiConfirm(`「${name}」已存在，确定覆盖吗？`))) return;
    const cb = fpState.onConfirm;
    closeFilePicker();
    await cb(fullPath);
  } catch (err) {
    showToast("保存文件失败：" + err.message);
  }
});

$("#btn-import").addEventListener("click", importFromFile);
$("#btn-export").addEventListener("click", exportToFile);
/* ============================================================
   游戏线程 —— AsoulOpt 配置的可视化编辑
   只读写 AsoulOpt 的官方配置（/data/adb/naki/asopt.conf），
   不改变它的任何实现逻辑。
   ============================================================ */
const ASOUL_STATE = { status: null, cfg: null, games: [] };

async function webuiCmd(args, timeoutMs) {
  const res = await ksuExec(`sh ${shQuote(WEBUI)} ${args}`, {}, timeoutMs || 30000);
  const out = (res.stdout || "").trim();
  const lines = out.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const L = lines[i].trim();
    if (L.startsWith("{")) { try { return JSON.parse(L); } catch (e) { /* 继续 */ } }
  }
  return { ok: false, msg: (res.stderr || "").trim() || "命令无输出" };
}

async function webuiTsv(args, timeoutMs) {
  const res = await ksuExec(`sh ${shQuote(WEBUI)} ${args}`, {}, timeoutMs || 30000);
  return (res.stdout || "").split("\n")
    .map((l) => l.replace(/\r$/, "")).filter(Boolean).map((l) => l.split("\t"));
}

function switchRoot(name) {
  navStack = [name];
  try { history.replaceState({ screen: name }, ""); } catch (e) { /* 忽略 */ }
  showScreenInternal(name);
  if (name === "asoul") loadAsoul();
}

function segHtml(id, val, opts) {
  return `<div class="seg" id="${id}">` + opts.map((o) =>
    `<button type="button" class="seg-btn${String(o.v) === String(val) ? " active" : ""}" data-val="${o.v}">${escapeHtml(o.t)}</button>`
  ).join("") + `</div>`;
}
function bindSeg(id) {
  const box = document.getElementById(id);
  if (!box) return;
  box.addEventListener("click", (e) => {
    const b = e.target.closest(".seg-btn");
    if (!b) return;
    box.querySelectorAll(".seg-btn").forEach((x) => x.classList.toggle("active", x === b));
  });
}
function segVal(id) {
  const b = document.querySelector(`#${id} .seg-btn.active`);
  return b ? b.getAttribute("data-val") : "0";
}

async function loadAsoul() {
  const st = $("#asoul-status");
  if (st) st.textContent = "正在读取…";
  if (typeof window.ksu === "undefined") return;
  ASOUL_STATE.status = await webuiCmd("status");
  ASOUL_STATE.cfg = await webuiCmd("asopt-get");
  const g = await webuiTsv("games");
  ASOUL_STATE.games = g.map((f) => ({
    pkg: f[0] || "", over: (f[1] || "0") === "1",
    mode: f[2] || "0", rt: f[3] || "0"
  })).filter((x) => x.pkg);
  renderAsoul();
}

function renderAsoul() {
  const s = ASOUL_STATE.status || {};
  const c = ASOUL_STATE.cfg || {};
  const body = $("#asoul-body");
  if (!body) return;

  const st = $("#asoul-status");
  if (st) {
    st.textContent = c.ok
      ? `全局 mode=${c.mode} rt=${c.rt} · 单独配置 ${c.count || 0} 个游戏`
      : "读取失败";
  }

  const sceneBadge = s.scene_installed
    ? '<span class="tag ok">Scene 已安装</span>'
    : '<span class="tag warn">未检测到 Scene</span>';
  const binBadge = s.asoul_binary
    ? '<span class="tag ok">AsoulOpt 已就位</span>'
    : '<span class="tag warn">未找到 AsoulOpt 二进制</span>';

  let html = "";
  html += `<div class="acard"><div class="card-title">环境</div>
    <div class="hint">${sceneBadge} ${binBadge}</div>
    <div class="hint">游戏配置文件：${escapeHtml(c.path || s.asopt_conf || "")}</div>
    <div class="hint">捆绑的 AsoulOpt 逻辑与上游完全一致，仅安装位置改到本模块的 asoulopt/ 子目录。</div>
  </div>`;

  html += `<div class="acard"><div class="card-title">全局运行模式</div>
    <div class="field"><label>mode — 运行模式</label>
      ${segHtml("as-mode-global", c.mode, [
        { v: 0, t: "0 硬亲和" }, { v: 1, t: "1 软迁移" }, { v: 2, t: "2 硬迁移" }])}
      <div class="hint">0 硬亲和（理论更好）· 1 软迁移（帧率可能更稳）· 2 硬迁移（帧率可能更稳）</div>
    </div>
    <div class="field"><label>rt — 实时模式</label>
      ${segHtml("as-rt-global", c.rt, [{ v: 0, t: "0 调度器默认" }, { v: 1, t: "1 实时" }])}
      <div class="hint">1 可能更流畅，但可能导致卡死</div>
    </div>
    <div class="asoul-actions"><button class="btn-primary" id="btn-asoul-save">保存全局设置</button></div>
    <div class="hint">保存后即时应用，切换游戏后生效。</div>
  </div>`;

  html += `<div class="acard"><div class="card-title">已安装且受支持的游戏（${ASOUL_STATE.games.length}）</div>`;
  if (!ASOUL_STATE.games.length) {
    html += `<div class="hint">未在已安装应用中发现 AsoulOpt 支持的游戏（可能本机未装游戏，或环境无 pm）。</div>`;
  } else {
    html += `<div class="game-list">`;
    for (const g of ASOUL_STATE.games) {
      const badge = g.over
        ? `<span class="tag ok">单独 ${escapeHtml(g.mode)}/${escapeHtml(g.rt)}</span>`
        : `<span class="tag">跟随全局 ${escapeHtml(g.mode)}/${escapeHtml(g.rt)}</span>`;
      html += `<div class="game-row">
        <span class="game-pkg">${escapeHtml(g.pkg)}</span>
        <span class="game-tail">${badge}
          <button class="icon-btn small" data-edit="${escapeHtml(g.pkg)}">设置</button>
          ${g.over ? `<button class="icon-btn danger small" data-del="${escapeHtml(g.pkg)}">清除</button>` : ""}
        </span></div>`;
    }
    html += `</div>`;
  }
  html += `</div>`;

  html += `<div class="acard"><div class="card-title">为某个游戏单独指定</div>
    <div class="field"><label>包名</label>
      <input type="text" id="as-pkg" class="fp-filename-input" list="as-pkg-list"
             placeholder="com.miHoYo.Yuanshen" spellcheck="false"></div>
    <datalist id="as-pkg-list">${ASOUL_STATE.games.map((g) => `<option value="${escapeHtml(g.pkg)}"></option>`).join("")}</datalist>
    <div class="field"><label>mode</label>
      ${segHtml("as-mode-new", 0, [{ v: 0, t: "0 硬亲和" }, { v: 1, t: "1 软迁移" }, { v: 2, t: "2 硬迁移" }])}</div>
    <div class="field"><label>rt</label>
      ${segHtml("as-rt-new", 0, [{ v: 0, t: "0 调度器默认" }, { v: 1, t: "1 实时" }])}</div>
    <div class="asoul-actions"><button class="btn-primary" id="btn-asoul-add">添加 / 覆盖</button></div>
    <div class="hint">生成的文件与上游 AsoulOpt 格式完全一致，可与官方模块共用。</div>
  </div>`;

  body.innerHTML = html;
  bindSeg("as-mode-global"); bindSeg("as-rt-global");
  bindSeg("as-mode-new"); bindSeg("as-rt-new");

  const bSave = $("#btn-asoul-save");
  if (bSave) bSave.addEventListener("click", saveAsoulGlobal);
  const bAdd = $("#btn-asoul-add");
  if (bAdd) bAdd.addEventListener("click", addAsoulGame);
  body.addEventListener("click", (e) => {
    const t = e.target;
    if (!t.getAttribute) return;
    const ed = t.getAttribute("data-edit");
    const dl = t.getAttribute("data-del");
    if (ed) {
      const inp = $("#as-pkg");
      if (inp) { inp.value = ed; inp.scrollIntoView({ block: "center", behavior: "smooth" }); }
    } else if (dl) {
      delAsoulGame(dl);
    }
  });
}

async function saveAsoulGlobal() {
  const m = segVal("as-mode-global");
  const r = segVal("as-rt-global");
  const res = await webuiCmd(`asopt-set ${shQuote(m)} ${shQuote(r)}`, 60000);
  showToast(res.msg || (res.ok ? "已保存" : "保存失败"));
  loadAsoul();
}

async function addAsoulGame() {
  const inp = $("#as-pkg");
  const p = inp ? inp.value.trim() : "";
  if (!p) { showToast("请输入包名"); return; }
  const m = segVal("as-mode-new");
  const r = segVal("as-rt-new");
  const res = await webuiCmd(`asopt-set-game ${shQuote(p)} ${shQuote(m)} ${shQuote(r)}`, 60000);
  showToast(res.msg || (res.ok ? "已保存" : "保存失败"));
  if (res.ok && inp) inp.value = "";
  loadAsoul();
}

async function delAsoulGame(pkg) {
  if (!(await uiConfirm(`清除「${pkg}」的单独配置？`))) return;
  const res = await webuiCmd(`asopt-del-game ${shQuote(pkg)}`, 60000);
  showToast(res.msg || (res.ok ? "已清除" : "失败"));
  loadAsoul();
}

$("#btn-settings").addEventListener("click", () => {

  navigateTo("settings");
  if (!settingsBuilt) {
    settingsBuilt = true;
    requestAnimationFrame(buildSettingsForm);
  }
});
$("#btn-settings-back").addEventListener("click", () => navigateBack());
$("#btn-save").addEventListener("click", persistToFile);

// ---- 顶部「用户线程 / 游戏线程」切换 ----
document.querySelectorAll(".modetab").forEach((b) => {
  b.addEventListener("click", () => switchRoot(b.getAttribute("data-root")));
});
// ---- 游戏线程：刷新 ----
$("#btn-asoul-reload").addEventListener("click", () => loadAsoul());
// ---- 用户线程：载入模块默认 ----
$("#btn-load-default").addEventListener("click", async () => {
  if (dirty && !(await uiConfirm("当前有未保存的修改，载入默认会覆盖编辑器内容，继续？"))) return;
  await loadDefaultThreads(false);
});
$("#btn-reload").addEventListener("click", async () => {
  if (dirty && !(await uiConfirm("当前有未保存的修改，重新读取将丢弃这些修改，确定继续吗？"))) return;
  loadFromFile();
});

window.addEventListener("beforeunload", (e) => {
  if (!dirty) return;
  e.preventDefault();
  e.returnValue = "";
});

(async function init() {
  applyUiScale(getUiScale());
  applyTheme(getTheme());
  applyBgImage(bgImageSource());
  applyFrosted(getFrosted());
  applyMinFrosted(getMinFrosted());
  applyTranslucent(getTranslucent());
  applyContrast(getContrast());
  applyCardOpacity(getCardOpacity());
  applyBgBlur(getBgBlur());
  syncKeyboardLayout();
  loadCpuTopology();

  setTimeout(ensureSettingsFormBuilt, 500);
  if (window.matchMedia) {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSchemeChange = () => { if (getTheme() === "system") applyDarkModeDisable(); };
    if (typeof mq.addEventListener === "function") mq.addEventListener("change", onSchemeChange);
    else if (typeof mq.addListener === "function") mq.addListener(onSchemeChange);
  }
  if (typeof window.ksu === "undefined" || typeof window.ksu.exec !== "function") {
    $("#env-banner").style.display = "block";
    setStatus("未检测到 Root WebUI 接口");
    renderList();
    return;
  }
  await loadFromFile();
  await validateBgFile();
})();
