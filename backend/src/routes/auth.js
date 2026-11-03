import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../config/db.js';
import { signToken, authenticate, privilegesFor } from '../middleware/auth.js';
import { asyncHandler, HttpError, badRequest } from '../utils/errors.js';
import { requireFields } from '../utils/helpers.js';

const router = Router();

async function loadSecurity() {
  const { rows } = await query("SELECT key, value FROM settings WHERE key IN ('security','helpdesk')");
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { min_password_length: 8, signup_domains: [], ...byKey.security, portal_signup_enabled: byKey.helpdesk?.portal_signup_enabled !== false };
}

export async function checkPassword(password) {
  const { min_password_length: min } = await loadSecurity();
  if (String(password).length < Number(min)) throw badRequest(`Password must be at least ${min} characters`);
}

async function privilegesOf(u) {
  if (!u.role_id) return privilegesFor(u.role);
  const { rows } = await query('SELECT privileges FROM roles WHERE id = $1', [u.role_id]);
  return privilegesFor(u.role, rows[0]?.privileges);
}

function publicUser(u) {
  return { role_id: u.role_id, agent_status_id: u.agent_status_id, id: u.id, kind: 'user', name: u.name, email: u.email, role: u.role, avatar_url: u.avatar_url, job_title: u.job_title, phone: u.phone, time_zone: u.time_zone, signature: u.signature };
}
function publicContact(c) {
  return { id: c.id, kind: 'contact', name: c.name, email: c.email, role: 'customer', company_id: c.company_id, phone: c.phone, avatar_url: c.avatar_url };
}

// Agents and customers share one login endpoint. Agents are checked first.
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  requireFields(req.body, ['email', 'password']);
  const lower = String(email).toLowerCase();

  const { rows: users } = await query('SELECT * FROM users WHERE LOWER(email) = $1', [lower]);
  if (users[0]) {
    const u = users[0];
    if (!u.is_active) throw new HttpError(403, 'This agent account has been deactivated');
    if (!(await bcrypt.compare(password, u.password_hash))) throw new HttpError(401, 'Invalid email or password');
    await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [u.id]);
    return res.json({ token: signToken({ sub: u.id, kind: 'user', role: u.role }), user: { ...publicUser(u), privileges: await privilegesOf(u) } });
  }

  const { rows: contacts } = await query('SELECT * FROM contacts WHERE LOWER(email) = $1', [lower]);
  const c = contacts[0];
  if (!c || !c.password_hash) throw new HttpError(401, 'Invalid email or password');
  if (c.is_blocked) throw new HttpError(403, 'This account is blocked');
  if (!(await bcrypt.compare(password, c.password_hash))) throw new HttpError(401, 'Invalid email or password');
  res.json({ token: signToken({ sub: c.id, kind: 'contact', role: 'customer' }), user: publicContact(c) });
}));

// Customer self-signup for the portal.
router.post('/register', asyncHandler(async (req, res) => {
  const { name, email, password, phone } = req.body;
  requireFields(req.body, ['name', 'email', 'password']);
  const security = await loadSecurity();
  if (!security.portal_signup_enabled) throw new HttpError(403, 'Portal sign-up is disabled');
  await checkPassword(password);
  const lower = String(email).toLowerCase();
  if (security.signup_domains?.length && !security.signup_domains.includes(lower.split('@')[1])) throw new HttpError(403, 'Sign-up is restricted to approved email domains');
  const { rows: existingUsers } = await query('SELECT id FROM users WHERE LOWER(email) = $1', [lower]);
  if (existingUsers.length) throw new HttpError(409, 'Email already in use');
  const hash = await bcrypt.hash(password, 10);

  // Auto-link to a company by email domain.
  const domain = lower.split('@')[1];
  const { rows: companies } = await query('SELECT id FROM companies WHERE $1 = ANY(domains) LIMIT 1', [domain]);
  const companyId = companies[0]?.id || null;

  const { rows: existing } = await query('SELECT * FROM contacts WHERE LOWER(email) = $1', [lower]);
  let contact;
  if (existing[0]) {
    if (existing[0].password_hash) throw new HttpError(409, 'An account with this email already exists. Please log in.');
    const { rows } = await query(
      'UPDATE contacts SET password_hash = $1, name = COALESCE($2, name), phone = COALESCE($3, phone), is_verified = TRUE WHERE id = $4 RETURNING *',
      [hash, name, phone || null, existing[0].id]
    );
    contact = rows[0];
  } else {
    const { rows } = await query(
      'INSERT INTO contacts (name, email, phone, password_hash, company_id, is_verified) VALUES ($1, $2, $3, $4, $5, TRUE) RETURNING *',
      [name, lower, phone || null, hash, companyId]
    );
    contact = rows[0];
  }
  res.status(201).json({ token: signToken({ sub: contact.id, kind: 'contact', role: 'customer' }), user: publicContact(contact) });
}));

router.get('/me', authenticate, asyncHandler(async (req, res) => {
  if (req.user.kind === 'user') {
    const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    const { rows: groups } = await query(
      'SELECT g.id, g.name FROM groups g JOIN group_members gm ON gm.group_id = g.id WHERE gm.user_id = $1', [req.user.id]
    );
    return res.json({ user: { ...publicUser(rows[0]), groups, privileges: await privilegesOf(rows[0]) } });
  }
  const { rows } = await query('SELECT * FROM contacts WHERE id = $1', [req.user.id]);
  res.json({ user: publicContact(rows[0]) });
}));

router.put('/me', authenticate, asyncHandler(async (req, res) => {
  const { name, phone, job_title, time_zone, signature, avatar_url } = req.body;
  if (req.user.kind === 'user') {
    if (req.body.agent_status_id !== undefined) await query('UPDATE users SET agent_status_id = $1 WHERE id = $2', [req.body.agent_status_id || null, req.user.id]);
    const { rows } = await query(
      `UPDATE users SET name = COALESCE($1, name), phone = COALESCE($2, phone), job_title = COALESCE($3, job_title),
              time_zone = COALESCE($4, time_zone), signature = COALESCE($5, signature), avatar_url = COALESCE($6, avatar_url)
        WHERE id = $7 RETURNING *`,
      [name, phone, job_title, time_zone, signature, avatar_url, req.user.id]
    );
    return res.json({ user: publicUser(rows[0]) });
  }
  const { rows } = await query(
    'UPDATE contacts SET name = COALESCE($1, name), phone = COALESCE($2, phone), avatar_url = COALESCE($3, avatar_url) WHERE id = $4 RETURNING *',
    [name, phone, avatar_url, req.user.id]
  );
  res.json({ user: publicContact(rows[0]) });
}));

router.post('/change-password', authenticate, asyncHandler(async (req, res) => {
  const { current_password, new_password } = req.body;
  requireFields(req.body, ['current_password', 'new_password']);
  await checkPassword(new_password);
  const table = req.user.kind === 'user' ? 'users' : 'contacts';
  const { rows } = await query(`SELECT password_hash FROM ${table} WHERE id = $1`, [req.user.id]);
  if (!(await bcrypt.compare(current_password, rows[0].password_hash))) throw new HttpError(400, 'Current password is incorrect');
  const hash = await bcrypt.hash(new_password, 10);
  await query(`UPDATE ${table} SET password_hash = $1 WHERE id = $2`, [hash, req.user.id]);
  res.json({ ok: true });
}));

export default router;
