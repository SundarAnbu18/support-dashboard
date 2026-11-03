import { Router } from 'express';
import crypto from 'node:crypto';
import { query } from '../config/db.js';
import { asyncHandler, HttpError, badRequest } from '../utils/errors.js';
import { requireFields } from '../utils/helpers.js';
import { applySla } from '../utils/sla.js';
import { logActivity } from '../utils/activity.js';
import { runAutomations } from '../utils/automations.js';
import { sendTicketEmail } from '../utils/email.js';
import { notifyUser, notifyGroup } from '../utils/notifications.js';

const router = Router();
const SOURCE_BY_CHANNEL = { email: 'email', whatsapp: 'social', facebook: 'social', social: 'social', phone: 'phone', chat: 'chat' };

async function findOrCreateContact({ email, name, phone }) {
  const lower = email ? String(email).toLowerCase() : null;
  const { rows } = lower
    ? await query('SELECT * FROM contacts WHERE LOWER(email) = $1', [lower])
    : await query('SELECT * FROM contacts WHERE phone = $1 OR mobile = $1', [phone]);
  if (rows[0]) return rows[0];
  const { rows: company } = lower ? await query('SELECT id FROM companies WHERE $1 = ANY(domains) LIMIT 1', [lower.split('@')[1]]) : { rows: [] };
  const { rows: created } = await query(
    'INSERT INTO contacts (name, email, phone, company_id) VALUES ($1,$2,$3,$4) RETURNING *',
    [name || (lower ? lower.split('@')[0] : phone), lower, phone || null, company[0]?.id || null]
  );
  return created[0];
}

async function createTicket({ contact, subject, description, source, group_id = null, product_id = null }) {
  const sla = await applySla({ priority: 'low', type: null, source, group_id, company_id: contact.company_id, created_at: new Date() });
  const { rows: [created] } = await query(
    `INSERT INTO tickets (subject, description, source, requester_id, company_id, group_id, product_id, sla_policy_id, fr_due_by, due_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [subject, description || '', source, contact.id, contact.company_id, group_id, product_id, sla.sla_policy_id, sla.fr_due_by, sla.due_by]
  );
  await logActivity(created.id, { kind: 'contact', id: contact.id, name: contact.name }, 'created', { priority: 'low', source });
  const ticket = await runAutomations('ticket_created', created);
  await sendTicketEmail('new_ticket_requester', ticket);
  return ticket;
}

function tokensMatch(given, expected) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(String(expected || ''));
  return a.length === b.length && b.length > 0 && crypto.timingSafeEqual(a, b);
}

// Bridge for mail gateways and messaging providers. Refuses everything until an admin creates a token.
router.post('/inbound/:channel', asyncHandler(async (req, res) => {
  const source = SOURCE_BY_CHANNEL[req.params.channel];
  if (!source) throw badRequest('Unknown channel');
  const { rows } = await query("SELECT value FROM settings WHERE key = 'inbound'");
  if (!tokensMatch(req.headers['x-inbound-token'], rows[0]?.value?.token)) throw new HttpError(401, 'Invalid inbound token');
  const { from_email: email, from_name: name, from_phone: phone, subject, body, to } = req.body;
  requireFields(req.body, ['body']);
  if (!email && !phone) throw badRequest('from_email or from_phone is required');
  const contact = await findOrCreateContact({ email, name, phone });
  if (contact.is_blocked) return res.status(202).json({ ignored: 'blocked contact' });

  // "[#123]" in the subject continues an existing ticket from the same requester.
  const ref = /\[#(\d+)\]/.exec(subject || '');
  if (ref) {
    const { rows: [existing] } = await query('SELECT * FROM tickets WHERE id = $1 AND requester_id = $2 AND deleted = FALSE', [ref[1], contact.id]);
    if (existing) {
      await query(`INSERT INTO conversations (ticket_id, contact_id, kind, body, source) VALUES ($1,$2,'reply',$3,$4)`, [existing.id, contact.id, body, source]);
      if (existing.status !== 'open') await query("UPDATE tickets SET status = 'open', resolved_at = NULL, closed_at = NULL WHERE id = $1", [existing.id]);
      else await query('UPDATE tickets SET updated_at = NOW() WHERE id = $1', [existing.id]);
      await logActivity(existing.id, { kind: 'contact', id: contact.id, name: contact.name }, 'customer_replied', { source });
      const payload = { type: 'customer_reply', title: `${contact.name} replied on #${existing.id}`, body: existing.subject, link: `/tickets/${existing.id}` };
      if (existing.responder_id) await notifyUser(existing.responder_id, payload); else await notifyGroup(existing.group_id, payload);
      await sendTicketEmail('requester_reply_agent', existing, { body });
      return res.status(201).json({ data: { ticket_id: existing.id, appended: true } });
    }
  }
  const { rows: [mailbox] } = to ? await query('SELECT group_id, product_id FROM mailboxes WHERE LOWER(email) = LOWER($1)', [to]) : { rows: [] };
  const ticket = await createTicket({ contact, subject: subject || String(body).slice(0, 80), description: body, source, group_id: mailbox?.group_id, product_id: mailbox?.product_id });
  res.status(201).json({ data: { ticket_id: ticket.id, appended: false } });
}));

// Public feedback form, embeddable on any site. Limited per IP because it needs no login.
const hits = new Map();
router.post('/public/feedback', asyncHandler(async (req, res) => {
  const now = Date.now();
  const recent = (hits.get(req.ip) || []).filter((at) => now - at < 3600000);
  if (recent.length >= 10) throw new HttpError(429, 'Too many submissions. Please try again later.');
  hits.set(req.ip, [...recent, now]);
  const { name, email, subject, description, website } = req.body;
  // "website" is a hidden field only bots fill in.
  if (website) return res.status(201).json({ ok: true });
  requireFields(req.body, ['email', 'subject', 'description']);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) throw badRequest('Enter a valid email address');
  const contact = await findOrCreateContact({ email, name });
  if (!contact.is_blocked) await createTicket({ contact, subject: String(subject).slice(0, 200), description, source: 'portal' });
  res.status(201).json({ ok: true });
}));

export default router;
