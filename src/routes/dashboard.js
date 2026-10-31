import { Router } from 'express';
import { query } from '../config/db.js';
import { authenticate, requireAgent } from '../middleware/auth.js';
import { asyncHandler } from '../utils/errors.js';
import { slaStatus } from '../utils/sla.js';

const router = Router();
router.use(authenticate, requireAgent);

router.get('/', asyncHandler(async (req, res) => {
  const me = req.user.id;
  const [{ rows: [counts] }, { rows: trend }, { rows: recentActivity }, { rows: myTickets }, { rows: overdue }, { rows: unassigned }, { rows: [csat] }, { rows: byStatus }, { rows: byPriority }, { rows: agentLoad }] = await Promise.all([
    query(`SELECT
             COUNT(*) FILTER (WHERE status IN ('open','pending')) AS unresolved,
             COUNT(*) FILTER (WHERE status = 'open') AS open,
             COUNT(*) FILTER (WHERE status = 'pending') AS on_hold,
             COUNT(*) FILTER (WHERE status IN ('open','pending') AND due_by < NOW()) AS overdue,
             COUNT(*) FILTER (WHERE status IN ('open','pending') AND due_by::date = CURRENT_DATE) AS due_today,
             COUNT(*) FILTER (WHERE status IN ('open','pending') AND responder_id IS NULL) AS unassigned,
             COUNT(*) FILTER (WHERE status IN ('open','pending') AND responder_id = $1) AS my_open,
             COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE) AS created_today,
             COUNT(*) FILTER (WHERE resolved_at::date = CURRENT_DATE) AS resolved_today,
             COUNT(*) FILTER (WHERE status = 'open' AND first_responded_at IS NULL AND fr_due_by < NOW()) AS awaiting_first_response_overdue,
             COUNT(*) FILTER (WHERE priority = 'urgent' AND status IN ('open','pending')) AS urgent_open
           FROM tickets WHERE deleted = FALSE AND spam = FALSE`, [me]),
    query(`WITH days AS (SELECT generate_series(CURRENT_DATE - 13, CURRENT_DATE, '1 day')::date AS day)
           SELECT d.day,
                  (SELECT COUNT(*) FROM tickets t WHERE t.created_at::date = d.day AND t.deleted = FALSE AND t.spam = FALSE) AS created,
                  (SELECT COUNT(*) FROM tickets t WHERE t.resolved_at::date = d.day AND t.deleted = FALSE AND t.spam = FALSE) AS resolved
             FROM days d ORDER BY d.day`),
    query(`SELECT a.*, t.subject FROM ticket_activities a JOIN tickets t ON t.id = a.ticket_id WHERE t.deleted = FALSE ORDER BY a.created_at DESC LIMIT 15`),
    query(`SELECT t.id, t.subject, t.status, t.priority, t.due_by, t.first_responded_at, t.fr_due_by, t.resolved_at, t.updated_at, c.name AS requester_name
             FROM tickets t JOIN contacts c ON c.id = t.requester_id
            WHERE t.responder_id = $1 AND t.status IN ('open','pending') AND t.deleted = FALSE AND t.spam = FALSE
            ORDER BY t.due_by ASC NULLS LAST LIMIT 8`, [me]),
    query(`SELECT t.id, t.subject, t.status, t.priority, t.due_by, t.first_responded_at, t.fr_due_by, t.resolved_at, c.name AS requester_name, u.name AS responder_name
             FROM tickets t JOIN contacts c ON c.id = t.requester_id LEFT JOIN users u ON u.id = t.responder_id
            WHERE t.status IN ('open','pending') AND t.due_by < NOW() AND t.deleted = FALSE AND t.spam = FALSE
            ORDER BY t.due_by ASC LIMIT 8`),
    query(`SELECT t.id, t.subject, t.status, t.priority, t.due_by, t.first_responded_at, t.fr_due_by, t.resolved_at, t.created_at, c.name AS requester_name, g.name AS group_name
             FROM tickets t JOIN contacts c ON c.id = t.requester_id LEFT JOIN groups g ON g.id = t.group_id
            WHERE t.status IN ('open','pending') AND t.responder_id IS NULL AND t.deleted = FALSE AND t.spam = FALSE
            ORDER BY t.created_at DESC LIMIT 8`),
    query(`SELECT COUNT(*) AS responses, ROUND(AVG(rating)::numeric,2) AS avg_rating, COUNT(*) FILTER (WHERE rating >= 4) AS positive
             FROM satisfaction_ratings WHERE created_at > NOW() - INTERVAL '30 days'`),
    query(`SELECT status AS label, COUNT(*) AS value FROM tickets WHERE deleted = FALSE AND spam = FALSE GROUP BY status`),
    query(`SELECT priority AS label, COUNT(*) AS value FROM tickets WHERE deleted = FALSE AND spam = FALSE AND status IN ('open','pending') GROUP BY priority`),
    query(`SELECT u.id, u.name, u.avatar_url, COUNT(t.id) AS open
             FROM users u LEFT JOIN tickets t ON t.responder_id = u.id AND t.status IN ('open','pending') AND t.deleted = FALSE
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
