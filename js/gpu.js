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



DataStore.data().then(DATA => {

  renderGpu(DATA);
});


function renderGpu(DATA) {
  const gpu = DATA.gpu_market || {};
  const grid = document.getElementById('gpuGrid');
  if (!gpu.avg_price_by_month) {
    grid.innerHTML = `<div class="empty-state">No GPU price data available.</div>`;
    return;
  }
  const chartBlock = gpu.chart
    ? `<img src="${gpu.chart}" alt="Average tracked GPU price by month">`
    : Object.entries(gpu.avg_price_by_month)
        .map(([m, v]) => `<div class="gpu-row"><span>${m}</span><span class="v">$${v.toFixed(0)}</span></div>`).join('');
  const cheapRows = (gpu.cheapest_models || [])
    .map(m => `<div class="gpu-row"><span>${m.model}</span><span class="v">$${m.avg_price.toFixed(0)}</span></div>`).join('');
  grid.innerHTML = `
    <div class="gpu-card gpu-card-chart"><h3>Avg. tracked GPU price by month</h3>${chartBlock}</div>
    <div class="gpu-card"><h3>Best value cards tracked</h3>${cheapRows}</div>
  `;
}
