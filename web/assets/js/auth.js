let currentUser = null;

async function checkAuth() {
  try {
    currentUser = await API.get('/auth/me');
    return true;
  } catch {
    currentUser = null;
    return false;
  }
}

async function requireLogin() {
  const loggedIn = await checkAuth();
  if (!loggedIn) {
    window.location.href = basePath('/login.html');
    return false;
  }
  return true;
}

async function requireAdminRole() {
  const loggedIn = await requireLogin();
  if (!loggedIn) return false;
  if (currentUser.role !== 'ADMIN') {
    window.location.href = basePath('/dashboard.html');
    return false;
  }
  return true;
}

function isAdmin() {
  return currentUser && currentUser.role === 'ADMIN';
}

async function logout() {
  try {
    await API.post('/auth/logout');
  } catch {}
  window.location.href = '/login.html';
}
