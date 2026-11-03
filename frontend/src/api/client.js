import axios from 'axios';

export const TOKEN_KEY = 'sd_token';

export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api' });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && !err.config.url.includes('/auth/login')) {
      localStorage.removeItem(TOKEN_KEY);
      if (!window.location.pathname.startsWith('/login')) window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export const errorMessage = (err) => err?.response?.data?.error || err?.message || 'Something went wrong';

// Convenience: unwrap { data } envelopes.
export const get = (url, params) => api.get(url, { params }).then((r) => r.data);
export const post = (url, body) => api.post(url, body).then((r) => r.data);
export const put = (url, body) => api.put(url, body).then((r) => r.data);
export const patch = (url, body) => api.patch(url, body).then((r) => r.data);
export const del = (url, params) => api.delete(url, { params }).then((r) => r.data);

// Fetches an authenticated CSV/file and hands it to the browser as a download.
export async function downloadFile(url, filename, body) {
  const res = body ? await api.post(url, body, { responseType: 'blob' }) : await api.get(url, { responseType: 'blob' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(res.data);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function postForm(url, fields, files = []) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    fd.append(k, typeof v === 'object' ? JSON.stringify(v) : v);
  }
  for (const f of files) fd.append('attachments', f);
  return api.post(url, fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data);
}
