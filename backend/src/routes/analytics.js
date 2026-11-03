import { Router } from 'express';
import { query } from '../config/db.js';
import { authenticate, requireAgent, requirePrivilege } from '../middleware/auth.js';
import { asyncHandler, badRequest, notFound } from '../utils/errors.js';
import { requireFields, toArray, buildUpdate } from '../utils/helpers.js';
import { toCsv, sendCsv } from '../utils/csv.js';
import { sendEmail } from '../utils/email.js';

const router = Router();

// Allow-lists: report configs are user input, so only these fragments ever reach SQL.
const METRICS = {
  tickets_created: { label: 'Tickets created', sql: 'COUNT(*)' },
  tickets_resolved: { label: 'Tickets resolved', sql: 'COUNT(*) FILTER (WHERE t.resolved_at IS NOT NULL)' },
  tickets_unresolved: { label: 'Unresolved tickets', sql: "COUNT(*) FILTER (WHERE t.status NOT IN ('resolved','closed'))" },
  avg_first_response_hours: { label: 'Avg first response (hours)', sql: 'ROUND((AVG(EXTRACT(EPOCH FROM (t.first_responded_at - t.created_at))) / 3600)::numeric, 2)' },
  avg_resolution_hours: { label: 'Avg resolution (hours)', sql: 'ROUND((AVG(EXTRACT(EPOCH FROM (t.resolved_at - t.created_at))) / 3600)::numeric, 2)' },
  sla_compliance_pct: { label: 'Resolved within SLA (%)', sql: 'ROUND(100.0 * COUNT(*) FILTER (WHERE t.resolved_at <= t.due_by) / NULLIF(COUNT(*) FILTER (WHERE t.resolved_at IS NOT NULL), 0), 1)' },
  avg_csat: { label: 'Average CSAT (1-5)', sql: 'ROUND(AVG((SELECT r.rating FROM satisfaction_ratings r WHERE r.ticket_id = t.id))::numeric, 2)' },
  time_spent_hours: { label: 'Time logged (hours)', sql: 'ROUND((SUM((SELECT COALESCE(SUM(te.minutes), 0) FROM time_entries te WHERE te.ticket_id = t.id)) / 60.0)::numeric, 1)' },
};
const DIMENSIONS = {
  status: { label: 'Status', sql: 't.status' },
  priority: { label: 'Priority', sql: 't.priority' },
  type: { label: 'Type', sql: "COALESCE(t.type, 'none')" },
  source: { label: 'Source', sql: 't.source' },
  group: { label: 'Group', sql: "COALESCE(g.name, 'No group')" },
  agent: { label: 'Agent', sql: "COALESCE(u.name, 'Unassigned')" },
  company: { label: 'Company', sql: "COALESCE(co.name, 'No company')" },
  product: { label: 'Product', sql: "COALESCE(p.name, 'No product')" },
  day: { label: 'Day', sql: "TO_CHAR(t.created_at, 'YYYY-MM-DD')" },
  week: { label: 'Week', sql: `TO_CHAR(DATE_TRUNC('week', t.created_at), 'YYYY-MM-DD')` },
  month: { label: 'Month', sql: "TO_CHAR(t.created_at, 'YYYY-MM')" },
  hour: { label: 'Hour of day', sql: "TO_CHAR(t.created_at, 'HH24')" },
};
const TIME_DIMENSIONS = ['day', 'week', 'month', 'hour'];

export async function runReport(config = {}) {
  const metrics = toArray(config.metrics).filter((m) => METRICS[m]);
  const dimension = DIMENSIONS[config.dimension];
  if (!metrics.length || !dimension) throw badRequest('Choose at least one metric and one dimension');
  const params = [];
  const where = ['t.deleted = FALSE', 't.spam = FALSE'];
  if (config.from) { params.push(config.from); where.push(`t.created_at >= $${params.length}`); }
  if (config.to) { params.push(config.to); where.push(`t.created_at < $${params.length}::date + INTERVAL '1 day'`); }
  if (config.days && !config.from) { params.push(String(Number(config.days))); where.push(`t.created_at >= NOW() - ($${params.length} || ' days')::interval`); }
  for (const [key, col, cast] of [['status', 't.status', 'text'], ['priority', 't.priority', 'text'], ['group_id', 't.group_id', 'int'], ['responder_id', 't.responder_id', 'int'], ['product_id', 't.product_id', 'int']]) {
    const v = toArray(config[key]);
    if (v.length) { params.push(cast === 'int' ? v.map(Number) : v); where.push(`${col} = ANY($${params.length}::${cast}[])`); }
  }
  const order = TIME_DIMENSIONS.includes(config.dimension) ? 'label ASC' : `"${metrics[0]}" DESC NULLS LAST`;
  const { rows } = await query(
    `SELECT ${dimension.sql} AS label, ${metrics.map((m) => `${METRICS[m].sql} AS "${m}"`).join(', ')}
       FROM tickets t
       LEFT JOIN users u ON u.id = t.responder_id LEFT JOIN groups g ON g.id = t.group_id
       LEFT JOIN companies co ON co.id = t.company_id LEFT JOIN products p ON p.id = t.product_id
      WHERE ${where.join(' AND ')} GROUP BY 1 ORDER BY ${order} LIMIT 200`, params
  );
  return { rows, metrics, columns: ['label', ...metrics] };
}

// Emails each due report as CSV. Called hourly by the job runner.
export async function sendScheduledReports() {
  const { rows: due } = await query(
    `SELECT * FROM saved_reports WHERE schedule IS NOT NULL AND array_length(recipients, 1) > 0
       AND (last_sent_at IS NULL OR (schedule = 'daily' AND last_sent_at < NOW() - INTERVAL '1 day') OR (schedule = 'weekly' AND last_sent_at < NOW() - INTERVAL '7 days'))`
  );
  for (const r of due) {
    const { rows, columns } = await runReport(r.config);
    for (const to of r.recipients) await sendEmail({ to, subject: `Scheduled report: ${r.name}`, body: toCsv(rows, columns) });
    await query('UPDATE saved_reports SET last_sent_at = NOW() WHERE id = $1', [r.id]);
  }
  return due.length;
}

router.use(authenticate, requireAgent);

// ---------------- gamification, derived from ticket history so it cannot drift
router.get('/arcade', asyncHandler(async (req, res) => {
  const { rows: s } = await query("SELECT value FROM settings WHERE key = 'arcade'");
  const cfg = { enabled: true, resolve_points: 10, sla_bonus: 5, fast_reply_bonus: 5, csat_bonus: 15, ...(s[0]?.value || {}) };
  const days = { week: 7, month: 30, quarter: 90 }[req.query.period] || 30;
  const { rows } = await query(
    `SELECT u.id, u.name, u.avatar_url,
            COUNT(t.id) AS resolved,
            COUNT(t.id) FILTER (WHERE t.resolved_at <= t.due_by) AS within_sla,
            COUNT(t.id) FILTER (WHERE t.first_responded_at <= t.fr_due_by) AS fast_replies,
            COUNT(r.id) FILTER (WHERE r.rating >= 4) AS happy_customers
       FROM users u
       LEFT JOIN tickets t ON t.responder_id = u.id AND t.resolved_at >= NOW() - ($1 || ' days')::interval AND t.deleted = FALSE AND t.spam = FALSE
       LEFT JOIN satisfaction_ratings r ON r.ticket_id = t.id
      WHERE u.is_active = TRUE GROUP BY u.id`, [String(days)]
  );
  const LEVELS = [[0, 'Beginner'], [100, 'Intermediate'], [500, 'Professional'], [1500, 'Expert'], [5000, 'Master'], [15000, 'Guru']];
  const board = rows.map((a) => {
    const points = a.resolved * cfg.resolve_points + a.within_sla * cfg.sla_bonus + a.fast_replies * cfg.fast_reply_bonus + a.happy_customers * cfg.csat_bonus;
    return { ...a, points, level: LEVELS.filter(([min]) => points >= min).pop()[1] };
  }).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  res.json({ data: board, settings: cfg });
}));

router.use(requirePrivilege('view_reports'));

router.get('/report-meta', (_req, res) => {
  const list = (o) => Object.entries(o).map(([key, v]) => ({ key, label: v.label }));
  res.json({ data: { metrics: list(METRICS), dimensions: list(DIMENSIONS) } });
});
router.post('/run', asyncHandler(async (req, res) => {
  const { rows, metrics } = await runReport(req.body);
  res.json({ data: rows, metrics });
}));
router.post('/run.csv', requirePrivilege('export_data'), asyncHandler(async (req, res) => {
  const { rows, columns } = await runReport(req.body);
  sendCsv(res, 'report.csv', rows, columns);
}));

// ---------------- saved reports
const ownerClause = 'id = $1 AND (user_id = $2 OR $3 = \'admin\')';
router.get('/reports', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT r.*, u.name AS owner_name FROM saved_reports r LEFT JOIN users u ON u.id = r.user_id
      WHERE r.user_id = $1 OR r.is_shared = TRUE ORDER BY r.is_favorite DESC, r.name`, [req.user.id]
  );
  res.json({ data: rows });
}));
router.post('/reports', asyncHandler(async (req, res) => {
  const b = req.body;
  requireFields(b, ['name']);
  await runReport(b.config);
  const { rows } = await query(
    'INSERT INTO saved_reports (user_id, name, folder, config, is_shared, schedule, recipients) VALUES ($1,$2,$3,$4,COALESCE($5,FALSE),$6,$7) RETURNING *',
    [req.user.id, b.name, b.folder || null, JSON.stringify(b.config), b.is_shared, b.schedule || null, toArray(b.recipients)]
  );
  res.status(201).json({ data: rows[0] });
}));
router.put('/reports/:id', asyncHandler(async (req, res) => {
  const b = { ...req.body };
  if (b.config !== undefined) { await runReport(b.config); b.config = JSON.stringify(b.config); }
  if (b.recipients !== undefined) b.recipients = toArray(b.recipients);
  if (b.schedule === '') b.schedule = null;
  const { sets, values } = buildUpdate(b, ['name', 'folder', 'config', 'is_shared', 'is_favorite', 'schedule', 'recipients'], 4);
  if (!sets.length) throw badRequest('Nothing to update');
  const { rows } = await query(`UPDATE saved_reports SET ${sets.join(', ')} WHERE ${ownerClause} RETURNING *`, [req.params.id, req.user.id, req.user.role, ...values]);
  if (!rows[0]) throw notFound('Report');
  res.json({ data: rows[0] });
}));
router.delete('/reports/:id', asyncHandler(async (req, res) => {
  const { rowCount } = await query(`DELETE FROM saved_reports WHERE ${ownerClause}`, [req.params.id, req.user.id, req.user.role]);
  if (!rowCount) throw notFound('Report');
  res.json({ ok: true });
}));

export default router;
