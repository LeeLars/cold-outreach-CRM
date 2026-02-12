const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? ''
  : 'https://cold-outreach-crm-production.up.railway.app';

const API = {
  async request(url, options = {}) {
    const config = {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      ...options
    };

    if (config.body && typeof config.body === 'object' && !(config.body instanceof FormData)) {
      config.body = JSON.stringify(config.body);
    }

    if (config.body instanceof FormData) {
      delete config.headers['Content-Type'];
    }

    const res = await fetch(`${API_BASE}/api${url}`, config);
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Er is iets misgegaan');
    }

    return data;
  },

  get(url) {
    return this.request(url);
  },

  post(url, body) {
    return this.request(url, { method: 'POST', body });
  },

  put(url, body) {
    return this.request(url, { method: 'PUT', body });
  },

  delete(url, body) {
    return this.request(url, { method: 'DELETE', body });
  },

  upload(url, formData) {
    return this.request(url, {
      method: 'POST',
      body: formData
    });
  }
};
