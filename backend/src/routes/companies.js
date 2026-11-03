import { Router } from 'express';
import { query } from '../config/db.js';
import { authenticate, requireAgent, requirePrivilege, requirePrivilegeToWrite } from '../middleware/auth.js';
import { asyncHandler, notFound, badRequest } from '../utils/errors.js';
import { parseCsv, sendCsv } from '../utils/csv.js';
import { requireFields, buildUpdate, pagination, toArray } from '../utils/helpers.js';

const router = Router();
router.use(authenticate, requireAgent, requirePrivilegeToWrite('manage_contacts'));

const BASE = `
  SELECT co.*,
         (SELECT COUNT(*) FROM contacts c WHERE c.company_id = co.id) AS contact_count,
         (SELECT COUNT(*) FROM tickets t WHERE t.company_id = co.id AND t.deleted = FALSE) AS ticket_count,
         (SELECT COUNT(*) FROM tickets t WHERE t.company_id = co.id AND t.deleted = FALSE AND t.status NOT IN ('resolved','closed')) AS open_ticket_count
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

router.get('/export', requirePrivilege('export_data'), asyncHandler(async (_req, res) => {
  const { rows } = await query(`${BASE} ORDER BY co.name`);
  sendCsv(res, 'companies.csv', rows, ['name', 'domains', 'industry', 'account_tier', 'health_score', 'renewal_date', 'description', 'contact_count', 'ticket_count', 'created_at']);
}));

router.post('/import', asyncHandler(async (req, res) => {
  const records = parseCsv(req.body.csv || '');
  if (!records.length) throw badRequest('The CSV file has no data rows');
  const result = { created: 0, updated: 0, errors: [] };
  for (const [i, r] of records.entries()) {
    if (!r.name) { result.errors.push(`Row ${i + 2}: name is required`); continue; }
    const domains = r.domains ? r.domains.split(/[;|]/).map((d) => d.trim().toLowerCase()).filter(Boolean) : [];
    const { rows } = await query(
      `INSERT INTO companies (name, domains, industry, description) VALUES ($1,$2,$3,$4)
       ON CONFLICT (name) DO UPDATE SET domains = EXCLUDED.domains, industry = COALESCE(EXCLUDED.industry, companies.industry), description = COALESCE(EXCLUDED.description, companies.description)
       RETURNING (xmax = 0) AS inserted`,
      [r.name, domains, r.industry || null, r.description || null]
    );
    if (rows[0].inserted) result.created++; else result.updated++;
  }
  res.json({ data: result });
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
  if (b.custom_fields !== undefined) b.custom_fields = JSON.stringify(b.custom_fields);
  const { sets, values } = buildUpdate(b, ['name', 'domains', 'description', 'notes', 'industry', 'account_tier', 'health_score', 'renewal_date', 'custom_fields']);
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
