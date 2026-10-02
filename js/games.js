let DATA = null;
let currentSort = 'opportunity_score';
let currentSearch = '';
let currentGenres = new Set();
let currentPrice = '';
let modalMode = 'utc';
let modalGame = null;

DataStore.data().then(d => {
  DATA = d;
  renderLatestUpdate(DATA);

  populateGenreFilter();
  renderGames();
  bindControls();

  const params = new URLSearchParams(location.search);
  const preselect = params.get('g');
  if (preselect) openModal(preselect);
});

function populateGenreFilter() {
  const genres = new Set();
  DATA.games.forEach(g => (g.genres || []).forEach(x => genres.add(x)));
  const optionsWrap = document.getElementById('genreOptions');
  optionsWrap.innerHTML = [...genres].sort().map(g => `
    <label class="checklist-option">
      <input type="checkbox" value="${g}"> <span>${g}</span>
    </label>
  `).join('');
  updateGenreToggleLabel();
}

function updateGenreToggleLabel() {
  const label = document.getElementById('genreToggleLabel');
  if (currentGenres.size === 0) label.textContent = 'All genres';
  else if (currentGenres.size === 1) label.textContent = [...currentGenres][0];
  else label.textContent = `${currentGenres.size} genres selected`;
}

/* Splits a search string on whitespace into separate OR terms, e.g.
   "dota valorant" -> ["dota", "valorant"], so several games can be
   compared side by side at once. */
function searchTerms() {
  return currentSearch.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function filteredSortedGames() {
  const terms = searchTerms();
  let games = DATA.games.filter(g => {
    if (terms.length) {
      const name = g.game.toLowerCase();
      if (!terms.some(t => name.includes(t))) return false;
    }
    if (currentGenres.size && !(g.genres || []).some(x => currentGenres.has(x))) return false;
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
        <div><span class="k">Best slot (UTC)</span><br><span class="v">${g.best_day_utc ? DAY_SHORT[g.best_day_utc] : '—'} ${g.best_hour_utc != null ? g.best_hour_utc + ':00' : ''}</span></div>
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
  modalGame = g;
  modalMode = 'utc';
  document.querySelectorAll('#modalModeToggle button').forEach(b => b.classList.toggle('active', b.dataset.mode === 'utc'));

  document.getElementById('modalTitle').textContent = g.game;
  document.getElementById('modalSub').textContent = g.review_score_desc
    ? `${g.review_score_desc} on Steam${g.total_reviews ? ` · ${g.total_reviews.toLocaleString()} reviews` : ''}`
    : `Not matched to a Steam catalog entry (may be an event, IRL category, or newly released title).`;

  renderModalStats();
  document.getElementById('modalBackdrop').classList.add('open');
  history.replaceState(null, '', `games.html?g=${encodeURIComponent(gameName)}`);
}

function renderModalStats() {
  const g = modalGame;
  const isLocal = modalMode === 'local';
  const bestDay = isLocal ? g.best_day_local : g.best_day_utc;
  const bestHour = isLocal ? g.best_hour_local : g.best_hour_utc;
  const byDay = isLocal ? g.by_day_local : g.by_day_utc;
  const clockLabel = isLocal ? '(local)' : '(UTC)';

  const stats = [
    ['Opportunity', g.opportunity_score.toFixed(0)],
    ['Avg viewers', Math.round(g.avg_viewers).toLocaleString()],
    ['Viewers / streamer', Math.round(g.viewers_per_streamer).toLocaleString()],
    ['Growth', `${g.growth_pct > 0 ? '+' : ''}${g.growth_pct}%`],
    [`Best day ${clockLabel}`, bestDay || '—'],
    [`Best hour ${clockLabel}`, bestHour != null ? `${bestHour}:00` : '—'],
  ];
  document.getElementById('modalStats').innerHTML = stats.map(([k, v]) => `
    <div class="modal-stat"><div class="k">${k}</div><div class="v">${v}</div></div>
  `).join('');

  const dayVals = DAY_ORDER.map(d => (byDay && byDay[d]) || 0);
  const maxDay = Math.max(...dayVals, 1);
  document.getElementById('modalDayBoard').innerHTML = DAY_ORDER.map(d => {
    const v = (byDay && byDay[d]) || 0;
    const level = Math.min(5, Math.ceil((v / maxDay) * 5));
    return `<div class="mini-cell" style="background:${heatColor(level)}"><span class="d">${DAY_SHORT[d]}</span>${v ? Math.round(v).toLocaleString() : '—'}</div>`;
  }).join('');
}

function closeModal() {
  document.getElementById('modalBackdrop').classList.remove('open');
  history.replaceState(null, '', 'games.html');
}

function bindControls() {
  document.getElementById('searchInput').addEventListener('input', e => { currentSearch = e.target.value; renderGames(); });
  document.getElementById('priceSelect').addEventListener('change', e => { currentPrice = e.target.value; renderGames(); });

  const dropdown = document.getElementById('genreDropdown');
  const toggle = document.getElementById('genreToggle');
  const panel = document.getElementById('genrePanel');
  toggle.addEventListener('click', () => dropdown.classList.toggle('open'));
  document.addEventListener('click', e => { if (!dropdown.contains(e.target)) dropdown.classList.remove('open'); });
  panel.addEventListener('change', e => {
    if (e.target.type !== 'checkbox') return;
    if (e.target.checked) currentGenres.add(e.target.value);
    else currentGenres.delete(e.target.value);
    updateGenreToggleLabel();
    renderGames();
  });
  document.getElementById('genreClearBtn').addEventListener('click', () => {
    currentGenres.clear();
    panel.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
    updateGenreToggleLabel();
    renderGames();
  });
  document.getElementById('genreAllBtn').addEventListener('click', () => {
    panel.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = true; currentGenres.add(cb.value); });
    updateGenreToggleLabel();
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
  document.querySelectorAll('#modalModeToggle button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#modalModeToggle button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      modalMode = btn.dataset.mode;
      renderModalStats();
    });
  });
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('modalBackdrop').addEventListener('click', e => { if (e.target.id === 'modalBackdrop') closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
}
