function initSidebar() {
  const sidebarEl = document.getElementById('sidebar');
  if (!sidebarEl) return;

  const currentPage = window.location.pathname.split('/').pop().replace('.html', '') || 'dashboard';

  const navItems = [
    { section: 'Overzicht', items: [
      { id: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard', href: basePath('/dashboard.html') }
    ]},
    { section: 'Lead Pipeline', items: [
      { id: 'leads', label: 'Leads', icon: 'users', href: basePath('/leads.html'), color: '#60a5fa' },
      { id: 'agenda', label: 'Agenda', icon: 'calendar', href: basePath('/agenda.html') }
    ]},
    { section: 'Klanten & Deals', items: [
      { id: 'clients', label: 'Klanten', icon: 'building-2', href: basePath('/clients.html'), color: '#34d399' },
      { id: 'deals', label: 'Deals', icon: 'handshake', href: basePath('/deals.html'), color: '#34d399' },
      { id: 'hosting', label: 'Hosting', icon: 'server', href: basePath('/hosting.html') },
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
      const colorStyle = item.color ? ` style="color:${item.color}"` : '';
      navHTML += `
        <a href="${item.href}" class="sidebar-link ${isActive ? 'active' : ''}">
          <i data-lucide="${item.icon}"${colorStyle}></i>
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
      <button class="sidebar-toggle" onclick="toggleSidebar()" aria-label="Menu">
        <i data-lucide="menu"></i>
      </button>
      <h1 class="topbar-title">${title}</h1>
    </div>
    <div class="topbar-right">
      <div class="topbar-search">
        <i data-lucide="search"></i>
        <input type="text" placeholder="Zoeken..." id="global-search">
      </div>
    </div>
  `;

  if (!document.getElementById('sidebar-backdrop')) {
    const backdrop = document.createElement('div');
    backdrop.id = 'sidebar-backdrop';
    backdrop.className = 'sidebar-backdrop';
    backdrop.onclick = () => toggleSidebar(false);
    document.body.appendChild(backdrop);
  }

  if (window.lucide) lucide.createIcons();
}

function toggleSidebar(forceState) {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (!sidebar) return;

  const isOpen = typeof forceState === 'boolean' ? forceState : !sidebar.classList.contains('open');

  if (isOpen) {
    sidebar.classList.add('open');
    if (backdrop) backdrop.classList.add('active');
  } else {
    sidebar.classList.remove('open');
    if (backdrop) backdrop.classList.remove('active');
  }
}
