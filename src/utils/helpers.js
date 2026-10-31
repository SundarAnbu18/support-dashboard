import { badRequest } from './errors.js';

export function pagination(q, defaults = { per_page: 25 }) {
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const perPage = Math.min(200, Math.max(1, parseInt(q.per_page, 10) || defaults.per_page));
  return { page, perPage, offset: (page - 1) * perPage };
}

export function toArray(v) {
  if (v === undefined || v === null || v === '') return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (trimmed.startsWith('[')) {
      try { return JSON.parse(trimmed); } catch { /* fallthrough */ }
    }
    return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [v];
}

export function toInt(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

export function toBool(v) {
  if (typeof v === 'boolean') return v;
  if (v === undefined || v === null || v === '') return undefined;
  return ['true', '1', 'yes', 'on'].includes(String(v).toLowerCase());
}

// Multipart bodies arrive with everything as strings; decode JSON-looking fields.
export function normalizeBody(body = {}) {
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    if (typeof v === 'string') {
      const t = v.trim();
      if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
        try { out[k] = JSON.parse(t); continue; } catch { /* keep string */ }
      }
    }
    out[k] = v;
  }
  return out;
}

export function requireFields(body, fields) {
  const missing = fields.filter((f) => body[f] === undefined || body[f] === null || body[f] === '');
  if (missing.length) throw badRequest(`Missing required fields: ${missing.join(', ')}`, { missing });
}

export function slugify(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

// Builds "SET col = $n" fragments from an allow-list of fields.
export function buildUpdate(data, allowed, startIndex = 1) {
  const sets = [];
  const values = [];
  let i = startIndex;
  for (const key of allowed) {
    if (data[key] !== undefined) {
      sets.push(`${key} = $${i++}`);
      values.push(data[key]);
    }
  }
  return { sets, values, nextIndex: i };
}

export const PRIORITY_ORDER = { urgent: 4, high: 3, medium: 2, low: 1 };
export const STATUSES = ['open', 'pending', 'resolved', 'closed'];
export const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
export const TYPES = ['question', 'incident', 'problem', 'feature_request', 'refund', 'other'];
export const SOURCES = ['email', 'portal', 'phone', 'chat', 'social', 'agent'];
