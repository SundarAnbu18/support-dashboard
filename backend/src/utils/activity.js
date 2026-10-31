import { query } from '../config/db.js';

export async function logActivity(ticketId, actor, action, details = {}, client) {
  const run = client ? client.query.bind(client) : query;
  const userId = actor && actor.kind === 'user' ? actor.id : null;
  const contactId = actor && actor.kind === 'contact' ? actor.id : null;
  const label = actor ? actor.name : 'System';
  await run(
    `INSERT INTO ticket_activities (ticket_id, user_id, contact_id, actor_label, action, details)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [ticketId, userId, contactId, label, action, JSON.stringify(details)]
  );
}
