import { Router } from 'express';
import { query, withTransaction } from '../config/db.js';
import { authenticate, requireAgent, requirePrivilege } from '../middleware/auth.js';
import { asyncHandler, notFound, badRequest } from '../utils/errors.js';
import { requireFields, toArray, toInt } from '../utils/helpers.js';
import { applySla } from '../utils/sla.js';
import { logActivity } from '../utils/activity.js';
import { executeActions } from '../utils/automations.js';
import { notifyUser } from '../utils/notifications.js';

const router = Router();
// Mounted ahead of the main tickets router, so every other path must pass straight through.
const EXTRA_PATHS = /^\/(bulk-scenario$|\d+\/(presence|extras|split|links|parent|todos|threads|scenarios|to-forum)(\/|$))/;
router.use((req, _res, next) => (EXTRA_PATHS.test(req.path) ? next() : next('router')));
router.use(authenticate, requireAgent);

const load = async (id) => {
  const { rows } = await query('SELECT * FROM tickets WHERE id = $1', [id]);
  if (!rows[0]) throw notFound('Ticket');
  return rows[0];
};
const SUMMARY = 't.id, t.subject, t.status, t.priority, t.created_at, u.name AS responder_name';

// Who else has this ticket open. Kept in memory: it only matters for the next few seconds.
const presence = new Map();
router.post('/:id/presence', asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  if (!presence.has(id)) presence.set(id, new Map());
  const viewers = presence.get(id);
  const now = Date.now();
  viewers.set(req.user.id, { id: req.user.id, name: req.user.name, replying: !!req.body.replying, at: now });
  for (const [uid, v] of viewers) if (now - v.at > 30000) viewers.delete(uid);
  res.json({ data: [...viewers.values()].filter((v) => v.id !== req.user.id) });
}));

router.get('/:id/extras', asyncHandler(async (req, res) => {
  const t = await load(req.params.id);
  const [parent, children, links, todos, threads, timeline] = await Promise.all([
    t.parent_ticket_id ? query(`SELECT ${SUMMARY} FROM tickets t LEFT JOIN users u ON u.id = t.responder_id WHERE t.id = $1`, [t.parent_ticket_id]) : { rows: [] },
    query(`SELECT ${SUMMARY} FROM tickets t LEFT JOIN users u ON u.id = t.responder_id WHERE t.parent_ticket_id = $1 AND t.deleted = FALSE ORDER BY t.id`, [t.id]),
    query(`SELECT ${SUMMARY} FROM ticket_links l JOIN tickets t ON t.id = CASE WHEN l.ticket_a = $1 THEN l.ticket_b ELSE l.ticket_a END
             LEFT JOIN users u ON u.id = t.responder_id WHERE (l.ticket_a = $1 OR l.ticket_b = $1) AND t.deleted = FALSE ORDER BY t.id`, [t.id]),
    query(`SELECT td.*, u.name AS user_name FROM ticket_todos td LEFT JOIN users u ON u.id = td.user_id WHERE td.ticket_id = $1 ORDER BY td.is_done, td.id`, [t.id]),
    query(`SELECT th.*, u.name AS created_by_name,
                  COALESCE((SELECT json_agg(json_build_object('id', m.id, 'body', m.body, 'created_at', m.created_at, 'user_name', mu.name) ORDER BY m.id)
                              FROM ticket_thread_messages m LEFT JOIN users mu ON mu.id = m.user_id WHERE m.thread_id = th.id), '[]') AS messages
             FROM ticket_threads th LEFT JOIN users u ON u.id = th.created_by_user_id WHERE th.ticket_id = $1 ORDER BY th.id`, [t.id]),
    query(`SELECT ${SUMMARY} FROM tickets t LEFT JOIN users u ON u.id = t.responder_id WHERE t.requester_id = $1 AND t.id <> $2 AND t.deleted = FALSE ORDER BY t.created_at DESC LIMIT 10`, [t.requester_id, t.id]),
  ]);
  res.json({ data: { parent: parent.rows[0] || null, children: children.rows, links: links.rows, todos: todos.rows, threads: threads.rows, timeline: timeline.rows } });
}));

// ---------------- split a customer reply into its own ticket
router.post('/:id/split', requirePrivilege('merge_split_ticket'), asyncHandler(async (req, res) => {
  const t = await load(req.params.id);
  const { rows: [conv] } = await query('SELECT * FROM conversations WHERE id = $1 AND ticket_id = $2', [toInt(req.body.conversation_id), t.id]);
  if (!conv) throw notFound('Conversation');
  if (!conv.contact_id) throw badRequest('Only customer replies can be split into a new ticket');
  const sla = await applySla({ priority: t.priority, type: t.type, source: t.source, group_id: t.group_id, company_id: t.company_id, created_at: new Date() });
  const created = await withTransaction(async (client) => {
    const { rows: [n] } = await client.query(
      `INSERT INTO tickets (subject, description, status, priority, type, source, requester_id, group_id, company_id, product_id, sla_policy_id, fr_due_by, due_by, created_by_user_id)
       VALUES ($1,$2,'open',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [req.body.subject || `Split from #${t.id}: ${t.subject}`, conv.body, t.priority, t.type, t.source, conv.contact_id, t.group_id, t.company_id, t.product_id, sla.sla_policy_id, sla.fr_due_by, sla.due_by, req.user.id]
    );
    await client.query('UPDATE attachments SET ticket_id = $1, conversation_id = NULL WHERE conversation_id = $2', [n.id, conv.id]);
    await client.query('DELETE FROM conversations WHERE id = $1', [conv.id]);
    await logActivity(n.id, req.user, 'split_from', { ticket: t.id }, client);
    await logActivity(t.id, req.user, 'split_to', { ticket: n.id }, client);
    return n;
  });
  res.status(201).json({ data: created });
}));

// ---------------- links and parent/child
router.post('/:id/links', asyncHandler(async (req, res) => {
  const a = Number(req.params.id);
  const b = toInt(req.body.ticket_id);
  if (!b || a === b) throw badRequest('Choose a different ticket to link');
  await load(a); await load(b);
  await query('INSERT INTO ticket_links (ticket_a, ticket_b, created_by_user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [Math.min(a, b), Math.max(a, b), req.user.id]);
  await logActivity(a, req.user, 'linked', { ticket: b });
  res.status(201).json({ ok: true });
}));
router.delete('/:id/links/:other', asyncHandler(async (req, res) => {
  const a = Number(req.params.id);
  const b = Number(req.params.other);
  await query('DELETE FROM ticket_links WHERE ticket_a = $1 AND ticket_b = $2', [Math.min(a, b), Math.max(a, b)]);
  await logActivity(a, req.user, 'unlinked', { ticket: b });
  res.json({ ok: true });
}));
router.post('/:id/parent', asyncHandler(async (req, res) => {
  const t = await load(req.params.id);
  const parentId = toInt(req.body.parent_id);
  if (parentId) {
    if (parentId === t.id) throw badRequest('A ticket cannot be its own parent');
    const parent = await load(parentId);
    if (parent.parent_ticket_id) throw badRequest('Child tickets cannot have children of their own');
    const { rows: [kids] } = await query('SELECT COUNT(*) FROM tickets WHERE parent_ticket_id = $1', [t.id]);
    if (Number(kids.count)) throw badRequest('This ticket already has child tickets');
  }
  await query('UPDATE tickets SET parent_ticket_id = $2 WHERE id = $1', [t.id, parentId]);
  await logActivity(t.id, req.user, parentId ? 'parent_set' : 'parent_removed', { ticket: parentId || t.parent_ticket_id });
  res.json({ ok: true });
}));

// ---------------- to-dos
router.post('/:id/todos', asyncHandler(async (req, res) => {
  requireFields(req.body, ['title']);
  const t = await load(req.params.id);
  const { rows } = await query('INSERT INTO ticket_todos (ticket_id, user_id, title, due_at) VALUES ($1,$2,$3,$4) RETURNING *', [t.id, req.user.id, req.body.title, req.body.due_at || null]);
  res.status(201).json({ data: rows[0] });
}));
router.patch('/:id/todos/:tid', asyncHandler(async (req, res) => {
  const { rows } = await query('UPDATE ticket_todos SET is_done = COALESCE($3, is_done), title = COALESCE($4, title) WHERE id = $1 AND ticket_id = $2 RETURNING *', [req.params.tid, req.params.id, req.body.is_done ?? null, req.body.title || null]);
  if (!rows[0]) throw notFound('To-do');
  res.json({ data: rows[0] });
}));
router.delete('/:id/todos/:tid', asyncHandler(async (req, res) => {
  await query('DELETE FROM ticket_todos WHERE id = $1 AND ticket_id = $2', [req.params.tid, req.params.id]);
  res.json({ ok: true });
}));

// ---------------- internal threads
router.post('/:id/threads', asyncHandler(async (req, res) => {
  requireFields(req.body, ['title', 'body']);
  const t = await load(req.params.id);
  const { rows: [thread] } = await query('INSERT INTO ticket_threads (ticket_id, title, created_by_user_id) VALUES ($1,$2,$3) RETURNING *', [t.id, req.body.title, req.user.id]);
  await query('INSERT INTO ticket_thread_messages (thread_id, user_id, body) VALUES ($1,$2,$3)', [thread.id, req.user.id, req.body.body]);
  for (const uid of toArray(req.body.notify_user_ids).map(Number).filter(Boolean)) {
    if (uid !== req.user.id) await notifyUser(uid, { type: 'thread', title: `${req.user.name} started a thread on #${t.id}`, body: req.body.title, link: `/tickets/${t.id}` });
  }
  await logActivity(t.id, req.user, 'thread_started', { title: req.body.title });
  res.status(201).json({ data: thread });
}));
router.post('/:id/threads/:tid/messages', asyncHandler(async (req, res) => {
  requireFields(req.body, ['body']);
  const { rows: [thread] } = await query('SELECT * FROM ticket_threads WHERE id = $1 AND ticket_id = $2', [req.params.tid, req.params.id]);
  if (!thread) throw notFound('Thread');
  const { rows } = await query('INSERT INTO ticket_thread_messages (thread_id, user_id, body) VALUES ($1,$2,$3) RETURNING *', [thread.id, req.user.id, req.body.body]);
  res.status(201).json({ data: rows[0] });
}));

// ---------------- scenarios
async function visibleScenario(id, user) {
  const { rows: [s] } = await query(
    `SELECT * FROM scenarios WHERE id = $1 AND (visibility = 'all' OR user_id = $2 OR $3 = 'admin'
       OR (visibility = 'group' AND group_id IN (SELECT group_id FROM group_members WHERE user_id = $2)))`,
    [id, user.id, user.role]
  );
  if (!s) throw notFound('Scenario');
  return s;
}
router.post('/bulk-scenario', asyncHandler(async (req, res) => {
  const scenario = await visibleScenario(req.body.scenario_id, req.user);
  const ids = toArray(req.body.ids).map(Number).filter(Boolean);
  if (!ids.length) throw badRequest('ids required');
  for (const id of ids) await executeActions(scenario.actions, await load(id), { label: 'Scenario', name: scenario.name, action: 'scenario', actor: req.user });
  res.json({ ok: true, count: ids.length });
}));
router.post('/:id/scenarios/:sid', asyncHandler(async (req, res) => {
  const scenario = await visibleScenario(req.params.sid, req.user);
  const updated = await executeActions(scenario.actions, await load(req.params.id), { label: 'Scenario', name: scenario.name, action: 'scenario', actor: req.user });
  res.json({ data: updated });
}));

// ---------------- convert a ticket into a forum topic
router.post('/:id/to-forum', requirePrivilege('moderate_forums'), asyncHandler(async (req, res) => {
  requireFields(req.body, ['forum_id']);
  const t = await load(req.params.id);
  const { rows } = await query(
    'INSERT INTO forum_topics (forum_id, title, body, user_id, ticket_id) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [toInt(req.body.forum_id), req.body.title || t.subject, t.description || t.subject, req.user.id, t.id]
  );
  await logActivity(t.id, req.user, 'converted_to_topic', { topic: rows[0].id });
  res.status(201).json({ data: rows[0] });
}));

export default router;
