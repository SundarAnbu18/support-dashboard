import { Router } from 'express';
import { query, withTransaction } from '../config/db.js';
import { authenticate, isAgent, isCustomer } from '../middleware/auth.js';
import { asyncHandler, notFound, badRequest, forbidden } from '../utils/errors.js';
import { requireFields, pagination, toArray, toInt, toBool, normalizeBody, STATUSES, PRIORITIES, TYPES, SOURCES } from '../utils/helpers.js';
import { applySla, computeDueDates, slaStatus } from '../utils/sla.js';
import { runAutomations } from '../utils/automations.js';
import { logActivity } from '../utils/activity.js';
import { notifyUser, notifyGroup, notifyContact } from '../utils/notifications.js';
import { upload, fileRecord } from '../utils/upload.js';

const router = Router();
router.use(authenticate);

const LIST_SELECT = `
  SELECT t.*,
         c.name AS requester_name, c.email AS requester_email, c.avatar_url AS requester_avatar,
         u.name AS responder_name, u.avatar_url AS responder_avatar,
         g.name AS group_name, co.name AS company_name,
         (SELECT COUNT(*) FROM conversations cv WHERE cv.ticket_id = t.id AND cv.is_private = FALSE) AS reply_count,
         (SELECT COUNT(*) FROM attachments a WHERE a.ticket_id = t.id) AS attachment_count,
         (SELECT MAX(cv.created_at) FROM conversations cv WHERE cv.ticket_id = t.id) AS last_reply_at,
         (SELECT COALESCE(SUM(minutes),0) FROM time_entries te WHERE te.ticket_id = t.id) AS time_spent_minutes
    FROM tickets t
    JOIN contacts c ON c.id = t.requester_id
    LEFT JOIN users u ON u.id = t.responder_id
    LEFT JOIN groups g ON g.id = t.group_id
    LEFT JOIN companies co ON co.id = t.company_id`;

function decorate(t) {
  return { ...t, sla_status: slaStatus(t) };
}

function scopeForUser(user, where, params) {
  if (isCustomer(user)) {
    params.push(user.id);
    where.push(`t.requester_id = $${params.length}`);
    where.push('t.deleted = FALSE AND t.spam = FALSE');
  }
}

async function loadTicket(id, user) {
  const { rows } = await query(`${LIST_SELECT} WHERE t.id = $1`, [id]);
  const t = rows[0];
  if (!t) throw notFound('Ticket');
  if (isCustomer(user) && (t.requester_id !== user.id || t.deleted || t.spam)) throw notFound('Ticket');
  return t;
}

async function findOrCreateRequester({ requester_id, requester_email, requester_name, requester_phone }) {
  if (requester_id) {
    const { rows } = await query('SELECT * FROM contacts WHERE id = $1', [requester_id]);
    if (!rows[0]) throw badRequest('Requester not found');
    return rows[0];
  }
  if (!requester_email && !requester_phone) throw badRequest('A requester (id, email or phone) is required');
  if (requester_email) {
    const email = String(requester_email).toLowerCase();
    const { rows } = await query('SELECT * FROM contacts WHERE LOWER(email) = $1', [email]);
    if (rows[0]) return rows[0];
    const { rows: comp } = await query('SELECT id FROM companies WHERE $1 = ANY(domains) LIMIT 1', [email.split('@')[1]]);
    const { rows: created } = await query(
      'INSERT INTO contacts (name, email, phone, company_id) VALUES ($1, $2, $3, $4) RETURNING *',
      [requester_name || email.split('@')[0], email, requester_phone || null, comp[0]?.id || null]
    );
    return created[0];
  }
  const { rows: created } = await query('INSERT INTO contacts (name, phone) VALUES ($1, $2) RETURNING *', [requester_name || requester_phone, requester_phone]);
  return created[0];
}

async function saveAttachments(files, { ticketId, conversationId, user }) {
  const out = [];
  for (const f of files || []) {
    const r = fileRecord(f);
    const { rows } = await query(
      `INSERT INTO attachments (ticket_id, conversation_id, file_name, content_type, size, path, uploaded_by_user_id, uploaded_by_contact_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [ticketId, conversationId || null, r.file_name, r.content_type, r.size, r.path, isAgent(user) ? user.id : null, isCustomer(user) ? user.id : null]
    );
    out.push(rows[0]);
  }
  return out;
}

// Round-robin assignment inside a group with auto_assign enabled.
async function autoAssign(groupId) {
  if (!groupId) return null;
  const { rows: g } = await query('SELECT auto_assign FROM groups WHERE id = $1', [groupId]);
  if (!g[0]?.auto_assign) return null;
  const { rows } = await query(
    `SELECT u.id, (SELECT COUNT(*) FROM tickets t WHERE t.responder_id = u.id AND t.status IN ('open','pending') AND t.deleted = FALSE) AS load
       FROM users u JOIN group_members gm ON gm.user_id = u.id WHERE gm.group_id = $1 AND u.is_active = TRUE ORDER BY load ASC, u.id ASC LIMIT 1`,
    [groupId]
  );
  return rows[0]?.id || null;
}

// ---------------------------------------------------------------- counts
router.get('/counts', asyncHandler(async (req, res) => {
  const me = isAgent(req.user) ? req.user.id : null;
  const scope = isCustomer(req.user) ? `AND requester_id = ${Number(req.user.id)} AND deleted = FALSE AND spam = FALSE` : '';
  const { rows } = await query(
    `SELECT
       COUNT(*) FILTER (WHERE status IN ('open','pending') AND deleted = FALSE AND spam = FALSE) AS unresolved,
       COUNT(*) FILTER (WHERE status = 'open' AND deleted = FALSE AND spam = FALSE) AS open,
       COUNT(*) FILTER (WHERE status = 'pending' AND deleted = FALSE AND spam = FALSE) AS pending,
       COUNT(*) FILTER (WHERE status = 'resolved' AND deleted = FALSE AND spam = FALSE) AS resolved,
       COUNT(*) FILTER (WHERE status = 'closed' AND deleted = FALSE AND spam = FALSE) AS closed,
       COUNT(*) FILTER (WHERE status IN ('open','pending') AND due_by < NOW() AND deleted = FALSE AND spam = FALSE) AS overdue,
       COUNT(*) FILTER (WHERE status IN ('open','pending') AND due_by::date = CURRENT_DATE AND deleted = FALSE AND spam = FALSE) AS due_today,
       COUNT(*) FILTER (WHERE status IN ('open','pending') AND responder_id IS NULL AND deleted = FALSE AND spam = FALSE) AS unassigned,
       COUNT(*) FILTER (WHERE status IN ('open','pending') AND responder_id = $1 AND deleted = FALSE AND spam = FALSE) AS my_open,
       COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours' AND deleted = FALSE AND spam = FALSE) AS new_today,
       COUNT(*) FILTER (WHERE spam = TRUE AND deleted = FALSE) AS spam,
       COUNT(*) FILTER (WHERE deleted = TRUE) AS trash,
       COUNT(*) FILTER (WHERE deleted = FALSE AND spam = FALSE) AS all_tickets,
       COUNT(*) FILTER (WHERE id IN (SELECT ticket_id FROM ticket_watchers WHERE user_id = $1) AND deleted = FALSE) AS watching
     FROM tickets WHERE TRUE ${scope}`,
    [me]
  );
  res.json({ data: rows[0] });
}));

// ---------------------------------------------------------------- list
router.get('/', asyncHandler(async (req, res) => {
  const q = req.query;
  const { page, perPage, offset } = pagination(q, { per_page: 30 });
  const where = [];
  const params = [];
  scopeForUser(req.user, where, params);

  const view = q.view || 'all';
  const me = isAgent(req.user) ? req.user.id : 0;
  const notTrash = 't.deleted = FALSE AND t.spam = FALSE';
  switch (view) {
    case 'unresolved': where.push(`t.status IN ('open','pending') AND ${notTrash}`); break;
    case 'new_and_my_open': where.push(`t.status IN ('open','pending') AND (t.responder_id IS NULL OR t.responder_id = ${me}) AND ${notTrash}`); break;
    case 'my_open': where.push(`t.status IN ('open','pending') AND t.responder_id = ${me} AND ${notTrash}`); break;
    case 'unassigned': where.push(`t.status IN ('open','pending') AND t.responder_id IS NULL AND ${notTrash}`); break;
    case 'overdue': where.push(`t.status IN ('open','pending') AND t.due_by < NOW() AND ${notTrash}`); break;
    case 'due_today': where.push(`t.status IN ('open','pending') AND t.due_by::date = CURRENT_DATE AND ${notTrash}`); break;
    case 'open': where.push(`t.status = 'open' AND ${notTrash}`); break;
    case 'on_hold': case 'pending': where.push(`t.status = 'pending' AND ${notTrash}`); break;
    case 'resolved': where.push(`t.status = 'resolved' AND ${notTrash}`); break;
    case 'closed': where.push(`t.status = 'closed' AND ${notTrash}`); break;
    case 'watching': where.push(`t.id IN (SELECT ticket_id FROM ticket_watchers WHERE user_id = ${me}) AND t.deleted = FALSE`); break;
    case 'spam': where.push('t.spam = TRUE AND t.deleted = FALSE'); break;
    case 'trash': where.push('t.deleted = TRUE'); break;
    default: if (!isCustomer(req.user)) where.push(notTrash);
  }

  const statuses = toArray(q.status); if (statuses.length) { params.push(statuses); where.push(`t.status = ANY($${params.length}::text[])`); }
  const priorities = toArray(q.priority); if (priorities.length) { params.push(priorities); where.push(`t.priority = ANY($${params.length}::text[])`); }
  const types = toArray(q.type); if (types.length) { params.push(types); where.push(`t.type = ANY($${params.length}::text[])`); }
  const sources = toArray(q.source); if (sources.length) { params.push(sources); where.push(`t.source = ANY($${params.length}::text[])`); }
  const responders = toArray(q.responder_id);
  if (responders.length) {
    const nums = responders.filter((r) => r !== 'none' && r !== 'null').map(Number);
    const includeNone = responders.includes('none') || responders.includes('null');
    const parts = [];
    if (nums.length) { params.push(nums); parts.push(`t.responder_id = ANY($${params.length}::int[])`); }
    if (includeNone) parts.push('t.responder_id IS NULL');
    where.push(`(${parts.join(' OR ')})`);
  }
  const groups = toArray(q.group_id).map(Number).filter(Boolean); if (groups.length) { params.push(groups); where.push(`t.group_id = ANY($${params.length}::int[])`); }
  if (q.requester_id) { params.push(toInt(q.requester_id)); where.push(`t.requester_id = $${params.length}`); }
  if (q.company_id) { params.push(toInt(q.company_id)); where.push(`t.company_id = $${params.length}`); }
  const tags = toArray(q.tags || q.tag); if (tags.length) { params.push(tags); where.push(`t.tags && $${params.length}::text[]`); }
  if (q.created_from) { params.push(q.created_from); where.push(`t.created_at >= $${params.length}`); }
  if (q.created_to) { params.push(q.created_to); where.push(`t.created_at <= $${params.length}::date + INTERVAL '1 day'`); }
  if (q.q) {
    params.push(`%${q.q}%`);
    const idMatch = /^#?(\d+)$/.exec(String(q.q).trim());
    where.push(`(t.subject ILIKE $${params.length} OR t.description ILIKE $${params.length} OR c.name ILIKE $${params.length} OR c.email ILIKE $${params.length}${idMatch ? ` OR t.id = ${Number(idMatch[1])}` : ''})`);
  }

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const sortMap = {
    created_at: 't.created_at', updated_at: 't.updated_at', due_by: 't.due_by', status: 't.status',
    priority: "CASE t.priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END",
    last_reply: 'last_reply_at',
  };
  const sortCol = sortMap[q.sort] || 't.created_at';
  const dir = (q.order || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const { rows: count } = await query(`SELECT COUNT(*) FROM tickets t JOIN contacts c ON c.id = t.requester_id ${whereSql}`, params);
  const { rows } = await query(`${LIST_SELECT} ${whereSql} ORDER BY ${sortCol} ${dir} NULLS LAST, t.id DESC LIMIT ${perPage} OFFSET ${offset}`, params);
  res.json({ data: rows.map(decorate), meta: { total: Number(count[0].count), page, per_page: perPage } });
}));

// ---------------------------------------------------------------- create
router.post('/', upload.array('attachments', 10), asyncHandler(async (req, res) => {
  const b = normalizeBody(req.body);
  requireFields(b, ['subject']);
  const customer = isCustomer(req.user);

  const requester = customer
    ? (await query('SELECT * FROM contacts WHERE id = $1', [req.user.id])).rows[0]
    : await findOrCreateRequester(b);

  const priority = PRIORITIES.includes(b.priority) ? b.priority : 'low';
  const status = !customer && STATUSES.includes(b.status) ? b.status : 'open';
  const type = TYPES.includes(b.type) ? b.type : null;
  const source = customer ? 'portal' : (SOURCES.includes(b.source) ? b.source : 'agent');
  const groupId = customer ? null : toInt(b.group_id);
  let responderId = customer ? null : toInt(b.responder_id);
  if (!responderId) responderId = await autoAssign(groupId);

  const draft = { priority, type, source, group_id: groupId, company_id: requester.company_id, created_at: new Date() };
  const sla = await applySla(draft);

  let ticket = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO tickets (subject, description, status, priority, type, source, requester_id, responder_id, group_id, company_id,
                            tags, cc_emails, custom_fields, sla_policy_id, fr_due_by, due_by, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [b.subject, b.description || '', status, priority, type, source, requester.id, responderId, groupId, requester.company_id,
       toArray(b.tags), toArray(b.cc_emails), JSON.stringify(b.custom_fields || {}), sla.sla_policy_id, sla.fr_due_by, sla.due_by,
       isAgent(req.user) ? req.user.id : null]
    );
    const t = rows[0];
    await logActivity(t.id, req.user, 'created', { status, priority, source }, client);
    return t;
  });

  await saveAttachments(req.files, { ticketId: ticket.id, user: req.user });
  ticket = await runAutomations('ticket_created', ticket);

  if (ticket.responder_id && ticket.responder_id !== req.user.id) {
    await notifyUser(ticket.responder_id, { type: 'ticket_assigned', title: `Ticket #${ticket.id} assigned to you`, body: ticket.subject, link: `/tickets/${ticket.id}` });
  } else if (!ticket.responder_id && ticket.group_id) {
    await notifyGroup(ticket.group_id, { type: 'ticket_created', title: `New ticket #${ticket.id} in your group`, body: ticket.subject, link: `/tickets/${ticket.id}` });
  }
  if (customer) {
    await notifyContact(requester.id, { type: 'ticket_created', title: `We received your request #${ticket.id}`, body: ticket.subject, link: `/portal/tickets/${ticket.id}` });
  }

  res.status(201).json({ data: decorate(await loadTicket(ticket.id, req.user)) });
}));

// ---------------------------------------------------------------- bulk
router.post('/bulk', asyncHandler(async (req, res) => {
  if (!isAgent(req.user)) throw forbidden();
  const ids = toArray(req.body.ids).map(Number).filter(Boolean);
  const action = req.body.action || {};
  if (!ids.length) throw badRequest('ids required');
  const updates = {};
  if (STATUSES.includes(action.status)) updates.status = action.status;
  if (PRIORITIES.includes(action.priority)) updates.priority = action.priority;
  if (TYPES.includes(action.type)) updates.type = action.type;
  if (action.responder_id !== undefined) updates.responder_id = toInt(action.responder_id);
  if (action.group_id !== undefined) updates.group_id = toInt(action.group_id);
  if (action.delete) updates.deleted = true;
  if (action.restore) updates.deleted = false;
  if (action.spam !== undefined) updates.spam = !!action.spam;

  const keys = Object.keys(updates);
  if (!keys.length && !action.add_tags) throw badRequest('No bulk action supplied');
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  if (updates.status === 'resolved') sets.push('resolved_at = COALESCE(resolved_at, NOW())');
  if (updates.status === 'closed') sets.push('closed_at = COALESCE(closed_at, NOW())');
  if (updates.status === 'open' || updates.status === 'pending') sets.push('resolved_at = NULL, closed_at = NULL');
  if (action.add_tags) { sets.push(`tags = (SELECT ARRAY(SELECT DISTINCT unnest(tags || $${keys.length + 2}::text[])))`); }
  const values = keys.map((k) => updates[k]);
  if (action.add_tags) values.push(toArray(action.add_tags));
  await query(`UPDATE tickets SET ${sets.join(', ')} WHERE id = ANY($1::int[])`, [ids, ...values]);
  for (const id of ids) await logActivity(id, req.user, 'bulk_update', { ...updates, add_tags: action.add_tags });
  res.json({ ok: true, count: ids.length });
}));

// ---------------------------------------------------------------- detail
router.get('/:id', asyncHandler(async (req, res) => {
  const t = await loadTicket(req.params.id, req.user);
  const customer = isCustomer(req.user);
  const { rows: conversations } = await query(
    `SELECT cv.*, u.name AS user_name, u.avatar_url AS user_avatar, c.name AS contact_name, c.email AS contact_email, c.avatar_url AS contact_avatar,
            COALESCE((SELECT json_agg(a.*) FROM attachments a WHERE a.conversation_id = cv.id), '[]') AS attachments
       FROM conversations cv LEFT JOIN users u ON u.id = cv.user_id LEFT JOIN contacts c ON c.id = cv.contact_id
      WHERE cv.ticket_id = $1 ${customer ? 'AND cv.is_private = FALSE' : ''} ORDER BY cv.created_at ASC`,
    [t.id]
  );
  const { rows: attachments } = await query('SELECT * FROM attachments WHERE ticket_id = $1 AND conversation_id IS NULL ORDER BY created_at', [t.id]);
  const { rows: activities } = customer ? { rows: [] } : await query(
    'SELECT * FROM ticket_activities WHERE ticket_id = $1 ORDER BY created_at DESC LIMIT 100', [t.id]
  );
  const { rows: timeEntries } = customer ? { rows: [] } : await query(
    'SELECT te.*, u.name AS user_name FROM time_entries te LEFT JOIN users u ON u.id = te.user_id WHERE te.ticket_id = $1 ORDER BY te.started_at DESC', [t.id]
  );
  const { rows: watchers } = await query(
    'SELECT u.id, u.name, u.avatar_url FROM ticket_watchers w JOIN users u ON u.id = w.user_id WHERE w.ticket_id = $1', [t.id]
  );
  const { rows: rating } = await query('SELECT * FROM satisfaction_ratings WHERE ticket_id = $1', [t.id]);
  const { rows: requester } = await query(
    `SELECT c.*, co.name AS company_name, (c.password_hash IS NOT NULL) AS has_portal_access,
            (SELECT COUNT(*) FROM tickets x WHERE x.requester_id = c.id AND x.deleted = FALSE) AS ticket_count
       FROM contacts c LEFT JOIN companies co ON co.id = c.company_id WHERE c.id = $1`, [t.requester_id]
  );
  const { password_hash, ...requesterSafe } = requester[0] || {};
  const { rows: merged } = await query('SELECT id, subject FROM tickets WHERE merged_into_ticket_id = $1', [t.id]);
  const { rows: sla } = t.sla_policy_id ? await query('SELECT id, name FROM sla_policies WHERE id = $1', [t.sla_policy_id]) : { rows: [] };

  res.json({
    data: {
      ...decorate(t), conversations, attachments, activities, time_entries: timeEntries, watchers,
      satisfaction: rating[0] || null, requester: requesterSafe, merged_tickets: merged, sla_policy: sla[0] || null,
      is_watching: watchers.some((w) => w.id === req.user.id && isAgent(req.user)),
    },
  });
}));

// ---------------------------------------------------------------- update
router.patch('/:id', asyncHandler(async (req, res) => {
  const t = await loadTicket(req.params.id, req.user);
  const b = req.body;
  const updates = {};
  if (isCustomer(req.user)) {
    // Customers may only close/reopen their own tickets.
    if (b.status === 'closed' || b.status === 'open') updates.status = b.status;
    else throw forbidden('Customers can only close or reopen tickets');
  } else {
    if (b.subject !== undefined) updates.subject = b.subject;
    if (b.description !== undefined) updates.description = b.description;
    if (b.status !== undefined) { if (!STATUSES.includes(b.status)) throw badRequest('Invalid status'); updates.status = b.status; }
    if (b.priority !== undefined) { if (!PRIORITIES.includes(b.priority)) throw badRequest('Invalid priority'); updates.priority = b.priority; }
    if (b.type !== undefined) updates.type = b.type || null;
    if (b.source !== undefined) updates.source = b.source;
    if (b.responder_id !== undefined) updates.responder_id = toInt(b.responder_id);
    if (b.group_id !== undefined) updates.group_id = toInt(b.group_id);
    if (b.requester_id !== undefined) updates.requester_id = toInt(b.requester_id);
    if (b.company_id !== undefined) updates.company_id = toInt(b.company_id);
    if (b.tags !== undefined) updates.tags = toArray(b.tags);
    if (b.cc_emails !== undefined) updates.cc_emails = toArray(b.cc_emails);
    if (b.custom_fields !== undefined) updates.custom_fields = JSON.stringify({ ...(t.custom_fields || {}), ...b.custom_fields });
    if (b.due_by !== undefined) updates.due_by = b.due_by || null;
    if (b.fr_due_by !== undefined) updates.fr_due_by = b.fr_due_by || null;
    if (b.spam !== undefined) updates.spam = toBool(b.spam);
    if (b.deleted !== undefined) updates.deleted = toBool(b.deleted);
    if (b.is_escalated !== undefined) updates.is_escalated = toBool(b.is_escalated);
  }

  const changes = {};
  for (const [k, v] of Object.entries(updates)) {
    const before = k === 'custom_fields' ? JSON.stringify(t[k]) : t[k];
    const after = k === 'custom_fields' ? v : v;
    if (JSON.stringify(before) !== JSON.stringify(after)) changes[k] = { from: t[k], to: k === 'custom_fields' ? JSON.parse(v) : v };
  }
  if (!Object.keys(changes).length) return res.json({ data: decorate(t) });

  const sets = [];
  const values = [t.id];
  for (const k of Object.keys(changes)) { values.push(updates[k]); sets.push(`${k} = $${values.length}`); }
  if (changes.priority && !b.due_by) {
    const due = computeDueDates(t.sla_policy_id ? (await query('SELECT * FROM sla_policies WHERE id = $1', [t.sla_policy_id])).rows[0] : null, updates.priority, t.created_at);
    values.push(due.due_by); sets.push(`due_by = $${values.length}`);
    if (!t.first_responded_at) { values.push(due.fr_due_by); sets.push(`fr_due_by = $${values.length}`); }
    sets.push('is_escalated = FALSE');
  }
  if (changes.status) {
    if (updates.status === 'resolved') sets.push('resolved_at = NOW()');
    if (updates.status === 'closed') sets.push('closed_at = NOW()', 'resolved_at = COALESCE(resolved_at, NOW())');
    if (updates.status === 'open' || updates.status === 'pending') sets.push('resolved_at = NULL', 'closed_at = NULL');
  }
  if (changes.requester_id) {
    const { rows } = await query('SELECT company_id FROM contacts WHERE id = $1', [updates.requester_id]);
    values.push(rows[0]?.company_id || null); sets.push(`company_id = $${values.length}`);
  }
  if (changes.group_id && !changes.responder_id && !t.responder_id) {
    const auto = await autoAssign(updates.group_id);
    if (auto) { values.push(auto); sets.push(`responder_id = $${values.length}`); changes.responder_id = { from: null, to: auto }; }
  }

  let { rows: [updated] } = await query(`UPDATE tickets SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, values);
  await logActivity(t.id, req.user, 'updated', { changes });

  if (changes.responder_id && updated.responder_id && updated.responder_id !== req.user.id) {
    await notifyUser(updated.responder_id, { type: 'ticket_assigned', title: `Ticket #${t.id} assigned to you`, body: updated.subject, link: `/tickets/${t.id}` });
  }
  if (changes.status && (updated.status === 'resolved' || updated.status === 'closed') && !isCustomer(req.user)) {
    await notifyContact(t.requester_id, { type: 'ticket_resolved', title: `Your ticket #${t.id} has been ${updated.status}`, body: 'Let us know how we did by rating your experience.', link: `/portal/tickets/${t.id}` });
  }
  if (!isCustomer(req.user)) updated = await runAutomations('ticket_updated', updated);
  res.json({ data: decorate(await loadTicket(t.id, req.user)) });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  if (!isAgent(req.user)) throw forbidden();
  const t = await loadTicket(req.params.id, req.user);
  if (req.query.permanent === 'true' && req.user.role === 'admin') {
    await query('DELETE FROM tickets WHERE id = $1', [t.id]);
    return res.json({ ok: true, permanent: true });
  }
  await query('UPDATE tickets SET deleted = TRUE WHERE id = $1', [t.id]);
  await logActivity(t.id, req.user, 'deleted', {});
  res.json({ ok: true });
}));

router.post('/:id/restore', asyncHandler(async (req, res) => {
  if (!isAgent(req.user)) throw forbidden();
  await query('UPDATE tickets SET deleted = FALSE, spam = FALSE WHERE id = $1', [req.params.id]);
  await logActivity(req.params.id, req.user, 'restored', {});
  res.json({ data: decorate(await loadTicket(req.params.id, req.user)) });
}));

// ---------------------------------------------------------------- conversations
async function addConversation(req, res, kind) {
  const t = await loadTicket(req.params.id, req.user);
  const b = normalizeBody(req.body);
  requireFields(b, ['body']);
  const agent = isAgent(req.user);
  if (!agent && kind !== 'reply') throw forbidden('Customers can only post replies');
  const isPrivate = kind === 'note' ? (b.is_private === undefined ? true : toBool(b.is_private)) : false;

  const { rows: [conv] } = await query(
    `INSERT INTO conversations (ticket_id, user_id, contact_id, kind, is_private, body, source, to_emails, cc_emails)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [t.id, agent ? req.user.id : null, agent ? null : req.user.id, kind, isPrivate, b.body, agent ? 'agent' : 'portal', toArray(b.to_emails), toArray(b.cc_emails)]
  );
  const attachments = await saveAttachments(req.files, { ticketId: t.id, conversationId: conv.id, user: req.user });

  const sets = [];
  const values = [t.id];
  if (agent && kind === 'reply') {
    if (!t.first_responded_at) sets.push('first_responded_at = NOW()');
    const newStatus = STATUSES.includes(b.status) ? b.status : (t.status === 'open' ? 'pending' : t.status);
    if (newStatus !== t.status) {
      values.push(newStatus); sets.push(`status = $${values.length}`);
      if (newStatus === 'resolved') sets.push('resolved_at = NOW()');
      if (newStatus === 'closed') sets.push('closed_at = NOW()', 'resolved_at = COALESCE(resolved_at, NOW())');
      if (newStatus === 'open' || newStatus === 'pending') sets.push('resolved_at = NULL', 'closed_at = NULL');
    }
    if (!t.responder_id) { values.push(req.user.id); sets.push(`responder_id = $${values.length}`); }
  } else if (!agent) {
    // Customer reply reopens the ticket and puts the SLA clock back on.
    if (t.status !== 'open') sets.push("status = 'open'", 'resolved_at = NULL', 'closed_at = NULL');
  } else if (kind === 'note' && STATUSES.includes(b.status) && b.status !== t.status) {
    values.push(b.status); sets.push(`status = $${values.length}`);
    if (b.status === 'resolved') sets.push('resolved_at = NOW()');
    if (b.status === 'closed') sets.push('closed_at = NOW()');
  }
  sets.push('updated_at = NOW()');
  await query(`UPDATE tickets SET ${sets.join(', ')} WHERE id = $1`, values);
  await logActivity(t.id, req.user, kind === 'reply' ? (agent ? 'agent_replied' : 'customer_replied') : kind === 'note' ? 'note_added' : 'forwarded', { conversation_id: conv.id, status: b.status });

  if (agent && kind === 'reply') {
    await notifyContact(t.requester_id, { type: 'agent_reply', title: `New reply on your ticket #${t.id}`, body: t.subject, link: `/portal/tickets/${t.id}` });
  }
  if (!agent) {
    const payload = { type: 'customer_reply', title: `${req.user.name} replied on #${t.id}`, body: t.subject, link: `/tickets/${t.id}` };
    if (t.responder_id) await notifyUser(t.responder_id, payload); else await notifyGroup(t.group_id, payload);
  }
  if (kind === 'note') {
    const mentioned = toArray(b.notify_user_ids).map(Number).filter(Boolean);
    for (const uid of mentioned) if (uid !== req.user.id) await notifyUser(uid, { type: 'note_mention', title: `${req.user.name} left you a note on #${t.id}`, body: b.body.slice(0, 140), link: `/tickets/${t.id}` });
  }
  const { rows: watchers } = await query('SELECT user_id FROM ticket_watchers WHERE ticket_id = $1', [t.id]);
  for (const w of watchers) if (w.user_id !== req.user.id) await notifyUser(w.user_id, { type: 'watched_ticket', title: `Activity on watched ticket #${t.id}`, body: `${req.user.name} added a ${kind}`, link: `/tickets/${t.id}` });

  res.status(201).json({ data: { ...conv, attachments, user_name: agent ? req.user.name : null, contact_name: agent ? null : req.user.name }, ticket: decorate(await loadTicket(t.id, req.user)) });
}

router.post('/:id/reply', upload.array('attachments', 10), asyncHandler((req, res) => addConversation(req, res, 'reply')));
router.post('/:id/note', upload.array('attachments', 10), asyncHandler((req, res) => addConversation(req, res, 'note')));
router.post('/:id/forward', upload.array('attachments', 10), asyncHandler((req, res) => addConversation(req, res, 'forward')));

router.delete('/:id/conversations/:cid', asyncHandler(async (req, res) => {
  if (!isAgent(req.user)) throw forbidden();
  const { rowCount } = await query('DELETE FROM conversations WHERE id = $1 AND ticket_id = $2 AND kind <> \'reply\'', [req.params.cid, req.params.id]);
  if (!rowCount) throw badRequest('Only notes and forwards can be deleted');
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- attachments
router.post('/:id/attachments', upload.array('attachments', 10), asyncHandler(async (req, res) => {
  const t = await loadTicket(req.params.id, req.user);
  const saved = await saveAttachments(req.files, { ticketId: t.id, user: req.user });
  res.status(201).json({ data: saved });
}));

router.delete('/:id/attachments/:aid', asyncHandler(async (req, res) => {
  if (!isAgent(req.user)) throw forbidden();
  await query('DELETE FROM attachments WHERE id = $1 AND ticket_id = $2', [req.params.aid, req.params.id]);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- activities
router.get('/:id/activities', asyncHandler(async (req, res) => {
  if (!isAgent(req.user)) throw forbidden();
  const { rows } = await query('SELECT * FROM ticket_activities WHERE ticket_id = $1 ORDER BY created_at DESC', [req.params.id]);
  res.json({ data: rows });
}));

// ---------------------------------------------------------------- time tracking
router.post('/:id/time_entries', asyncHandler(async (req, res) => {
  if (!isAgent(req.user)) throw forbidden();
  const t = await loadTicket(req.params.id, req.user);
  const minutes = toInt(req.body.minutes);
  if (!minutes || minutes <= 0) throw badRequest('minutes must be a positive number');
  const { rows } = await query(
    'INSERT INTO time_entries (ticket_id, user_id, minutes, note, billable, started_at) VALUES ($1,$2,$3,$4,$5,COALESCE($6, NOW())) RETURNING *',
    [t.id, req.user.id, minutes, req.body.note || null, req.body.billable === undefined ? true : toBool(req.body.billable), req.body.started_at || null]
  );
  await logActivity(t.id, req.user, 'time_logged', { minutes });
  res.status(201).json({ data: { ...rows[0], user_name: req.user.name } });
}));

router.delete('/:id/time_entries/:tid', asyncHandler(async (req, res) => {
  if (!isAgent(req.user)) throw forbidden();
  await query('DELETE FROM time_entries WHERE id = $1 AND ticket_id = $2', [req.params.tid, req.params.id]);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- watchers
router.post('/:id/watch', asyncHandler(async (req, res) => {
  if (!isAgent(req.user)) throw forbidden();
  await query('INSERT INTO ticket_watchers (ticket_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.params.id, req.user.id]);
  res.json({ ok: true, watching: true });
}));
router.delete('/:id/watch', asyncHandler(async (req, res) => {
  if (!isAgent(req.user)) throw forbidden();
  await query('DELETE FROM ticket_watchers WHERE ticket_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  res.json({ ok: true, watching: false });
}));

// ---------------------------------------------------------------- merge
router.post('/:id/merge', asyncHandler(async (req, res) => {
  if (!isAgent(req.user)) throw forbidden();
  const primary = await loadTicket(req.params.id, req.user);
  const ids = toArray(req.body.ticket_ids).map(Number).filter((n) => n && n !== primary.id);
  if (!ids.length) throw badRequest('ticket_ids required');
  await withTransaction(async (client) => {
    for (const id of ids) {
      const { rows: [sec] } = await client.query('SELECT * FROM tickets WHERE id = $1', [id]);
      if (!sec) continue;
      await client.query(
        `INSERT INTO conversations (ticket_id, user_id, kind, is_private, body, source)
         VALUES ($1, $2, 'note', TRUE, $3, 'merge')`,
        [primary.id, req.user.id, `Merged from ticket #${sec.id} "${sec.subject}":\n\n${sec.description}`]
      );
      await client.query(
        `INSERT INTO conversations (ticket_id, user_id, contact_id, kind, is_private, body, source, created_at)
         SELECT $1, user_id, contact_id, kind, TRUE, '[From #' || $2 || '] ' || body, source, created_at FROM conversations WHERE ticket_id = $2`,
        [primary.id, sec.id]
      );
      await client.query('UPDATE attachments SET ticket_id = $1 WHERE ticket_id = $2', [primary.id, sec.id]);
      await client.query(
        `UPDATE tickets SET status = 'closed', closed_at = NOW(), resolved_at = COALESCE(resolved_at, NOW()), merged_into_ticket_id = $1 WHERE id = $2`,
        [primary.id, sec.id]
      );
      await logActivity(sec.id, req.user, 'merged', { into: primary.id }, client);
    }
    await logActivity(primary.id, req.user, 'merge_target', { from: ids }, client);
  });
  res.json({ data: decorate(await loadTicket(primary.id, req.user)) });
}));

// ---------------------------------------------------------------- satisfaction
router.post('/:id/satisfaction', asyncHandler(async (req, res) => {
  const t = await loadTicket(req.params.id, req.user);
  const rating = toInt(req.body.rating);
  if (!rating || rating < 1 || rating > 5) throw badRequest('rating must be 1-5');
  if (isAgent(req.user)) throw forbidden('Only the requester can rate a ticket');
  if (!['resolved', 'closed'].includes(t.status)) throw badRequest('You can rate a ticket once it is resolved');
  const { rows } = await query(
    `INSERT INTO satisfaction_ratings (ticket_id, contact_id, agent_id, rating, feedback)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (ticket_id) DO UPDATE SET rating = EXCLUDED.rating, feedback = EXCLUDED.feedback, created_at = NOW()
     RETURNING *`,
    [t.id, req.user.id, t.responder_id, rating, req.body.feedback || null]
  );
  await logActivity(t.id, req.user, 'rated', { rating });
  if (t.responder_id) await notifyUser(t.responder_id, { type: 'csat', title: `${req.user.name} rated ticket #${t.id}: ${rating}/5`, body: req.body.feedback || '', link: `/tickets/${t.id}` });
  res.status(201).json({ data: rows[0] });
}));

export default router;
