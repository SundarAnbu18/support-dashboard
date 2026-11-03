import { Router } from 'express';
import { query } from '../config/db.js';
import { authenticate, optionalAuth, requirePrivilege, isAgent } from '../middleware/auth.js';
import { asyncHandler, notFound, forbidden, badRequest } from '../utils/errors.js';
import { requireFields, pagination, buildUpdate } from '../utils/helpers.js';

const router = Router();
const canModerate = (user) => isAgent(user) && user.privileges.includes('moderate_forums');
const moderate = [authenticate, requirePrivilege('moderate_forums')];

const visibilityFor = (user) => (isAgent(user) ? ['public', 'logged_in', 'agents'] : user ? ['public', 'logged_in'] : ['public']);

async function moderationStatus(user) {
  if (isAgent(user)) return 'published';
  const { rows } = await query("SELECT value FROM settings WHERE key = 'forums'");
  return rows[0]?.value?.moderate_customer_posts === false ? 'published' : 'waiting';
}
const author = (user) => (isAgent(user) ? [user.id, null] : [null, user.id]);
const voterKey = (user) => `${user.kind}:${user.id}`;

async function loadForum(id, user) {
  const { rows: [forum] } = await query('SELECT * FROM forums WHERE id = $1', [id]);
  if (!forum || !visibilityFor(user).includes(forum.visibility)) throw notFound('Forum');
  return forum;
}
async function loadTopic(id, user) {
  const { rows: [topic] } = await query(
    `SELECT tp.*, f.name AS forum_name, f.forum_type, f.visibility, COALESCE(u.name, c.name) AS author_name, (u.id IS NOT NULL) AS by_agent,
            (SELECT COUNT(*) FROM forum_votes v WHERE v.topic_id = tp.id) AS votes
       FROM forum_topics tp JOIN forums f ON f.id = tp.forum_id
       LEFT JOIN users u ON u.id = tp.user_id LEFT JOIN contacts c ON c.id = tp.contact_id WHERE tp.id = $1`, [id]
  );
  if (!topic || !visibilityFor(user).includes(topic.visibility)) throw notFound('Topic');
  const ownPending = user && !isAgent(user) && topic.contact_id === user.id && topic.status === 'waiting';
  if (topic.status !== 'published' && !canModerate(user) && !ownPending) throw notFound('Topic');
  return topic;
}

// ---------------- reading (public forums need no login)
router.get('/', optionalAuth, asyncHandler(async (req, res) => {
  const { rows: categories } = await query('SELECT * FROM forum_categories ORDER BY position, id');
  const { rows: forums } = await query(
    `SELECT f.*, (SELECT COUNT(*) FROM forum_topics t WHERE t.forum_id = f.id AND t.status = 'published') AS topic_count
       FROM forums f WHERE f.visibility = ANY($1::text[]) ORDER BY f.position, f.id`, [visibilityFor(req.user)]
  );
  res.json({ data: categories.map((c) => ({ ...c, forums: forums.filter((f) => f.category_id === c.id) })) });
}));

router.get('/topics', optionalAuth, asyncHandler(async (req, res) => {
  const q = req.query;
  const { page, perPage, offset } = pagination(q, { per_page: 25 });
  const params = [visibilityFor(req.user)];
  const where = ['f.visibility = ANY($1::text[])'];
  if (q.status && q.status !== 'published') {
    if (!canModerate(req.user)) throw forbidden();
    params.push(q.status); where.push(`tp.status = $${params.length}`);
  } else where.push("tp.status = 'published'");
  if (q.forum_id) { params.push(Number(q.forum_id)); where.push(`tp.forum_id = $${params.length}`); }
  if (q.q) { params.push(`%${q.q}%`); where.push(`(tp.title ILIKE $${params.length} OR tp.body ILIKE $${params.length})`); }
  if (q.mine && req.user) {
    params.push(req.user.id);
    where.push(isAgent(req.user) ? `tp.user_id = $${params.length}` : `tp.contact_id = $${params.length}`);
  }
  const whereSql = where.join(' AND ');
  const { rows: [count] } = await query(`SELECT COUNT(*) FROM forum_topics tp JOIN forums f ON f.id = tp.forum_id WHERE ${whereSql}`, params);
  const { rows } = await query(
    `SELECT tp.id, tp.forum_id, tp.title, tp.status, tp.is_locked, tp.is_pinned, tp.stamp, tp.views, tp.created_at, tp.updated_at,
            LEFT(tp.body, 200) AS excerpt, f.name AS forum_name, f.forum_type, COALESCE(u.name, c.name) AS author_name,
            (SELECT COUNT(*) FROM forum_posts p WHERE p.topic_id = tp.id AND p.status = 'published') AS reply_count,
            (SELECT COUNT(*) FROM forum_votes v WHERE v.topic_id = tp.id) AS votes
       FROM forum_topics tp JOIN forums f ON f.id = tp.forum_id
       LEFT JOIN users u ON u.id = tp.user_id LEFT JOIN contacts c ON c.id = tp.contact_id
      WHERE ${whereSql} ORDER BY tp.is_pinned DESC, tp.updated_at DESC LIMIT ${perPage} OFFSET ${offset}`, params
  );
  res.json({ data: rows, meta: { total: Number(count.count), page, per_page: perPage } });
}));

router.get('/topics/:id', optionalAuth, asyncHandler(async (req, res) => {
  const topic = await loadTopic(req.params.id, req.user);
  await query('UPDATE forum_topics SET views = views + 1 WHERE id = $1', [topic.id]);
  const params = [topic.id];
  let visible = "AND p.status = 'published'";
  if (canModerate(req.user)) visible = '';
  else if (req.user && !isAgent(req.user)) { params.push(req.user.id); visible = `AND (p.status = 'published' OR p.contact_id = $2)`; }
  const { rows: posts } = await query(
    `SELECT p.*, COALESCE(u.name, c.name) AS author_name, (u.id IS NOT NULL) AS by_agent FROM forum_posts p
       LEFT JOIN users u ON u.id = p.user_id LEFT JOIN contacts c ON c.id = p.contact_id
      WHERE p.topic_id = $1 ${visible} ORDER BY p.created_at`, params
  );
  const { rows: voted } = req.user ? await query('SELECT 1 FROM forum_votes WHERE topic_id = $1 AND voter = $2', [topic.id, voterKey(req.user)]) : { rows: [] };
  res.json({ data: { ...topic, posts, has_voted: voted.length > 0, can_moderate: canModerate(req.user) } });
}));

// ---------------- posting
router.post('/topics', authenticate, asyncHandler(async (req, res) => {
  requireFields(req.body, ['forum_id', 'title', 'body']);
  const forum = await loadForum(req.body.forum_id, req.user);
  if (forum.forum_type === 'announcements' && !isAgent(req.user)) throw forbidden('Only agents can post announcements');
  const status = await moderationStatus(req.user);
  const { rows } = await query(
    'INSERT INTO forum_topics (forum_id, title, body, user_id, contact_id, status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [forum.id, req.body.title, req.body.body, ...author(req.user), status]
  );
  res.status(201).json({ data: rows[0] });
}));

router.post('/topics/:id/posts', authenticate, asyncHandler(async (req, res) => {
  requireFields(req.body, ['body']);
  const topic = await loadTopic(req.params.id, req.user);
  if (topic.is_locked && !canModerate(req.user)) throw badRequest('This topic is locked');
  const status = await moderationStatus(req.user);
  const { rows } = await query(
    'INSERT INTO forum_posts (topic_id, body, user_id, contact_id, status) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [topic.id, req.body.body, ...author(req.user), status]
  );
  if (status === 'published') await query('UPDATE forum_topics SET updated_at = NOW() WHERE id = $1', [topic.id]);
  res.status(201).json({ data: rows[0] });
}));

router.post('/topics/:id/vote', authenticate, asyncHandler(async (req, res) => {
  const topic = await loadTopic(req.params.id, req.user);
  const key = voterKey(req.user);
  const { rowCount } = await query('DELETE FROM forum_votes WHERE topic_id = $1 AND voter = $2', [topic.id, key]);
  if (!rowCount) await query('INSERT INTO forum_votes (topic_id, voter) VALUES ($1,$2)', [topic.id, key]);
  res.json({ voted: !rowCount });
}));

// ---------------- moderation
router.get('/moderation/counts', ...moderate, asyncHandler(async (_req, res) => {
  const { rows: [c] } = await query(
    `SELECT (SELECT COUNT(*) FROM forum_topics WHERE status = 'waiting') + (SELECT COUNT(*) FROM forum_posts WHERE status = 'waiting') AS waiting,
            (SELECT COUNT(*) FROM forum_topics WHERE status = 'spam') + (SELECT COUNT(*) FROM forum_posts WHERE status = 'spam') AS spam`
  );
  res.json({ data: c });
}));
router.get('/moderation/posts', ...moderate, asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT p.*, tp.title AS topic_title, COALESCE(u.name, c.name) AS author_name FROM forum_posts p JOIN forum_topics tp ON tp.id = p.topic_id
       LEFT JOIN users u ON u.id = p.user_id LEFT JOIN contacts c ON c.id = p.contact_id WHERE p.status = $1 ORDER BY p.created_at DESC`,
    [req.query.status || 'waiting']
  );
  res.json({ data: rows });
}));
router.patch('/topics/:id', ...moderate, asyncHandler(async (req, res) => {
  const { sets, values } = buildUpdate(req.body, ['title', 'body', 'status', 'is_locked', 'is_pinned', 'stamp', 'forum_id']);
  if (!sets.length) throw badRequest('Nothing to update');
  values.push(req.params.id);
  const { rows } = await query(`UPDATE forum_topics SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`, values);
  if (!rows[0]) throw notFound('Topic');
  res.json({ data: rows[0] });
}));
router.delete('/topics/:id', ...moderate, asyncHandler(async (req, res) => {
  await query('DELETE FROM forum_topics WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));
router.patch('/posts/:id', ...moderate, asyncHandler(async (req, res) => {
  const { sets, values } = buildUpdate(req.body, ['body', 'status', 'is_answer']);
  if (!sets.length) throw badRequest('Nothing to update');
  values.push(req.params.id);
  const { rows } = await query(`UPDATE forum_posts SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`, values);
  if (!rows[0]) throw notFound('Post');
  res.json({ data: rows[0] });
}));
router.delete('/posts/:id', ...moderate, asyncHandler(async (req, res) => {
  await query('DELETE FROM forum_posts WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// ---------------- structure
const structure = (table, fields, required) => {
  router.post(`/${table}`, ...moderate, asyncHandler(async (req, res) => {
    requireFields(req.body, required);
    const cols = fields.filter((f) => req.body[f] !== undefined);
    const { rows } = await query(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, cols.map((c) => req.body[c]));
    res.status(201).json({ data: rows[0] });
  }));
  router.put(`/${table}/:id`, ...moderate, asyncHandler(async (req, res) => {
    const { sets, values } = buildUpdate(req.body, fields);
    if (!sets.length) throw badRequest('Nothing to update');
    values.push(req.params.id);
    const { rows } = await query(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`, values);
    if (!rows[0]) throw notFound('Forum');
    res.json({ data: rows[0] });
  }));
  router.delete(`/${table}/:id`, ...moderate, asyncHandler(async (req, res) => {
    await query(`DELETE FROM ${table} WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  }));
};
structure('forum_categories', ['name', 'description', 'position'], ['name']);
structure('forums', ['category_id', 'name', 'description', 'forum_type', 'visibility', 'position'], ['category_id', 'name']);

export default router;
