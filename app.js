const DAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_SHORT = { Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun' };

let DATA = null;
let currentSort = 'opportunity_score';
let currentSearch = '';
let currentGenre = '';
let currentPrice = '';

async function loadData() {
  try {
    const res = await fetch('data.json');
    if (!res.ok) throw new Error('bad response');
    DATA = await res.json();
    init();
  } catch (err) {
    document.getElementById('topbarMeta').textContent = 'could not load data.json';
    document.body.innerHTML = `<div class="wrap" style="padding-top:80px">
      <h1 style="font-family:'Space Grotesk',sans-serif">data.json didn't load</h1>
      <p style="color:#8B9A9B;max-width:60ch">Browsers block local file:// pages from fetching other local files.
      Serve this folder instead, e.g. from a terminal in this directory run:</p>
      <p class="mono" style="background:#192124;padding:12px 16px;border-radius:8px;display:inline-block">python3 -m http.server 8000</p>
      <p style="color:#8B9A9B">then open <span class="mono">http://localhost:8000</span>.</p>
    </div>`;
  }
}

function init() {
  const months = DATA.meta.months_covered || [];
  document.getElementById('topbarMeta').textContent =
    `${months[0] || '?'} \u2192 ${months[months.length - 1] || '?'}`;
  document.getElementById('footerMonths').textContent = months.join(', ');

  renderReadouts();
  renderOnAir();
  renderBoard();
  populateGenreFilter();
  renderGames();
  bindControls();
}

function renderReadouts() {
  const m = DATA.meta;
  const items = [
    [fmt(m.total_games_tracked), 'Games tracked'],
    [fmt(m.total_games_with_recommendations), 'With enough data to rank'],
    [fmt(m.total_streamers_seen), 'Distinct streamers seen'],
    [fmt(m.total_twitch_snapshots), 'Twitch snapshots analyzed'],
  ];
  const el = document.getElementById('readouts');
  el.innerHTML = items.map(([num, label]) => `
    <div class="readout"><div class="num">${num}</div><div class="label">${label}</div></div>
  `).join('');
}

function fmt(n) {
  if (n === undefined || n === null) return '—';
  return n.toLocaleString();
}

/* ---------------- On-air-now readout ---------------- */
function renderOnAir() {
  const sched = DATA.schedule || {};
  const now = new Date();
  const utcHour = now.getUTCHours();
  // JS getUTCDay(): 0=Sunday..6=Saturday. Convert to our Monday-first order.
  const jsDay = now.getUTCDay();
  const dayName = DAY_ORDER[(jsDay + 6) % 7];

  const cell = (sched.heatmap || []).find(h => h.day === dayName && h.hour === utcHour);
  const ratio = cell ? cell.ratio : (sched.by_hour ? sched.by_hour[utcHour] : null);

  const allRatios = (sched.heatmap || []).map(h => h.ratio).filter(v => typeof v === 'number');
  let pct = 0.5, tag = 'mid', tagLabel = 'MODERATE';
  if (allRatios.length && ratio != null) {
    const sorted = [...allRatios].sort((a, b) => a - b);
    const rank = sorted.filter(v => v <= ratio).length / sorted.length;
    pct = rank;
    if (rank > 0.66) { tag = 'good'; tagLabel = 'WIDE OPEN'; }
    else if (rank > 0.33) { tag = 'mid'; tagLabel = 'MODERATE'; }
    else { tag = 'low'; tagLabel = 'CROWDED'; }
  }

  document.getElementById('onairTag').textContent = tagLabel;
  document.getElementById('onairTag').className = 'onair-tag mono ' + tag;
  document.getElementById('onairTime').textContent =
    `${dayName.toUpperCase()} · ${String(utcHour).padStart(2, '0')}:00 UTC (your local time now)`;

  const verdictMap = {
    good: "It's a good time to go live.",
    mid: "An okay time to go live.",
    low: "A crowded time to go live.",
  };
  document.getElementById('onairVerdict').textContent = verdictMap[tag];
  document.getElementById('onairDetail').textContent = ratio != null
    ? `Historically, streamers active right now average about ${Math.round(ratio).toLocaleString()} viewers each for every concurrent streamer in this slot.`
    : `Not enough snapshots at this exact hour — check the signal board below for the closest well-covered slot.`;
  document.getElementById('onairBar').style.width = `${Math.round(pct * 100)}%`;
}

/* ---------------- Signal board (day x hour heatmap) ---------------- */
function renderBoard() {
  const sched = DATA.schedule || {};
  document.getElementById('bestDayOverall').textContent = sched.best_day_overall || '—';
  document.getElementById('bestHourOverall').textContent =
    sched.best_hour_overall != null ? `${String(sched.best_hour_overall).padStart(2, '0')}:00` : '—';

  const heatmap = sched.heatmap || [];
  const lookup = {};
  let max = 0;
  heatmap.forEach(h => {
    lookup[`${h.day}|${h.hour}`] = h.ratio;
    if (h.ratio > max) max = h.ratio;
  });

  const grid = document.getElementById('boardGrid');
  let html = `<div></div>`;
  for (let h = 0; h < 24; h++) {
    html += `<div class="board-hourlabel">${h % 3 === 0 ? h : ''}</div>`;
  }
  DAY_ORDER.forEach(day => {
    html += `<div class="board-daylabel">${DAY_SHORT[day]}</div>`;
    for (let h = 0; h < 24; h++) {
      const ratio = lookup[`${day}|${h}`];
      const level = ratio == null ? '' : Math.min(5, Math.ceil((ratio / (max || 1)) * 5));
      const isBest = day === sched.best_day_overall && h === sched.best_hour_overall;
      const tip = ratio == null ? `${day} ${h}:00 — no data` : `${day} ${h}:00 UTC — ${Math.round(ratio).toLocaleString()} viewers/streamer`;
      html += `<div class="cell${isBest ? ' best' : ''}" data-level="${level}" data-tip="${tip}"></div>`;
    }
  });
  grid.innerHTML = html;
}

/* ---------------- Game grid ---------------- */
function populateGenreFilter() {
  const genres = new Set();
  DATA.games.forEach(g => (g.genres || []).forEach(x => genres.add(x)));
  const select = document.getElementById('genreSelect');
  [...genres].sort().forEach(g => {
    const opt = document.createElement('option');
    opt.value = g; opt.textContent = g;
    select.appendChild(opt);
  });
}

function scoreColor(score) {
  if (score >= 66) return 'var(--cue)';
  if (score >= 33) return 'var(--amber)';
  return 'var(--tally)';
}

function filteredSortedGames() {
  let games = DATA.games.filter(g => {
    if (currentSearch && !g.game.toLowerCase().includes(currentSearch.toLowerCase())) return false;
    if (currentGenre && !(g.genres || []).includes(currentGenre)) return false;
    if (currentPrice === 'free' && !g.free) return false;
    if (currentPrice === 'paid' && (g.free || g.free === undefined)) return false;
    return true;
  });
  games.sort((a, b) => (b[currentSort] ?? -Infinity) - (a[currentSort] ?? -Infinity));
  return games;
}

function renderGames() {
  const games = filteredSortedGames();
  const grid = document.getElementById('gameGrid');
  const empty = document.getElementById('emptyState');
  if (!games.length) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  grid.innerHTML = games.slice(0, 60).map(g => {
    const tags = (g.genres || []).slice(0, 3).map(t => `<span class="tag">${t}</span>`).join('');
    const priceTag = g.free ? `<span class="tag">Free</span>` : (g.price != null ? `<span class="tag">$${(g.price / 100).toFixed(2)}</span>` : '');
    const growthSign = g.growth_pct > 0 ? '+' : '';
    return `
    <div class="card" data-game="${encodeURIComponent(g.game)}">
      <div class="card-top">
        <div class="card-title">${g.game}</div>
        <div class="card-score mono" style="color:${scoreColor(g.opportunity_score)}">${g.opportunity_score.toFixed(0)}</div>
      </div>
      <div class="card-meter"><div class="card-meter-fill" style="width:${g.opportunity_score}%;background:${scoreColor(g.opportunity_score)}"></div></div>
      <div class="card-tags">${priceTag}${tags}</div>
      <div class="card-stats">
        <div><span class="k">Avg viewers</span><br><span class="v">${Math.round(g.avg_viewers).toLocaleString()}</span></div>
        <div><span class="k">Per streamer</span><br><span class="v">${Math.round(g.viewers_per_streamer).toLocaleString()}</span></div>
        <div><span class="k">Growth</span><br><span class="v">${growthSign}${g.growth_pct}%</span></div>
        <div><span class="k">Best slot</span><br><span class="v">${g.best_day ? DAY_SHORT[g.best_day] : '—'} ${g.best_hour != null ? g.best_hour + ':00' : ''}</span></div>
      </div>
      <div class="confidence-note">Based on ${g.samples} snapshots across ${g.unique_streamers_seen} streamers.</div>
    </div>`;
  }).join('');

  grid.querySelectorAll('.card').forEach(card => {
    card.addEventListener('click', () => openModal(decodeURIComponent(card.dataset.game)));
  });
}

/* ---------------- Modal ---------------- */
function openModal(gameName) {
  const g = DATA.games.find(x => x.game === gameName);
  if (!g) return;
  document.getElementById('modalTitle').textContent = g.game;
  document.getElementById('modalSub').textContent = g.review_score_desc
    ? `${g.review_score_desc} on Steam${g.total_reviews ? ` · ${g.total_reviews.toLocaleString()} reviews` : ''}`
    : `Not matched to a Steam catalog entry (may be an event, IRL category, or newly released title).`;

  const stats = [
    ['Opportunity', g.opportunity_score.toFixed(0)],
    ['Avg viewers', Math.round(g.avg_viewers).toLocaleString()],
    ['Viewers / streamer', Math.round(g.viewers_per_streamer).toLocaleString()],
    ['Growth', `${g.growth_pct > 0 ? '+' : ''}${g.growth_pct}%`],
    ['Best day', g.best_day || '—'],
    ['Best hour (UTC)', g.best_hour != null ? `${g.best_hour}:00` : '—'],
  ];
  document.getElementById('modalStats').innerHTML = stats.map(([k, v]) => `
    <div class="modal-stat"><div class="k">${k}</div><div class="v">${v}</div></div>
  `).join('');

  const dayVals = DAY_ORDER.map(d => g.by_day && g.by_day[d] || 0);
  const maxDay = Math.max(...dayVals, 1);
  document.getElementById('modalDayBoard').innerHTML = DAY_ORDER.map(d => {
    const v = (g.by_day && g.by_day[d]) || 0;
    const level = Math.min(5, Math.ceil((v / maxDay) * 5));
    const bg = ['#1B2426', '#1E3B33', '#235544', '#2B7358', '#38A874', '#63D9A0'][level];
    return `<div class="mini-cell" style="background:${bg}"><span class="d">${DAY_SHORT[d]}</span>${v ? Math.round(v).toLocaleString() : '—'}</div>`;
  }).join('');

  document.getElementById('modalBackdrop').classList.add('open');
}

function closeModal() {
  document.getElementById('modalBackdrop').classList.remove('open');
}

/* ---------------- Controls ---------------- */
function bindControls() {
  document.getElementById('searchInput').addEventListener('input', e => {
    currentSearch = e.target.value;
    renderGames();
  });
  document.getElementById('genreSelect').addEventListener('change', e => {
    currentGenre = e.target.value;
    renderGames();
  });
  document.getElementById('priceSelect').addEventListener('change', e => {
    currentPrice = e.target.value;
    renderGames();
  });
  document.querySelectorAll('.sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentSort = btn.dataset.sort;
      renderGames();
    });
  });
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('modalBackdrop').addEventListener('click', e => {
    if (e.target.id === 'modalBackdrop') closeModal();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
}

loadData();