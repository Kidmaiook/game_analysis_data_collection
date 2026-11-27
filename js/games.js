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
  renderFormulas();
  bindControls();
  GRDownload.attach(document.querySelector('#modalBackdrop .modal'), {
    title: () => t('games.dl_title', { game: modalGame ? modalGame.game : '' }),
    subtitle: () => (modalMode === 'local' ? t('common.local') : 'UTC'),
    png: modalBoardPng,
    csv: modalBoardCsv,
  });

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
  if (currentGenres.size === 0) label.textContent = t('games.all_genres');
  else if (currentGenres.size === 1) label.textContent = [...currentGenres][0];
  else label.textContent = t('games.genres_n', { n: currentGenres.size });
}

/* Splits a search string on whitespace into separate OR terms, e.g.
   "dota valorant" -> ["dota", "valorant"], so several games can be
   compared side by side at once. Full game names picked from the dropdown
   are kept together as one phrase (e.g. "Dota 2") instead of being split. */
let pickedGames = [];
function searchTerms() {
  let text = currentSearch.toLowerCase();
  const terms = [];
  pickedGames.slice().sort((a, b) => b.length - a.length).forEach(name => {
    const n = name.toLowerCase();
    if (text.includes(n)) { terms.push(n); text = text.replace(n, ' '); }
  });
  return terms.concat(text.trim().split(/\s+/).filter(Boolean));
}

function filteredSortedGames() {
  const terms = searchTerms();
  let games = DATA.games.filter(g => {
    if (terms.length) {
      const name = g.game.toLowerCase();
      if (!terms.some(term => name.includes(term))) return false;
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
    const tags = (g.genres || []).slice(0, 3).map(tg => `<span class="tag">${tg}</span>`).join('');
    const priceTag = g.free ? `<span class="tag">${t('games.card.free')}</span>` : (g.price != null ? `<span class="tag">$${(g.price / 100).toFixed(2)}</span>` : '');
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
        <div><span class="k">${t('games.card.avg')}</span><br><span class="v">${fmt(Math.round(g.avg_viewers))}</span></div>
        <div><span class="k">${t('games.card.per')}</span><br><span class="v">${fmt(Math.round(g.viewers_per_streamer))}</span></div>
        <div><span class="k">${t('games.card.growth')}</span><br><span class="v">${growthSign}${g.growth_pct}%</span></div>
        <div><span class="k">${t('games.card.slot')}</span><br><span class="v">${g.best_day_utc ? dayShortLabel(g.best_day_utc) : '—'} ${g.best_hour_utc != null ? g.best_hour_utc + ':00' : ''}</span></div>
      </div>
      <div class="confidence-note">${t('games.card.based_on', { samples: fmt(g.samples), streamers: fmt(g.unique_streamers_seen) })}</div>
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
    ? t('games.modal.sub', { desc: g.review_score_desc, reviews: g.total_reviews ? t('games.modal.reviews', { n: fmt(g.total_reviews) }) : '' })
    : t('games.modal.unmatched');

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
  const clockLabel = isLocal ? `(${t('common.local')})` : '(UTC)';

  const stats = [
    [t('games.modal.opportunity'), g.opportunity_score.toFixed(0)],
    [t('games.modal.avg'), fmt(Math.round(g.avg_viewers))],
    [t('games.modal.per'), fmt(Math.round(g.viewers_per_streamer))],
    [t('games.modal.growth'), `${g.growth_pct > 0 ? '+' : ''}${g.growth_pct}%`],
    [t('games.modal.best_day', { clock: clockLabel }), bestDay ? dayLabel(bestDay) : '—'],
    [t('games.modal.best_hour', { clock: clockLabel }), bestHour != null ? `${bestHour}:00` : '—'],
  ];
  document.getElementById('modalStats').innerHTML = stats.map(([k, v]) => `
    <div class="modal-stat"><div class="k">${k}</div><div class="v">${v}</div></div>
  `).join('');

  const dayVals = DAY_ORDER.map(d => (byDay && byDay[d]) || 0);
  const maxDay = Math.max(...dayVals, 1);
  document.getElementById('modalDayBoard').innerHTML = DAY_ORDER.map(d => {
    const v = (byDay && byDay[d]) || 0;
    const level = Math.min(5, Math.ceil((v / maxDay) * 5));
    return `<div class="mini-cell" data-level="${level}" style="background:${heatColor(level)}"><span class="d">${dayShortLabel(d)}</span>${v ? fmt(Math.round(v)) : '—'}</div>`;
  }).join('');
}

function closeModal() {
  document.getElementById('modalBackdrop').classList.remove('open');
  history.replaceState(null, '', 'games.html');
}

function bindControls() {
  const searchInput = document.getElementById('searchInput');
  const suggestions = document.getElementById('gameSearchSuggestions');
  const escHtml = str => str.replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
  /* The dropdown works on the word currently being typed: every time a space
     is typed, the dropdown starts over for the next word. Choosing a game
     replaces just that word and leaves a trailing space so the next one can
     be typed straight away. */
  function currentToken() {
    const v = searchInput.value;
    const m = v.match(/(\S*)$/);
    return { token: m ? m[1] : '', start: m ? v.length - m[1].length : v.length };
  }
  function updateGameSuggestions() {
    const { token } = currentToken();
    const query = token.toLowerCase();
    if (!query) { suggestions.hidden = true; suggestions.innerHTML = ''; return; }
    const matches = DATA.games
      .filter(g => g.game.toLowerCase().includes(query))
      .sort((a, b) => {
        const rank = g => { const n = g.game.toLowerCase();
          return n.startsWith(query) ? 0 : n.split(/\s+/).some(w => w.startsWith(query)) ? 1 : 2; };
        return rank(a) - rank(b) || a.game.localeCompare(b.game);
      }).slice(0, 8);
    suggestions.innerHTML = matches.map(g =>
      `<button type="button" class="game-search-option" role="option" data-game="${encodeURIComponent(g.game)}">${escHtml(g.game)}</button>`
    ).join('');
    suggestions.hidden = matches.length === 0;
    suggestions.querySelectorAll('.game-search-option').forEach(btn => btn.addEventListener('click', () => {
      const name = decodeURIComponent(btn.dataset.game);
      const { start } = currentToken();
      searchInput.value = searchInput.value.slice(0, start) + name + ' ';
      if (!pickedGames.includes(name)) pickedGames.push(name);
      currentSearch = searchInput.value;
      suggestions.hidden = true;
      searchInput.focus();
      renderGames();
    }));
  }
  searchInput.addEventListener('input', e => {
    currentSearch = e.target.value;
    pickedGames = pickedGames.filter(n => currentSearch.toLowerCase().includes(n.toLowerCase()));
    updateGameSuggestions();
    renderGames();
  });
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') suggestions.hidden = true;
    if (e.key === 'Enter' && !suggestions.hidden) {
      const first = suggestions.querySelector('.game-search-option');
      if (first) { e.preventDefault(); first.click(); }
    }
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.game-search-wrap')) suggestions.hidden = true;
  });
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


/* ---------------- Score formulas, with the real numbers behind them ---------------- */
function renderFormulas() {
  const M = DATA.methodology || {};
  const opp = M.opportunity || {};
  const pot = M.potential || {};
  const nf = (v, d = 0) => localeNumber(v, { maximumFractionDigits: d, minimumFractionDigits: d });
  const host = document.getElementById('oppFormula');
  if (host && opp.components) {
    const label = { audience: t('games.how_a'), saturation: t('games.how_s'), growth: t('games.how_g') };
    const rows = opp.components.map(c => `<tr><td>${label[c.key]}</td><td class="mono">${Math.round(c.weight * 100)}%</td>
      <td class="mono">${nf(c.zero_at, c.key === 'growth' ? 1 : 0)}${c.key === 'growth' ? '%' : ''}</td>
      <td class="mono">${nf(c.full_at, c.key === 'growth' ? 1 : 0)}${c.key === 'growth' ? '%' : ''}</td></tr>`).join('');
    const ex = opp.example;
    const exLabel = { audience: t('games.how_ex_a'), saturation: t('games.how_ex_s'), growth: t('games.how_ex_g') };
    let exHtml = '';
    if (ex) {
      const exRows = ex.components.map(c => `<tr><td>${exLabel[c.key]}</td>
        <td class="mono">${nf(c.value, c.key === 'growth' ? 1 : 0)}${c.key === 'growth' ? '%' : ''}</td>
        <td class="mono">${nf(c.norm, 3)}</td><td class="mono">${nf(c.points, 2)}</td></tr>`).join('');
      exHtml = `<h4>${t('games.how_ex_h', { game: ex.game })}</h4>
        <div class="table-scroll"><table class="formula-table"><thead><tr><th>${t('games.how_ex_col_comp')}</th><th>${t('games.how_ex_col_value')}</th><th>${t('games.how_ex_col_score')}</th><th>${t('games.how_ex_col_pts')}</th></tr></thead>
        <tbody>${exRows}<tr class="sum"><td colspan="3">${t('games.how_ex_sum')}</td><td class="mono">${nf(ex.raw_score, 2)}</td></tr></tbody></table></div>
        <p class="mono formula-line">${t('games.how_ex_m', { n: ex.unique_streamers, n1: ex.unique_streamers + 1, m: nf(ex.multiplier, 3) })}</p>
        <p class="mono formula-line"><strong>${t('games.how_ex_final', { raw: nf(ex.raw_score, 2), m: nf(ex.multiplier, 3), final: nf(ex.final, 1) })}</strong></p>`;
    }
    host.innerHTML = `
      <p>${t('games.how_lead', { n: opp.n_games })}</p>
      <h4>${t('games.how_formula_h')}</h4>
      <p class="mono formula-line"><strong>${t('games.how_formula')}</strong></p>
      <h4>${t('games.how_comp_h')}</h4>
      <div class="table-scroll"><table class="formula-table"><thead><tr><th>${t('games.how_col_comp')}</th><th>${t('games.how_col_weight')}</th><th>${t('games.how_col_zero')}</th><th>${t('games.how_col_full')}</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="mono formula-line">${t('games.how_norm')}</p>
      <h4>${t('games.how_m_h')}</h4>
      <p>${t('games.how_m')}</p>
      ${exHtml}
      <h4>${t('games.how_colors_h')}</h4>
      <div class="score-legend">
        <span class="score-legend-item"><span class="dot" style="background:var(--cue)"></span> ${t('games.how_c1')}</span>
        <span class="score-legend-item"><span class="dot" style="background:var(--amber)"></span> ${t('games.how_c2')}</span>
        <span class="score-legend-item"><span class="dot" style="background:var(--tally)"></span> ${t('games.how_c3')}</span>
      </div>
      <p>${t('games.how_board')}</p>`;
  }
  const potHost = document.getElementById('potFormula');
  if (potHost && pot.rows) potHost.innerHTML = potentialFormulaHtml(pot);
}

/* ---- exporters for the modal's mini day board ---- */
function modalBoardCsv() {
  const g = modalGame;
  const byDay = modalMode === 'local' ? g.by_day_local : g.by_day_utc;
  return [['day', 'avg_viewers', 'clock'], ...DAY_ORDER.map(d => [d, (byDay && byDay[d]) || '', modalMode === 'local' ? 'local' : 'UTC'])];
}
async function modalBoardPng({ title, subtitle }) {
  const g = modalGame;
  const byDay = modalMode === 'local' ? g.by_day_local : g.by_day_utc;
  const vals = DAY_ORDER.map(d => (byDay && byDay[d]) || 0);
  const maxDay = Math.max(...vals, 1);
  const panel = GRDownload.cssVar('--panel', '#192124');
  const text = GRDownload.cssVar('--text', '#ECEEE9');
  const dim = GRDownload.cssVar('--text-dim', '#8B9A9B');
  const W = 640, H = 230, scale = 2, cw = 76, gap = 8, left = 24;
  const canvas = document.createElement('canvas');
  canvas.width = W * scale; canvas.height = H * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = panel; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = text; ctx.font = '700 22px sans-serif'; ctx.fillText(title, 24, 38);
  ctx.fillStyle = dim; ctx.font = '14px monospace'; ctx.fillText(subtitle, 24, 62);
  DAY_ORDER.forEach((d, i) => {
    const level = Math.min(5, Math.ceil((vals[i] / maxDay) * 5));
    const x = left + i * (cw + gap);
    ctx.fillStyle = vals[i] ? heatColor(level) : (document.documentElement.getAttribute('data-theme') === 'light' ? '#F1F5F9' : 'rgba(128,140,142,0.18)');
    ctx.fillRect(x, 90, cw, 80);
    ctx.fillStyle = text; ctx.font = '12px monospace'; ctx.fillText(dayShortLabel(d), x + 8, 110);
    ctx.font = '700 14px monospace'; ctx.fillText(vals[i] ? fmt(Math.round(vals[i])) : '\u2014', x + 8, 150);
  });
  ctx.fillStyle = dim; ctx.font = '12px monospace';
  ctx.fillText('Green Room \u00b7 PSU Phuket \u00b7 ' + new Date().toISOString().slice(0, 10), 24, H - 18);
  return new Promise(res => canvas.toBlob(res, 'image/png'));
}
