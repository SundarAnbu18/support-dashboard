import { Router } from 'express';
import { query } from '../config/db.js';
import { authenticate, requireAgent, requireAdmin } from '../middleware/auth.js';
import { asyncHandler, notFound } from '../utils/errors.js';
import { requireFields, buildUpdate } from '../utils/helpers.js';

const router = Router();
router.use(authenticate, requireAgent);

const SELECT = `
  SELECT g.*,
         COALESCE(json_agg(json_build_object('id', u.id, 'name', u.name, 'email', u.email, 'avatar_url', u.avatar_url) ORDER BY u.name)
                  FILTER (WHERE u.id IS NOT NULL), '[]') AS members,
         (SELECT COUNT(*) FROM tickets t WHERE t.group_id = g.id AND t.status IN ('open','pending') AND t.deleted = FALSE) AS open_tickets
    FROM groups g
    LEFT JOIN group_members gm ON gm.group_id = g.id
    LEFT JOIN users u ON u.id = gm.user_id`;

router.get('/', asyncHandler(async (_req, res) => {
  const { rows } = await query(`${SELECT} GROUP BY g.id ORDER BY g.name`);
  res.json({ data: rows });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const { rows } = await query(`${SELECT} WHERE g.id = $1 GROUP BY g.id`, [req.params.id]);
  if (!rows[0]) throw notFound('Group');
  res.json({ data: rows[0] });
}));

router.post('/', requireAdmin, asyncHandler(async (req, res) => {
  const { name, description, escalate_to_user_id, auto_assign = false, member_ids = [] } = req.body;
  requireFields(req.body, ['name']);
  const { rows } = await query(
    'INSERT INTO groups (name, description, escalate_to_user_id, auto_assign) VALUES ($1, $2, $3, $4) RETURNING id',
    [name, description || null, escalate_to_user_id || null, !!auto_assign]
  );
  for (const uid of member_ids) {
    await query('INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [rows[0].id, uid]);
  }
  const { rows: out } = await query(`${SELECT} WHERE g.id = $1 GROUP BY g.id`, [rows[0].id]);
  res.status(201).json({ data: out[0] });
}));

router.put('/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { sets, values } = buildUpdate(req.body, ['name', 'description', 'escalate_to_user_id', 'auto_assign']);
  if (sets.length) {
    values.push(req.params.id);
    await query(`UPDATE groups SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
  }
  if (Array.isArray(req.body.member_ids)) {
    await query('DELETE FROM group_members WHERE group_id = $1', [req.params.id]);
    for (const uid of req.body.member_ids) {
      await query('INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.params.id, uid]);
    }
  }
  const { rows } = await query(`${SELECT} WHERE g.id = $1 GROUP BY g.id`, [req.params.id]);
  if (!rows[0]) throw notFound('Group');
  res.json({ data: rows[0] });
}));

router.delete('/:id', requireAdmin, asyncHandler(async (req, res) => {
  const { rowCount } = await query('DELETE FROM groups WHERE id = $1', [req.params.id]);
  if (!rowCount) throw notFound('Group');
  res.json({ ok: true });
}));

export default router;
