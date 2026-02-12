function showToast(message, type = 'success') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <i data-lucide="${type === 'success' ? 'check-circle' : type === 'error' ? 'x-circle' : 'alert-triangle'}"></i>
    <span>${message}</span>
  `;
  container.appendChild(toast);
  if (window.lucide) lucide.createIcons();

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function openModal(id) {
  const overlay = document.getElementById(id);
  if (overlay) overlay.classList.add('active');
}

function closeModal(id) {
  const overlay = document.getElementById(id);
  if (overlay) overlay.classList.remove('active');
}

function openSlideOver(id) {
  const overlay = document.getElementById(id + '-overlay');
  const panel = document.getElementById(id);
  if (overlay) overlay.classList.add('active');
  if (panel) panel.classList.add('active');
}

function closeSlideOver(id) {
  const overlay = document.getElementById(id + '-overlay');
  const panel = document.getElementById(id);
  if (overlay) overlay.classList.remove('active');
  if (panel) panel.classList.remove('active');
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('nl-NL', {
    style: 'currency',
    currency: 'EUR'
  }).format(amount);
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('nl-NL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

function formatDateTime(dateStr) {
  return new Date(dateStr).toLocaleString('nl-NL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

const STATUS_LABELS = {
  NIEUW: 'Nieuw',
  VERSTUURD: 'Verstuurd',
  GEEN_REACTIE: 'Geen reactie',
  GEREAGEERD: 'Gereageerd',
  AFSPRAAK: 'Afspraak geboekt',
  KLANT: 'Klant',
  NIET_GEINTERESSEERD: 'Niet geinteresseerd'
};

function statusBadge(status) {
  return `<span class="status-badge ${status}">${STATUS_LABELS[status] || status}</span>`;
}

function renderPagination(container, { page, totalPages, total }, onPageChange) {
  const start = ((page - 1) * 50) + 1;
  const end = Math.min(page * 50, total);

  container.innerHTML = `
    <div class="pagination">
      <span class="pagination-info">${start}-${end} van ${total} resultaten</span>
      <div class="pagination-buttons">
        <button class="btn btn-secondary btn-sm" ${page <= 1 ? 'disabled' : ''} data-page="${page - 1}">
          <i data-lucide="chevron-left"></i> Vorige
        </button>
        <button class="btn btn-secondary btn-sm" ${page >= totalPages ? 'disabled' : ''} data-page="${page + 1}">
          Volgende <i data-lucide="chevron-right"></i>
        </button>
      </div>
    </div>
  `;

  container.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!btn.disabled) onPageChange(parseInt(btn.dataset.page));
    });
  });

  if (window.lucide) lucide.createIcons();
}
