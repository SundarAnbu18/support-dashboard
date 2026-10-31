import { Router } from 'express';
import { query } from '../config/db.js';
import { authenticate, requireAgent, requireAdmin, optionalAuth } from '../middleware/auth.js';
import { asyncHandler, notFound, badRequest } from '../utils/errors.js';
import { requireFields, buildUpdate, slugify } from '../utils/helpers.js';

const router = Router();

const DEFAULT_SETTINGS = {
  helpdesk: { name: 'SupportDesk', portal_name: 'Help Center', support_email: 'support@supportdesk.local', primary_color: '#2563eb', language: 'en', time_zone: 'UTC', portal_signup_enabled: true },
  tickets: { default_priority: 'low', default_status: 'open', auto_close_after_days: 7, allow_customer_close: true, csat_enabled: true, agent_collision: true },
  notifications: { notify_assignee: true, notify_group_on_new: true, notify_requester_on_reply: true },
};

// Public branding for the login/portal pages.
router.get('/public', optionalAuth, asyncHandler(async (_req, res) => {
  const { rows } = await query("SELECT value FROM settings WHERE key = 'helpdesk'");
  res.json({ data: { ...DEFAULT_SETTINGS.helpdesk, ...(rows[0]?.value || {}) } });
}));

router.use(authenticate, requireAgent);

router.get('/', asyncHandler(async (_req, res) => {
  const { rows } = await query('SELECT key, value FROM settings');
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = { ...(DEFAULT_SETTINGS[r.key] || {}), ...r.value };
  res.json({ data: out });
}));

router.put('/:key', requireAdmin, asyncHandler(async (req, res) => {
  const key = req.params.key;
  if (!DEFAULT_SETTINGS[key]) throw badRequest('Unknown settings group');
  const { rows: existing } = await query('SELECT value FROM settings WHERE key = $1', [key]);
  const merged = { ...DEFAULT_SETTINGS[key], ...(existing[0]?.value || {}), ...req.body };
  await query(
    'INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()',
    [key, JSON.stringify(merged)]
  );
  res.json({ data: merged });
}));

// ---------------- business hours
router.get('/business-hours', asyncHandler(async (_req, res) => {
  const { rows } = await query('SELECT * FROM business_hours ORDER BY is_default DESC, name');
  res.json({ data: rows });
}));
router.post('/business-hours', requireAdmin, asyncHandler(async (req, res) => {
  const b = req.body;
  requireFields(b, ['name']);
  const { rows } = await query(
    'INSERT INTO business_hours (name, description, time_zone, is_default, always_open, schedule, holidays) VALUES ($1,$2,COALESCE($3,\'UTC\'),COALESCE($4,FALSE),COALESCE($5,FALSE),$6,$7) RETURNING *',
    [b.name, b.description || null, b.time_zone, b.is_default, b.always_open, JSON.stringify(b.schedule || {}), JSON.stringify(b.holidays || [])]
  );
  if (rows[0].is_default) await query('UPDATE business_hours SET is_default = FALSE WHERE id <> $1', [rows[0].id]);
  res.status(201).json({ data: rows[0] });
}));
router.put('/business-hours/:id', requireAdmin, asyncHandler(async (req, res) => {
  const b = { ...req.body };
  if (b.schedule !== undefined) b.schedule = JSON.stringify(b.schedule);
  if (b.holidays !== undefined) b.holidays = JSON.stringify(b.holidays);
  const { sets, values } = buildUpdate(b, ['name', 'description', 'time_zone', 'is_default', 'always_open', 'schedule', 'holidays']);
  if (!sets.length) throw badRequest('Nothing to update');
  values.push(req.params.id);
  const { rows } = await query(`UPDATE business_hours SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`, values);
  if (!rows[0]) throw notFound('Business hours');
  if (rows[0].is_default) await query('UPDATE business_hours SET is_default = FALSE WHERE id <> $1', [rows[0].id]);
  res.json({ data: rows[0] });
}));
router.delete('/business-hours/:id', requireAdmin, asyncHandler(async (req, res) => {
  await query('DELETE FROM business_hours WHERE id = $1 AND is_default = FALSE', [req.params.id]);
  res.json({ ok: true });
}));

// ---------------- ticket fields (custom fields)
router.get('/ticket-fields', asyncHandler(async (_req, res) => {
  const { rows } = await query('SELECT * FROM ticket_fields ORDER BY position, id');
  res.json({ data: rows });
}));
router.post('/ticket-fields', requireAdmin, asyncHandler(async (req, res) => {
  const b = req.body;
  requireFields(b, ['label', 'field_type']);
  const name = slugify(b.name || b.label).replace(/-/g, '_');
  const { rows } = await query(
    `INSERT INTO ticket_fields (name, label, field_type, options, required_for_agents, required_for_customers, visible_to_customers, position)
     VALUES ($1,$2,$3,$4,COALESCE($5,FALSE),COALESCE($6,FALSE),COALESCE($7,TRUE),COALESCE($8,(SELECT COALESCE(MAX(position),0)+1 FROM ticket_fields))) RETURNING *`,
    [name, b.label, b.field_type, JSON.stringify(b.options || []), b.required_for_agents, b.required_for_customers, b.visible_to_customers, b.position || null]
  );
  res.status(201).json({ data: rows[0] });
}));
router.put('/ticket-fields/:id', requireAdmin, asyncHandler(async (req, res) => {
  const b = { ...req.body };
  if (b.options !== undefined) b.options = JSON.stringify(b.options);
  const { sets, values } = buildUpdate(b, ['label', 'field_type', 'options', 'required_for_agents', 'required_for_customers', 'visible_to_customers', 'position']);
  if (!sets.length) throw badRequest('Nothing to update');
  values.push(req.params.id);
  const { rows } = await query(`UPDATE ticket_fields SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`, values);
  if (!rows[0]) throw notFound('Ticket field');
  res.json({ data: rows[0] });
}));
router.delete('/ticket-fields/:id', requireAdmin, asyncHandler(async (req, res) => {
  await query('DELETE FROM ticket_fields WHERE id = $1 AND is_default = FALSE', [req.params.id]);
  res.json({ ok: true });
}));

export default router;
