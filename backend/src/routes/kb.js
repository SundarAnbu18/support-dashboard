import { Router } from 'express';
import { query } from '../config/db.js';
import { authenticate, optionalAuth, requireAgent, isAgent } from '../middleware/auth.js';
import { asyncHandler, notFound, badRequest } from '../utils/errors.js';
import { requireFields, buildUpdate, slugify, toArray, toInt } from '../utils/helpers.js';

const router = Router();

function visibilityClause(user, alias = 'f') {
  if (isAgent(user)) return 'TRUE';
  if (user) return `${alias}.visibility IN ('public','logged_in')`;
  return `${alias}.visibility = 'public'`;
}

// ---------------- public / portal tree
router.get('/portal', optionalAuth, asyncHandler(async (req, res) => {
  const vis = visibilityClause(req.user);
  const { rows: categories } = await query('SELECT * FROM kb_categories WHERE visible_in_portal = TRUE ORDER BY position, name');
  const { rows: folders } = await query(`SELECT f.*, (SELECT COUNT(*) FROM kb_articles a WHERE a.folder_id = f.id AND a.status = 'published') AS article_count FROM kb_folders f WHERE ${vis} ORDER BY f.position, f.name`);
  const { rows: articles } = await query(
    `SELECT a.id, a.folder_id, a.title, a.slug, a.views, a.thumbs_up, a.published_at, LEFT(a.body, 160) AS excerpt
       FROM kb_articles a JOIN kb_folders f ON f.id = a.folder_id WHERE a.status = 'published' AND ${vis} ORDER BY a.title`
  );
  const tree = categories.map((c) => ({
    ...c,
    folders: folders.filter((f) => f.category_id === c.id).map((f) => ({ ...f, articles: articles.filter((a) => a.folder_id === f.id) })),
  })).filter((c) => c.folders.length);
  const { rows: popular } = await query(
    `SELECT a.id, a.title, a.slug, a.views FROM kb_articles a JOIN kb_folders f ON f.id = a.folder_id WHERE a.status = 'published' AND ${vis} ORDER BY a.views DESC LIMIT 6`
  );
  res.json({ data: { categories: tree, popular } });
}));

router.get('/portal/search', optionalAuth, asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ data: [] });
  const vis = visibilityClause(req.user);
  const { rows } = await query(
    `SELECT a.id, a.title, a.slug, a.views, LEFT(a.body, 200) AS excerpt, f.name AS folder_name, c.name AS category_name
       FROM kb_articles a JOIN kb_folders f ON f.id = a.folder_id JOIN kb_categories c ON c.id = f.category_id
      WHERE a.status = 'published' AND ${vis} AND (a.title ILIKE $1 OR a.body ILIKE $1 OR $2 = ANY(a.keywords) OR $2 = ANY(a.tags))
      ORDER BY a.views DESC LIMIT 20`,
    [`%${q}%`, q.toLowerCase()]
  );
  res.json({ data: rows });
}));

router.get('/portal/articles/:slug', optionalAuth, asyncHandler(async (req, res) => {
  const vis = visibilityClause(req.user);
  const { rows } = await query(
    `SELECT a.*, f.name AS folder_name, f.id AS folder_id, c.name AS category_name, c.id AS category_id, u.name AS author_name
       FROM kb_articles a JOIN kb_folders f ON f.id = a.folder_id JOIN kb_categories c ON c.id = f.category_id LEFT JOIN users u ON u.id = a.author_id
      WHERE a.slug = $1 AND a.status = 'published' AND ${vis}`, [req.params.slug]
  );
  if (!rows[0]) throw notFound('Article');
  await query('UPDATE kb_articles SET views = views + 1 WHERE id = $1', [rows[0].id]);
  const { rows: related } = await query(
    `SELECT id, title, slug FROM kb_articles WHERE folder_id = $1 AND id <> $2 AND status = 'published' ORDER BY views DESC LIMIT 5`, [rows[0].folder_id, rows[0].id]
  );
  res.json({ data: { ...rows[0], related } });
}));

router.post('/portal/articles/:slug/feedback', optionalAuth, asyncHandler(async (req, res) => {
  const col = req.body.helpful ? 'thumbs_up' : 'thumbs_down';
  const { rows } = await query(`UPDATE kb_articles SET ${col} = ${col} + 1 WHERE slug = $1 RETURNING id, thumbs_up, thumbs_down`, [req.params.slug]);
  if (!rows[0]) throw notFound('Article');
  res.json({ data: rows[0] });
}));

// ---------------- agent management
router.use(authenticate, requireAgent);

router.get('/categories', asyncHandler(async (_req, res) => {
  const { rows: categories } = await query('SELECT * FROM kb_categories ORDER BY position, name');
  const { rows: folders } = await query(
    `SELECT f.*, (SELECT COUNT(*) FROM kb_articles a WHERE a.folder_id = f.id) AS article_count,
            (SELECT COUNT(*) FROM kb_articles a WHERE a.folder_id = f.id AND a.status = 'published') AS published_count
       FROM kb_folders f ORDER BY f.position, f.name`
  );
  res.json({ data: categories.map((c) => ({ ...c, folders: folders.filter((f) => f.category_id === c.id) })) });
}));

router.post('/categories', asyncHandler(async (req, res) => {
  requireFields(req.body, ['name']);
  const { rows } = await query(
    'INSERT INTO kb_categories (name, description, position, visible_in_portal) VALUES ($1, $2, COALESCE($3, (SELECT COALESCE(MAX(position),0)+1 FROM kb_categories)), COALESCE($4, TRUE)) RETURNING *',
    [req.body.name, req.body.description || null, toInt(req.body.position), req.body.visible_in_portal]
  );
  res.status(201).json({ data: rows[0] });
}));
router.put('/categories/:id', asyncHandler(async (req, res) => {
  const { sets, values } = buildUpdate(req.body, ['name', 'description', 'position', 'visible_in_portal']);
  values.push(req.params.id);
  const { rows } = await query(`UPDATE kb_categories SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`, values);
  if (!rows[0]) throw notFound('Category');
  res.json({ data: rows[0] });
}));
router.delete('/categories/:id', asyncHandler(async (req, res) => {
  await query('DELETE FROM kb_categories WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

router.post('/folders', asyncHandler(async (req, res) => {
  requireFields(req.body, ['name', 'category_id']);
  const { rows } = await query(
    'INSERT INTO kb_folders (category_id, name, description, visibility, position) VALUES ($1, $2, $3, COALESCE($4, \'public\'), COALESCE($5, (SELECT COALESCE(MAX(position),0)+1 FROM kb_folders WHERE category_id = $1))) RETURNING *',
    [toInt(req.body.category_id), req.body.name, req.body.description || null, req.body.visibility || null, toInt(req.body.position)]
  );
  res.status(201).json({ data: rows[0] });
}));
router.put('/folders/:id', asyncHandler(async (req, res) => {
  const { sets, values } = buildUpdate(req.body, ['name', 'description', 'visibility', 'position', 'category_id']);
  values.push(req.params.id);
  const { rows } = await query(`UPDATE kb_folders SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`, values);
  if (!rows[0]) throw notFound('Folder');
  res.json({ data: rows[0] });
}));
router.delete('/folders/:id', asyncHandler(async (req, res) => {
  await query('DELETE FROM kb_folders WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

const ARTICLE_SELECT = `
  SELECT a.*, f.name AS folder_name, f.category_id, c.name AS category_name, u.name AS author_name
    FROM kb_articles a JOIN kb_folders f ON f.id = a.folder_id JOIN kb_categories c ON c.id = f.category_id LEFT JOIN users u ON u.id = a.author_id`;

router.get('/articles', asyncHandler(async (req, res) => {
  const where = [];
  const params = [];
  if (req.query.folder_id) { params.push(toInt(req.query.folder_id)); where.push(`a.folder_id = $${params.length}`); }
  if (req.query.category_id) { params.push(toInt(req.query.category_id)); where.push(`f.category_id = $${params.length}`); }
  if (req.query.status) { params.push(req.query.status); where.push(`a.status = $${params.length}`); }
  if (req.query.q) { params.push(`%${req.query.q}%`); where.push(`(a.title ILIKE $${params.length} OR a.body ILIKE $${params.length})`); }
  const { rows } = await query(`${ARTICLE_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.updated_at DESC LIMIT 200`, params);
  res.json({ data: rows });
}));

router.get('/articles/:id', asyncHandler(async (req, res) => {
  const { rows } = await query(`${ARTICLE_SELECT} WHERE a.id = $1`, [req.params.id]);
  if (!rows[0]) throw notFound('Article');
  res.json({ data: rows[0] });
}));

async function uniqueSlug(base, excludeId) {
  let slug = slugify(base) || 'article';
  let i = 1;
  for (;;) {
    const { rows } = await query('SELECT id FROM kb_articles WHERE slug = $1 AND ($2::int IS NULL OR id <> $2)', [slug, excludeId || null]);
    if (!rows.length) return slug;
    slug = `${slugify(base)}-${++i}`;
  }
}

router.post('/articles', asyncHandler(async (req, res) => {
  const b = req.body;
  requireFields(b, ['title', 'folder_id']);
  const slug = await uniqueSlug(b.slug || b.title);
  const status = b.status === 'published' ? 'published' : 'draft';
  const { rows } = await query(
    `INSERT INTO kb_articles (folder_id, title, slug, body, status, author_id, tags, keywords, published_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, CASE WHEN $5 = 'published' THEN NOW() ELSE NULL END) RETURNING id`,
    [toInt(b.folder_id), b.title, slug, b.body || '', status, req.user.id, toArray(b.tags), toArray(b.keywords)]
  );
  const { rows: out } = await query(`${ARTICLE_SELECT} WHERE a.id = $1`, [rows[0].id]);
  res.status(201).json({ data: out[0] });
}));

router.put('/articles/:id', asyncHandler(async (req, res) => {
  const b = { ...req.body };
  if (b.tags !== undefined) b.tags = toArray(b.tags);
  if (b.keywords !== undefined) b.keywords = toArray(b.keywords);
  if (b.folder_id !== undefined) b.folder_id = toInt(b.folder_id);
  if (b.slug) b.slug = await uniqueSlug(b.slug, Number(req.params.id));
  if (b.status && !['draft', 'published'].includes(b.status)) throw badRequest('Invalid status');
  const { sets, values } = buildUpdate(b, ['folder_id', 'title', 'slug', 'body', 'status', 'tags', 'keywords']);
  if (b.status === 'published') sets.push('published_at = COALESCE(published_at, NOW())');
  if (!sets.length) throw badRequest('Nothing to update');
  values.push(req.params.id);
  const { rowCount } = await query(`UPDATE kb_articles SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
  if (!rowCount) throw notFound('Article');
  const { rows } = await query(`${ARTICLE_SELECT} WHERE a.id = $1`, [req.params.id]);
  res.json({ data: rows[0] });
}));

router.delete('/articles/:id', asyncHandler(async (req, res) => {
  const { rowCount } = await query('DELETE FROM kb_articles WHERE id = $1', [req.params.id]);
  if (!rowCount) throw notFound('Article');
  res.json({ ok: true });
}));

export default router;
