let DATA = null;
let currentMode = 'time_of_day';  // default view: streamer-local time of day
let currentCountry = 'ALL';

DataStore.data().then(d => {
  DATA = d;
  renderLatestUpdate(DATA);

  renderCountrySelect();
  renderExplanations();
  renderBoard();
  bindControls();
  GRDownload.attach(document.getElementById('boardHost'), {
    title: () => t('sched.dl_title'),
    subtitle: () => `${currentMode === 'standardized' ? 'UTC' : t('common.local')}${currentCountry === 'ALL' ? '' : ' · ' + currentCountry}`,
    png: boardPng,
    csv: boardCsv,
  });
});

function renderCountrySelect() {
  const select = document.getElementById('countrySelect');
  const countries = Object.keys((DATA.schedule || {}).by_country || {}).sort();
  select.innerHTML = `<option value="ALL">${t('common.all_regions')}</option>` +
    countries.map(c => `<option value="${c}">${c}</option>`).join('');
  select.value = currentCountry;
}

function currentSchedule() {
  const sched = DATA.schedule || {};
  if (currentCountry !== 'ALL') {
    const countryData = (sched.by_country || {})[currentCountry];
    if (countryData) return countryData[currentMode] || {};
  }
  return sched[currentMode] || {};
}

/* Static explanations whose numbers come from the real collection coverage
   (so the text can never drift away from the data). */
function renderExplanations() {
  const cov = (DATA.schedule || {}).coverage || {};
  const rows = fmt((DATA.meta || {}).total_twitch_snapshots);
  document.getElementById('timeP1').innerHTML = t('sched.time_p1', { rows });
  if (cov.total_snapshots) {
    document.getElementById('nodataP1').textContent = t('sched.nodata_p1', {
      total: fmt(cov.total_snapshots), days: fmt(cov.span_days), perday: localeNumber(cov.avg_snapshots_per_day, { maximumFractionDigits: 1 }),
      covered: cov.cells_covered, cells: cov.cells_total, missing: cov.cells_total - cov.cells_covered,
    });
    document.getElementById('nodataP2').textContent = t('sched.nodata_p2', {
      min: cov.min_snapshots_in_covered_cell, max: cov.max_snapshots_in_cell,
    });
    const per = cov.snapshots_per_utc_hour || {};
    const maxN = Math.max(1, ...Object.values(per));
    const host = document.getElementById('covBars');
    host.innerHTML = Array.from({ length: 24 }, (_, h) => {
      const n = per[h] || 0;
      return `<div class="cov-bar${n ? '' : ' none'}" data-tip="${t('sched.cov_tip', { hour: String(h).padStart(2, '0'), n })}"><span style="height:${Math.max(4, (n / maxN) * 100)}%"></span><i>${h % 3 === 0 ? h : ''}</i></div>`;
    }).join('');
    initChartInteractivity(host);
  }
}

function renderBoard() {
  const sched = currentSchedule();
  const isLocal = currentMode === 'time_of_day';
  const regionLabel = currentCountry === 'ALL' ? '' : ` \u2014 ${currentCountry}`;

  document.getElementById('bestHourLabel').textContent = isLocal ? t('sched.best_hour_local') : t('sched.best_hour_utc');
  document.getElementById('modeNote').textContent = (isLocal ? t('sched.note.local') : t('sched.note.utc')) + regionLabel;

  document.getElementById('bestDayOverall').textContent = sched.best_day_overall ? dayLabel(sched.best_day_overall) : '—';
  document.getElementById('bestHourOverall').textContent =
    sched.best_hour_overall != null ? `${String(sched.best_hour_overall).padStart(2, '0')}:00` : '—';

  const heatmap = sched.heatmap || [];
  const lookup = {};
  let max = 0;
  heatmap.forEach(h => { lookup[`${h.day}|${h.hour}`] = h; if (h.ratio > max) max = h.ratio; });

  // Outlined cell = the single brightest cell that is backed by at least 2 snapshots
  // (a lone snapshot is too noisy to crown). Falls back to any cell if none qualify.
  const pool = heatmap.some(h => h.n >= 2) ? heatmap.filter(h => h.n >= 2) : heatmap;
  const bestCell = pool.reduce((m, h) => (!m || h.ratio > m.ratio ? h : m), null);

  const grid = document.getElementById('boardGrid');
  if (!heatmap.length) {
    grid.innerHTML = `<div class="empty-state">${t('sched.empty')}</div>`;
    return;
  }
  const clock = isLocal ? t('common.local') : 'UTC';
  let html = `<div></div>`;
  for (let h = 0; h < 24; h++) html += `<div class="board-hourlabel">${h % 3 === 0 ? h : ''}</div>`;
  DAY_ORDER.forEach(day => {
    html += `<div class="board-daylabel">${dayShortLabel(day)}</div>`;
    for (let h = 0; h < 24; h++) {
      const c = lookup[`${day}|${h}`];
      const level = c == null ? '' : Math.min(5, Math.ceil((c.ratio / (max || 1)) * 5));
      const isBest = bestCell && day === bestCell.day && h === bestCell.hour;
      const hh = String(h).padStart(2, '0');
      let tip;
      if (c == null) {
        tip = isLocal ? t('sched.tip_nodata_local', { day: dayShortLabel(day), hour: hh }) : t('sched.tip_nodata_utc', { day: dayShortLabel(day), hour: hh });
      } else {
        tip = t('sched.tip', { day: dayShortLabel(day), hour: hh, clock, ratio: localeNumber(Math.round(c.ratio)), n: c.n }) + (c.n <= 1 ? t('sched.tip_weak') : '');
      }
      html += `<div class="cell${isBest ? ' best' : ''}${c && c.n <= 1 ? ' weak' : ''}" data-level="${level}" data-tip="${tip}"></div>`;
    }
  });
  grid.innerHTML = html;
  initChartInteractivity(grid);
}

/* ---- exporters for the heatmap (a CSS grid, so it has its own PNG/CSV) ---- */
function boardCsv() {
  const sched = currentSchedule();
  const rows = [['day', 'hour', 'clock', 'region', 'viewers_per_streamer', 'n_snapshots', 'avg_streamers', 'avg_viewers']];
  const lookup = {};
  (sched.heatmap || []).forEach(h => { lookup[`${h.day}|${h.hour}`] = h; });
  DAY_ORDER.forEach(day => {
    for (let h = 0; h < 24; h++) {
      const c = lookup[`${day}|${h}`];
      rows.push([day, h, currentMode === 'standardized' ? 'UTC' : 'local', currentCountry,
        c ? c.ratio : '', c ? c.n : 0, c ? c.streamers : '', c ? c.viewers : '']);
    }
  });
  return rows;
}

async function boardPng({ title, subtitle }) {
  const sched = currentSchedule();
  const lookup = {};
  let max = 0;
  (sched.heatmap || []).forEach(h => { lookup[`${h.day}|${h.hour}`] = h; if (h.ratio > max) max = h.ratio; });
  const panel = GRDownload.cssVar('--panel', '#192124');
  const text = GRDownload.cssVar('--text', '#ECEEE9');
  const dim = GRDownload.cssVar('--text-dim', '#8B9A9B');
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const noDataFill = isLight ? '#F1F5F9' : 'rgba(128,140,142,0.18)';
  const noDataLine = isLight ? '#CBD6E2' : 'rgba(128,140,142,0.35)';
  const cell = 26, gap = 3, left = 64, top = 104, scale = 2;
  const W = left + 24 * (cell + gap) + 24, H = top + 7 * (cell + gap) + 70;
  const canvas = document.createElement('canvas');
  canvas.width = W * scale; canvas.height = H * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = panel; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = text; ctx.font = '700 22px sans-serif'; ctx.fillText(title, 24, 38);
  ctx.fillStyle = dim; ctx.font = '14px monospace'; ctx.fillText(subtitle, 24, 62);
  ctx.font = '11px monospace';
  for (let h = 0; h < 24; h += 3) { ctx.fillStyle = dim; ctx.fillText(String(h), left + h * (cell + gap) + 4, top - 8); }
  DAY_ORDER.forEach((day, r) => {
    ctx.fillStyle = dim; ctx.font = '12px monospace'; ctx.fillText(dayShortLabel(day), 16, top + r * (cell + gap) + 17);
    for (let h = 0; h < 24; h++) {
      const c = lookup[`${day}|${h}`];
      const x = left + h * (cell + gap), y = top + r * (cell + gap);
      if (!c) {
        ctx.fillStyle = noDataFill; ctx.fillRect(x, y, cell, cell);
        ctx.strokeStyle = noDataLine; ctx.beginPath(); ctx.moveTo(x, y + cell); ctx.lineTo(x + cell, y); ctx.stroke();
      } else {
        const level = Math.min(5, Math.ceil((c.ratio / (max || 1)) * 5));
        ctx.fillStyle = heatColor(level); ctx.fillRect(x, y, cell, cell);
      }
    }
  });
  ctx.fillStyle = dim; ctx.font = '12px monospace';
  ctx.fillText(`${t('sched.legend.quiet')} \u2192 ${t('sched.legend.open')}`, 24, H - 36);
  ctx.fillText('Green Room \u00b7 PSU Phuket \u00b7 ' + new Date().toISOString().slice(0, 10), 24, H - 14);
  return new Promise(res => canvas.toBlob(res, 'image/png'));
}

function bindControls() {
  document.getElementById('tzSelect').addEventListener('change', e => {
    currentMode = e.target.value;
    renderBoard();
  });
  document.getElementById('countrySelect').addEventListener('change', e => {
    currentCountry = e.target.value;
    renderBoard();
  });
}
