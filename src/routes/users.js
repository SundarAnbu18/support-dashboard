import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../config/db.js';
import { authenticate, requireAgent, requireAdmin } from '../middleware/auth.js';
import { asyncHandler, notFound, badRequest, HttpError } from '../utils/errors.js';
import { requireFields, buildUpdate, toBool } from '../utils/helpers.js';

const router = Router();
router.use(authenticate, requireAgent);

const USER_COLS = `u.id, u.name, u.email, u.role, u.avatar_url, u.phone, u.job_title, u.time_zone, u.signature, u.is_active, u.last_login_at, u.created_at`;

router.get('/', asyncHandler(async (req, res) => {
  const { q, active } = req.query;
  const where = [];
  const params = [];
  if (q) { params.push(`%${q}%`); where.push(`(u.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`); }
  if (active !== undefined) { params.push(toBool(active)); where.push(`u.is_active = $${params.length}`); }
  const { rows } = await query(
    `SELECT ${USER_COLS},
            COALESCE(json_agg(json_build_object('id', g.id, 'name', g.name)) FILTER (WHERE g.id IS NOT NULL), '[]') AS groups,
            (SELECT COUNT(*) FROM tickets t WHERE t.responder_id = u.id AND t.status IN ('open','pending') AND t.deleted = FALSE) AS open_tickets
       FROM users u
       LEFT JOIN group_members gm ON gm.user_id = u.id
       LEFT JOIN groups g ON g.id = gm.group_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      GROUP BY u.id ORDER BY u.name ASC`,
    params
  );
  res.json({ data: rows });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT ${USER_COLS},
            COALESCE(json_agg(json_build_object('id', g.id, 'name', g.name)) FILTER (WHERE g.id IS NOT NULL), '[]') AS groups
       FROM users u LEFT JOIN group_members gm ON gm.user_id = u.id LEFT JOIN groups g ON g.id = gm.group_id
      WHERE u.id = $1 GROUP BY u.id`,
    [req.params.id]
  );
  if (!rows[0]) throw notFound('Agent');
  const { rows: stats } = await query(
    `SELECT COUNT(*) FILTER (WHERE status IN ('open','pending')) AS open,
            COUNT(*) FILTER (WHERE status IN ('resolved','closed')) AS resolved,
            COUNT(*) AS total
       FROM tickets WHERE responder_id = $1 AND deleted = FALSE`,
    [req.params.id]
  );
  res.json({ data: { ...rows[0], stats: stats[0] } });
}));

router.post('/', requireAdmin, asyncHandler(async (req, res) => {
  const { name, email, password, role = 'agent', phone, job_title, time_zone, group_ids = [] } = req.body;
  requireFields(req.body, ['name', 'email', 'password']);
  if (!['admin', 'agent'].includes(role)) throw badRequest('Invalid role');
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await query(
    `INSERT INTO users (name, email, password_hash, role, phone, job_title, time_zone)
     VALUES ($1, LOWER($2), $3, $4, $5, $6, COALESCE($7, 'UTC')) RETURNING *`,
    [name, email, hash, role, phone || null, job_title || null, time_zone || null]
  );
  for (const gid of group_ids) {
    await query('INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [gid, rows[0].id]);
  }
  const { password_hash, ...safe } = rows[0];
  res.status(201).json({ data: safe });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const targetId = Number(req.params.id);
  const isSelf = targetId === req.user.id;
  if (!isSelf && req.user.role !== 'admin') throw new HttpError(403, 'Only admins can edit other agents');
  const body = { ...req.body };
  if (req.user.role !== 'admin') { delete body.role; delete body.is_active; }
  if (body.email) body.email = String(body.email).toLowerCase();
  const { sets, values, nextIndex } = buildUpdate(body, ['name', 'email', 'role', 'phone', 'job_title', 'time_zone', 'signature', 'avatar_url', 'is_active']);
  if (body.password) {
    sets.push(`password_hash = $${values.length + 1}`);
    values.push(await bcrypt.hash(body.password, 10));
  }
  if (sets.length) {
    values.push(targetId);
    await query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
  }
  if (Array.isArray(body.group_ids) && req.user.role === 'admin') {
    await query('DELETE FROM group_members WHERE user_id = $1', [targetId]);
    for (const gid of body.group_ids) {
      await query('INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [gid, targetId]);
    }
  }
  const { rows } = await query(`SELECT ${USER_COLS} FROM users u WHERE u.id = $1`, [targetId]);
  if (!rows[0]) throw notFound('Agent');
  res.json({ data: rows[0] });
}));

router.delete('/:id', requireAdmin, asyncHandler(async (req, res) => {
  if (Number(req.params.id) === req.user.id) throw badRequest('You cannot deactivate yourself');
  const { rowCount } = await query('UPDATE users SET is_active = FALSE WHERE id = $1', [req.params.id]);
  if (!rowCount) throw notFound('Agent');
  await query('UPDATE tickets SET responder_id = NULL WHERE responder_id = $1 AND status IN (\'open\',\'pending\')', [req.params.id]);
  res.json({ ok: true });
}));

export default router;
