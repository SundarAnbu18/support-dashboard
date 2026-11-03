import { Router } from 'express';
import { query } from '../config/db.js';
import { authenticate, requireAgent } from '../middleware/auth.js';
import { asyncHandler } from '../utils/errors.js';
import { slaStatus } from '../utils/sla.js';
import { toInt } from '../utils/helpers.js';

const router = Router();
router.use(authenticate, requireAgent);

// "My Dashboard" header: tiles and today's trend, filterable by group and product.
router.get('/today', asyncHandler(async (req, res) => {
  const params = [];
  let scope = 't.deleted = FALSE AND t.spam = FALSE AND t.archived = FALSE';
  if (toInt(req.query.group_id)) { params.push(toInt(req.query.group_id)); scope += ` AND t.group_id = $${params.length}`; }
  if (toInt(req.query.product_id)) { params.push(toInt(req.query.product_id)); scope += ` AND t.product_id = $${params.length}`; }
  const [{ rows: [tiles] }, { rows: hourly }, { rows: [today] }, { rows: [yesterday] }, { rows: byGroup }, { rows: [undelivered] }] = await Promise.all([
    query(`SELECT COUNT(*) FILTER (WHERE t.status NOT IN ('resolved','closed')) AS unresolved,
                  COUNT(*) FILTER (WHERE t.status NOT IN ('resolved','closed') AND t.due_by < NOW()) AS overdue,
                  COUNT(*) FILTER (WHERE t.status NOT IN ('resolved','closed') AND t.due_by::date = CURRENT_DATE) AS due_today,
                  COUNT(*) FILTER (WHERE t.status = 'open') AS open,
                  COUNT(*) FILTER (WHERE t.status NOT IN ('open','resolved','closed')) AS on_hold,
                  COUNT(*) FILTER (WHERE t.status NOT IN ('resolved','closed') AND t.responder_id IS NULL) AS unassigned
             FROM tickets t WHERE ${scope}`, params),
    query(`SELECT h AS hour,
                  (SELECT COUNT(*) FROM tickets t WHERE ${scope} AND t.created_at >= CURRENT_DATE AND t.created_at < CURRENT_DATE + 1 AND EXTRACT(HOUR FROM t.created_at) = h) AS today,
                  (SELECT COUNT(*) FROM tickets t WHERE ${scope} AND t.created_at >= CURRENT_DATE - 1 AND t.created_at < CURRENT_DATE AND EXTRACT(HOUR FROM t.created_at) = h) AS yesterday
             FROM generate_series(0, 23) h ORDER BY h`, params),
    ...[['CURRENT_DATE', 'CURRENT_DATE + 1'], ['CURRENT_DATE - 1', 'CURRENT_DATE']].map(([from, to]) => query(
      `SELECT COUNT(*) FILTER (WHERE t.created_at >= ${from} AND t.created_at < ${to}) AS received,
              COUNT(*) FILTER (WHERE t.resolved_at >= ${from} AND t.resolved_at < ${to}) AS resolved,
              ROUND((AVG(EXTRACT(EPOCH FROM (t.first_responded_at - t.created_at))) FILTER (WHERE t.first_responded_at >= ${from} AND t.first_responded_at < ${to}) / 60)::numeric, 1) AS avg_first_response_minutes,
              ROUND(100.0 * COUNT(*) FILTER (WHERE t.resolved_at >= ${from} AND t.resolved_at < ${to} AND t.resolved_at <= t.due_by) / NULLIF(COUNT(*) FILTER (WHERE t.resolved_at >= ${from} AND t.resolved_at < ${to}), 0), 1) AS sla_pct
         FROM tickets t WHERE ${scope}`, params)),
    query(`SELECT COALESCE(g.name, 'No group') AS name, g.id, COUNT(*) FILTER (WHERE t.status = 'open') AS open, COUNT(*) FILTER (WHERE t.status NOT IN ('resolved','closed')) AS unresolved
             FROM tickets t LEFT JOIN groups g ON g.id = t.group_id WHERE ${scope} AND t.status NOT IN ('resolved','closed') GROUP BY g.id, g.name ORDER BY unresolved DESC LIMIT 8`, params),
    query("SELECT COUNT(*) AS count FROM email_outbox WHERE status = 'failed' AND created_at > NOW() - INTERVAL '30 days'"),
  ]);
  res.json({ data: { tiles, hourly, today, yesterday, by_group: byGroup, undelivered: Number(undelivered.count) } });
}));

router.get('/', asyncHandler(async (req, res) => {
  const me = req.user.id;
  const [{ rows: [counts] }, { rows: trend }, { rows: recentActivity }, { rows: myTickets }, { rows: overdue }, { rows: unassigned }, { rows: [csat] }, { rows: byStatus }, { rows: byPriority }, { rows: agentLoad }] = await Promise.all([
    query(`SELECT
             COUNT(*) FILTER (WHERE status NOT IN ('resolved','closed')) AS unresolved,
             COUNT(*) FILTER (WHERE status = 'open') AS open,
             COUNT(*) FILTER (WHERE status NOT IN ('open','resolved','closed')) AS on_hold,
             COUNT(*) FILTER (WHERE status NOT IN ('resolved','closed') AND due_by < NOW()) AS overdue,
             COUNT(*) FILTER (WHERE status NOT IN ('resolved','closed') AND due_by::date = CURRENT_DATE) AS due_today,
             COUNT(*) FILTER (WHERE status NOT IN ('resolved','closed') AND responder_id IS NULL) AS unassigned,
             COUNT(*) FILTER (WHERE status NOT IN ('resolved','closed') AND responder_id = $1) AS my_open,
             COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE) AS created_today,
             COUNT(*) FILTER (WHERE resolved_at::date = CURRENT_DATE) AS resolved_today,
             COUNT(*) FILTER (WHERE status = 'open' AND first_responded_at IS NULL AND fr_due_by < NOW()) AS awaiting_first_response_overdue,
             COUNT(*) FILTER (WHERE priority = 'urgent' AND status NOT IN ('resolved','closed')) AS urgent_open
           FROM tickets WHERE deleted = FALSE AND spam = FALSE`, [me]),
    query(`WITH days AS (SELECT generate_series(CURRENT_DATE - 13, CURRENT_DATE, '1 day')::date AS day)
           SELECT d.day,
                  (SELECT COUNT(*) FROM tickets t WHERE t.created_at::date = d.day AND t.deleted = FALSE AND t.spam = FALSE) AS created,
                  (SELECT COUNT(*) FROM tickets t WHERE t.resolved_at::date = d.day AND t.deleted = FALSE AND t.spam = FALSE) AS resolved
             FROM days d ORDER BY d.day`),
    query(`SELECT a.*, t.subject FROM ticket_activities a JOIN tickets t ON t.id = a.ticket_id WHERE t.deleted = FALSE ORDER BY a.created_at DESC LIMIT 15`),
    query(`SELECT t.id, t.subject, t.status, t.priority, t.due_by, t.first_responded_at, t.fr_due_by, t.resolved_at, t.updated_at, c.name AS requester_name
             FROM tickets t JOIN contacts c ON c.id = t.requester_id
            WHERE t.responder_id = $1 AND t.status NOT IN ('resolved','closed') AND t.deleted = FALSE AND t.spam = FALSE
            ORDER BY t.due_by ASC NULLS LAST LIMIT 8`, [me]),
    query(`SELECT t.id, t.subject, t.status, t.priority, t.due_by, t.first_responded_at, t.fr_due_by, t.resolved_at, c.name AS requester_name, u.name AS responder_name
             FROM tickets t JOIN contacts c ON c.id = t.requester_id LEFT JOIN users u ON u.id = t.responder_id
            WHERE t.status NOT IN ('resolved','closed') AND t.due_by < NOW() AND t.deleted = FALSE AND t.spam = FALSE
            ORDER BY t.due_by ASC LIMIT 8`),
    query(`SELECT t.id, t.subject, t.status, t.priority, t.due_by, t.first_responded_at, t.fr_due_by, t.resolved_at, t.created_at, c.name AS requester_name, g.name AS group_name
             FROM tickets t JOIN contacts c ON c.id = t.requester_id LEFT JOIN groups g ON g.id = t.group_id
            WHERE t.status NOT IN ('resolved','closed') AND t.responder_id IS NULL AND t.deleted = FALSE AND t.spam = FALSE
            ORDER BY t.created_at DESC LIMIT 8`),
    query(`SELECT COUNT(*) AS responses, ROUND(AVG(rating)::numeric,2) AS avg_rating, COUNT(*) FILTER (WHERE rating >= 4) AS positive
             FROM satisfaction_ratings WHERE created_at > NOW() - INTERVAL '30 days'`),
    query(`SELECT status AS label, COUNT(*) AS value FROM tickets WHERE deleted = FALSE AND spam = FALSE GROUP BY status`),
    query(`SELECT priority AS label, COUNT(*) AS value FROM tickets WHERE deleted = FALSE AND spam = FALSE AND status NOT IN ('resolved','closed') GROUP BY priority`),
    query(`SELECT u.id, u.name, u.avatar_url, COUNT(t.id) AS open
             FROM users u LEFT JOIN tickets t ON t.responder_id = u.id AND t.status NOT IN ('resolved','closed') AND t.deleted = FALSE
            WHERE u.is_active = TRUE GROUP BY u.id ORDER BY open DESC, u.name LIMIT 8`),
  ]);
  const dec = (rows) => rows.map((t) => ({ ...t, sla_status: slaStatus(t) }));
  res.json({
    data: {
      counts, trend, recent_activity: recentActivity, my_tickets: dec(myTickets), overdue: dec(overdue), unassigned: dec(unassigned),
      csat: { ...csat, score_pct: Number(csat.responses) ? Math.round((Number(csat.positive) / Number(csat.responses)) * 100) : null },
      by_status: byStatus, by_priority: byPriority, agent_load: agentLoad,
    },
  });
}));

export default router;
