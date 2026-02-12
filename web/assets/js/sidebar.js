function initSidebar() {
  const sidebarEl = document.getElementById('sidebar');
  if (!sidebarEl) return;

  const currentPage = window.location.pathname.split('/').pop().replace('.html', '') || 'dashboard';

  const navItems = [
    { section: 'Overzicht', items: [
      { id: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard', href: basePath('/dashboard.html') }
    ]},
    { section: 'Beheer', items: [
      { id: 'leads', label: 'Leads', icon: 'users', href: basePath('/leads.html') },
      { id: 'deals', label: 'Deals', icon: 'handshake', href: basePath('/deals.html') },
      { id: 'packages', label: 'Pakketten', icon: 'package', href: basePath('/packages.html') }
    ]},
    { section: 'Analyse', items: [
      { id: 'stats', label: 'Statistieken', icon: 'bar-chart-3', href: basePath('/stats.html') }
    ]},
    { section: 'Systeem', items: [
      { id: 'users', label: 'Gebruikers', icon: 'shield-check', href: basePath('/users.html'), adminOnly: true },
      { id: 'settings', label: 'Instellingen', icon: 'settings', href: basePath('/settings.html') }
    ]}
  ];

  let navHTML = '';
  navItems.forEach(section => {
    navHTML += `<div class="sidebar-section">
      <div class="sidebar-section-label">${section.section}</div>`;

    section.items.forEach(item => {
      if (item.adminOnly && (!currentUser || currentUser.role !== 'ADMIN')) return;
      const isActive = currentPage === item.id;
      navHTML += `
        <a href="${item.href}" class="sidebar-link ${isActive ? 'active' : ''}">
          <i data-lucide="${item.icon}"></i>
          <span>${item.label}</span>
        </a>`;
    });

    navHTML += '</div>';
  });

  sidebarEl.innerHTML = `
    <div class="sidebar-header">
      <div class="sidebar-logo">
        <img src="${basePath('/assets/images/logo/GrafixStudio_Favicon_Wit.png')}" alt="Logo" style="width:36px;height:36px;border-radius:6px;">
        <span class="sidebar-logo-text">Cold Outreach</span>
      </div>
    </div>
    <nav class="sidebar-nav">${navHTML}</nav>
    <div class="sidebar-footer">
      <div class="sidebar-user">
        <div class="sidebar-avatar">${currentUser ? currentUser.name.charAt(0).toUpperCase() : '?'}</div>
        <div class="sidebar-user-info">
          <div class="sidebar-user-name">${currentUser ? currentUser.name : ''}</div>
          <div class="sidebar-user-role">${currentUser ? (currentUser.role === 'ADMIN' ? 'Admin' : 'Medewerker') : ''}</div>
        </div>
        <button onclick="logout()" class="btn-icon" title="Uitloggen">
          <i data-lucide="log-out"></i>
        </button>
      </div>
    </div>
  `;

  if (window.lucide) lucide.createIcons();
}

function initTopbar(title) {
  const topbarEl = document.getElementById('topbar');
  if (!topbarEl) return;

  topbarEl.innerHTML = `
    <div class="topbar-left">
      <h1 class="topbar-title">${title}</h1>
    </div>
    <div class="topbar-right">
      <div class="topbar-search">
        <i data-lucide="search"></i>
        <input type="text" placeholder="Zoeken..." id="global-search">
      </div>
    </div>
  `;

  if (window.lucide) lucide.createIcons();
}
