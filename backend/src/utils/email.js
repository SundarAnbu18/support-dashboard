import { query } from '../config/db.js';

let transportPromise;
async function transport() {
  if (!process.env.SMTP_HOST) return null;
  if (!transportPromise) {
    transportPromise = import('nodemailer').then(({ default: nodemailer }) => nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    }));
  }
  return transportPromise;
}

// Every message is recorded in the outbox. Without SMTP_HOST it stays there as "logged".
export async function sendEmail({ to, subject, body, ticketId = null }) {
  if (!to) return null;
  let status = 'logged';
  let error = null;
  const mailer = await transport();
  if (mailer) {
    try {
      await mailer.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text: body });
      status = 'sent';
    } catch (err) {
      status = 'failed';
      error = err.message;
    }
  }
  const { rows } = await query(
    'INSERT INTO email_outbox (ticket_id, to_email, subject, body, status, error) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [ticketId, to, subject, body, status, error]
  );
  return rows[0];
}

export function renderTemplate(text, vars) {
  return String(text).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key) => vars[key] ?? '');
}

// Sends one configured notification. Mail problems must never fail the ticket action.
export async function sendTicketEmail(key, ticket, extra = {}) {
  try {
    const { rows: [tpl] } = await query('SELECT * FROM email_notifications WHERE key = $1 AND is_enabled = TRUE', [key]);
    if (!tpl) return;
    const { rows: [people] } = await query(
      `SELECT c.name AS requester_name, c.email AS requester_email, u.name AS agent_name, u.email AS agent_email
         FROM contacts c LEFT JOIN users u ON u.id = $2 WHERE c.id = $1`,
      [ticket.requester_id, ticket.responder_id]
    );
    if (!people) return;
    const to = tpl.audience === 'requester' ? people.requester_email : people.agent_email;
    const vars = {
      'ticket.id': ticket.id, 'ticket.subject': ticket.subject, 'ticket.status': ticket.status, 'ticket.priority': ticket.priority,
      'requester.name': people.requester_name, 'agent.name': people.agent_name, 'reply.body': extra.body,
    };
    await sendEmail({ to, subject: renderTemplate(tpl.subject, vars), body: renderTemplate(tpl.body, vars), ticketId: ticket.id });
  } catch (err) {
    console.error('[email]', err.message);
  }
}
