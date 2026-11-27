/* ============================================================
   Graph downloads. Every chart on the site can be saved as:
     - PNG  (rasterised from the on-screen SVG, with a title strip)
     - SVG  (vector, styles inlined so it opens correctly anywhere)
     - CSV  (the numbers behind the chart, read from its hover tooltips)
   The schedule heatmap (a CSS grid, not an SVG) registers its own
   exporters through GRDownload.attach(host, { png, csv }).
   ============================================================ */
const GRDownload = (() => {
  const STYLE_PROPS = [
    'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray',
    'opacity', 'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline',
    'letter-spacing', 'visibility',
  ];

  const tr = (k, fallback) => (typeof t === 'function' ? t(k) : fallback);

  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  function slug(s) {
    return String(s || 'chart').toLowerCase().replace(/[^a-z0-9\u0E00-\u0E7F]+/g, '-').replace(/^-+|-+$/g, '') || 'chart';
  }

  function saveBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  function csvEscape(v) {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function saveCsv(rows, filename) {
    const text = rows.map(r => r.map(csvEscape).join(',')).join('\r\n');
    saveBlob(new Blob(['\ufeff' + text], { type: 'text/csv;charset=utf-8' }), filename);
  }

  /* Clone an SVG with all computed styles baked in (CSS variables resolved),
     so the exported file doesn't depend on style.css. */
  function bakeSvg(svg) {
    const clone = svg.cloneNode(true);
    const src = [svg, ...svg.querySelectorAll('*')];
    const dst = [clone, ...clone.querySelectorAll('*')];
    src.forEach((s, i) => {
      const d = dst[i];
      const cs = getComputedStyle(s);
      STYLE_PROPS.forEach(p => {
        const v = cs.getPropertyValue(p);
        if (v) d.style.setProperty(p, v);
      });
      d.removeAttribute('data-tip');
      d.removeAttribute('data-game');
      d.removeAttribute('class');
    });
    const vb = svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width
      ? [svg.viewBox.baseVal.width, svg.viewBox.baseVal.height]
      : [svg.getBoundingClientRect().width || 560, svg.getBoundingClientRect().height || 260];
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', vb[0]);
    clone.setAttribute('height', vb[1]);
    clone.removeAttribute('style');
    return { clone, w: vb[0], h: vb[1] };
  }

  function svgString(svg, bg) {
    const { clone, w, h } = bakeSvg(svg);
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('width', '100%');
    rect.setAttribute('height', '100%');
    rect.setAttribute('fill', bg);
    clone.insertBefore(rect, clone.firstChild);
    return { text: new XMLSerializer().serializeToString(clone), w, h };
  }

  function wrapLines(ctx, text, maxW) {
    const words = String(text || '').split(/\s+/);
    const lines = [];
    let line = '';
    words.forEach(w => {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
    });
    if (line) lines.push(line);
    return lines;
  }

  function drawHeaderFooter(ctx, W, headH, title, subtitle, footH, textColor, dimColor, footer) {
    ctx.fillStyle = textColor;
    ctx.font = '700 22px "Space Grotesk", "Noto Sans Thai", sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(title || '', 24, 38);
    if (subtitle) {
      ctx.fillStyle = dimColor;
      ctx.font = '400 14px "IBM Plex Mono", monospace';
      ctx.fillText(subtitle, 24, 62);
    }
    ctx.fillStyle = dimColor;
    ctx.font = '400 12px "IBM Plex Mono", monospace';
    ctx.fillText(footer, 24, headH + footH - 12 + 0);
  }

  async function svgToPngBlob(svg, { title, subtitle, scale = 2 } = {}) {
    const bg = cssVar('--panel', '#192124');
    const textColor = cssVar('--text', '#ECEEE9');
    const dimColor = cssVar('--text-dim', '#8B9A9B');
    const { text, w, h } = svgString(svg, bg);
    const img = new Image();
    const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml;charset=utf-8' }));
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const pad = 24;
    const drawW = Math.max(w, 600);
    const outW = drawW + pad * 2;
    const drawH = (h / w) * drawW;
    const headH = title ? 78 : 0;
    const footH = 34;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(outW * scale);
    canvas.height = Math.round((headH + drawH + footH) * scale);
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, outW, headH + drawH + footH);
    if (title) drawHeaderFooter(ctx, outW, headH, title, subtitle, 0, textColor, dimColor, '');
    ctx.drawImage(img, pad, headH, drawW, drawH);
    ctx.fillStyle = dimColor;
    ctx.font = '400 12px "IBM Plex Mono", monospace';
    ctx.fillText('Green Room \u00b7 PSU Phuket \u00b7 ' + new Date().toISOString().slice(0, 10), 24, headH + drawH + 22);
    URL.revokeObjectURL(url);
    return new Promise(res => canvas.toBlob(res, 'image/png'));
  }

  /* CSV from the chart's own hover tooltips: each tooltip is "<strong>label</strong><br>detail<br>detail",
     which is exactly the data the viewer can already read off the chart. */
  function csvRowsFromHost(host) {
    const seen = new Set();
    const rows = [];
    let maxCols = 0;
    host.querySelectorAll('[data-tip]').forEach(el => {
      const tip = el.getAttribute('data-tip') || '';
      if (seen.has(tip)) return;
      seen.add(tip);
      const tmp = document.createElement('div');
      tmp.innerHTML = tip.replace(/<br\s*\/?>/gi, '\n');
      const parts = tmp.textContent.split('\n').map(s => s.trim()).filter(Boolean);
      if (!parts.length) return;
      maxCols = Math.max(maxCols, parts.length);
      rows.push(parts);
    });
    const header = Array.from({ length: maxCols }, (_, i) => (i === 0 ? tr('dl.csv_label', 'label') : `${tr('dl.csv_value', 'value')}_${i}`));
    return [header, ...rows];
  }

  /* attach(host, opts): adds a "Download" button + menu to the top-left of a chart host.
     opts.title/subtitle: strings (or functions returning strings) for PNG header.
     opts.svg: function returning the <svg> to export (defaults to the first chart svg in host).
     opts.png / opts.csv: override exporters (used by the schedule heatmap). */
  function attach(host, opts = {}) {
    if (!host || host.querySelector(':scope > .dl-wrap')) return;
    const wrap = document.createElement('div');
    wrap.className = 'dl-wrap';
    wrap.innerHTML = `
      <button type="button" class="dl-btn" aria-haspopup="true" aria-expanded="false" title="${tr('dl.download', 'Download')}">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 1v8m0 0L5 6m3 3l3-3M2 11v2.5A1.5 1.5 0 003.5 15h9a1.5 1.5 0 001.5-1.5V11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span>${tr('dl.download', 'Download')}</span>
      </button>
      <div class="dl-menu" role="menu">
        <button type="button" role="menuitem" data-fmt="png">${tr('dl.png', 'Image (PNG)')}</button>
        <button type="button" role="menuitem" data-fmt="svg">${tr('dl.svg', 'Vector (SVG)')}</button>
        <button type="button" role="menuitem" data-fmt="csv">${tr('dl.csv', 'Data (CSV)')}</button>
      </div>`;
    if (!getComputedStyle(host).position || getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(wrap);

    const btn = wrap.querySelector('.dl-btn');
    const menu = wrap.querySelector('.dl-menu');
    const close = () => { wrap.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); };
    btn.addEventListener('click', e => {
      e.stopPropagation();
      document.querySelectorAll('.dl-wrap.open').forEach(w => { if (w !== wrap) w.classList.remove('open'); });
      wrap.classList.toggle('open');
      btn.setAttribute('aria-expanded', wrap.classList.contains('open') ? 'true' : 'false');
    });
    document.addEventListener('click', e => { if (!wrap.contains(e.target)) close(); });

    const val = v => (typeof v === 'function' ? v() : v);
    menu.addEventListener('click', async e => {
      const b = e.target.closest('[data-fmt]');
      if (!b) return;
      e.stopPropagation();
      close();
      const fmtKey = b.dataset.fmt;
      const title = val(opts.title) || (host.querySelector('h3') ? host.querySelector('h3').textContent : 'chart');
      const subtitle = val(opts.subtitle) || '';
      const base = slug(title) + (subtitle ? '-' + slug(subtitle) : '');
      try {
        if (fmtKey === 'csv') {
          const rows = opts.csv ? opts.csv() : csvRowsFromHost(host);
          saveCsv(rows, base + '.csv');
          return;
        }
        if (opts.png && fmtKey === 'png') {
          saveBlob(await opts.png({ title, subtitle }), base + '.png');
          return;
        }
        const svg = opts.svg ? opts.svg() : host.querySelector('.chart-zoom-wrap svg, svg.mini-chart, svg');
        if (!svg) return;
        if (fmtKey === 'svg') {
          saveBlob(new Blob([svgString(svg, cssVar('--panel', '#192124')).text], { type: 'image/svg+xml' }), base + '.svg');
        } else {
          saveBlob(await svgToPngBlob(svg, { title, subtitle }), base + '.png');
        }
      } catch (err) {
        console.error('Download failed', err);
      }
    });
  }

  return { attach, saveBlob, saveCsv, svgToPngBlob, cssVar, slug, wrapLines, csvRowsFromHost };
})();
