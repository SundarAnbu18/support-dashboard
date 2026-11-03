import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../config/db.js';
import { authenticate, requireAgent, requirePrivilege, requirePrivilegeToWrite } from '../middleware/auth.js';
import { asyncHandler, notFound, badRequest } from '../utils/errors.js';
import { requireFields, buildUpdate, pagination, toArray, toInt } from '../utils/helpers.js';
import { parseCsv, sendCsv } from '../utils/csv.js';

const router = Router();
router.use(authenticate, requireAgent, requirePrivilegeToWrite('manage_contacts'));

const BASE = `
  SELECT c.id, c.name, c.email, c.phone, c.mobile, c.company_id, c.job_title, c.address, c.time_zone, c.language,
         c.tags, c.description, c.is_verified, c.is_blocked, c.avatar_url, c.custom_fields, c.created_at, c.updated_at,
         (c.password_hash IS NOT NULL) AS has_portal_access,
         co.name AS company_name,
         (SELECT COUNT(*) FROM tickets t WHERE t.requester_id = c.id AND t.deleted = FALSE) AS ticket_count,
         (SELECT COUNT(*) FROM tickets t WHERE t.requester_id = c.id AND t.deleted = FALSE AND t.status NOT IN ('resolved','closed')) AS open_ticket_count
    FROM contacts c LEFT JOIN companies co ON co.id = c.company_id`;

router.get('/', asyncHandler(async (req, res) => {
  const { q, company_id, tag, blocked, sort = 'name', order = 'asc' } = req.query;
  const { page, perPage, offset } = pagination(req.query);
  const where = [];
  const params = [];
  if (q) { params.push(`%${q}%`); where.push(`(c.name ILIKE $${params.length} OR c.email ILIKE $${params.length} OR c.phone ILIKE $${params.length} OR co.name ILIKE $${params.length})`); }
  if (company_id) { params.push(toInt(company_id)); where.push(`c.company_id = $${params.length}`); }
  if (tag) { params.push(tag); where.push(`$${params.length} = ANY(c.tags)`); }
  if (blocked !== undefined) { params.push(blocked === 'true'); where.push(`c.is_blocked = $${params.length}`); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const sortCol = { name: 'c.name', created_at: 'c.created_at', email: 'c.email', company: 'co.name' }[sort] || 'c.name';
  const dir = order === 'desc' ? 'DESC' : 'ASC';
  const { rows: count } = await query(`SELECT COUNT(*) FROM contacts c LEFT JOIN companies co ON co.id = c.company_id ${whereSql}`, params);
  const { rows } = await query(`${BASE} ${whereSql} ORDER BY ${sortCol} ${dir} LIMIT ${perPage} OFFSET ${offset}`, params);
  res.json({ data: rows, meta: { total: Number(count[0].count), page, per_page: perPage } });
}));

router.get('/export', requirePrivilege('export_data'), asyncHandler(async (_req, res) => {
  const { rows } = await query(`${BASE} ORDER BY c.name`);
  sendCsv(res, 'contacts.csv', rows, ['name', 'email', 'phone', 'mobile', 'company_name', 'job_title', 'address', 'time_zone', 'language', 'tags', 'description', 'created_at']);
}));

// CSV import: updates contacts matched by email, creates the rest, reports bad rows.
router.post('/import', asyncHandler(async (req, res) => {
  const records = parseCsv(req.body.csv || '');
  if (!records.length) throw badRequest('The CSV file has no data rows');
  const result = { created: 0, updated: 0, errors: [] };
  for (const [i, r] of records.entries()) {
    const email = r.email ? r.email.toLowerCase() : null;
    if (!r.name || (!email && !r.phone)) { result.errors.push(`Row ${i + 2}: name and an email or phone are required`); continue; }
    let companyId = null;
    if (r.company || r.company_name) {
      const { rows } = await query('SELECT id FROM companies WHERE LOWER(name) = LOWER($1)', [r.company || r.company_name]);
      companyId = rows[0]?.id || null;
    }
    const tags = r.tags ? r.tags.split(/[;|]/).map((t) => t.trim()).filter(Boolean) : [];
    const { rows: found } = email ? await query('SELECT id FROM contacts WHERE LOWER(email) = $1', [email]) : { rows: [] };
    const values = [r.name, r.phone || null, r.mobile || null, companyId, r.job_title || null, r.address || null, tags];
    if (found[0]) {
      await query('UPDATE contacts SET name=$1, phone=COALESCE($2,phone), mobile=COALESCE($3,mobile), company_id=COALESCE($4,company_id), job_title=COALESCE($5,job_title), address=COALESCE($6,address), tags=$7 WHERE id=$8', [...values, found[0].id]);
      result.updated++;
    } else {
      await query('INSERT INTO contacts (name, phone, mobile, company_id, job_title, address, tags, email) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [...values, email]);
      result.created++;
    }
  }
  res.json({ data: result });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const { rows } = await query(`${BASE} WHERE c.id = $1`, [req.params.id]);
  if (!rows[0]) throw notFound('Contact');
  const { rows: tickets } = await query(
    `SELECT t.id, t.subject, t.status, t.priority, t.created_at, t.updated_at, u.name AS responder_name
       FROM tickets t LEFT JOIN users u ON u.id = t.responder_id
      WHERE t.requester_id = $1 AND t.deleted = FALSE ORDER BY t.created_at DESC LIMIT 50`,
    [req.params.id]
  );
  res.json({ data: { ...rows[0], tickets } });
}));

router.post('/', asyncHandler(async (req, res) => {
  const b = req.body;
  requireFields(b, ['name']);
  if (!b.email && !b.phone) throw badRequest('Provide at least an email or phone number');
  const email = b.email ? String(b.email).toLowerCase() : null;
  let companyId = toInt(b.company_id);
  if (!companyId && email) {
    const { rows } = await query('SELECT id FROM companies WHERE $1 = ANY(domains) LIMIT 1', [email.split('@')[1]]);
    companyId = rows[0]?.id || null;
  }
  const hash = b.password ? await bcrypt.hash(b.password, 10) : null;
  const { rows } = await query(
    `INSERT INTO contacts (name, email, phone, mobile, company_id, job_title, address, time_zone, language, tags, description, password_hash, is_verified)
     VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'UTC'),COALESCE($9,'en'),$10,$11,$12,$13) RETURNING id`,
    [b.name, email, b.phone || null, b.mobile || null, companyId, b.job_title || null, b.address || null, b.time_zone || null, b.language || null, toArray(b.tags), b.description || null, hash, !!hash]
  );
  const { rows: out } = await query(`${BASE} WHERE c.id = $1`, [rows[0].id]);
  res.status(201).json({ data: out[0] });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const b = { ...req.body };
  if (b.email) b.email = String(b.email).toLowerCase();
  if (b.tags !== undefined) b.tags = toArray(b.tags);
  if (b.company_id !== undefined) b.company_id = toInt(b.company_id);
  if (b.custom_fields !== undefined) b.custom_fields = JSON.stringify(b.custom_fields);
  const { sets, values } = buildUpdate(b, ['name', 'email', 'phone', 'mobile', 'company_id', 'job_title', 'address', 'time_zone', 'language', 'tags', 'description', 'is_blocked', 'avatar_url', 'custom_fields']);
  if (b.password) {
    sets.push(`password_hash = $${values.length + 1}`);
    values.push(await bcrypt.hash(b.password, 10));
    sets.push('is_verified = TRUE');
  }
  if (sets.length) {
    values.push(req.params.id);
    const { rowCount } = await query(`UPDATE contacts SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
    if (!rowCount) throw notFound('Contact');
  }
  const { rows } = await query(`${BASE} WHERE c.id = $1`, [req.params.id]);
  if (!rows[0]) throw notFound('Contact');
  res.json({ data: rows[0] });
}));

// Merge secondary contacts into a primary one (moves tickets, deletes duplicates).
router.post('/:id/merge', asyncHandler(async (req, res) => {
  const ids = toArray(req.body.contact_ids).map(Number).filter((n) => n && n !== Number(req.params.id));
  if (!ids.length) throw badRequest('contact_ids required');
  await query('UPDATE tickets SET requester_id = $1 WHERE requester_id = ANY($2::int[])', [req.params.id, ids]);
  await query('UPDATE conversations SET contact_id = $1 WHERE contact_id = ANY($2::int[])', [req.params.id, ids]);
  await query('DELETE FROM contacts WHERE id = ANY($1::int[])', [ids]);
  const { rows } = await query(`${BASE} WHERE c.id = $1`, [req.params.id]);
  res.json({ data: rows[0] });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const { rowCount } = await query('DELETE FROM contacts WHERE id = $1', [req.params.id]);
  if (!rowCount) throw notFound('Contact');
  res.json({ ok: true });
}));

export default router;
