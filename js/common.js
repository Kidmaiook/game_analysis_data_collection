const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_SHORT = { Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun' };
const HEAT_COLORS = [
  'rgba(var(--cue-rgb), 0.08)',
  'rgba(var(--cue-rgb), 0.24)',
  'rgba(var(--cue-rgb), 0.42)',
  'rgba(var(--cue-rgb), 0.62)',
  'rgba(var(--cue-rgb), 0.82)',
  'var(--cue)',
];

function fmt(n) {
  if (n === undefined || n === null) return '—';
  return n.toLocaleString();
}

function scoreColor(score) {
  if (score >= 66) return 'var(--cue)';
  if (score >= 33) return 'var(--amber)';
  return 'var(--tally)';
}

function heatColor(level) {
  return HEAT_COLORS[Math.max(0, Math.min(5, level))];
}

const DataStore = (() => {
  let dataPromise = null;
  let insightsPromise = null;

  function friendlyFetchError() {
    document.body.innerHTML = `<div class="wrap" style="padding-top:80px">
      <h1 style="font-family:'Space Grotesk',sans-serif">Data didn't load</h1>
      <p style="color:#8B9A9B;max-width:60ch">Browsers block local file:// pages from fetching other local files.
      Serve this folder instead — from a terminal in the <span class="mono">site/</span> directory run:</p>
      <p class="mono" style="background:#192124;padding:12px 16px;border-radius:8px;display:inline-block">python -m http.server 8000</p>
      <p style="color:#8B9A9B">then open <span class="mono">http://localhost:8000</span>.</p>
    </div>`;
  }

  return {
    data() {
      if (!dataPromise) {
        dataPromise = fetch('data.json').then(r => {
          if (!r.ok) throw new Error('bad response');
          return r.json();
        }).catch(err => { friendlyFetchError(); throw err; });
      }
      return dataPromise;
    },
    insights() {
      if (!insightsPromise) {
        insightsPromise = fetch('insights.json').then(r => {
          if (!r.ok) throw new Error('bad response');
          return r.json();
        }).catch(err => { friendlyFetchError(); throw err; });
      }
      return insightsPromise;
    },
  };
})();

function highlightActiveNav() {
  const path = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.topnav a').forEach(a => {
    const href = a.getAttribute('href');
    if (href === path || (path === '' && href === 'index.html')) a.classList.add('active');
    else a.classList.remove('active');
  });
}

document.addEventListener('DOMContentLoaded', highlightActiveNav);

/* Renders "Latest update: dd/mm/yyyy" into the topbar on every page. Called
   once data.json or insights.json (whichever the page already fetches) has
   resolved, so pages don't need their own copy of this formatting logic. */
function renderLatestUpdate(payload) {
  const el = document.getElementById('topbarMeta');
  if (!el || !payload) return;
  const display = payload.last_updated_display
    || (payload.generated_at ? formatDateDMY(payload.generated_at) : null);
  el.textContent = display ? `Latest update: ${display}` : '—';
}

function formatDateDMY(isoString) {
  const d = new Date(isoString);
  if (isNaN(d)) return null;
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/* ============================================================
   Shared chart interactivity: hover shows a floating tooltip,
   click "pins" the same info so it stays put (for touch devices,
   or anyone who wants to read it without holding the mouse still).
   Chart-drawing code just needs to mark hoverable elements with
   data-tip="..." (plain text or small HTML) -- this file wires
   the rest up once per chart container.
   ============================================================ */
let __sharedTooltipEl = null;
function ensureTooltipEl() {
  if (__sharedTooltipEl) return __sharedTooltipEl;
  const el = document.createElement('div');
  el.className = 'chart-tooltip';
  el.style.display = 'none';
  document.body.appendChild(el);
  __sharedTooltipEl = el;
  return el;
}

function initChartInteractivity(container) {
  if (!container || container.__chartInteractive) return;
  container.__chartInteractive = true;
  const tooltip = ensureTooltipEl();
  let pinned = null;

  const showTooltip = (el, evt) => {
    const tip = el.getAttribute('data-tip');
    if (!tip) return;
    tooltip.innerHTML = tip;
    tooltip.style.display = 'block';
    positionTooltip(evt);
  };
  const positionTooltip = evt => {
    const pad = 14;
    let x = evt.clientX + pad, y = evt.clientY + pad;
    const rect = tooltip.getBoundingClientRect();
    if (x + rect.width > window.innerWidth - 8) x = evt.clientX - rect.width - pad;
    if (y + rect.height > window.innerHeight - 8) y = evt.clientY - rect.height - pad;
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  };
  const hideTooltip = () => { if (!pinned) tooltip.style.display = 'none'; };

  container.addEventListener('mousemove', evt => {
    const el = evt.target.closest('[data-tip]');
    if (!el) { hideTooltip(); return; }
    if (pinned && pinned !== el) return;
    showTooltip(el, evt);
  });
  container.addEventListener('mouseleave', hideTooltip);

  container.addEventListener('click', evt => {
    const el = evt.target.closest('[data-tip]');
    container.querySelectorAll('.chart-el-pinned').forEach(n => n.classList.remove('chart-el-pinned'));
    if (!el) { pinned = null; tooltip.style.display = 'none'; return; }
    if (pinned === el) { pinned = null; tooltip.style.display = 'none'; return; }
    pinned = el;
    el.classList.add('chart-el-pinned');
    tooltip.classList.add('chart-tooltip-pinned');
    showTooltip(el, evt);
  });

  // Touch: tap shows + pins in one go (there's no hover on touch).
  container.addEventListener('touchstart', evt => {
    const touch = evt.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const tipEl = el && el.closest('[data-tip]');
    container.querySelectorAll('.chart-el-pinned').forEach(n => n.classList.remove('chart-el-pinned'));
    if (!tipEl) { pinned = null; tooltip.style.display = 'none'; return; }
    pinned = tipEl;
    tipEl.classList.add('chart-el-pinned');
    showTooltip(tipEl, { clientX: touch.clientX, clientY: touch.clientY });
  }, { passive: true });
}

/* ============================================================
   Zoom controls
   - Sitewide: scales the whole page, persisted in localStorage, shared
     across all 4 pages through one control rendered into #siteZoomControl
     (a placeholder every page has in its topbar). Uses CSS transform
     (not the non-standard `zoom` property) because `zoom` has real,
     reproducible inconsistencies with pointer-coordinate math in
     Chromium (getBoundingClientRect/getScreenCTM can disagree with the
     actual cursor position once `zoom` is applied to an ancestor) --
     that's what silently broke the GPU chart's hover readout. transform
     doesn't have that problem, it's just not layout-affecting on its
     own, so we manually compensate the page's reserved space to match.
   - Per-chart: see initGraphZoom() below, used by chart-heavy pages.
   ============================================================ */
const ZOOM_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.4];
const ZOOM_STORAGE_KEY = 'green-room-site-zoom';
let _zoomRoot = null;

function currentSiteZoom() {
  const stored = parseFloat(localStorage.getItem(ZOOM_STORAGE_KEY));
  return ZOOM_STEPS.includes(stored) ? stored : 1;
}

let _topbarShell = null;

function ensureZoomRoot() {
  if (_zoomRoot) return _zoomRoot;

  // Pull the navbar out of the scaled area entirely so it stays a fixed,
  // readable size and doesn't drift/distort at different zoom levels --
  // only the page's own content scales, not the navigation chrome. It
  // keeps the exact same look by reusing the .wrap centering rules.
  const topbarEl = document.querySelector('.topbar');
  let shell = null;
  if (topbarEl) {
    shell = document.createElement('div');
    shell.id = 'topbarShell';
    shell.className = 'wrap';
    shell.appendChild(topbarEl);
  }

  const root = document.createElement('div');
  root.id = 'zoomRoot';
  while (document.body.firstChild) root.appendChild(document.body.firstChild);
  if (shell) document.body.appendChild(shell);
  document.body.appendChild(root);
  // Lock zoomRoot to a fixed pixel width up front. Left as the default
  // "auto" (fill your container), it inherits from <body> -- and since
  // compensateZoomLayout() below sets body's width explicitly, that would
  // feed straight back into zoomRoot's own rendered width, which feeds
  // back into the next measurement, spiraling the page to thousands of
  // pixels wide within a couple of zoom clicks. A fixed width breaks that
  // loop; height is left auto since content height changes legitimately
  // (different chart, different dropdown) and doesn't have this coupling.
  root.style.width = `${window.innerWidth}px`;
  _zoomRoot = root;
  _topbarShell = shell;
  if (shell) {
    // position:fixed anchors to the real browser viewport regardless of
    // body's size, which matters here because compensateZoomLayout()
    // deliberately makes body wider/taller than the viewport to hold the
    // scaled content -- a normal-flow element would center itself against
    // that inflated body width, not the true viewport, and visibly drift.
    // left:0 + right:0 (both, not width:100%) is what's needed for the
    // .wrap class's margin:auto to actually center it within the viewport
    // for a position:fixed element -- omitting either one makes the UA
    // fall back to flush-left instead of centering.
    shell.style.position = 'fixed';
    shell.style.top = '0';
    shell.style.left = '0';
    shell.style.right = '0';
    shell.style.zIndex = '100';
    shell.style.background = 'var(--ink)';
    root.style.marginTop = `${shell.offsetHeight}px`;
  }
  // Deliberately no ResizeObserver here: reacting to every incidental
  // content-height change (a chart re-rendering, a web font finishing
  // load) by resizing body mid-session is what was silently resetting
  // scroll position during ordinary use. Layout is recomputed on an
  // explicit zoom change (applySiteZoom) and on real window resizes only.
  window.addEventListener('resize', () => {
    root.style.width = `${window.innerWidth}px`;
    if (shell) root.style.marginTop = `${shell.offsetHeight}px`;
    compensateZoomLayout();
  });
  return root;
}

function compensateZoomLayout(level) {
  if (!_zoomRoot) return;
  const lvl = level != null ? level : currentSiteZoom();
  const naturalWidth = parseFloat(_zoomRoot.style.width) || _zoomRoot.scrollWidth;
  const topbarHeight = _topbarShell ? _topbarShell.offsetHeight : 0;
  document.body.style.width = `${naturalWidth * lvl}px`;
  document.body.style.height = `${topbarHeight + _zoomRoot.scrollHeight * lvl}px`;
}

function applySiteZoom(level) {
  // Capture scroll position BEFORE ensureZoomRoot() runs: on the very
  // first call, that function re-parents the entire page into a new
  // wrapper div, and that DOM restructuring itself resets window.scrollY
  // to 0 -- capturing "current" scroll after that point would just be
  // capturing the reset, not what the user actually had.
  const prevMaxScrollBefore = document.body.scrollHeight - window.innerHeight;
  const scrollRatio = prevMaxScrollBefore > 0 ? window.scrollY / prevMaxScrollBefore : 0;
  const root = ensureZoomRoot();
  root.style.transformOrigin = 'top left';
  root.style.transform = `scale(${level})`;
  // Pass the new level explicitly here -- compensateZoomLayout() would
  // otherwise fall back to currentSiteZoom(), which still reads the OLD
  // value from localStorage until the setItem call further down runs,
  // leaving body's size one step behind the transform actually applied.
  compensateZoomLayout(level);
  // Force the browser to actually apply the new body width/height before
  // reading scrollHeight again below -- otherwise this scrollTo can run
  // against the stale pre-resize layout and silently clamp to 0.
  void document.body.offsetHeight;
  const restoreScroll = () => {
    const newMaxScroll = document.body.scrollHeight - window.innerHeight;
    window.scrollTo(0, scrollRatio * Math.max(0, newMaxScroll));
  };
  restoreScroll();
  // The first time this runs, ensureZoomRoot() just re-parented the whole
  // page into a new wrapper div, and some browsers apply their own
  // "content moved" scroll reset asynchronously (after this function has
  // already returned), silently undoing the restoreScroll() call above.
  // Re-asserting it a frame later (twice, to be past any such reset)
  // covers that without a visible jump for the normal (already-wrapped)
  // case, since the position is already correct by then.
  requestAnimationFrame(() => requestAnimationFrame(restoreScroll));
  localStorage.setItem(ZOOM_STORAGE_KEY, String(level));
  const label = document.getElementById('siteZoomLabel');
  if (label) label.textContent = `${Math.round(level * 100)}%`;
}

function initSiteZoomControl() {
  const holder = document.getElementById('siteZoomControl');
  if (!holder) return;
  holder.innerHTML = `
    <button type="button" class="zoom-btn zoom-btn-a" id="siteZoomOut" title="Zoom out" aria-label="Zoom out">A</button>
    <span class="zoom-label mono" id="siteZoomLabel">100%</span>
    <button type="button" class="zoom-btn zoom-btn-a" id="siteZoomIn" title="Zoom in" aria-label="Zoom in">A</button>
    <button type="button" class="zoom-btn" id="siteZoomReset" title="Reset zoom" aria-label="Reset zoom">&#8635;</button>
  `;
  let level = currentSiteZoom();
  applySiteZoom(level);
  const step = dir => {
    const idx = ZOOM_STEPS.indexOf(level);
    const next = Math.max(0, Math.min(ZOOM_STEPS.length - 1, idx + dir));
    level = ZOOM_STEPS[next];
    applySiteZoom(level);
  };
  document.getElementById('siteZoomIn').addEventListener('click', () => step(1));
  document.getElementById('siteZoomOut').addEventListener('click', () => step(-1));
  document.getElementById('siteZoomReset').addEventListener('click', () => { level = 1; applySiteZoom(level); });
}
document.addEventListener('DOMContentLoaded', initSiteZoomControl);

/* Per-chart zoom: adds a small a/A/reset trio to the top-right corner of a
   chart card that scales just that chart in place (transform: scale),
   leaving the rest of the page alone. `wrapEl` is the element to scale;
   its parent is given an explicit height so scaling up doesn't make it
   overlap whatever comes after it in normal flow. */
const GRAPH_ZOOM_STEPS = [0.75, 1, 1.25, 1.5, 1.75];
const GRAPH_ZOOM_DEFAULT_IDX = 1;
function initGraphZoom(hostEl, wrapEl) {
  if (!hostEl || !wrapEl || hostEl.querySelector('.graph-zoom-controls')) return;
  let idx = GRAPH_ZOOM_DEFAULT_IDX;
  const baseHeight = wrapEl.getBoundingClientRect().height || wrapEl.scrollHeight;
  wrapEl.style.transformOrigin = 'top left';

  const controls = document.createElement('div');
  controls.className = 'graph-zoom-controls';
  controls.innerHTML = `
    <button type="button" class="zoom-btn zoom-btn-icon" data-dir="-1" title="Zoom out" aria-label="Zoom out">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="10" cy="10" r="6"/><line x1="14.5" y1="14.5" x2="20" y2="20"/><line x1="7" y1="10" x2="13" y2="10"/></svg>
    </button>
    <button type="button" class="zoom-btn zoom-btn-icon" data-dir="1" title="Zoom in" aria-label="Zoom in">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="10" cy="10" r="6"/><line x1="14.5" y1="14.5" x2="20" y2="20"/><line x1="7" y1="10" x2="13" y2="10"/><line x1="10" y1="7" x2="10" y2="13"/></svg>
    </button>
    <button type="button" class="zoom-btn zoom-btn-reset" data-reset="1" title="Reset size" aria-label="Reset size">Reset</button>
  `;
  hostEl.style.position = hostEl.style.position || 'relative';
  hostEl.appendChild(controls);

  const apply = () => {
    const scale = GRAPH_ZOOM_STEPS[idx];
    wrapEl.style.transform = `scale(${scale})`;
    wrapEl.parentElement.style.height = `${baseHeight * scale}px`;
    wrapEl.parentElement.style.overflow = scale > 1 ? 'auto' : 'visible';
    // A scaled-up chart needs the full card width to grow into, or it
    // visually overlaps the text column next to it (transform doesn't
    // change layout size, only paint) -- so drop to a single column
    // while zoomed in, same as the site's own narrow-viewport behavior.
    hostEl.classList.toggle('graph-zoomed', scale > 1);
  };
  controls.querySelectorAll('[data-dir]').forEach(btn => {
    btn.addEventListener('click', () => {
      const dir = parseInt(btn.dataset.dir, 10);
      idx = Math.max(0, Math.min(GRAPH_ZOOM_STEPS.length - 1, idx + dir));
      apply();
    });
  });
  controls.querySelector('[data-reset]').addEventListener('click', () => {
    idx = GRAPH_ZOOM_DEFAULT_IDX;
    apply();
  });
}

/* ============================================================
   Light / dark theme toggle. Persisted in localStorage, shared across
   all 4 pages via a placeholder (#themeToggleControl) in the topbar,
   same pattern as the zoom control. Actual colors live in style.css
   under [data-theme="light"] overrides of the same CSS variables the
   dark theme already uses everywhere, so no component needs its own
   light-mode styling.
   ============================================================ */
const THEME_STORAGE_KEY = 'green-room-theme';

function currentTheme() {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === 'light' ? 'light' : 'dark';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  const btn = document.getElementById('themeToggleBtn');
  if (btn) btn.textContent = theme === 'light' ? '\u2600' : '\u263E';
}

function initThemeControl() {
  const holder = document.getElementById('themeToggleControl');
  if (!holder) return;
  holder.innerHTML = `<button type="button" class="zoom-btn" id="themeToggleBtn" title="Toggle light/dark theme" aria-label="Toggle light/dark theme"></button>`;
  applyTheme(currentTheme());
  document.getElementById('themeToggleBtn').addEventListener('click', () => {
    applyTheme(currentTheme() === 'light' ? 'dark' : 'light');
  });
}
document.addEventListener('DOMContentLoaded', initThemeControl);

/* ============================================================
   Hybrid search+dropdown: turns a plain <select> into a searchable
   combobox (click/focus to open, type to filter, arrow keys + Enter to
   pick) while leaving the original <select> in the DOM as the real
   source of truth -- it still has the right .value, still fires a real
   'change' event when the user picks something, and is still whatever
   render*Select() functions rebuild via .innerHTML. That means every
   existing call site (option rebuilding, .value assignment, 'change'
   listeners) keeps working completely unchanged; this only replaces how
   the user interacts with it.
   ============================================================ */
function initHybridSelect(select) {
  if (!select || select.dataset.hybridInit) return;
  select.dataset.hybridInit = '1';

  const wrap = document.createElement('div');
  wrap.className = 'hybrid-select';
  select.parentNode.insertBefore(wrap, select);
  wrap.appendChild(select);
  select.classList.add('hybrid-select-native');
  select.tabIndex = -1;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'hybrid-select-toggle';
  toggle.innerHTML = `<span class="hybrid-select-label"></span><span class="hybrid-caret">&#9662;</span>`;
  wrap.appendChild(toggle);

  const panel = document.createElement('div');
  panel.className = 'hybrid-select-panel';
  panel.innerHTML = `<input type="text" class="hybrid-select-search" placeholder="Search&hellip;" autocomplete="off">
    <div class="hybrid-select-options"></div>`;
  wrap.appendChild(panel);

  const labelEl = toggle.querySelector('.hybrid-select-label');
  const searchInput = panel.querySelector('.hybrid-select-search');
  const optionsList = panel.querySelector('.hybrid-select-options');

  const syncLabel = () => {
    const opt = select.options[select.selectedIndex];
    labelEl.textContent = opt ? opt.textContent : '';
    toggle.classList.toggle('disabled', select.disabled);
  };

  const pick = opt => {
    if (!opt || opt.disabled) return;
    select.value = opt.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    closePanel();
    toggle.focus();
  };

  function renderOptions(filter) {
    const f = (filter || '').trim().toLowerCase();
    optionsList.innerHTML = '';
    [...select.options].forEach((opt, idx) => {
      if (f && !opt.textContent.toLowerCase().includes(f)) return;
      const row = document.createElement('div');
      row.className = 'hybrid-select-option'
        + (opt.disabled ? ' disabled' : '')
        + (idx === select.selectedIndex ? ' selected' : '');
      row.textContent = opt.textContent;
      row.dataset.value = opt.value;
      // mousedown (not click) fires before the search input's blur would
      // otherwise close the panel first and swallow the selection.
      row.addEventListener('mousedown', evt => { evt.preventDefault(); pick(opt); });
      optionsList.appendChild(row);
    });
    if (!optionsList.children.length) {
      optionsList.innerHTML = '<div class="hybrid-select-empty">No matches</div>';
    }
  }

  function openPanel() {
    if (select.disabled) return;
    wrap.classList.add('open');
    searchInput.value = '';
    renderOptions('');
    searchInput.focus();
  }
  function closePanel() {
    wrap.classList.remove('open');
  }

  toggle.addEventListener('click', () => {
    if (wrap.classList.contains('open')) closePanel(); else openPanel();
  });
  searchInput.addEventListener('input', () => renderOptions(searchInput.value));
  searchInput.addEventListener('keydown', evt => {
    if (evt.key === 'Escape') { closePanel(); toggle.focus(); }
    else if (evt.key === 'Enter') {
      evt.preventDefault();
      const highlighted = optionsList.querySelector('.hybrid-select-option.active')
        || optionsList.querySelector('.hybrid-select-option:not(.disabled)');
      if (highlighted) pick([...select.options].find(o => o.value === highlighted.dataset.value));
    } else if (evt.key === 'ArrowDown' || evt.key === 'ArrowUp') {
      evt.preventDefault();
      const rows = [...optionsList.querySelectorAll('.hybrid-select-option:not(.disabled)')];
      if (!rows.length) return;
      const curIdx = rows.findIndex(r => r.classList.contains('active'));
      rows.forEach(r => r.classList.remove('active'));
      const next = evt.key === 'ArrowDown'
        ? rows[Math.min(rows.length - 1, curIdx + 1)]
        : rows[Math.max(0, curIdx - 1)];
      next.classList.add('active');
      next.scrollIntoView({ block: 'nearest' });
    }
  });
  document.addEventListener('click', evt => { if (!wrap.contains(evt.target)) closePanel(); });

  select.addEventListener('change', syncLabel);
  // Keeps the visible label (and disabled styling) correct even when a
  // page's own JS rebuilds this select's options or flips .disabled
  // programmatically, not just on direct user interaction.
  new MutationObserver(syncLabel).observe(select, { childList: true, attributes: true, subtree: true });

  syncLabel();
}

function initHybridSelectsOnPage() {
  document.querySelectorAll('select').forEach(initHybridSelect);
}
document.addEventListener('DOMContentLoaded', initHybridSelectsOnPage);
