// Network helpers with retry/backoff and base URL detection

const DEFAULT_BASE = 'http://localhost:8080';

export function getApiBase() {
  try {
    const ls = localStorage.getItem('snhelp_api_base');
    if (ls && /^https?:\/\//i.test(ls)) return ls.replace(/\/$/, '');
  } catch {}
  return DEFAULT_BASE;
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export async function request(path, { method = 'GET', body = undefined, headers = {}, retries = 2, retryDelay = 350 } = {}) {
  const url = getApiBase() + path;
  const finalHeaders = { 'Accept': 'application/json', ...headers };
  let payload = undefined;
  if (body !== undefined) {
    finalHeaders['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let attempt = 0, lastErr = null;
  while (attempt <= retries) {
    try {
      const resp = await fetch(url, { method, headers: finalHeaders, body: payload, mode: 'cors', credentials: 'omit' });
      const ct = resp.headers.get('content-type') || '';
      let data = null;
      if (ct.includes('application/json')) {
        data = await resp.json();
      } else {
        const txt = await resp.text();
        try { data = JSON.parse(txt); } catch { data = { text: txt }; }
      }
      if (!resp.ok) {
        const err = new Error((data && data.detail) || `HTTP ${resp.status}`);
        err.status = resp.status;
        err.data = data;
        throw err;
      }
      return data;
    } catch (e) {
      lastErr = e;
      if (attempt >= retries) break;
      const backoff = retryDelay * Math.pow(2, attempt);
      await sleep(backoff);
      attempt++;
    }
  }
  throw lastErr || new Error('Network error');
}
