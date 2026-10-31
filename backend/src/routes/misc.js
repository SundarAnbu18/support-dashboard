import { Router } from 'express';
import { query } from '../config/db.js';
import { authenticate, requireAgent, isAgent } from '../middleware/auth.js';
import { asyncHandler, notFound, badRequest } from '../utils/errors.js';
import { requireFields } from '../utils/helpers.js';

export const searchRouter = Router();
searchRouter.use(authenticate, requireAgent);
searchRouter.get('/', asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ data: { tickets: [], contacts: [], companies: [], articles: [] } });
  const like = `%${q}%`;
  const idMatch = /^#?(\d+)$/.exec(q);
  const [{ rows: tickets }, { rows: contacts }, { rows: companies }, { rows: articles }] = await Promise.all([
    query(`SELECT t.id, t.subject, t.status, t.priority, t.created_at, c.name AS requester_name FROM tickets t JOIN contacts c ON c.id = t.requester_id
            WHERE t.deleted = FALSE AND (t.subject ILIKE $1 OR t.description ILIKE $1 OR c.name ILIKE $1 OR c.email ILIKE $1 ${idMatch ? `OR t.id = ${Number(idMatch[1])}` : ''})
            ORDER BY t.created_at DESC LIMIT 10`, [like]),
    query('SELECT id, name, email, phone FROM contacts WHERE name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1 ORDER BY name LIMIT 8', [like]),
    query('SELECT id, name, domains FROM companies WHERE name ILIKE $1 OR array_to_string(domains, \',\') ILIKE $1 ORDER BY name LIMIT 8', [like]),
    query('SELECT id, title, slug, status FROM kb_articles WHERE title ILIKE $1 OR body ILIKE $1 ORDER BY views DESC LIMIT 8', [like]),
  ]);
  res.json({ data: { tickets, contacts, companies, articles } });
}));

export const notificationsRouter = Router();
notificationsRouter.use(authenticate);
const ownerClause = (user) => (isAgent(user) ? 'user_id = $1' : 'contact_id = $1');
notificationsRouter.get('/', asyncHandler(async (req, res) => {
  const { rows } = await query(`SELECT * FROM notifications WHERE ${ownerClause(req.user)} ORDER BY created_at DESC LIMIT 50`, [req.user.id]);
  const { rows: [{ count }] } = await query(`SELECT COUNT(*) FROM notifications WHERE ${ownerClause(req.user)} AND is_read = FALSE`, [req.user.id]);
  res.json({ data: rows, unread: Number(count) });
}));
notificationsRouter.post('/read-all', asyncHandler(async (req, res) => {
  await query(`UPDATE notifications SET is_read = TRUE WHERE ${ownerClause(req.user)}`, [req.user.id]);
  res.json({ ok: true });
}));
notificationsRouter.patch('/:id', asyncHandler(async (req, res) => {
  await query(`UPDATE notifications SET is_read = $2 WHERE id = $1 AND ${ownerClause(req.user).replace('$1', '$3')}`, [req.params.id, req.body.is_read !== false, req.user.id]);
  res.json({ ok: true });
}));
notificationsRouter.delete('/:id', asyncHandler(async (req, res) => {
  await query(`DELETE FROM notifications WHERE id = $1 AND ${ownerClause(req.user).replace('$1', '$2')}`, [req.params.id, req.user.id]);
  res.json({ ok: true });
}));

export const savedViewsRouter = Router();
savedViewsRouter.use(authenticate, requireAgent);
savedViewsRouter.get('/', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT v.*, u.name AS owner_name FROM saved_views v LEFT JOIN users u ON u.id = v.user_id
      WHERE v.user_id = $1 OR v.visibility = 'all_agents' ORDER BY v.position, v.name`, [req.user.id]
  );
  res.json({ data: rows });
}));
savedViewsRouter.post('/', asyncHandler(async (req, res) => {
  requireFields(req.body, ['name']);
  const { rows } = await query(
    'INSERT INTO saved_views (user_id, name, filters, visibility) VALUES ($1, $2, $3, COALESCE($4, \'private\')) RETURNING *',
    [req.user.id, req.body.name, JSON.stringify(req.body.filters || {}), req.body.visibility || null]
  );
  res.status(201).json({ data: rows[0] });
}));
savedViewsRouter.put('/:id', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `UPDATE saved_views SET name = COALESCE($2, name), filters = COALESCE($3, filters), visibility = COALESCE($4, visibility)
      WHERE id = $1 AND (user_id = $5 OR $6 = 'admin') RETURNING *`,
    [req.params.id, req.body.name || null, req.body.filters ? JSON.stringify(req.body.filters) : null, req.body.visibility || null, req.user.id, req.user.role]
  );
  if (!rows[0]) throw notFound('View');
  res.json({ data: rows[0] });
}));
savedViewsRouter.delete('/:id', asyncHandler(async (req, res) => {
  const { rowCount } = await query('DELETE FROM saved_views WHERE id = $1 AND (user_id = $2 OR $3 = \'admin\')', [req.params.id, req.user.id, req.user.role]);
  if (!rowCount) throw notFound('View');
  res.json({ ok: true });
}));
