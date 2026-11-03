import { Router } from 'express';
import crypto from 'node:crypto';
import { query } from '../config/db.js';
import { authenticate, requireAgent, requireAdmin, optionalAuth, ALL_PRIVILEGES } from '../middleware/auth.js';
import { asyncHandler, badRequest, notFound } from '../utils/errors.js';
import { crudRouter } from '../utils/crud.js';
import { slugify, toArray } from '../utils/helpers.js';
import { refreshStatuses } from '../utils/statuses.js';

const router = Router();

// Portal pages need these without an agent login.
router.get('/ticket-statuses/public', asyncHandler(async (_req, res) => {
  const { rows } = await query('SELECT key, label, customer_label, stops_sla, is_default FROM ticket_statuses ORDER BY position, key');
  res.json({ data: rows });
}));
router.get('/ticket-forms/public', optionalAuth, asyncHandler(async (_req, res) => {
  const { rows } = await query('SELECT id, name, description, type, product_id, group_id, field_names FROM ticket_forms WHERE is_active = TRUE ORDER BY position, id');
  res.json({ data: rows });
}));
router.get('/surveys/active', asyncHandler(async (_req, res) => {
  const { rows } = await query('SELECT id, name, question, labels FROM surveys WHERE is_active = TRUE ORDER BY id LIMIT 1');
  res.json({ data: rows[0] || null });
}));

router.use(authenticate, requireAgent);

router.use('/ticket-statuses', crudRouter({
  table: 'ticket_statuses', idColumn: 'key', label: 'Status', orderBy: 'position, key',
  fields: ['label', 'customer_label', 'stops_sla', 'position'], required: ['label'],
  beforeSave: (b) => {
    if (b.label && !b.key) b.key = slugify(b.label).replace(/-/g, '_');
    if (b.label && !b.customer_label) b.customer_label = b.label;
  },
  canDelete: async (key) => {
    const { rows: [s] } = await query('SELECT is_default FROM ticket_statuses WHERE key = $1', [key]);
    if (s?.is_default) throw badRequest('Built-in statuses cannot be deleted');
    const { rows: [used] } = await query('SELECT COUNT(*) FROM tickets WHERE status = $1', [key]);
    if (Number(used.count)) throw badRequest(`${used.count} ticket(s) still use this status`);
  },
  afterChange: refreshStatuses,
}));
router.use('/products', crudRouter({ table: 'products', fields: ['name', 'description', 'support_email', 'portal_name'], required: ['name'], orderBy: 'name', label: 'Product' }));
router.use('/agent-statuses', crudRouter({ table: 'agent_statuses', fields: ['name', 'emoji', 'accepts_tickets', 'position'], required: ['name'], orderBy: 'position, id', label: 'Agent status' }));
router.use('/ticket-templates', crudRouter({
  table: 'ticket_templates', orderBy: 'name', label: 'Template', required: ['name'],
  fields: ['name', 'description', 'parent_template_id', 'subject', 'body', 'priority', 'status', 'type', 'group_id', 'responder_id', 'product_id', 'tags'],
  beforeSave: (b) => { if (b.tags !== undefined) b.tags = toArray(b.tags); },
}));
router.use('/ticket-forms', crudRouter({
  table: 'ticket_forms', orderBy: 'position, id', label: 'Form', required: ['name'],
  fields: ['name', 'description', 'type', 'product_id', 'group_id', 'field_names', 'is_active', 'position'],
  beforeSave: (b) => { if (b.field_names !== undefined) b.field_names = toArray(b.field_names); },
}));
router.use('/entity-fields', crudRouter({
  table: 'entity_fields', orderBy: 'entity, position, id', label: 'Field', required: ['entity', 'label'], json: ['options'],
  fields: ['entity', 'name', 'label', 'field_type', 'options', 'position'],
  beforeSave: (b) => { if (b.label && !b.name) b.name = slugify(b.label).replace(/-/g, '_'); },
}));
router.use('/surveys', crudRouter({
  table: 'surveys', orderBy: 'id', label: 'Survey', required: ['name'], json: ['labels'], fields: ['name', 'question', 'labels', 'is_active'],
  beforeSave: (b) => { if (b.labels !== undefined && (!Array.isArray(b.labels) || b.labels.length < 2 || b.labels.length > 7)) throw badRequest('A survey needs 2 to 7 answer labels'); },
  // Only one survey can be sent at a time.
  afterChange: async (row) => { if (row?.is_active) await query('UPDATE surveys SET is_active = FALSE WHERE id <> $1', [row.id]); },
}));
router.use('/mailboxes', crudRouter({ table: 'mailboxes', fields: ['name', 'email', 'group_id', 'product_id', 'is_default'], required: ['name', 'email'], orderBy: 'name', label: 'Mailbox' }));
router.use('/email-notifications', crudRouter({ table: 'email_notifications', idColumn: 'key', fields: ['is_enabled', 'subject', 'body'], orderBy: 'audience DESC, key', label: 'Notification' }));

// ---------------- roles
const syncRoleUsers = async (role) => {
  if (role) await query('UPDATE users SET role = $1 WHERE role_id = $2', [role.privileges.includes('manage_admin') ? 'admin' : 'agent', role.id]);
};
router.use('/roles', crudRouter({
  table: 'roles', orderBy: 'id', label: 'Role', required: ['name'], fields: ['name', 'description', 'privileges'],
  beforeSave: async (b, req) => {
    if (b.privileges !== undefined) {
      b.privileges = toArray(b.privileges).filter((p) => ALL_PRIVILEGES.includes(p));
    }
    if (req.params.id) {
      const { rows: [role] } = await query('SELECT is_default FROM roles WHERE id = $1', [req.params.id]);
      if (role?.is_default) throw badRequest('Built-in roles cannot be changed. Create a new role instead.');
    }
  },
  canDelete: async (id) => {
    const { rows: [role] } = await query('SELECT is_default, (SELECT COUNT(*) FROM users WHERE role_id = $1) AS users FROM roles WHERE id = $1', [id]);
    if (role?.is_default) throw badRequest('Built-in roles cannot be deleted');
    if (Number(role?.users)) throw badRequest('Move the agents off this role first');
  },
  afterChange: syncRoleUsers,
}));

// ---------------- scenarios: visible by scope, written by admins
router.get('/scenarios', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT s.*, u.name AS owner_name, g.name AS group_name FROM scenarios s LEFT JOIN users u ON u.id = s.user_id LEFT JOIN groups g ON g.id = s.group_id
      WHERE s.visibility = 'all' OR s.user_id = $1 OR $2 = 'admin'
         OR (s.visibility = 'group' AND s.group_id IN (SELECT group_id FROM group_members WHERE user_id = $1))
      ORDER BY s.name`, [req.user.id, req.user.role]
  );
  res.json({ data: rows });
}));
router.post('/scenarios', requireAdmin, asyncHandler(async (req, res) => {
  const b = req.body;
  if (!b.name) throw badRequest('name is required');
  const { rows } = await query(
    `INSERT INTO scenarios (name, description, visibility, group_id, user_id, actions) VALUES ($1,$2,COALESCE($3,'all'),$4,$5,$6) RETURNING *`,
    [b.name, b.description || null, b.visibility || null, b.group_id || null, req.user.id, JSON.stringify(b.actions || [])]
  );
  res.status(201).json({ data: rows[0] });
}));
router.put('/scenarios/:id', requireAdmin, asyncHandler(async (req, res) => {
  const b = req.body;
  const { rows } = await query(
    `UPDATE scenarios SET name = COALESCE($2,name), description = $3, visibility = COALESCE($4,visibility), group_id = $5, actions = COALESCE($6,actions) WHERE id = $1 RETURNING *`,
    [req.params.id, b.name || null, b.description || null, b.visibility || null, b.group_id || null, b.actions ? JSON.stringify(b.actions) : null]
  );
  if (!rows[0]) throw notFound('Scenario');
  res.json({ data: rows[0] });
}));
router.delete('/scenarios/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { rowCount } = await query('DELETE FROM scenarios WHERE id = $1', [req.params.id]);
  if (!rowCount) throw notFound('Scenario');
  res.json({ ok: true });
}));

// ---------------- channels: token for the inbound webhook, shown to admins only
router.get('/channels/token', requireAdmin, asyncHandler(async (_req, res) => {
  const { rows } = await query("SELECT value FROM settings WHERE key = 'inbound'");
  res.json({ data: { token: rows[0]?.value?.token || null } });
}));
router.post('/channels/token', requireAdmin, asyncHandler(async (_req, res) => {
  const token = crypto.randomBytes(24).toString('hex');
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('inbound', $1, NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [JSON.stringify({ token })]
  );
  res.json({ data: { token } });
}));

// ---------------- operations
router.get('/audit-log', requireAdmin, asyncHandler(async (_req, res) => {
  const { rows } = await query('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 200');
  res.json({ data: rows });
}));
router.get('/outbox', asyncHandler(async (req, res) => {
  const params = [];
  let where = '';
  if (req.query.status) { params.push(req.query.status); where = 'WHERE status = $1'; }
  const { rows } = await query(`SELECT * FROM email_outbox ${where} ORDER BY created_at DESC LIMIT 200`, params);
  res.json({ data: rows });
}));

export default router;
