import { Router } from 'express';
import { query } from '../config/db.js';
import { authenticate, requireAgent } from '../middleware/auth.js';
import { asyncHandler, notFound } from '../utils/errors.js';
import { requireFields } from '../utils/helpers.js';

const router = Router();
router.use(authenticate, requireAgent);

router.get('/', asyncHandler(async (_req, res) => {
  const { rows } = await query(
    `SELECT tg.*, (SELECT COUNT(*) FROM tickets t WHERE tg.name = ANY(t.tags) AND t.deleted = FALSE) AS ticket_count
       FROM tags tg ORDER BY tg.name`
  );
  res.json({ data: rows });
}));

router.post('/', asyncHandler(async (req, res) => {
  requireFields(req.body, ['name']);
  const { rows } = await query(
    'INSERT INTO tags (name, color) VALUES (LOWER(TRIM($1)), COALESCE($2, \'#6366f1\')) ON CONFLICT (name) DO UPDATE SET color = COALESCE($2, tags.color) RETURNING *',
    [req.body.name, req.body.color || null]
  );
  res.status(201).json({ data: rows[0] });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const { rows: old } = await query('SELECT * FROM tags WHERE id = $1', [req.params.id]);
  if (!old[0]) throw notFound('Tag');
  const name = req.body.name ? String(req.body.name).toLowerCase().trim() : old[0].name;
  const { rows } = await query('UPDATE tags SET name = $1, color = COALESCE($2, color) WHERE id = $3 RETURNING *', [name, req.body.color || null, req.params.id]);
  if (name !== old[0].name) {
    await query('UPDATE tickets SET tags = array_replace(tags, $1, $2) WHERE $1 = ANY(tags)', [old[0].name, name]);
  }
  res.json({ data: rows[0] });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const { rows } = await query('DELETE FROM tags WHERE id = $1 RETURNING name', [req.params.id]);
  if (!rows[0]) throw notFound('Tag');
  await query('UPDATE tickets SET tags = array_remove(tags, $1) WHERE $1 = ANY(tags)', [rows[0].name]);
  res.json({ ok: true });
}));

export default router;
