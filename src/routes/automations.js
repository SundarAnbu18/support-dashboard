import { Router } from 'express';
import { query } from '../config/db.js';
import { authenticate, requireAgent, requireAdmin } from '../middleware/auth.js';
import { asyncHandler, notFound, badRequest } from '../utils/errors.js';
import { requireFields, buildUpdate } from '../utils/helpers.js';
import { runTimeTriggers, runAutomations } from '../utils/automations.js';

const router = Router();
router.use(authenticate, requireAgent);

export const AUTOMATION_META = {
  events: ['ticket_created', 'ticket_updated', 'time_trigger'],
  fields: [
    { key: 'subject', label: 'Subject', type: 'text' },
    { key: 'description', label: 'Description', type: 'text' },
    { key: 'status', label: 'Status', type: 'select', options: ['open', 'pending', 'resolved', 'closed'] },
    { key: 'priority', label: 'Priority', type: 'select', options: ['low', 'medium', 'high', 'urgent'] },
    { key: 'type', label: 'Type', type: 'select', options: ['question', 'incident', 'problem', 'feature_request', 'refund', 'other'] },
    { key: 'source', label: 'Source', type: 'select', options: ['email', 'portal', 'phone', 'chat', 'social', 'agent'] },
    { key: 'group_id', label: 'Group', type: 'group' },
    { key: 'responder_id', label: 'Agent', type: 'agent' },
    { key: 'tags', label: 'Tags', type: 'text' },
    { key: 'requester_email', label: 'Requester email', type: 'text' },
    { key: 'requester_domain', label: 'Requester domain', type: 'text' },
    { key: 'company_name', label: 'Company name', type: 'text' },
    { key: 'has_responder', label: 'Is assigned', type: 'boolean' },
    { key: 'first_responded', label: 'Has first response', type: 'boolean' },
    { key: 'hours_since_created', label: 'Hours since created', type: 'number' },
    { key: 'hours_since_updated', label: 'Hours since updated', type: 'number' },
    { key: 'hours_until_due', label: 'Hours until due', type: 'number' },
    { key: 'hours_since_due', label: 'Hours since due', type: 'number' },
  ],
  operators: ['is', 'is_not', 'contains', 'not_contains', 'starts_with', 'ends_with', 'in', 'not_in', 'greater_than', 'less_than', 'is_empty', 'is_not_empty'],
  actions: [
    { key: 'set_priority', label: 'Set priority', value: 'select', options: ['low', 'medium', 'high', 'urgent'] },
    { key: 'set_status', label: 'Set status', value: 'select', options: ['open', 'pending', 'resolved', 'closed'] },
    { key: 'set_type', label: 'Set type', value: 'select', options: ['question', 'incident', 'problem', 'feature_request', 'refund', 'other'] },
    { key: 'assign_group', label: 'Assign to group', value: 'group' },
    { key: 'assign_agent', label: 'Assign to agent', value: 'agent' },
    { key: 'add_tag', label: 'Add tag', value: 'text' },
    { key: 'remove_tag', label: 'Remove tag', value: 'text' },
    { key: 'add_note', label: 'Add private note', value: 'textarea' },
    { key: 'notify_agent', label: 'Notify agent', value: 'agent' },
    { key: 'notify_group', label: 'Notify group', value: 'group' },
    { key: 'notify_assignee', label: 'Notify assignee', value: 'none' },
    { key: 'escalate', label: 'Mark as escalated', value: 'none' },
    { key: 'mark_spam', label: 'Mark as spam', value: 'none' },
  ],
};

router.get('/meta', (_req, res) => res.json({ data: AUTOMATION_META }));

router.get('/', asyncHandler(async (req, res) => {
  const params = [];
  let where = '';
  if (req.query.event) { params.push(req.query.event); where = 'WHERE event = $1'; }
  const { rows } = await query(`SELECT * FROM automations ${where} ORDER BY event, position, id`, params);
  res.json({ data: rows });
}));

router.post('/', requireAdmin, asyncHandler(async (req, res) => {
  const b = req.body;
  requireFields(b, ['name', 'event']);
  if (!AUTOMATION_META.events.includes(b.event)) throw badRequest('Invalid event');
  const { rows } = await query(
    `INSERT INTO automations (name, description, event, conditions, actions, is_active, position)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, TRUE), COALESCE($7, (SELECT COALESCE(MAX(position),0)+1 FROM automations WHERE event = $3))) RETURNING *`,
    [b.name, b.description || null, b.event, JSON.stringify(b.conditions || { match: 'all', rules: [] }), JSON.stringify(b.actions || []), b.is_active, b.position || null]
  );
  res.status(201).json({ data: rows[0] });
}));

router.put('/:id', requireAdmin, asyncHandler(async (req, res) => {
  const b = { ...req.body };
  if (b.conditions !== undefined) b.conditions = JSON.stringify(b.conditions);
  if (b.actions !== undefined) b.actions = JSON.stringify(b.actions);
  const { sets, values } = buildUpdate(b, ['name', 'description', 'event', 'conditions', 'actions', 'is_active', 'position']);
  if (!sets.length) throw badRequest('Nothing to update');
  values.push(req.params.id);
  const { rows } = await query(`UPDATE automations SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`, values);
  if (!rows[0]) throw notFound('Automation');
  res.json({ data: rows[0] });
}));

router.post('/reorder', requireAdmin, asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  for (let i = 0; i < ids.length; i++) await query('UPDATE automations SET position = $1 WHERE id = $2', [i + 1, ids[i]]);
  res.json({ ok: true });
}));

// Manually run all time-trigger rules now.
router.post('/run-time-triggers', requireAdmin, asyncHandler(async (_req, res) => {
  const touched = await runTimeTriggers();
  res.json({ ok: true, tickets_updated: touched });
}));

// Dry-run a single rule's conditions against a ticket.
router.post('/:id/test', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM automations WHERE id = $1', [req.params.id]);
  if (!rows[0]) throw notFound('Automation');
  const { rows: tickets } = await query('SELECT * FROM tickets WHERE id = $1', [req.body.ticket_id]);
  if (!tickets[0]) throw badRequest('ticket_id required');
  const { evaluateConditions } = await import('../utils/automations.js');
  // Light context without side effects.
  const matched = evaluateConditions(rows[0].conditions, tickets[0]);
  res.json({ data: { matched } });
}));

router.delete('/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { rowCount } = await query('DELETE FROM automations WHERE id = $1', [req.params.id]);
  if (!rowCount) throw notFound('Automation');
  res.json({ ok: true });
}));

export default router;
