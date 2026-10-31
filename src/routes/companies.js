import { Router } from 'express';
import { query } from '../config/db.js';
import { authenticate, requireAgent } from '../middleware/auth.js';
import { asyncHandler, notFound } from '../utils/errors.js';
import { requireFields, buildUpdate, pagination, toArray } from '../utils/helpers.js';

const router = Router();
router.use(authenticate, requireAgent);

const BASE = `
  SELECT co.*,
         (SELECT COUNT(*) FROM contacts c WHERE c.company_id = co.id) AS contact_count,
         (SELECT COUNT(*) FROM tickets t WHERE t.company_id = co.id AND t.deleted = FALSE) AS ticket_count,
         (SELECT COUNT(*) FROM tickets t WHERE t.company_id = co.id AND t.deleted = FALSE AND t.status IN ('open','pending')) AS open_ticket_count
    FROM companies co`;

router.get('/', asyncHandler(async (req, res) => {
  const { q, health_score, sort = 'name', order = 'asc' } = req.query;
  const { page, perPage, offset } = pagination(req.query);
  const where = [];
  const params = [];
  if (q) { params.push(`%${q}%`); where.push(`(co.name ILIKE $${params.length} OR array_to_string(co.domains, ',') ILIKE $${params.length})`); }
  if (health_score) { params.push(health_score); where.push(`co.health_score = $${params.length}`); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const sortCol = { name: 'co.name', created_at: 'co.created_at' }[sort] || 'co.name';
  const { rows: count } = await query(`SELECT COUNT(*) FROM companies co ${whereSql}`, params);
  const { rows } = await query(`${BASE} ${whereSql} ORDER BY ${sortCol} ${order === 'desc' ? 'DESC' : 'ASC'} LIMIT ${perPage} OFFSET ${offset}`, params);
  res.json({ data: rows, meta: { total: Number(count[0].count), page, per_page: perPage } });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const { rows } = await query(`${BASE} WHERE co.id = $1`, [req.params.id]);
  if (!rows[0]) throw notFound('Company');
  const { rows: contacts } = await query('SELECT id, name, email, phone, job_title FROM contacts WHERE company_id = $1 ORDER BY name', [req.params.id]);
  const { rows: tickets } = await query(
    `SELECT t.id, t.subject, t.status, t.priority, t.created_at, c.name AS requester_name, u.name AS responder_name
       FROM tickets t JOIN contacts c ON c.id = t.requester_id LEFT JOIN users u ON u.id = t.responder_id
      WHERE t.company_id = $1 AND t.deleted = FALSE ORDER BY t.created_at DESC LIMIT 50`,
    [req.params.id]
  );
  res.json({ data: { ...rows[0], contacts, tickets } });
}));

router.post('/', asyncHandler(async (req, res) => {
  const b = req.body;
  requireFields(b, ['name']);
  const { rows } = await query(
    `INSERT INTO companies (name, domains, description, notes, industry, account_tier, health_score, renewal_date)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6,'standard'), COALESCE($7,'neutral'), $8) RETURNING id`,
    [b.name, toArray(b.domains).map((d) => d.toLowerCase()), b.description || null, b.notes || null, b.industry || null, b.account_tier || null, b.health_score || null, b.renewal_date || null]
  );
  const { rows: out } = await query(`${BASE} WHERE co.id = $1`, [rows[0].id]);
  res.status(201).json({ data: out[0] });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const b = { ...req.body };
  if (b.domains !== undefined) b.domains = toArray(b.domains).map((d) => d.toLowerCase());
  if (b.renewal_date === '') b.renewal_date = null;
  const { sets, values } = buildUpdate(b, ['name', 'domains', 'description', 'notes', 'industry', 'account_tier', 'health_score', 'renewal_date']);
  if (sets.length) {
    values.push(req.params.id);
    const { rowCount } = await query(`UPDATE companies SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
    if (!rowCount) throw notFound('Company');
  }
  const { rows } = await query(`${BASE} WHERE co.id = $1`, [req.params.id]);
  if (!rows[0]) throw notFound('Company');
  res.json({ data: rows[0] });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const { rowCount } = await query('DELETE FROM companies WHERE id = $1', [req.params.id]);
  if (!rowCount) throw notFound('Company');
  res.json({ ok: true });
}));

export default router;
