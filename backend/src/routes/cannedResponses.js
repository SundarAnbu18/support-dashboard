import { Router } from 'express';
import { query } from '../config/db.js';
import { authenticate, requireAgent } from '../middleware/auth.js';
import { asyncHandler, notFound } from '../utils/errors.js';
import { requireFields, buildUpdate, toInt } from '../utils/helpers.js';

const router = Router();
router.use(authenticate, requireAgent);

const VISIBLE = `(cr.visibility = 'all' OR (cr.visibility = 'personal' AND cr.user_id = $1)
                  OR (cr.visibility = 'group' AND cr.group_id IN (SELECT group_id FROM group_members WHERE user_id = $1)))`;

router.get('/', asyncHandler(async (req, res) => {
  const params = [req.user.id];
  let extra = '';
  if (req.query.q) { params.push(`%${req.query.q}%`); extra += ` AND (cr.title ILIKE $${params.length} OR cr.content ILIKE $${params.length})`; }
  if (req.query.folder) { params.push(req.query.folder); extra += ` AND cr.folder = $${params.length}`; }
  const { rows } = await query(
    `SELECT cr.*, u.name AS owner_name, g.name AS group_name FROM canned_responses cr
       LEFT JOIN users u ON u.id = cr.user_id LEFT JOIN groups g ON g.id = cr.group_id
      WHERE ${VISIBLE} ${extra} ORDER BY cr.folder, cr.title`, params
  );
  res.json({ data: rows });
}));

router.post('/', asyncHandler(async (req, res) => {
  const b = req.body;
  requireFields(b, ['title', 'content']);
  const { rows } = await query(
    `INSERT INTO canned_responses (title, content, folder, visibility, group_id, user_id)
     VALUES ($1, $2, COALESCE($3, 'General'), COALESCE($4, 'all'), $5, $6) RETURNING *`,
    [b.title, b.content, b.folder || null, b.visibility || null, toInt(b.group_id), req.user.id]
  );
  res.status(201).json({ data: rows[0] });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const b = { ...req.body };
  if (b.group_id !== undefined) b.group_id = toInt(b.group_id);
  const { sets, values } = buildUpdate(b, ['title', 'content', 'folder', 'visibility', 'group_id']);
  if (!sets.length) throw notFound('Nothing to update');
  values.push(req.params.id);
  const { rows } = await query(`UPDATE canned_responses SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`, values);
  if (!rows[0]) throw notFound('Canned response');
  res.json({ data: rows[0] });
}));

router.post('/:id/use', asyncHandler(async (req, res) => {
  const { rows } = await query('UPDATE canned_responses SET usage_count = usage_count + 1 WHERE id = $1 RETURNING *', [req.params.id]);
  if (!rows[0]) throw notFound('Canned response');
  // Placeholder substitution for the ticket context, if provided.
  let content = rows[0].content;
  const ctx = req.body || {};
  for (const [k, v] of Object.entries(ctx)) content = content.replaceAll(`{{${k}}}`, v ?? '');
  res.json({ data: { ...rows[0], content } });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const { rowCount } = await query('DELETE FROM canned_responses WHERE id = $1', [req.params.id]);
  if (!rowCount) throw notFound('Canned response');
  res.json({ ok: true });
}));

export default router;
