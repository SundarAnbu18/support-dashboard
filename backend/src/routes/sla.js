import { Router } from 'express';
import { query } from '../config/db.js';
import { authenticate, requireAgent, requireAdmin } from '../middleware/auth.js';
import { asyncHandler, notFound, badRequest } from '../utils/errors.js';
import { requireFields, buildUpdate } from '../utils/helpers.js';
import { DEFAULT_TARGETS } from '../utils/sla.js';

const router = Router();
router.use(authenticate, requireAgent);

router.get('/', asyncHandler(async (_req, res) => {
  const { rows } = await query(
    `SELECT p.*, (SELECT COUNT(*) FROM tickets t WHERE t.sla_policy_id = p.id AND t.deleted = FALSE) AS ticket_count
       FROM sla_policies p ORDER BY p.is_default ASC, p.position ASC, p.id ASC`
  );
  res.json({ data: rows, defaults: DEFAULT_TARGETS });
}));

router.post('/', requireAdmin, asyncHandler(async (req, res) => {
  const b = req.body;
  requireFields(b, ['name']);
  const { rows } = await query(
    `INSERT INTO sla_policies (name, description, is_active, position, conditions, targets)
     VALUES ($1, $2, COALESCE($3, TRUE), COALESCE($4, (SELECT COALESCE(MAX(position),0)+1 FROM sla_policies)), $5, $6) RETURNING *`,
    [b.name, b.description || null, b.is_active, b.position || null, JSON.stringify(b.conditions || {}), JSON.stringify(b.targets || DEFAULT_TARGETS)]
  );
  res.status(201).json({ data: rows[0] });
}));

router.put('/:id', requireAdmin, asyncHandler(async (req, res) => {
  const b = { ...req.body };
  if (b.conditions !== undefined) b.conditions = JSON.stringify(b.conditions);
  if (b.targets !== undefined) b.targets = JSON.stringify(b.targets);
  const { rows: existing } = await query('SELECT * FROM sla_policies WHERE id = $1', [req.params.id]);
  if (!existing[0]) throw notFound('SLA policy');
  if (existing[0].is_default && b.is_active === false) throw badRequest('The default policy cannot be deactivated');
  const { sets, values } = buildUpdate(b, ['name', 'description', 'is_active', 'position', 'conditions', 'targets']);
  if (!sets.length) return res.json({ data: existing[0] });
  values.push(req.params.id);
  const { rows } = await query(`UPDATE sla_policies SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`, values);
  res.json({ data: rows[0] });
}));

router.post('/reorder', requireAdmin, asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  for (let i = 0; i < ids.length; i++) await query('UPDATE sla_policies SET position = $1 WHERE id = $2', [i + 1, ids[i]]);
  res.json({ ok: true });
}));

router.delete('/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT is_default FROM sla_policies WHERE id = $1', [req.params.id]);
  if (!rows[0]) throw notFound('SLA policy');
  if (rows[0].is_default) throw badRequest('The default policy cannot be deleted');
  await query('DELETE FROM sla_policies WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

export default router;
