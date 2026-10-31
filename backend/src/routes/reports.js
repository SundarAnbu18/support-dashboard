import { Router } from 'express';
import { query } from '../config/db.js';
import { authenticate, requireAgent } from '../middleware/auth.js';
import { asyncHandler } from '../utils/errors.js';

const router = Router();
router.use(authenticate, requireAgent);

function range(q) {
  const to = q.to ? new Date(q.to) : new Date();
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 29 * 86400000);
  to.setHours(23, 59, 59, 999);
  from.setHours(0, 0, 0, 0);
  return { from, to };
}

const BASE_FILTER = 't.deleted = FALSE AND t.spam = FALSE AND t.created_at BETWEEN $1 AND $2';

router.get('/overview', asyncHandler(async (req, res) => {
  const { from, to } = range(req.query);
  const p = [from, to];
  const [{ rows: [totals] }, { rows: byStatus }, { rows: byPriority }, { rows: byType }, { rows: bySource }, { rows: trend }, { rows: [sla] }, { rows: [csat] }, { rows: byHour }, { rows: byWeekday }] = await Promise.all([
    query(`SELECT COUNT(*) AS created,
                  COUNT(*) FILTER (WHERE t.resolved_at IS NOT NULL) AS resolved,
                  COUNT(*) FILTER (WHERE t.status IN ('open','pending')) AS unresolved,
                  COUNT(*) FILTER (WHERE t.status = 'closed') AS closed,
                  COUNT(*) FILTER (WHERE t.is_escalated) AS escalated,
                  ROUND(AVG(EXTRACT(EPOCH FROM (t.first_responded_at - t.created_at))/3600)::numeric, 2) AS avg_first_response_hours,
                  ROUND(AVG(EXTRACT(EPOCH FROM (t.resolved_at - t.created_at))/3600)::numeric, 2) AS avg_resolution_hours,
                  ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (t.resolved_at - t.created_at))/3600)::numeric, 2) AS median_resolution_hours,
                  ROUND(AVG((SELECT COUNT(*) FROM conversations cv WHERE cv.ticket_id = t.id AND cv.kind = 'reply'))::numeric, 2) AS avg_replies
             FROM tickets t WHERE ${BASE_FILTER}`, p),
    query(`SELECT t.status AS label, COUNT(*) AS value FROM tickets t WHERE ${BASE_FILTER} GROUP BY t.status`, p),
    query(`SELECT t.priority AS label, COUNT(*) AS value FROM tickets t WHERE ${BASE_FILTER} GROUP BY t.priority`, p),
    query(`SELECT COALESCE(t.type,'unset') AS label, COUNT(*) AS value FROM tickets t WHERE ${BASE_FILTER} GROUP BY t.type ORDER BY value DESC`, p),
    query(`SELECT t.source AS label, COUNT(*) AS value FROM tickets t WHERE ${BASE_FILTER} GROUP BY t.source ORDER BY value DESC`, p),
    query(`WITH days AS (SELECT generate_series($1::date, $2::date, '1 day')::date AS day)
           SELECT d.day,
                  (SELECT COUNT(*) FROM tickets t WHERE t.created_at::date = d.day AND t.deleted = FALSE AND t.spam = FALSE) AS created,
                  (SELECT COUNT(*) FROM tickets t WHERE t.resolved_at::date = d.day AND t.deleted = FALSE AND t.spam = FALSE) AS resolved
             FROM days d ORDER BY d.day`, p),
    query(`SELECT COUNT(*) FILTER (WHERE t.first_responded_at IS NOT NULL) AS responded,
                  COUNT(*) FILTER (WHERE t.first_responded_at IS NOT NULL AND t.first_responded_at <= t.fr_due_by) AS responded_in_sla,
                  COUNT(*) FILTER (WHERE t.resolved_at IS NOT NULL) AS resolved,
                  COUNT(*) FILTER (WHERE t.resolved_at IS NOT NULL AND t.resolved_at <= t.due_by) AS resolved_in_sla,
                  COUNT(*) FILTER (WHERE t.status IN ('open','pending') AND t.due_by < NOW()) AS currently_overdue
             FROM tickets t WHERE ${BASE_FILTER}`, p),
    query(`SELECT COUNT(*) AS responses, ROUND(AVG(r.rating)::numeric, 2) AS avg_rating,
                  COUNT(*) FILTER (WHERE r.rating >= 4) AS positive, COUNT(*) FILTER (WHERE r.rating = 3) AS neutral, COUNT(*) FILTER (WHERE r.rating <= 2) AS negative
             FROM satisfaction_ratings r WHERE r.created_at BETWEEN $1 AND $2`, p),
    query(`SELECT EXTRACT(HOUR FROM t.created_at)::int AS hour, COUNT(*) AS value FROM tickets t WHERE ${BASE_FILTER} GROUP BY hour ORDER BY hour`, p),
    query(`SELECT EXTRACT(ISODOW FROM t.created_at)::int AS weekday, COUNT(*) AS value FROM tickets t WHERE ${BASE_FILTER} GROUP BY weekday ORDER BY weekday`, p),
  ]);
  const pct = (a, b) => (Number(b) ? Math.round((Number(a) / Number(b)) * 1000) / 10 : null);
  res.json({
    data: {
      range: { from, to },
      totals,
      by_status: byStatus, by_priority: byPriority, by_type: byType, by_source: bySource,
      trend,
      sla: { ...sla, first_response_pct: pct(sla.responded_in_sla, sla.responded), resolution_pct: pct(sla.resolved_in_sla, sla.resolved) },
      csat: { ...csat, score_pct: pct(csat.positive, csat.responses) },
      by_hour: byHour, by_weekday: byWeekday,
    },
  });
}));

router.get('/agents', asyncHandler(async (req, res) => {
  const { from, to } = range(req.query);
  const { rows } = await query(
    `SELECT u.id, u.name, u.avatar_url, u.role,
            COUNT(t.id) AS assigned,
            COUNT(t.id) FILTER (WHERE t.resolved_at IS NOT NULL) AS resolved,
            COUNT(t.id) FILTER (WHERE t.status IN ('open','pending')) AS open,
            COUNT(t.id) FILTER (WHERE t.resolved_at IS NOT NULL AND t.resolved_at <= t.due_by) AS resolved_in_sla,
            ROUND(AVG(EXTRACT(EPOCH FROM (t.first_responded_at - t.created_at))/3600)::numeric, 2) AS avg_first_response_hours,
            ROUND(AVG(EXTRACT(EPOCH FROM (t.resolved_at - t.created_at))/3600)::numeric, 2) AS avg_resolution_hours,
            (SELECT COUNT(*) FROM conversations cv JOIN tickets tt ON tt.id = cv.ticket_id WHERE cv.user_id = u.id AND cv.kind = 'reply' AND cv.created_at BETWEEN $1 AND $2) AS replies,
            (SELECT ROUND(AVG(r.rating)::numeric, 2) FROM satisfaction_ratings r WHERE r.agent_id = u.id AND r.created_at BETWEEN $1 AND $2) AS csat,
            (SELECT COUNT(*) FROM satisfaction_ratings r WHERE r.agent_id = u.id AND r.created_at BETWEEN $1 AND $2) AS csat_responses,
            (SELECT COALESCE(SUM(te.minutes),0) FROM time_entries te WHERE te.user_id = u.id AND te.started_at BETWEEN $1 AND $2) AS minutes_logged
       FROM users u
       LEFT JOIN tickets t ON t.responder_id = u.id AND t.deleted = FALSE AND t.spam = FALSE AND t.created_at BETWEEN $1 AND $2
      WHERE u.is_active = TRUE
      GROUP BY u.id ORDER BY resolved DESC, u.name`,
    [from, to]
  );
  res.json({ data: rows });
}));

router.get('/groups', asyncHandler(async (req, res) => {
  const { from, to } = range(req.query);
  const { rows } = await query(
    `SELECT g.id, g.name,
            COUNT(t.id) AS assigned,
            COUNT(t.id) FILTER (WHERE t.resolved_at IS NOT NULL) AS resolved,
            COUNT(t.id) FILTER (WHERE t.status IN ('open','pending')) AS open,
            COUNT(t.id) FILTER (WHERE t.status IN ('open','pending') AND t.due_by < NOW()) AS overdue,
            ROUND(AVG(EXTRACT(EPOCH FROM (t.first_responded_at - t.created_at))/3600)::numeric, 2) AS avg_first_response_hours,
            ROUND(AVG(EXTRACT(EPOCH FROM (t.resolved_at - t.created_at))/3600)::numeric, 2) AS avg_resolution_hours
       FROM groups g LEFT JOIN tickets t ON t.group_id = g.id AND t.deleted = FALSE AND t.spam = FALSE AND t.created_at BETWEEN $1 AND $2
      GROUP BY g.id ORDER BY g.name`, [from, to]
  );
  res.json({ data: rows });
}));

router.get('/companies', asyncHandler(async (req, res) => {
  const { from, to } = range(req.query);
  const { rows } = await query(
    `SELECT co.id, co.name, co.health_score, co.account_tier,
            COUNT(t.id) AS tickets,
            COUNT(t.id) FILTER (WHERE t.status IN ('open','pending')) AS open,
            COUNT(t.id) FILTER (WHERE t.priority IN ('high','urgent')) AS high_priority,
            ROUND(AVG(EXTRACT(EPOCH FROM (t.resolved_at - t.created_at))/3600)::numeric, 2) AS avg_resolution_hours,
            (SELECT ROUND(AVG(r.rating)::numeric,2) FROM satisfaction_ratings r JOIN tickets tt ON tt.id = r.ticket_id WHERE tt.company_id = co.id) AS csat
       FROM companies co LEFT JOIN tickets t ON t.company_id = co.id AND t.deleted = FALSE AND t.spam = FALSE AND t.created_at BETWEEN $1 AND $2
      GROUP BY co.id ORDER BY tickets DESC, co.name LIMIT 50`, [from, to]
  );
  res.json({ data: rows });
}));

router.get('/tags', asyncHandler(async (req, res) => {
  const { from, to } = range(req.query);
  const { rows } = await query(
    `SELECT tag AS label, COUNT(*) AS value FROM tickets t, unnest(t.tags) AS tag
      WHERE ${BASE_FILTER} GROUP BY tag ORDER BY value DESC LIMIT 20`, [from, to]
  );
  res.json({ data: rows });
}));

router.get('/satisfaction', asyncHandler(async (req, res) => {
  const { from, to } = range(req.query);
  const { rows: distribution } = await query(
    `SELECT r.rating AS label, COUNT(*) AS value FROM satisfaction_ratings r WHERE r.created_at BETWEEN $1 AND $2 GROUP BY r.rating ORDER BY r.rating`, [from, to]
  );
  const { rows: recent } = await query(
    `SELECT r.*, t.subject, c.name AS contact_name, u.name AS agent_name FROM satisfaction_ratings r
       JOIN tickets t ON t.id = r.ticket_id LEFT JOIN contacts c ON c.id = r.contact_id LEFT JOIN users u ON u.id = r.agent_id
      WHERE r.created_at BETWEEN $1 AND $2 ORDER BY r.created_at DESC LIMIT 30`, [from, to]
  );
  res.json({ data: { distribution, recent } });
}));

router.get('/time-tracking', asyncHandler(async (req, res) => {
  const { from, to } = range(req.query);
  const { rows } = await query(
    `SELECT u.id, u.name, COALESCE(SUM(te.minutes),0) AS minutes, COALESCE(SUM(te.minutes) FILTER (WHERE te.billable),0) AS billable_minutes, COUNT(DISTINCT te.ticket_id) AS tickets
       FROM users u LEFT JOIN time_entries te ON te.user_id = u.id AND te.started_at BETWEEN $1 AND $2
      WHERE u.is_active = TRUE GROUP BY u.id ORDER BY minutes DESC`, [from, to]
  );
  res.json({ data: rows });
}));

export default router;
