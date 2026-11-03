import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { query } from '../config/db.js';
import { HttpError } from '../utils/errors.js';

export const ALL_PRIVILEGES = ['reply_ticket', 'delete_ticket', 'merge_split_ticket', 'export_data', 'manage_contacts', 'manage_kb', 'moderate_forums', 'view_reports', 'manage_admin'];

// Agents without a custom role fall back to what their base role has always allowed.
export function privilegesFor(role, rolePrivileges) {
  if (rolePrivileges) return rolePrivileges;
  return role === 'admin' ? ALL_PRIVILEGES : ALL_PRIVILEGES.filter((p) => p !== 'manage_admin');
}

export function signToken(payload) {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn });
}

async function loadPrincipal(decoded) {
  if (decoded.kind === 'user') {
    const { rows } = await query(
      'SELECT u.id, u.name, u.email, u.role, u.avatar_url, u.is_active, r.privileges FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = $1',
      [decoded.sub]
    );
    const u = rows[0];
    if (!u || !u.is_active) return null;
    return { id: u.id, kind: 'user', role: u.role, name: u.name, email: u.email, avatar_url: u.avatar_url, privileges: privilegesFor(u.role, u.privileges) };
  }
  if (decoded.kind === 'contact') {
    const { rows } = await query(
      'SELECT id, name, email, company_id, is_blocked FROM contacts WHERE id = $1',
      [decoded.sub]
    );
    const c = rows[0];
    if (!c || c.is_blocked) return null;
    return { id: c.id, kind: 'contact', role: 'customer', name: c.name, email: c.email, company_id: c.company_id };
  }
  return null;
}

function extractToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  if (req.query && req.query.token) return String(req.query.token);
  return null;
}

export async function optionalAuth(req, _res, next) {
  try {
    const token = extractToken(req);
    if (!token) return next();
    const decoded = jwt.verify(token, env.jwtSecret);
    req.user = await loadPrincipal(decoded);
    next();
  } catch {
    next();
  }
}

export async function authenticate(req, _res, next) {
  try {
    const token = extractToken(req);
    if (!token) throw new HttpError(401, 'Authentication required');
    let decoded;
    try {
      decoded = jwt.verify(token, env.jwtSecret);
    } catch {
      throw new HttpError(401, 'Invalid or expired token');
    }
    const principal = await loadPrincipal(decoded);
    if (!principal) throw new HttpError(401, 'Account not found or disabled');
    req.user = principal;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAgent(req, _res, next) {
  if (!req.user || req.user.kind !== 'user') return next(new HttpError(403, 'Agent access required'));
  next();
}

export function requireAdmin(req, _res, next) {
  if (!req.user || req.user.role !== 'admin') return next(new HttpError(403, 'Admin access required'));
  next();
}

export const requirePrivilege = (privilege) => (req, _res, next) => {
  if (!req.user?.privileges?.includes(privilege)) return next(new HttpError(403, 'Your role does not allow this action'));
  next();
};

// Reads stay open to every agent; writes need the privilege.
export const requirePrivilegeToWrite = (privilege) => (req, res, next) => (req.method === 'GET' ? next() : requirePrivilege(privilege)(req, res, next));

export const isAgent = (user) => user && user.kind === 'user';
export const isAdmin = (user) => user && user.role === 'admin';
export const isCustomer = (user) => user && user.kind === 'contact';
