DataStore.data().then(DATA => {
  renderLatestUpdate(DATA);

  renderReadouts(DATA);
  renderOnAir(DATA);
  renderTeaser(DATA);
  renderGpu(DATA);
});

function renderReadouts(DATA) {
  const m = DATA.meta;
  const items = [
    [fmt(m.total_games_tracked), t('home.readout.games')],
    [fmt(m.total_games_with_recommendations), t('home.readout.ranked')],
    [fmt(m.total_streamers_seen), t('home.readout.streamers')],
    [fmt(m.total_twitch_snapshots), t('home.readout.snapshots')],
  ];
  document.getElementById('readouts').innerHTML = items.map(([num, label]) => `
    <div class="readout"><div class="num">${num}</div><div class="label">${label}</div></div>
  `).join('');
}

/* "On air now" card. Everything drawn here comes from the same day x hour
   table as the Signal Board (UTC view): the zone cut-offs are the real 33rd /
   66th percentile values of that table, the marker sits at this slot's real
   value on the real min-max scale, and the strip below is today's actual
   24-hour profile. No decorative gradients. */
function renderOnAir(DATA) {
  const sched = (DATA.schedule || {}).standardized || {};
  const heat = sched.heatmap || [];
  const now = new Date();
  const utcHour = now.getUTCHours();
  const dayName = DAY_ORDER[(now.getUTCDay() + 6) % 7];
  const hh = String(utcHour).padStart(2, '0');

  const cell = heat.find(h => h.day === dayName && h.hour === utcHour);
  let ratio = cell ? cell.ratio : null;
  let n = cell ? cell.n : 0;
  let fellBack = false;
  if (ratio == null && sched.by_hour && sched.by_hour[utcHour] != null) {
    ratio = sched.by_hour[utcHour];
    n = (sched.by_hour_snapshots || {})[utcHour] || 0;
    fellBack = true;
  }

  const all = heat.map(h => h.ratio).filter(v => typeof v === 'number').sort((a, b) => a - b);
  const clocks = document.getElementById('onairClocks');
  const yourClock = now.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
  clocks.innerHTML = `<div><span>${t('onair.your_clock')}</span> ${yourClock}</div>`
    + `<div><span>${t('onair.slot_used')}</span> ${dayShortLabel(dayName)} ${hh}:00–${hh}:59 UTC</div>`;

  if (!all.length || ratio == null) {
    document.getElementById('onairTag').textContent = '—';
    document.getElementById('onairVerdict').textContent = t('onair.no_data');
    document.getElementById('onairDetail').textContent = '';
    return;
  }

  const q = p => all[Math.min(all.length - 1, Math.floor(p * (all.length - 1)))];
  const t1 = q(0.33), t2 = q(0.66), lo = all[0], hi = all[all.length - 1];
  const zoneOf = v => (v >= t2 ? 'good' : v >= t1 ? 'mid' : 'low');
  const zone = zoneOf(ratio);
  const levelNum = { low: 1, mid: 2, good: 3 }[zone];
  const pctBelow = Math.round((all.filter(v => v < ratio).length / all.length) * 100);
  const r0 = v => localeNumber(Math.round(v));

  const tag = document.getElementById('onairTag');
  tag.textContent = t('onair.tag.' + zone);
  tag.className = 'onair-tag mono ' + zone;
  document.getElementById('onairLevel').textContent = t('onair.level', { n: levelNum });
  document.getElementById('onairVerdict').textContent = t('onair.verdict.' + zone);

  let detail = t('onair.reading_line', { ratio: r0(ratio), pct: pctBelow, n: all.length });
  detail += ' ' + (fellBack ? t('onair.fallback', { hour: hh })
    : (n <= 1 ? t('onair.evidence_one') : t('onair.evidence', { n })));
  document.getElementById('onairDetail').textContent = detail;

  // Meter on the real value scale.
  const span = Math.max(1e-9, hi - lo);
  const pos = v => Math.max(0, Math.min(100, ((v - lo) / span) * 100));
  const w1 = pos(t1), w2 = pos(t2) - pos(t1), w3 = 100 - pos(t2);
  const tickLabels = [[lo, 'start'], [t1, 'mid'], [t2, 'mid'], [hi, 'end']]
    .map(([v, a]) => `<span class="meter-tick ${a}" style="left:${pos(v)}%">${r0(v)}</span>`).join('');
  document.getElementById('onairMeter').innerHTML = `
    <div class="meter-title">${t('onair.meter_title')}</div>
    <div class="meter-track">
      <span class="mz low" style="width:${w1}%"></span><span class="mz mid" style="width:${w2}%"></span><span class="mz good" style="width:${w3}%"></span>
      <span class="meter-marker ${zone}" style="left:${pos(ratio)}%"><span class="meter-pin"></span><span class="meter-val mono">${r0(ratio)}</span></span>
    </div>
    <div class="meter-scale">${tickLabels}</div>
    <div class="meter-zones">
      <span class="mzl low"><i></i><b>${t('onair.zone.low')}</b> ${t('onair.zone_range.low', { a: r0(t1) })}</span>
      <span class="mzl mid"><i></i><b>${t('onair.zone.mid')}</b> ${t('onair.zone_range.mid', { a: r0(t1), b: r0(t2) })}</span>
      <span class="mzl good"><i></i><b>${t('onair.zone.good')}</b> ${t('onair.zone_range.good', { b: r0(t2) })}</span>
    </div>`;

  // Today's 24-hour profile.
  const bars = Array.from({ length: 24 }, (_, h) => {
    const c = heat.find(x => x.day === dayName && x.hour === h);
    const isNow = h === utcHour;
    const hs = String(h).padStart(2, '0');
    if (!c) {
      return `<div class="today-bar nodata${isNow ? ' now' : ''}" data-tip="${hs}:00 UTC — ${t('onair.today_nodata')}"><span style="height:100%"></span></div>`;
    }
    const z = zoneOf(c.ratio);
    const tip = t('onair.today_tip', { hour: hs, ratio: r0(c.ratio), zone: t('onair.zone.' + z), n: c.n });
    return `<div class="today-bar ${z}${isNow ? ' now' : ''}" data-tip="${tip}"><span style="height:${Math.max(8, (c.ratio / hi) * 100)}%"></span></div>`;
  }).join('');
  const labels = Array.from({ length: 24 }, (_, h) => `<i>${h % 6 === 0 ? h : ''}</i>`).join('');
  const todayHost = document.getElementById('onairToday');
  todayHost.innerHTML = `<div class="meter-title">${t('onair.today_title', { day: dayLabel(dayName) })}</div>
    <div class="today-bars">${bars}</div><div class="today-labels mono">${labels}</div>`;
  initChartInteractivity(todayHost);
}

function renderTeaser(DATA) {
  const top = [...DATA.games].sort((a, b) => b.opportunity_score - a.opportunity_score).slice(0, 4);
  document.getElementById('teaserGrid').innerHTML = top.map(g => `
    <a class="teaser-card" href="games.html?g=${encodeURIComponent(g.game)}">
      <div class="t-score mono">${g.opportunity_score.toFixed(0)} ${t('home.teaser.opportunity')}</div>
      <div class="t-name">${g.game}</div>
      <div class="t-stat">${t('home.teaser.stat', { viewers: fmt(Math.round(g.avg_viewers)), growth: (g.growth_pct > 0 ? '+' : '') + g.growth_pct + '%' })}</div>
    </a>
  `).join('');
}

function renderGpu(DATA) {
  const gpu = DATA.gpu_market || {};
  const grid = document.getElementById('gpuGrid');
  const yearSelect = document.getElementById('gpuYearSelect');
  if (!gpu.avg_price_by_month || !Object.keys(gpu.avg_price_by_month).length) {
    grid.innerHTML = `<div class="empty-state">${t('home.gpu_none')}</div>`;
    if (yearSelect) yearSelect.style.display = 'none';
    return;
  }

  const byYear = gpu.avg_price_by_year || {};
  const years = Object.keys(byYear).sort();
  if (yearSelect) {
    yearSelect.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');
    yearSelect.value = years[years.length - 1];
    yearSelect.addEventListener('change', () => renderGpuPriceChart(gpu, yearSelect.value));
  }

  grid.innerHTML = `
    <div class="gpu-card gpu-card-chart">
      <h4>${t('home.gpu_chart_title')}</h4>
      <div id="gpuPriceChart"></div>
    </div>
    <div class="gpu-card" id="gpuValueCard"><h4>${t('home.gpu_value_title')}</h4></div>
  `;
  // Render the value card FIRST: it's the one with natural (unstretched)
  // content height, so the grid row's real height isn't settled until its
  // bars are in the DOM. Only then do we measure how tall the chart card's
  // box actually is, so the chart can be drawn to exactly fill it instead
  // of guessing a fixed aspect ratio and leaving dead space.
  renderGpuValueChart(gpu);
  renderGpuPriceChart(gpu, years[years.length - 1]);
  GRDownload.attach(grid.querySelector('.gpu-card-chart'), {
    svg: () => document.getElementById('gpuPriceSvg'),
    title: () => t('home.gpu.download'),
    subtitle: () => (yearSelect ? yearSelect.value : ''),
    csv: () => {
      const yr = yearSelect ? yearSelect.value : years[years.length - 1];
      return [['month', 'avg_price_usd'], ...Object.entries(byYear[yr] || {}).map(([m, v]) => [m, v])];
    },
  });
}

/* Interactive month-by-month price line for one year: hovering a point
   updates the average readout on the right to that specific month; moving
   off the chart resets the readout back to the selected year's overall
   average. Built as plain inline SVG + mouse events, no chart library. */
function renderGpuPriceChart(gpu, year) {
  const container = document.getElementById('gpuPriceChart');
  if (!container) return;
  const monthData = (gpu.avg_price_by_year || {})[year] || {};
  const months = Object.keys(monthData).sort();
  if (!months.length) {
    container.innerHTML = `<div class="empty-state">${t('home.gpu_none_year', { year })}</div>`;
    return;
  }
  const values = months.map(m => monthData[m]);
  const yearAvg = values.reduce((a, b) => a + b, 0) / values.length;

  // Draw the SVG at the container's own measured size (its height is set by
  // its taller sibling card via the grid's stretch behavior) instead of a
  // fixed aspect ratio, so the chart always fills the space with no
  // letterboxing or leftover empty band underneath it.
  const rect = container.getBoundingClientRect();
  const width = Math.round(rect.width) || 640;
  const height = Math.max(200, Math.round(rect.height) || 260);
  const padL = 56, padR = 20, padT = 20, padB = 34;
  const innerW = width - padL - padR, innerH = height - padT - padB;
  const minV = Math.min(...values) * 0.94;
  const maxV = Math.max(...values) * 1.06;
  const stepX = months.length > 1 ? innerW / (months.length - 1) : 0;
  const yFor = v => padT + innerH - ((v - minV) / (maxV - minV || 1)) * innerH;
  const points = values.map((v, i) => [padL + i * stepX, yFor(v)]);

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const areaD = `${pathD} L${points[points.length - 1][0].toFixed(1)},${(padT + innerH).toFixed(1)} L${points[0][0].toFixed(1)},${(padT + innerH).toFixed(1)} Z`;

  let grid = '';
  for (let g = 0; g <= 3; g++) {
    const gy = padT + (innerH * g) / 3;
    const val = maxV - ((maxV - minV) * g) / 3;
    grid += `<line x1="${padL}" x2="${width - padR}" y1="${gy.toFixed(1)}" y2="${gy.toFixed(1)}" class="chart-grid"/>`;
    grid += `<text x="${padL - 8}" y="${(gy + 4).toFixed(1)}" text-anchor="end" class="chart-axis-label">$${Math.round(val)}</text>`;
  }
  const monthLabels = months.map((m, i) =>
    `<text x="${points[i][0].toFixed(1)}" y="${height - padB + 18}" text-anchor="middle" class="chart-axis-label">${m.slice(5)}</text>`).join('');
  const dots = points.map((p, i) =>
    `<circle class="gpu-chart-dot" data-idx="${i}" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="4"/>`).join('');

  // Invisible full-height "hit zones" around each point (midpoint-split
  // between neighbors), given to the browser's native hit-testing instead
  // of computing "nearest point to cursor X" ourselves. This is what makes
  // it correct regardless of any page zoom/scale in effect: native hit
  // testing is always consistent with where things actually render, while
  // manual coordinate math (getBoundingClientRect ratios, or even SVG
  // getScreenCTM) can drift out of sync with the cursor under certain
  // ancestor transforms -- exactly what broke this chart's hover before.
  const hitZones = points.map((p, i) => {
    const prevX = i === 0 ? padL : (points[i - 1][0] + p[0]) / 2;
    const nextX = i === points.length - 1 ? width - padR : (points[i + 1][0] + p[0]) / 2;
    return `<rect x="${prevX.toFixed(1)}" y="${padT}" width="${Math.max(0, nextX - prevX).toFixed(1)}" height="${innerH}" fill="transparent" data-idx="${i}"/>`;
  }).join('');

  container.innerHTML = `
    <div class="gpu-chart-wrap" id="gpuChartWrap">
      <svg viewBox="0 0 ${width} ${height}" class="mini-chart gpu-price-svg" id="gpuPriceSvg" preserveAspectRatio="xMidYMid meet">
        ${grid}
        <path d="${areaD}" fill="var(--cue)" opacity="0.12" stroke="none"/>
        <path d="${pathD}" fill="none" stroke="var(--cue)" stroke-width="2.4"/>
        ${dots}
        ${monthLabels}
        <line id="gpuHoverLine" x1="0" x2="0" y1="${padT}" y2="${padT + innerH}" class="gpu-hover-line" style="display:none;"/>
        ${hitZones}
      </svg>
      <div class="gpu-chart-readout">
        <div class="k">${t('home.gpu.avg_price')}</div>
        <div class="v mono" id="gpuReadoutValue">$${yearAvg.toFixed(0)}</div>
        <div class="sub" id="gpuReadoutLabel">${t('home.gpu.year_avg', { year })}</div>
      </div>
    </div>
  `;

  const hoverLine = document.getElementById('gpuHoverLine');
  const readoutValue = document.getElementById('gpuReadoutValue');
  const readoutLabel = document.getElementById('gpuReadoutLabel');

  const resetReadout = () => {
    readoutValue.textContent = `$${yearAvg.toFixed(0)}`;
    readoutLabel.textContent = t('home.gpu.year_avg', { year });
    hoverLine.style.display = 'none';
  };

  const showPoint = idx => {
    readoutValue.textContent = `$${values[idx].toFixed(0)}`;
    readoutLabel.textContent = months[idx];
    hoverLine.setAttribute('x1', points[idx][0].toFixed(1));
    hoverLine.setAttribute('x2', points[idx][0].toFixed(1));
    hoverLine.style.display = 'block';
  };

  const wrap = document.getElementById('gpuChartWrap');
  wrap.addEventListener('mouseover', evt => {
    const zone = evt.target.closest('[data-idx]');
    if (zone) showPoint(parseInt(zone.dataset.idx, 10));
  });
  wrap.addEventListener('mouseleave', resetReadout);
  // Touch support: elementFromPoint is, like native mouseover hit-testing,
  // correct regardless of page zoom -- tap to inspect, lift finger to reset.
  wrap.addEventListener('touchmove', evt => {
    if (!evt.touches.length) return;
    const touch = evt.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const zone = el && el.closest('[data-idx]');
    if (zone) showPoint(parseInt(zone.dataset.idx, 10));
  });
  wrap.addEventListener('touchend', resetReadout);
}

/* Turns the "cheapest models" list into a bar chart that tells a story:
   each card's price is measured against the overall average tracked price,
   so the reader immediately sees not just "what's cheap" but "how much
   cheaper than typical" each option is. */
function renderGpuValueChart(gpu) {
  const card = document.getElementById('gpuValueCard');
  const cheapest = gpu.cheapest_models || [];
  if (!cheapest.length) {
    card.innerHTML += `<div class="empty-state">${t('home.gpu.no_model')}</div>`;
    return;
  }
  const monthVals = Object.values(gpu.avg_price_by_month || {});
  const avgPrice = monthVals.length ? monthVals.reduce((a, b) => a + b, 0) / monthVals.length : null;

  const maxPrice = Math.max(...cheapest.map(m => m.avg_price), avgPrice || 0) * 1.08;
  const rows = cheapest.map(m => {
    const pct = Math.max(2, (m.avg_price / maxPrice) * 100);
    const belowAvg = avgPrice ? Math.round((1 - m.avg_price / avgPrice) * 100) : null;
    const savingTag = belowAvg != null && belowAvg > 0
      ? `<span class="gpu-bar-saving">${t('home.gpu.below', { n: belowAvg })}</span>`
      : '';
    return `
      <div class="gpu-bar-row">
        <div class="gpu-bar-label">${m.model}</div>
        <div class="gpu-bar-track">
          <div class="gpu-bar-fill" style="width:${pct}%"></div>
        </div>
        <div class="gpu-bar-value mono">$${m.avg_price.toFixed(0)} ${savingTag}</div>
      </div>`;
  }).join('');

  const avgLine = avgPrice
    ? `<div class="gpu-bar-avgline" style="left:${Math.min(96, (avgPrice / maxPrice) * 100)}%"></div>`
    : '';
  const avgLabel = avgPrice
    ? `<div class="gpu-bar-avglabel">${t('home.gpu.overall')} <strong>$${avgPrice.toFixed(0)}</strong></div>`
    : '';

  card.innerHTML += `
    <p class="gpu-story-note">${t('home.gpu.note')}</p>
    <div class="gpu-bar-chart">
      ${avgLine}
      ${rows}
    </div>
    ${avgLabel}
  `;
}
