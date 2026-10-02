const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ALL_VALUE = 'ALL';
const DAY_ORDER_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

let INSIGHTS = null;
let currentPeriod = 'GLOBAL';
let currentYear = ALL_VALUE;
let currentMonth = ALL_VALUE;
let currentWeek = ALL_VALUE;
let currentDay = ALL_VALUE;
let periodsParsed = []; // [{year:'2026', month:'07', key:'2026-07'}, ...]
let currentTimezone = 'standardized';
let currentCountry = 'ALL';
let q4ViewMode = 'stacked'; // 'simple' | 'stacked'
let q6ViewMode = 'stacked'; // 'stacked' | 'pie'
let distScaleMode = 'linear'; // 'linear' | 'log10'
let selectedGame = null; // cross-chart game filter, set by clicking any game element

Promise.all([DataStore.data(), DataStore.insights()]).then(([DATA, insights]) => {
  INSIGHTS = insights;
  renderLatestUpdate(insights);

  periodsParsed = INSIGHTS.periods
    .filter(p => p !== 'GLOBAL')
    .map(p => ({ year: p.split('-')[0], month: p.split('-')[1], key: p }));

  // Default is global/global, i.e. all months across all years.
  currentYear = ALL_VALUE;
  currentMonth = ALL_VALUE;
  currentWeek = ALL_VALUE;
  currentDay = ALL_VALUE;
  currentPeriod = 'GLOBAL';

  renderYearSelect();
  renderMonthSelect();
  renderWeekSelect();
  renderDaySelect();
  bindPeriodControls();
  renderCountrySelect();
  bindTimingControls();
  renderBlocks();
});

function years() {
  return [...new Set(periodsParsed.map(p => p.year))].sort();
}

function monthsForYear(year) {
  const pool = year === ALL_VALUE ? periodsParsed : periodsParsed.filter(p => p.year === year);
  return [...new Set(pool.map(p => p.month))].sort();
}

function renderYearSelect() {
  const select = document.getElementById('yearSelect');
  select.innerHTML = `<option value="${ALL_VALUE}">All years</option>` +
    years().map(y => `<option value="${y}">${y}</option>`).join('');
  select.value = currentYear;
}

function renderMonthSelect() {
  const select = document.getElementById('monthSelect');
  const opts = monthsForYear(currentYear);
  select.innerHTML = `<option value="${ALL_VALUE}">All months</option>` +
    opts.map(m => `<option value="${m}">${MONTH_NAMES[parseInt(m, 10) - 1] || m}</option>`).join('');
  select.value = opts.includes(currentMonth) ? currentMonth : ALL_VALUE;
  currentMonth = select.value;
}

/* Week options come from whichever weeks actually have chart_data for the
   resolved period (currentPeriod, which Month/Year resolve to). Disabled
   entirely when no specific month is in view (Global spans many months, so
   "week 2" would be ambiguous). */
function weeksForCurrentPeriod() {
  if (currentPeriod === 'GLOBAL') return [];
  const periodData = (INSIGHTS.chart_data && INSIGHTS.chart_data[currentPeriod]) || {};
  return Object.keys(periodData.weeks || {}).sort((a, b) => +a - +b);
}

function daysInCurrentMonth() {
  return (INSIGHTS.days_in_month && INSIGHTS.days_in_month[currentPeriod]) || 31;
}

function renderWeekSelect() {
  const select = document.getElementById('weekSelect');
  const weeks = weeksForCurrentPeriod();
  const disabled = currentPeriod === 'GLOBAL';
  select.disabled = disabled;
  select.innerHTML = `<option value="${ALL_VALUE}">All weeks</option>` +
    weeks.map(w => {
      const startDay = (+w - 1) * 7 + 1;
      const endDay = Math.min(+w * 7, daysInCurrentMonth());
      return `<option value="${w}">Week ${w} (days ${startDay}\u2013${endDay})</option>`;
    }).join('');
  select.value = weeks.includes(currentWeek) ? currentWeek : ALL_VALUE;
  currentWeek = select.value;
}

/* Per the spec: if no week is chosen, Day lists every day 1..last-day-of-
   month. If a week IS chosen, Day narrows to just that week's days. */
function renderDaySelect() {
  const select = document.getElementById('daySelect');
  const disabled = currentPeriod === 'GLOBAL';
  select.disabled = disabled;

  let dayNumbers;
  if (disabled) {
    dayNumbers = [];
  } else if (currentWeek !== ALL_VALUE) {
    const startDay = (+currentWeek - 1) * 7 + 1;
    const endDay = Math.min(+currentWeek * 7, daysInCurrentMonth());
    dayNumbers = Array.from({ length: endDay - startDay + 1 }, (_, i) => startDay + i);
  } else {
    dayNumbers = Array.from({ length: daysInCurrentMonth() }, (_, i) => i + 1);
  }

  select.innerHTML = `<option value="${ALL_VALUE}">All days</option>` +
    dayNumbers.map(d => `<option value="${String(d).padStart(2, '0')}">Day ${d}</option>`).join('');
  const dayVals = dayNumbers.map(d => String(d).padStart(2, '0'));
  select.value = dayVals.includes(currentDay) ? currentDay : ALL_VALUE;
  currentDay = select.value;
}

/* Resolves the (year, month) dropdown selection to an actual period key
   present in insights.json, falling back sensibly if that exact combo
   isn't tracked (e.g. only one side of the pair was narrowed down). This
   keeps working the same way even once the dataset spans more years/months. */
function resolvePeriod() {
  if (currentYear === ALL_VALUE && currentMonth === ALL_VALUE) return 'GLOBAL';

  if (currentYear !== ALL_VALUE && currentMonth !== ALL_VALUE) {
    const exact = periodsParsed.find(p => p.year === currentYear && p.month === currentMonth);
    if (exact) return exact.key;
  }
  if (currentYear !== ALL_VALUE && currentMonth === ALL_VALUE) {
    const matches = periodsParsed.filter(p => p.year === currentYear).sort((a, b) => b.month.localeCompare(a.month));
    if (matches.length) return matches[0].key;
  }
  if (currentYear === ALL_VALUE && currentMonth !== ALL_VALUE) {
    const matches = periodsParsed.filter(p => p.month === currentMonth).sort((a, b) => b.year.localeCompare(a.year));
    if (matches.length) return matches[0].key;
  }
  return 'GLOBAL';
}

function bindPeriodControls() {
  document.getElementById('yearSelect').addEventListener('change', e => {
    currentYear = e.target.value;
    renderMonthSelect();
    currentPeriod = resolvePeriod();
    currentWeek = ALL_VALUE;
    currentDay = ALL_VALUE;
    renderWeekSelect();
    renderDaySelect();
    renderBlocks();
  });
  document.getElementById('monthSelect').addEventListener('change', e => {
    currentMonth = e.target.value;
    currentPeriod = resolvePeriod();
    currentWeek = ALL_VALUE;
    currentDay = ALL_VALUE;
    renderWeekSelect();
    renderDaySelect();
    renderBlocks();
  });
  document.getElementById('weekSelect').addEventListener('change', e => {
    currentWeek = e.target.value;
    currentDay = ALL_VALUE;
    renderDaySelect();
    renderBlocks();
  });
  document.getElementById('daySelect').addEventListener('change', e => {
    currentDay = e.target.value;
    // Picking an exact day that falls outside the current week selection
    // (or with week left on "All") is fine either way -- just make sure
    // the week dropdown doesn't silently disagree with it.
    if (currentDay !== ALL_VALUE && currentWeek !== ALL_VALUE) {
      const dayNum = parseInt(currentDay, 10);
      const startDay = (+currentWeek - 1) * 7 + 1;
      const endDay = Math.min(+currentWeek * 7, daysInCurrentMonth());
      if (dayNum < startDay || dayNum > endDay) currentWeek = ALL_VALUE;
    }
    renderWeekSelect();
    renderBlocks();
  });
}

function bindTimingControls() {
  document.getElementById('timingTimezoneSelect').addEventListener('change', e => {
    currentTimezone = e.target.value;
    renderTimingCharts();
  });
  document.getElementById('timingCountrySelect').addEventListener('change', e => {
    currentCountry = e.target.value;
    renderTimingCharts();
  });
}

function renderCountrySelect() {
  const select = document.getElementById('timingCountrySelect');
  const countries = INSIGHTS.countries || [];
  select.innerHTML = `<option value="ALL">All regions</option>` +
    countries.map(c => `<option value="${c}">${c}</option>`).join('');
  select.value = currentCountry;
}

/* ---------- Granularity resolution shared by chart_data and schedule_charts ---------- */

function currentGranularity() {
  if (currentPeriod !== 'GLOBAL' && currentDay !== ALL_VALUE) return { type: 'day', key: currentDay };
  if (currentPeriod !== 'GLOBAL' && currentWeek !== ALL_VALUE) return { type: 'week', key: currentWeek };
  return { type: 'base' };
}

function currentChartData() {
  const periodData = (INSIGHTS.chart_data && INSIGHTS.chart_data[currentPeriod]) || {};
  const g = currentGranularity();
  if (g.type === 'day') return (periodData.days || {})[g.key] || {};
  if (g.type === 'week') return (periodData.weeks || {})[g.key] || {};
  return periodData.base || {};
}

function currentPeriodLabel() {
  if (currentPeriod === 'GLOBAL') return 'all months, all years';
  const g = currentGranularity();
  if (g.type === 'day') return `${currentPeriod}-${g.key}`;
  if (g.type === 'week') return `${currentPeriod}, Week ${g.key}`;
  return currentPeriod;
}

/* ---------- Main chart blocks: q1, q2, q3, q6, q8, distribution ---------- */

function renderBlocks() {
  const label = currentPeriod === 'GLOBAL' ? 'Showing: all months, all years' : `Showing: ${currentPeriodLabel()}`;
  document.getElementById('periodCurrent').textContent = label;

  const cd = currentChartData();
  const periodLabel = currentPeriodLabel();

  document.getElementById('insightBlocksPre').innerHTML = [
    chartBlockHtml('q1', 'Steam players vs. Twitch viewers', scatterBlock(cd.q1, periodLabel)),
    chartBlockHtml('q2', 'Top games by potential score', q2Block(cd.q2, periodLabel)),
    chartBlockHtml('q3', 'What drives viewership', q3Block(cd.q3, periodLabel)),
  ].join('');

  document.getElementById('insightBlocksPost').innerHTML = [
    chartBlockHtml('q8', 'Predicting rising games', q8Block(cd.q8, periodLabel)),
    chartBlockHtml('distribution', 'Viewer count distribution', distributionBlock(cd.distribution, periodLabel)),
  ].join('');

  wireUpChartBlocks(document.getElementById('insightBlocksPre'));
  wireUpChartBlocks(document.getElementById('insightBlocksPost'));

  renderTimingCharts();
}

function chartBlockHtml(key, title, inner) {
  return `<div class="insight-block" data-chart-key="${key}">${inner.svg}
    <div>
      <h3>${title}</h3>
      <p>${inner.desc ? escapeHtml(inner.desc) : 'Not enough data at this granularity for this chart. Try a Week or the whole Month/Global view.'}</p>
    </div>
  </div>`;
}

function wireUpChartBlocks(container) {
  container.querySelectorAll('.insight-block').forEach(block => {
    initChartInteractivity(block);
    const wrap = block.querySelector('.chart-zoom-wrap');
    if (wrap) initGraphZoom(block, wrap);
  });
  container.querySelectorAll('[data-scale-toggle]').forEach(btn => {
    btn.addEventListener('click', evt => {
      evt.stopPropagation();
      distScaleMode = btn.dataset.scaleToggle;
      renderDistributionOnly();
    });
  });
  container.querySelectorAll('[data-view-toggle]').forEach(btn => {
    btn.addEventListener('click', evt => {
      evt.stopPropagation();
      const chartKey = btn.closest('.insight-block').dataset.chartKey;
      if (chartKey === 'q4') q4ViewMode = btn.dataset.viewToggle;
      if (chartKey === 'q6') q6ViewMode = btn.dataset.viewToggle;
      renderTimingCharts();
    });
  });
  container.querySelectorAll('[data-game]').forEach(el => {
    el.addEventListener('click', () => {
      const game = el.dataset.game;
      setSelectedGame(selectedGame === game ? null : game);
    });
  });
  applyGameFilter(container);
}

/* Cross-chart game filter: clicking any game element (a Q1 point, a Q2
   bar, a stacked segment, or a stacked-chart legend row) highlights that
   same game everywhere it appears on the page and dims everything else,
   so you can trace one title's footprint across every chart at once.
   Clicking the same game again (or the chip) clears it. */
function setSelectedGame(game) {
  selectedGame = game;
  const chip = document.getElementById('gameFilterChip');
  if (game) {
    chip.style.display = 'inline-flex';
    chip.innerHTML = `Filtering: <strong>${escapeHtml(game)}</strong> <span class="chip-clear">&times;</span>`;
  } else {
    chip.style.display = 'none';
    chip.innerHTML = '';
  }
  applyGameFilter(document);
}

function applyGameFilter(scope) {
  const els = scope.querySelectorAll('[data-game]');
  els.forEach(el => {
    if (!selectedGame) {
      el.style.opacity = '';
      el.classList.remove('game-filter-match');
      return;
    }
    const match = el.dataset.game === selectedGame;
    el.classList.toggle('game-filter-match', match);
    el.style.opacity = match ? '' : '0.12';
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const chip = document.getElementById('gameFilterChip');
  if (chip) chip.addEventListener('click', () => setSelectedGame(null));
});

function toggleRow(options, activeValue, attrName) {
  return `<div class="chart-toggle-row">${options.map(opt =>
    `<button type="button" class="chart-toggle-btn${opt.value === activeValue ? ' active' : ''}" data-${attrName}="${opt.value}">${opt.label}</button>`
  ).join('')}</div>`;
}

function chartWrap(svg, extra = '') {
  return `<div class="chart-zoom-wrap-outer">${extra}<div class="chart-zoom-wrap">${svg}</div></div>`;
}

function emptyChart() {
  return `<div class="empty-state">No chart for this selection.</div>`;
}

function scatterBlock(d, periodLabel) {
  if (!d || !d.points || !d.points.length) return { svg: emptyChart(), desc: null };
  const strength = Math.abs(d.r) > 0.7 ? 'strong' : Math.abs(d.r) > 0.4 ? 'moderate' : 'weak';
  const direction = d.r > 0 ? 'rise together' : 'move in opposite directions';
  const sig = d.p < 0.05 ? "a real pattern, not noise" : 'not statistically distinguishable from noise';
  const desc = `Steam player counts and Twitch viewer counts have a ${strength} relationship (r = ${d.r.toFixed(2)}) for ${periodLabel}: the two tend to ${direction}. Across ${fmt(d.n)} matched game/day snapshots, that's ${sig} (p = ${d.p < 0.0001 ? d.p.toExponential(2) : d.p.toFixed(4)}).`;
  return { svg: chartWrap(svgScatterChart(d.points)), desc };
}

function q2Block(d, periodLabel) {
  if (!d || !d.top || !d.top.length) return { svg: emptyChart(), desc: null };
  const top = d.top[0], second = d.top[1];
  const hasBottom = d.bottom && d.bottom.length;
  const worst = hasBottom ? d.bottom[d.bottom.length - 1] : null;
  const gapNote = second
    ? (top.score - second.score > 0.15
      ? ` It's clear of the next name, '${second.game}', by a real margin.`
      : ` It's only narrowly ahead of '${second.game}' \u2014 treat the top few as a tier, not a strict ranking.`)
    : '';
  const spreadNote = worst
    ? ` At the other end, '${worst.game}' sits lowest (${worst.score.toFixed(2)}) \u2014 a spread of ${(top.score - worst.score).toFixed(2)} between this period's strongest and weakest signal.`
    : '';
  const desc = `'${top.game}' is the standout for ${periodLabel}.${gapNote}${spreadNote} Potential score blends standardized (z-scored) Twitch viewers (60%) and Steam players (40%), so it can go negative \u2014 it flags titles unusually strong (or weak) relative to everything else tracked in this window, not just the biggest raw audience.`;
  const items = [
    { divider: true, label: 'Top 5' },
    ...d.top.map(g => ({ label: g.game, value: g.score, group: 'top' })),
    ...(hasBottom ? [{ divider: true, label: 'Bottom 5' }, ...d.bottom.map(g => ({ label: g.game, value: g.score, group: 'bottom' }))] : []),
  ];
  return {
    svg: chartWrap(svgHorizontalBarChart(items, {
      valueLabel: 'Potential score',
      format: v => v.toFixed(2),
      colorFor: it => it.group === 'bottom' ? 'var(--tally)' : 'var(--cue)',
      itemsAreGames: true,
    })),
    desc,
  };
}

function q3Block(d, periodLabel) {
  if (!d || !d.features || !d.features.length) return { svg: emptyChart(), desc: null };
  const top = d.features[0], second = d.features[1];
  const fit = d.r2 > 0.7 ? 'explains most of the variation' : d.r2 > 0.3 ? 'captures a real but partial pattern' : "only weakly explains what's happening";
  const desc = `A Random Forest model trained to predict viewer count leans hardest on '${top.feature}'${second ? `, with '${second.feature}' as its next-strongest signal,` : ''} for ${periodLabel}. The model ${fit} (R\u00b2 = ${d.r2.toFixed(2)}, average prediction error \u00b1${fmt(Math.round(d.mae))} viewers, n = ${fmt(d.n)}).`;
  const items = d.features.map(f => ({ label: f.feature, value: f.importance }));
  return { svg: chartWrap(svgHorizontalBarChart(items, { color: 'var(--amber)', valueLabel: 'Importance', format: v => v.toFixed(3) })), desc };
}

function q8Block(d, periodLabel) {
  if (!d || !d.metrics || !d.metrics.length) return { svg: emptyChart(), desc: null };
  const best = d.metrics.reduce((a, b) => Math.abs(b.r) > Math.abs(a.r) ? b : a);
  const verdict = best.label === 'Scoring Logic'
    ? 'backs up the scoring logic used elsewhere on this site'
    : `suggests a simpler signal ('${best.label}') actually predicts tomorrow's growth better than the built-in Potential score does`;
  const desc = `Comparing three candidate signals against each game's next-day viewer change for ${periodLabel}, '${best.label}' comes out ahead (r = ${best.r.toFixed(3)}). That ${verdict} (n = ${fmt(d.n)}).`;
  const labels = d.metrics.map(m => m.label);
  const values = d.metrics.map(m => m.r);
  const bestIdx = d.metrics.indexOf(best);
  return { svg: chartWrap(svgBarChart(labels, values, { color: 'var(--cue)', highlight: bestIdx, allowNegative: true, tipSuffix: ' correlation', axisFormat: v => v.toFixed(2) })), desc };
}

function distributionBlock(d, periodLabel) {
  if (!d || !d.counts || !d.counts.length) return { svg: emptyChart(), desc: null };
  const desc = `The typical stream during ${periodLabel} pulls a median of ${fmt(Math.round(d.median))} viewers, but the top 10% of snapshots reach ${fmt(Math.round(d.p90))}+ \u2014 viewership is heavily right-skewed, dominated by a small number of very large streams. That's why simple averages elsewhere on the site can look inflated by a handful of giants (n = ${fmt(d.n)} snapshots).${distScaleMode === 'log10' ? ' Log10 view compresses that skew so the smaller bars stay readable next to the giants.' : ' Switch to Log10 to see the long tail of smaller streams more clearly.'}`;
  const toggle = toggleRow([{ value: 'linear', label: 'Linear' }, { value: 'log10', label: 'Log10' }], distScaleMode, 'scale-toggle');
  return { svg: chartWrap(svgHistogramChart(d.bins, d.counts, { scale: distScaleMode }), toggle), desc };
}

function renderDistributionOnly() {
  const cd = currentChartData();
  const periodLabel = currentPeriodLabel();
  const old = document.querySelector('#insightBlocksPost .insight-block[data-chart-key="distribution"]');
  if (!old) return;
  const html = chartBlockHtml('distribution', 'Viewer count distribution', distributionBlock(cd.distribution, periodLabel));
  old.outerHTML = html;
  wireUpChartBlocks(document.getElementById('insightBlocksPost'));
}

/* ---------- Timing signals: Q4/Q5/Q6/Q7 as client-rendered interactive charts ---------- */

function currentTimingSeries() {
  const periodData = (INSIGHTS.schedule_charts && INSIGHTS.schedule_charts[currentPeriod]) || {};
  const g = currentGranularity();
  const bucket = g.type === 'day' ? (periodData.days || {})[g.key]
    : g.type === 'week' ? (periodData.weeks || {})[g.key]
    : periodData.base;
  const countryData = (bucket || {})[currentCountry] || (bucket || {})['ALL'] || null;
  if (!countryData) return null;
  return countryData[currentTimezone] || countryData['standardized'] || null;
}

/* Q4 and Q6's "stacked by top games" views need the (bulkier) per-game
   breakdown, which the backend only computes for the 'ALL' region (see
   EDA.py's include_stacks flag). If the selected country lacks it, fall
   back to the ALL-region series just for the stack, with a note. */
function timingSeriesForStacks() {
  const direct = currentTimingSeries();
  if (direct && (direct.hourly_stack || direct.daily_stack)) return { series: direct, fellBack: false };
  const periodData = (INSIGHTS.schedule_charts && INSIGHTS.schedule_charts[currentPeriod]) || {};
  const g = currentGranularity();
  const bucket = g.type === 'day' ? (periodData.days || {})[g.key]
    : g.type === 'week' ? (periodData.weeks || {})[g.key]
    : periodData.base;
  const allData = (bucket || {})['ALL'];
  const fallback = allData ? (allData[currentTimezone] || allData['standardized']) : null;
  return { series: fallback, fellBack: currentCountry !== 'ALL' && !!fallback };
}

function renderTimingCharts() {
  const container = document.getElementById('timingCharts');
  const series = currentTimingSeries();
  const regionLabel = currentCountry === 'ALL' ? 'all regions' : currentCountry;
  const tzLabel = currentTimezone === 'standardized' ? 'standardized UTC' : 'local time-of-day';

  if (!series) {
    container.innerHTML = `<div class="empty-state">Not enough tracked data for ${escapeHtml(regionLabel)} at this granularity yet. Try a broader Week/Month/Global view.</div>`;
    return;
  }

  const dailyStreamers = DAY_ORDER_FULL.map(d => series.daily_streamers[d] ?? 0);
  const dailyRatio = DAY_ORDER_FULL.map(d => series.daily_viewer_per_streamer[d] ?? 0);
  const hourlyViewers = Array.from({ length: 24 }, (_, h) => series.hourly_avg_viewers[h] ?? 0);
  const dayShort = DAY_ORDER_FULL.map(d => DAY_SHORT[d]);

  const peakDayIdx = argmax(dailyStreamers);
  const quietDayIdx = argmin(dailyStreamers);
  const peakHourIdx = argmax(hourlyViewers);
  const quietHourIdx = argmin(hourlyViewers);
  const bestRatioIdx = argmax(dailyRatio);
  const worstRatioIdx = argmin(dailyRatio);

  const q4desc = dailyStreamers.some(v => v > 0)
    ? `For ${escapeHtml(regionLabel)} (${tzLabel}), ${DAY_ORDER_FULL[peakDayIdx]} draws the most unique streamers, while ${DAY_ORDER_FULL[quietDayIdx]} is the quietest. Sample size: ${fmt(series.sample_count)} tracked snapshots.`
    : 'Not enough data to identify a pattern for this filter.';
  const q5desc = hourlyViewers.some(v => v > 0)
    ? `Viewership for ${escapeHtml(regionLabel)} peaks around ${String(peakHourIdx).padStart(2, '0')}:00 and is quietest around ${String(quietHourIdx).padStart(2, '0')}:00 (${tzLabel}).`
    : 'Not enough data to identify a pattern for this filter.';
  const q7desc = dailyRatio.some(v => v > 0)
    ? `${DAY_ORDER_FULL[bestRatioIdx]} gives the best viewers-per-streamer payoff for ${escapeHtml(regionLabel)}; ${DAY_ORDER_FULL[worstRatioIdx]} is the most saturated.`
    : 'Not enough data to identify a pattern for this filter.';

  const q4Toggle = toggleRow([{ value: 'simple', label: 'Streamers' }, { value: 'stacked', label: 'By game' }], q4ViewMode, 'view-toggle');
  const q4Html = q4ViewMode === 'stacked' ? q4StackedHtml(regionLabel, tzLabel) : chartWrap(svgBarChart(dayShort, dailyStreamers, { color: 'var(--cue)', highlight: peakDayIdx }), q4Toggle);
  const q4Desc = q4ViewMode === 'stacked' ? q4StackedDesc(regionLabel) : q4desc;

  const q6Toggle = toggleRow([{ value: 'stacked', label: 'By hour' }, { value: 'pie', label: 'Peak hour' }], q6ViewMode, 'view-toggle');
  const { html: q6Html, desc: q6Desc } = q6Content(regionLabel, q6Toggle);

  container.innerHTML = `
    <div class="insight-block" data-chart-key="q4">
      ${q4Html}
      <div>
        <h3>Streamer activity by day</h3>
        <p>${q4Desc}</p>
      </div>
    </div>
    <div class="insight-block" data-chart-key="q5">
      ${chartWrap(svgLineChart(Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0')), hourlyViewers, { color: 'var(--amber)' }))}
      <div>
        <h3>Viewer engagement by hour</h3>
        <p>${q5desc}</p>
      </div>
    </div>
    <div class="insight-block" data-chart-key="q6">
      ${q6Html}
      <div>
        <h3>Game market share by hour</h3>
        <p>${q6Desc}</p>
      </div>
    </div>
    <div class="insight-block" data-chart-key="q7">
      ${chartWrap(svgBarChart(dayShort, dailyRatio, { color: 'var(--cue)', highlight: bestRatioIdx }))}
      <div>
        <h3>Viewer-per-streamer ratio by day</h3>
        <p>${q7desc}</p>
      </div>
    </div>
  `;
  wireUpChartBlocks(container);
}

function q4StackedHtml(regionLabel, tzLabel) {
  const { series, fellBack } = timingSeriesForStacks();
  const toggle = toggleRow([{ value: 'simple', label: 'Streamers' }, { value: 'stacked', label: 'By game' }], q4ViewMode, 'view-toggle');
  if (!series || !series.daily_stack) return chartWrap(emptyChart(), toggle);
  const dayShort = DAY_ORDER_FULL.map(d => DAY_SHORT[d]);
  const stack = DAY_ORDER_FULL.map(d => series.daily_stack.find(s => s.key === d) || { key: d, segments: [], total: 0 });
  const fallbackNote = fellBack ? `<div class="chart-fallback-note">Game breakdown isn't available for ${escapeHtml(regionLabel)} \u2014 showing all regions instead.</div>` : '';
  return chartWrap(svgStackedBarChart(stack, series.daily_stack_games, { axisLabels: dayShort, peakKey: series.daily_stack_peak_day }), toggle + fallbackNote);
}

function q4StackedDesc(regionLabel) {
  const { series, fellBack } = timingSeriesForStacks();
  if (!series || !series.daily_stack) return 'Not enough data to break this down by game for this filter.';
  const peakDay = series.daily_stack_peak_day;
  const region = fellBack ? 'all regions' : regionLabel;
  return `Same day-of-week view as the streamer count, but split by which top games make up the viewership \u2014 ${peakDay} is the single biggest day for ${escapeHtml(region)}. Hover any segment for that game's exact share that day.`;
}

function q6Content(regionLabel, toggle) {
  const { series, fellBack } = timingSeriesForStacks();
  if (!series || !series.hourly_stack || !series.hourly_stack.length) {
    return { html: chartWrap(emptyChart(), toggle), desc: 'Not enough data at this granularity for this chart.' };
  }
  const peakRow = series.hourly_stack[series.peak_hour];
  const leader = (peakRow.segments || []).filter(s => s.game !== 'Others').sort((a, b) => b.viewers - a.viewers)[0];
  const leaderShare = leader ? (leader.viewers / series.peak_hour_total * 100).toFixed(1) : null;
  const others = (peakRow.segments || []).find(s => s.game === 'Others');
  const region = fellBack ? 'all regions' : regionLabel;
  const othersNote = others ? ` Even at peak, everything outside the top 5 ('Others') still adds up to ${(others.viewers / series.peak_hour_total * 100).toFixed(1)}% of that hour's viewership.` : '';
  const fallbackNote = fellBack ? `<div class="chart-fallback-note">Game breakdown isn't available for ${escapeHtml(regionLabel)} \u2014 showing all regions instead.</div>` : '';

  if (q6ViewMode === 'pie') {
    const slices = (peakRow.segments || []).map(s => ({ label: s.game, value: s.viewers }));
    const desc = leader
      ? `Peak-hour (${String(series.peak_hour).padStart(2, '0')}:00 UTC) snapshot for ${escapeHtml(region)}: '${leader.game}' takes ${leaderShare}% of that single hour.${othersNote} Switch to "By hour" to see how this composition holds up across the full day.`
      : `Peak-hour composition for ${escapeHtml(region)}.`;
    return { html: chartWrap(svgDonutChartWithLegend(slices), toggle) + fallbackNote, desc };
  }
  const desc = leader
    ? `The busiest hour is ${String(series.peak_hour).padStart(2, '0')}:00 UTC (dashed outline below), where '${leader.game}' takes the largest slice (${leaderShare}%) for ${escapeHtml(region)}.${othersNote} Tracking the same top 5 games across all 24 hours shows whether a game's audience is steady all day or concentrated in a narrow window.`
    : `Hourly viewership composition for ${escapeHtml(region)}.`;
  return {
    html: chartWrap(svgStackedBarChart(series.hourly_stack, series.hourly_stack_games, {
      axisLabels: Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0')),
      peakKey: series.peak_hour, tickEvery: 3,
    }), toggle) + fallbackNote,
    desc,
  };
}

function argmax(arr) {
  let idx = 0;
  for (let i = 1; i < arr.length; i++) if ((arr[i] ?? -Infinity) > (arr[idx] ?? -Infinity)) idx = i;
  return idx;
}
function argmin(arr) {
  let idx = 0;
  for (let i = 1; i < arr.length; i++) if ((arr[i] ?? Infinity) < (arr[idx] ?? Infinity)) idx = i;
  return idx;
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}
function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/* ============================================================
   Chart drawing helpers -- plain inline SVG, no chart library.
   Every hoverable/clickable element carries data-tip (consumed by
   initChartInteractivity in common.js) instead of a native <title>,
   so hover AND click both work consistently across desktop/touch.
   ============================================================ */

function svgBarChart(labels, values, opts = {}) {
  const width = 560, height = 230;
  const padL = 44, padR = 14, padT = 14, padB = 28;
  const innerW = width - padL - padR, innerH = height - padT - padB;
  const allowNeg = !!opts.allowNegative;
  const hasPos = values.some(v => (v || 0) > 0);
  const hasNeg = values.some(v => (v || 0) < 0);
  const maxV = Math.max(1e-9, ...values.map(v => Math.abs(v || 0)));
  // Only split the chart 50/50 above/below zero when values actually mix
  // sign; an all-negative (or all-positive) set gets the full height
  // instead of wasting half the chart on a side nothing uses.
  let zeroY, usableH;
  if (allowNeg && hasPos && hasNeg) {
    zeroY = padT + innerH / 2; usableH = innerH / 2;
  } else if (allowNeg && hasNeg && !hasPos) {
    zeroY = padT; usableH = innerH;
  } else {
    zeroY = padT + innerH; usableH = innerH;
  }
  const n = labels.length;
  const slot = innerW / n;
  const barW = slot * 0.6;
  let bars = '';
  labels.forEach((lab, i) => {
    const v = values[i] || 0;
    const h = (Math.abs(v) / maxV) * usableH;
    const x = padL + i * slot + (slot - barW) / 2;
    const y = v >= 0 ? zeroY - h : zeroY;
    const isHi = i === opts.highlight;
    const tip = `<strong>${escapeHtml(lab)}</strong><br>${fmt(Math.round(v * 1000) / 1000)}${opts.tipSuffix || ''}`;
    bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="3" fill="${opts.color || 'var(--cue)'}" opacity="${isHi ? 1 : 0.55}" data-tip="${escAttr(tip)}"/>`;
    bars += `<text x="${(x + barW / 2).toFixed(1)}" y="${height - padB + 16}" text-anchor="middle" class="chart-axis-label">${lab}</text>`;
  });
  let grid = '';
  const axisFmt = opts.axisFormat || (v => fmt(v));
  if (allowNeg && hasPos && hasNeg) {
    grid += `<line x1="${padL}" x2="${width - padR}" y1="${zeroY.toFixed(1)}" y2="${zeroY.toFixed(1)}" class="chart-grid"/>`;
  } else {
    for (let g = 0; g <= 2; g++) {
      const gy = padT + innerH - (innerH * g) / 2;
      const val = (maxV * g) / 2;
      grid += `<line x1="${padL}" x2="${width - padR}" y1="${gy.toFixed(1)}" y2="${gy.toFixed(1)}" class="chart-grid"/>`;
      grid += `<text x="${padL - 8}" y="${(gy + 4).toFixed(1)}" text-anchor="end" class="chart-axis-label">${axisFmt(val)}</text>`;
    }
  }
  return `<svg viewBox="0 0 ${width} ${height}" class="mini-chart" preserveAspectRatio="xMidYMid meet">${grid}${bars}</svg>`;
}

function svgLineChart(labels, values, opts = {}) {
  const width = 560, height = 230;
  const padL = 44, padR = 14, padT = 14, padB = 28;
  const innerW = width - padL - padR, innerH = height - padT - padB;
  const maxV = Math.max(1, ...values.map(v => v || 0));
  const n = labels.length;
  const stepX = n > 1 ? innerW / (n - 1) : 0;
  const points = values.map((v, i) => {
    const x = padL + i * stepX;
    const y = padT + innerH - ((v || 0) / maxV) * innerH;
    return [x, y];
  });
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const areaD = `${pathD} L${points[points.length - 1][0].toFixed(1)},${(padT + innerH).toFixed(1)} L${points[0][0].toFixed(1)},${(padT + innerH).toFixed(1)} Z`;
  const dots = points.map((p, i) => {
    const tip = `${labels[i]}:00 &mdash; <strong>${fmt(Math.round(values[i]))}</strong> avg viewers`;
    return `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="4" fill="${opts.color || 'var(--cue)'}" data-tip="${escAttr(tip)}"/>`;
  }).join('');
  const tickEvery = Math.ceil(n / 8);
  const xlabels = labels.map((lab, i) => (i % tickEvery === 0)
    ? `<text x="${points[i][0].toFixed(1)}" y="${height - padB + 16}" text-anchor="middle" class="chart-axis-label">${lab}</text>` : '').join('');
  let grid = '';
  for (let g = 0; g <= 2; g++) {
    const gy = padT + innerH - (innerH * g) / 2;
    const val = Math.round((maxV * g) / 2);
    grid += `<line x1="${padL}" x2="${width - padR}" y1="${gy.toFixed(1)}" y2="${gy.toFixed(1)}" class="chart-grid"/>`;
    grid += `<text x="${padL - 8}" y="${(gy + 4).toFixed(1)}" text-anchor="end" class="chart-axis-label">${fmt(val)}</text>`;
  }
  return `<svg viewBox="0 0 ${width} ${height}" class="mini-chart" preserveAspectRatio="xMidYMid meet">
    ${grid}
    <path d="${areaD}" fill="${opts.color || 'var(--cue)'}" opacity="0.12" stroke="none"/>
    <path d="${pathD}" fill="none" stroke="${opts.color || 'var(--cue)'}" stroke-width="2.2"/>
    ${dots}
    ${xlabels}
  </svg>`;
}

function svgScatterChart(points) {
  const width = 560, height = 260;
  const padL = 54, padR = 16, padT = 14, padB = 34;
  const innerW = width - padL - padR, innerH = height - padT - padB;
  if (!points.length) return `<svg viewBox="0 0 ${width} ${height}" class="mini-chart"></svg>`;
  const maxX = Math.max(...points.map(p => p.x)) * 1.05 || 1;
  const maxY = Math.max(...points.map(p => p.y)) * 1.05 || 1;
  const px = x => padL + (x / maxX) * innerW;
  const py = y => padT + innerH - (y / maxY) * innerH;

  let grid = '';
  for (let g = 0; g <= 2; g++) {
    const gy = padT + (innerH * g) / 2;
    const val = Math.round(maxY - (maxY * g) / 2);
    grid += `<line x1="${padL}" x2="${width - padR}" y1="${gy.toFixed(1)}" y2="${gy.toFixed(1)}" class="chart-grid"/>`;
    grid += `<text x="${padL - 8}" y="${(gy + 4).toFixed(1)}" text-anchor="end" class="chart-axis-label">${fmt(val)}</text>`;
  }
  let xticks = '';
  for (let g = 0; g <= 2; g++) {
    const gx = padL + (innerW * g) / 2;
    const val = Math.round((maxX * g) / 2);
    xticks += `<text x="${gx.toFixed(1)}" y="${height - padB + 16}" text-anchor="middle" class="chart-axis-label">${fmt(val)}</text>`;
  }
  const dots = points.map(p => {
    const tip = `<strong>${escapeHtml(p.game)}</strong><br>Steam players: ${fmt(Math.round(p.x))}<br>Twitch viewers: ${fmt(Math.round(p.y))}`;
    return `<circle cx="${px(p.x).toFixed(1)}" cy="${py(p.y).toFixed(1)}" r="3.5" fill="var(--cue)" fill-opacity="0.65" data-tip="${escAttr(tip)}" data-game="${escAttr(p.game)}"/>`;
  }).join('');
  return `<svg viewBox="0 0 ${width} ${height}" class="mini-chart" preserveAspectRatio="xMidYMid meet">
    ${grid}${xticks}${dots}
    <text x="${(width / 2).toFixed(1)}" y="${height - 4}" text-anchor="middle" class="chart-axis-label">Steam current players</text>
  </svg>`;
}

function svgHorizontalBarChart(items, opts = {}) {
  const rowH = 27, padL = 132, padR = 56, padT = 8, padB = 8;
  const width = 560;
  const height = padT + padB + items.length * rowH;
  const innerW = width - padL - padR;
  const barItems = items.filter(it => !it.divider);
  const hasPos = barItems.some(it => it.value > 0);
  const hasNeg = barItems.some(it => it.value < 0);
  const diverging = hasPos && hasNeg;
  const maxV = Math.max(1e-9, ...barItems.map(it => Math.abs(it.value)));
  const zeroX = diverging ? padL + innerW / 2 : padL;
  const usableW = diverging ? innerW / 2 : innerW;
  let bars = '';
  if (diverging) {
    bars += `<line x1="${zeroX.toFixed(1)}" x2="${zeroX.toFixed(1)}" y1="${padT}" y2="${height - padB}" class="chart-grid"/>`;
  }
  items.forEach((it, i) => {
    const y = padT + i * rowH;
    if (it.divider) {
      bars += `<text x="${padL}" y="${(y + rowH / 2 + 4).toFixed(1)}" class="chart-axis-label" font-weight="700" fill="var(--text)">${escapeHtml(it.label)}</text>`;
      return;
    }
    const w = (Math.abs(it.value) / maxV) * usableW;
    const x = it.value >= 0 ? zeroX : zeroX - w;
    const color = opts.colorFor ? opts.colorFor(it) : (opts.color || 'var(--cue)');
    const formatted = opts.format ? opts.format(it.value) : fmt(it.value);
    const tip = `<strong>${escapeHtml(it.label)}</strong><br>${opts.valueLabel || 'Value'}: ${formatted}`;
    const shortLabel = it.label.length > 20 ? it.label.slice(0, 19) + '\u2026' : it.label;
    bars += `<text x="${padL - 8}" y="${(y + rowH / 2 + 4).toFixed(1)}" text-anchor="end" class="chart-axis-label">${escapeHtml(shortLabel)}</text>`;
    bars += `<rect x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" width="${Math.max(1, w).toFixed(1)}" height="${rowH - 8}" rx="3" fill="${color}" opacity="${opts.highlightAll || i === 0 ? 1 : 0.75}" data-tip="${escAttr(tip)}"${opts.itemsAreGames ? ` data-game="${escAttr(it.label)}"` : ''}/>`;
    const labelX = it.value >= 0 ? x + w + 8 : x - 8;
    const anchor = it.value >= 0 ? 'start' : 'end';
    bars += `<text x="${labelX.toFixed(1)}" y="${(y + rowH / 2 + 4).toFixed(1)}" text-anchor="${anchor}" class="chart-axis-label">${formatted}</text>`;
  });
  return `<svg viewBox="0 0 ${width} ${height}" class="mini-chart" preserveAspectRatio="xMidYMid meet">${bars}</svg>`;
}

const DONUT_PALETTE = ['#63D9A0', '#E3A23C', '#E1483A', '#4FA8D8', '#B37FE0', '#5B6B6D'];

function svgDonutChartWithLegend(slices) {
  const size = 220, cx = size / 2, cy = size / 2, rOuter = 96, rInner = 54;
  const total = slices.reduce((a, b) => a + b.value, 0) || 1;
  let angle = -Math.PI / 2;
  let paths = '';
  const legendRows = [];
  slices.forEach((s, i) => {
    const frac = s.value / total;
    const a0 = angle;
    const a1 = angle + frac * Math.PI * 2;
    angle = a1;
    const large = (a1 - a0) > Math.PI ? 1 : 0;
    const x0 = cx + rOuter * Math.cos(a0), y0 = cy + rOuter * Math.sin(a0);
    const x1 = cx + rOuter * Math.cos(a1), y1 = cy + rOuter * Math.sin(a1);
    const xi0 = cx + rInner * Math.cos(a1), yi0 = cy + rInner * Math.sin(a1);
    const xi1 = cx + rInner * Math.cos(a0), yi1 = cy + rInner * Math.sin(a0);
    const d = `M${x0.toFixed(1)},${y0.toFixed(1)} A${rOuter},${rOuter} 0 ${large} 1 ${x1.toFixed(1)},${y1.toFixed(1)} L${xi0.toFixed(1)},${yi0.toFixed(1)} A${rInner},${rInner} 0 ${large} 0 ${xi1.toFixed(1)},${yi1.toFixed(1)} Z`;
    const color = s.label === 'Others' ? 'var(--text-dim)' : DONUT_PALETTE[i % DONUT_PALETTE.length];
    const pct = (frac * 100).toFixed(1);
    const tip = `<strong>${escapeHtml(s.label)}</strong><br>${fmt(Math.round(s.value))} viewers (${pct}%)`;
    paths += `<path d="${d}" fill="${color}" opacity="0.92" data-tip="${escAttr(tip)}" data-game="${escAttr(s.label)}"/>`;
    legendRows.push(`<div class="donut-legend-row" data-tip="${escAttr(tip)}" data-game="${escAttr(s.label)}"><span class="donut-swatch" style="background:${color}"></span>${escapeHtml(s.label)} <span class="mono">${pct}%</span></div>`);
  });
  return `<div class="donut-wrap">
    <svg viewBox="0 0 ${size} ${size}" class="mini-chart donut-chart">${paths}</svg>
    <div class="donut-legend">${legendRows.join('')}</div>
  </div>`;
}

/* Stacked bar across a fixed axis (24 hours, or the 7 days of the week):
   each bar's segments are the same fixed set of top-N games (by total
   viewership) + "Others" -- adds the dimension a single snapshot chart
   can't show, so you can see whether one game's share holds steady across
   the axis or spikes in one slot. Used for both Q6 (by hour) and Q4's
   "By game" view (by day). */
function svgStackedBarChart(stack, gameOrder, opts = {}) {
  const width = 560, height = 260;
  const padL = 50, padR = 14, padT = 14, padB = 34;
  const innerW = width - padL - padR, innerH = height - padT - padB;
  const maxTotal = Math.max(1, ...stack.map(s => s.total || 0));
  const n = stack.length;
  const slot = innerW / n;
  const barW = slot * 0.68;
  const colorFor = game => game === 'Others' ? 'var(--text-dim)' : DONUT_PALETTE[gameOrder.indexOf(game) % DONUT_PALETTE.length];
  const axisLabels = opts.axisLabels || stack.map(s => String(s.key));
  const tickEvery = opts.tickEvery || 1;
  const unitLabel = opts.unitLabel || '';

  let bars = '';
  stack.forEach((s, i) => {
    const x = padL + i * slot + (slot - barW) / 2;
    let yCursor = padT + innerH;
    (s.segments || []).forEach(seg => {
      if (seg.viewers <= 0) return;
      const h = (seg.viewers / maxTotal) * innerH;
      const y = yCursor - h;
      const isPeak = opts.peakKey === s.key;
      const tip = `<strong>${escapeHtml(seg.game)}</strong><br>${escapeHtml(axisLabels[i])}${unitLabel} &mdash; ${fmt(Math.round(seg.viewers))} viewers`;
      bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" fill="${colorFor(seg.game)}" opacity="${isPeak ? 1 : 0.82}" data-tip="${escAttr(tip)}" data-game="${escAttr(seg.game)}"/>`;
      yCursor = y;
    });
    if (opts.peakKey === s.key) {
      bars += `<rect x="${(x - 1.5).toFixed(1)}" y="${padT}" width="${(barW + 3).toFixed(1)}" height="${innerH}" fill="none" stroke="var(--amber)" stroke-width="1.5" stroke-dasharray="3 2" pointer-events="none"/>`;
    }
    if (i % tickEvery === 0) {
      bars += `<text x="${(x + barW / 2).toFixed(1)}" y="${height - padB + 16}" text-anchor="middle" class="chart-axis-label">${escapeHtml(axisLabels[i])}</text>`;
    }
  });

  let grid = '';
  for (let g = 0; g <= 2; g++) {
    const gy = padT + innerH - (innerH * g) / 2;
    const val = Math.round((maxTotal * g) / 2);
    grid += `<line x1="${padL}" x2="${width - padR}" y1="${gy.toFixed(1)}" y2="${gy.toFixed(1)}" class="chart-grid"/>`;
    grid += `<text x="${padL - 8}" y="${(gy + 4).toFixed(1)}" text-anchor="end" class="chart-axis-label">${fmt(val)}</text>`;
  }

  const legendTip = g => `<strong>${escapeHtml(g)}</strong><br>Click to isolate this game across the chart`;
  const legend = gameOrder.map((g, i) =>
    `<div class="donut-legend-row" data-tip="${escAttr(legendTip(g))}" data-game="${escAttr(g)}"><span class="donut-swatch" style="background:${DONUT_PALETTE[i % DONUT_PALETTE.length]}"></span>${escapeHtml(g)}</div>`
  ).join('') + `<div class="donut-legend-row" data-tip="${escAttr(legendTip('Others'))}" data-game="Others"><span class="donut-swatch" style="background:var(--text-dim)"></span>Others</div>`;

  return `<div class="stacked-wrap">
    <svg viewBox="0 0 ${width} ${height}" class="mini-chart" preserveAspectRatio="xMidYMid meet">${grid}${bars}
      <text x="${(width / 2).toFixed(1)}" y="${height - 4}" text-anchor="middle" class="chart-axis-label">${opts.peakKey != null ? 'Dashed outline marks the peak slot' : ''}</text>
    </svg>
    <div class="donut-legend">${legend}</div>
  </div>`;
}

function svgHistogramChart(bins, counts, opts = {}) {
  const width = 560, height = 230;
  const padL = 50, padR = 14, padT = 14, padB = 28;
  const innerW = width - padL - padR, innerH = height - padT - padB;
  const scaleMode = opts.scale || 'linear';
  const maxC = Math.max(1, ...counts);
  const transform = v => scaleMode === 'log10' ? Math.log10(v + 1) : v;
  const maxT = transform(maxC) || 1;
  const n = counts.length;
  const slot = innerW / n;
  let bars = '';
  counts.forEach((c, i) => {
    const h = (transform(c) / maxT) * innerH;
    const x = padL + i * slot;
    const y = padT + innerH - h;
    const lo = Math.round(bins[i]), hi = Math.round(bins[i + 1]);
    const tip = `${fmt(lo)}&ndash;${fmt(hi)} viewers<br><strong>${fmt(c)}</strong> snapshots`;
    bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(0, slot - 1).toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" fill="var(--cue)" opacity="0.75" data-tip="${escAttr(tip)}"/>`;
  });
  let xt = '';
  [0, 0.25, 0.5, 0.75, 1].forEach(f => {
    const val = Math.round(bins[0] + (bins[bins.length - 1] - bins[0]) * f);
    xt += `<text x="${(padL + innerW * f).toFixed(1)}" y="${height - padB + 16}" text-anchor="middle" class="chart-axis-label">${fmt(val)}</text>`;
  });
  let grid = '';
  if (scaleMode === 'log10') {
    const maxPow = Math.max(1, Math.ceil(Math.log10(maxC + 1)));
    for (let p = 0; p <= maxPow; p++) {
      const val = Math.pow(10, p);
      const t = transform(val);
      const gy = padT + innerH - (t / maxT) * innerH;
      grid += `<line x1="${padL}" x2="${width - padR}" y1="${gy.toFixed(1)}" y2="${gy.toFixed(1)}" class="chart-grid"/>`;
      grid += `<text x="${padL - 8}" y="${(gy + 4).toFixed(1)}" text-anchor="end" class="chart-axis-label">${fmt(val)}</text>`;
    }
  } else {
    for (let g = 0; g <= 2; g++) {
      const gy = padT + innerH - (innerH * g) / 2;
      const val = Math.round((maxC * g) / 2);
      grid += `<line x1="${padL}" x2="${width - padR}" y1="${gy.toFixed(1)}" y2="${gy.toFixed(1)}" class="chart-grid"/>`;
      grid += `<text x="${padL - 8}" y="${(gy + 4).toFixed(1)}" text-anchor="end" class="chart-axis-label">${fmt(val)}</text>`;
    }
  }
  return `<svg viewBox="0 0 ${width} ${height}" class="mini-chart" preserveAspectRatio="xMidYMid meet">${grid}${bars}${xt}</svg>`;
}
