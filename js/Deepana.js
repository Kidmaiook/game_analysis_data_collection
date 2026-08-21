document.addEventListener('DOMContentLoaded', () => {
    // 2. Full-Screen Image Modal Logic
    const modal = document.getElementById('image-modal');
    const modalImg = document.getElementById('modal-img');
    const modalCaption = document.getElementById('modal-caption');
    const modalClose = document.getElementById('modal-close');

    function openModal(imageSrc, title) {
        if (!modal || !modalImg || !modalCaption) return;
        modalImg.src = imageSrc;
        modalCaption.textContent = title;
        modal.classList.add('open');
    }

    function closeModal() {
        if (modal) modal.classList.remove('open');
    }

    if (modalClose) modalClose.addEventListener('click', closeModal);
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

    // 3. Fetch External JSON Data
    let pageData = null;

    fetch('DA.json')
        .then(response => {
            if (!response.ok) throw new Error('Failed to load JSON');
            return response.json();
        })
        .then(data => {
            pageData = data;
            const categories = data.Info || data.periods || [];
            if (categories.length > 0) {
                setupFilters(categories);
                renderCards(categories[0]);
            }
        })
        .catch(error => {
            console.error('JSON Load Error:', error);
            const grid = document.getElementById('dashboard-grid');
            if (grid) {
                grid.innerHTML = `<p class="no-data">Unable to load data.json. Ensure file exists or run via Live Server.</p>`;
            }
        });

    // 4. Render Category Buttons
    function setupFilters(categories) {
        const btnContainer = document.getElementById('filter-buttons');
        if (!btnContainer) return;

        btnContainer.innerHTML = categories.map((cat, i) => `
            <button class="filter-btn ${i === 0 ? 'active' : ''}" data-period="${cat}">${cat}</button>
        `).join('');

        btnContainer.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                btnContainer.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                e.currentTarget.classList.add('active');
                renderCards(e.currentTarget.getAttribute('data-period'));
            });
        });
    }

    // 5. Render Cards (Preserving your exact layout & classes)
    function renderCards(category) {
        const grid = document.getElementById('dashboard-grid');
        if (!grid || !pageData || !pageData.charts) return;

        const cards = pageData.charts[category] || [];

        if (cards.length === 0) {
            grid.innerHTML = `<p class="no-data">No analysis data available for ${category}.</p>`;
            return;
        }

        grid.innerHTML = cards.map(card => {
            // Find the image array dynamically even if keys vary
            let imageList = [];
            if (Array.isArray(card.images)) {
                imageList = card.images;
            } else {
                for (let key in card) {
                    if (Array.isArray(card[key])) {
                        imageList = card[key];
                        break;
                    }
                }
            }

            const cardTitle = typeof card.title === 'string' ? card.title : '';
            const cardDesc = typeof card.description === 'string' ? card.description : '';

            return `
                <div class="multi-card">
                    ${cardTitle ? `
                        <div class="card-content-top">
                            <h2>${cardTitle}</h2>
                        </div>
                    ` : ''}

                    <div class="card-images-row">
                        ${imageList.map(img => `
                            <div class="img-wrapper">
                                <img src="${img.url || img.image || ''}" 
                                     alt="${img.label || cardTitle || 'Chart'}" 
                                     class="zoomable-img" 
                                     onerror="this.src='https://via.placeholder.com/400x240?text=${encodeURIComponent(img.label || 'Image')}';">
                                ${img.label ? `<span class="img-label">${img.label}</span>` : ''}
                            </div>
                        `).join('')}
                    </div>

                    <div class="card-content-bottom">
                        <p>${cardDesc}</p>
                    </div>
                </div>
            `;
        }).join('');

        // Attach zoom listeners to images
        grid.querySelectorAll('.zoomable-img').forEach(img => {
            img.addEventListener('click', () => {
                openModal(img.src, img.alt);
            });
        });
    }
});