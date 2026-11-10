export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || `Request failed (${res.status})`);
    e.status = res.status;
    throw e;
  }
  return data;
}

export const get = (p) => api(p);
export const post = (p, body = {}) => api(p, { method: 'POST', body });
export const put = (p, body = {}) => api(p, { method: 'PUT', body });
export const patch = (p, body = {}) => api(p, { method: 'PATCH', body });
export const del = (p) => api(p, { method: 'DELETE' });
