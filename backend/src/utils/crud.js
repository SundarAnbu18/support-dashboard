import { Router } from 'express';
import { query } from '../config/db.js';
import { requireAdmin } from '../middleware/auth.js';
import { asyncHandler, notFound, badRequest } from './errors.js';
import { buildUpdate, requireFields } from './helpers.js';

// Small list/create/update/delete router for admin-managed config tables.
// `fields` is the column allow-list; `json` columns are serialised before writing.
export function crudRouter({ table, fields, json = [], required = [], orderBy = 'id', idColumn = 'id', label = 'Record', beforeSave, afterChange, canDelete }) {
  const router = Router();
  const encode = async (req) => {
    const b = { ...req.body };
    if (beforeSave) await beforeSave(b, req);
    for (const k of json) if (b[k] !== undefined) b[k] = JSON.stringify(b[k]);
    for (const k of fields) if (b[k] === '') b[k] = null;
    return b;
  };
  router.get('/', asyncHandler(async (_req, res) => {
    const { rows } = await query(`SELECT * FROM ${table} ORDER BY ${orderBy}`);
    res.json({ data: rows });
  }));
  router.post('/', requireAdmin, asyncHandler(async (req, res) => {
    requireFields(req.body, required);
    const b = await encode(req);
    const cols = [...fields, ...(idColumn !== 'id' ? [idColumn] : [])].filter((k) => b[k] !== undefined);
    const { rows } = await query(
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
      cols.map((k) => b[k])
    );
    if (afterChange) await afterChange(rows[0]);
    res.status(201).json({ data: rows[0] });
  }));
  router.put('/:id', requireAdmin, asyncHandler(async (req, res) => {
    const b = await encode(req);
    const { sets, values } = buildUpdate(b, fields);
    if (!sets.length) throw badRequest('Nothing to update');
    values.push(req.params.id);
    const { rows } = await query(`UPDATE ${table} SET ${sets.join(', ')} WHERE ${idColumn} = $${values.length} RETURNING *`, values);
    if (!rows[0]) throw notFound(label);
    if (afterChange) await afterChange(rows[0]);
    res.json({ data: rows[0] });
  }));
  router.delete('/:id', requireAdmin, asyncHandler(async (req, res) => {
    if (canDelete) await canDelete(req.params.id);
    const { rowCount } = await query(`DELETE FROM ${table} WHERE ${idColumn} = $1`, [req.params.id]);
    if (!rowCount) throw notFound(label);
    if (afterChange) await afterChange(null);
    res.json({ ok: true });
  }));
  return router;
}
