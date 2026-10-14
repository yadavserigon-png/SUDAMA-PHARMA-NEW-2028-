// Small fetch wrapper. Token lives in localStorage; every call goes to the same backend.
export const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const TOKEN_KEY = 'sp_token';

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(t) {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* storage blocked */ }
}

export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function api(path, { method = 'GET', body, form, headers = {}, raw = false } = {}) {
  const h = { ...headers };
  const token = getToken();
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form; // FormData - browser sets the multipart boundary
  else if (body !== undefined) {
    h['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${API_BASE}/api${path}`, { method, headers: h, body: payload });
  if (raw) {
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new ApiError(res.status, j.error || `Request failed (${res.status})`, j);
    }
    return res;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token) window.dispatchEvent(new Event('sp:unauthorized'));
    throw new ApiError(res.status, data.error || `Request failed (${res.status})`, data);
  }
  return data;
}

/** Download a protected file (Excel, PDF) using the auth header. */
export async function download(path, fallbackName = 'download') {
  const res = await api(path, { raw: true });
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') || '';
  const name = /filename="([^"]+)"/.exec(cd)?.[1] || fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Open a protected file (prescription image, invoice PDF) in a new tab. */
export async function openProtected(path) {
  const w = window.open('', '_blank');
  try {
    const res = await api(path, { raw: true });
    const url = URL.createObjectURL(await res.blob());
    if (w) w.location.href = url;
    else window.location.href = url;
  } catch (e) {
    if (w) w.close();
    throw e;
  }
}

export const fileUrl = (name) => `/files/${encodeURIComponent(name)}`;
export const publicUrl = (p) => (p && p.startsWith('/uploads') ? `${API_BASE}${p}` : p);

export function newKey() {
  return (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
}
