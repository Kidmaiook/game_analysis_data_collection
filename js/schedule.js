let DATA = null;
let currentMode = 'standardized';
let currentCountry = 'ALL';

DataStore.data().then(d => {
  DATA = d;
  renderLatestUpdate(DATA);

  renderCountrySelect();
  renderBoard();
  bindControls();
});

function renderCountrySelect() {
  const select = document.getElementById('countrySelect');
  const countries = Object.keys((DATA.schedule || {}).by_country || {}).sort();
  select.innerHTML = `<option value="ALL">All regions</option>` +
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

function renderBoard() {
  const sched = currentSchedule();
  const isLocal = currentMode === 'time_of_day';
  const regionLabel = currentCountry === 'ALL' ? '' : ` \u2014 ${currentCountry}`;

  document.getElementById('bestHourLabel').textContent = isLocal ? 'Best hour overall (local)' : 'Best hour overall (UTC)';
  document.getElementById('modeNote').textContent = (isLocal
    ? 'Each stream re-expressed in its own approximate local time (estimated from broadcast language). Shows whether certain points in a streamer\'s own day tend to do better, regardless of where they are.'
    : 'One shared UTC clock for everyone. Use this to target a specific real-world audience window.') + regionLabel;

  document.getElementById('bestDayOverall').textContent = sched.best_day_overall || '—';
  document.getElementById('bestHourOverall').textContent =
    sched.best_hour_overall != null ? `${String(sched.best_hour_overall).padStart(2, '0')}:00` : '—';

  const heatmap = sched.heatmap || [];
  const lookup = {};
  let max = 0;
  heatmap.forEach(h => { lookup[`${h.day}|${h.hour}`] = h.ratio; if (h.ratio > max) max = h.ratio; });

  const grid = document.getElementById('boardGrid');
  if (!heatmap.length) {
    grid.innerHTML = `<div class="empty-state">Not enough tracked data for this region/timezone combination yet.</div>`;
    return;
  }
  let html = `<div></div>`;
  for (let h = 0; h < 24; h++) html += `<div class="board-hourlabel">${h % 3 === 0 ? h : ''}</div>`;
  DAY_ORDER.forEach(day => {
    html += `<div class="board-daylabel">${DAY_SHORT[day]}</div>`;
    for (let h = 0; h < 24; h++) {
      const ratio = lookup[`${day}|${h}`];
      const level = ratio == null ? '' : Math.min(5, Math.ceil((ratio / (max || 1)) * 5));
      const isBest = day === sched.best_day_overall && h === sched.best_hour_overall;
      const tip = ratio == null ? `${day} ${h}:00 — no data` : `${day} ${h}:00 ${isLocal ? 'local' : 'UTC'} — ${Math.round(ratio).toLocaleString()} viewers/streamer`;
      html += `<div class="cell${isBest ? ' best' : ''}" data-level="${level}" data-tip="${tip}"></div>`;
    }
  });
  grid.innerHTML = html;
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
