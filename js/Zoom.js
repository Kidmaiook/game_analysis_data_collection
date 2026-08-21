document.addEventListener('DOMContentLoaded', () => {
  // 2. Modal Logic Setup
  const modal = document.getElementById('image-modal');
  const modalImg = document.getElementById('modal-img');
  const modalCaption = document.getElementById('modal-caption');
  const modalClose = document.getElementById('modal-close');

  function openModal(imageSrc, title) {
    modalImg.src = imageSrc;
    modalCaption.textContent = title;
    modal.classList.add('open');
  }

  function closeModal() {
    modal.classList.remove('open');
  }

  if (modalClose) {
    modalClose.addEventListener('click', closeModal);
  }

  // Close modal when clicking outside the image or pressing ESC
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal && modal.classList.contains('open')) {
      closeModal();
    }
  });

  // 3. Fetch JSON and Render Content
  let dashboardData = null;

  fetch('insights.json')
    .then(response => response.json())
    .then(data => {
      dashboardData = data;
      setupFilters(data.periods);
      if (data.periods && data.periods.length > 0) {
        renderCharts(data.periods[0]);
      }
    })
    .catch(error => console.error('Error loading JSON data:', error));

  function setupFilters(periods) {
    const btnContainer = document.getElementById('filter-buttons');
    const dropdown = document.getElementById('period-dropdown');

    if (periods.length > 6) {
      btnContainer.style.display = 'none';
      dropdown.style.display = 'block';
      dropdown.innerHTML = periods.map(p => `<option value="${p}">${p}</option>`).join('');
      dropdown.addEventListener('change', (e) => renderCharts(e.target.value));
    } else {
      dropdown.style.display = 'none';
      btnContainer.style.display = 'flex';
      btnContainer.innerHTML = periods.map((p, i) => `
        <button class="filter-btn ${i === 0 ? 'active' : ''}" data-period="${p}">${p}</button>
      `).join('');

      btnContainer.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          btnContainer.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
          e.target.classList.add('active');
          renderCharts(e.target.getAttribute('data-period'));
        });
      });
    }
  }

  function renderCharts(period) {
    const grid = document.getElementById('dashboard-grid');
    if (!grid || !dashboardData) return;

    const charts = (dashboardData.charts && dashboardData.charts[period]) || [];

    if (charts.length === 0) {
      grid.innerHTML = `<p class="no-data">No chart data available for ${period}.</p>`;
      return;
    }

    grid.innerHTML = charts.map(chart => `
      <div class="graph-card">
        <div class="card-image">
          <img src="${chart.image}" alt="${chart.title}" class="zoomable-img" onerror="this.src='https://via.placeholder.com/500x320?text=Image+Not+Found'">
        </div>
        <div class="card-content">
          <span class="badge">${period}</span>
          <h2>${chart.title}</h2>
          <p>${chart.description}</p>
        </div>
      </div>
    `).join('');

    // Attach click event to all zoomable images after rendering
    grid.querySelectorAll('.zoomable-img').forEach(img => {
      img.addEventListener('click', () => {
        openModal(img.src, img.alt);
      });
    });
  }
});