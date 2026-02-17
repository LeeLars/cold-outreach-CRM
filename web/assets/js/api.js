const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? ''
  : 'https://cold-outreach-crm-production.up.railway.app';

const API = {
  _cache: new Map(),
  _inflight: new Map(),
  _cacheTTL: 30000,

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

  get(url, { cache = false } = {}) {
    if (cache) {
      const cached = this._cache.get(url);
      if (cached && Date.now() - cached.ts < this._cacheTTL) {
        return Promise.resolve(cached.data);
      }
    }

    if (this._inflight.has(url)) {
      return this._inflight.get(url);
    }

    const promise = this.request(url).then(data => {
      this._inflight.delete(url);
      if (cache) {
        this._cache.set(url, { data, ts: Date.now() });
      }
      return data;
    }).catch(err => {
      this._inflight.delete(url);
      throw err;
    });

    this._inflight.set(url, promise);
    return promise;
  },

  post(url, body) {
    this._cache.clear();
    return this.request(url, { method: 'POST', body });
  },

  put(url, body) {
    this._cache.clear();
    return this.request(url, { method: 'PUT', body });
  },

  delete(url, body) {
    this._cache.clear();
    return this.request(url, { method: 'DELETE', body });
  },

  upload(url, formData) {
    this._cache.clear();
    return this.request(url, {
      method: 'POST',
      body: formData
    });
  },

  invalidate(url) {
    if (url) this._cache.delete(url);
    else this._cache.clear();
  }
};
