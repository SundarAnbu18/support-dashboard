import { query } from '../config/db.js';

export async function notifyUser(userId, { type, title, body, link }) {
  if (!userId) return;
  await query(
    `INSERT INTO notifications (user_id, type, title, body, link) VALUES ($1, $2, $3, $4, $5)`,
    [userId, type, title, body || null, link || null]
  );
}

export async function notifyContact(contactId, { type, title, body, link }) {
  if (!contactId) return;
  await query(
    `INSERT INTO notifications (contact_id, type, title, body, link) VALUES ($1, $2, $3, $4, $5)`,
    [contactId, type, title, body || null, link || null]
  );
}

export async function notifyGroup(groupId, payload, exceptUserId) {
  if (!groupId) return;
  const { rows } = await query('SELECT user_id FROM group_members WHERE group_id = $1', [groupId]);
  for (const r of rows) {
    if (r.user_id !== exceptUserId) await notifyUser(r.user_id, payload);
  }
}
