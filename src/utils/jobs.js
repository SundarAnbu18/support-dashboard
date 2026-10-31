import { query } from '../config/db.js';
import { notifyUser, notifyGroup } from './notifications.js';
import { logActivity } from './activity.js';
import { runTimeTriggers } from './automations.js';

// Flags SLA breaches and notifies the assignee / group once per breach.
export async function checkSlaBreaches() {
  const { rows: frBreaches } = await query(
    `UPDATE tickets SET fr_escalated = TRUE
      WHERE fr_escalated = FALSE AND first_responded_at IS NULL AND fr_due_by < NOW()
        AND status = 'open' AND deleted = FALSE AND spam = FALSE
      RETURNING id, subject, responder_id, group_id`
  );
  for (const t of frBreaches) {
    const payload = { type: 'sla_breach', title: `First response overdue on #${t.id}`, body: t.subject, link: `/tickets/${t.id}` };
    if (t.responder_id) await notifyUser(t.responder_id, payload); else await notifyGroup(t.group_id, payload);
    await logActivity(t.id, null, 'sla_response_breached', {});
  }
  const { rows: breaches } = await query(
    `UPDATE tickets SET is_escalated = TRUE
      WHERE is_escalated = FALSE AND due_by < NOW()
        AND status IN ('open','pending') AND deleted = FALSE AND spam = FALSE
      RETURNING id, subject, responder_id, group_id`
  );
  for (const t of breaches) {
    const payload = { type: 'sla_breach', title: `Resolution overdue on #${t.id}`, body: t.subject, link: `/tickets/${t.id}` };
    if (t.responder_id) await notifyUser(t.responder_id, payload); else await notifyGroup(t.group_id, payload);
    await logActivity(t.id, null, 'sla_resolution_breached', {});
  }
  return frBreaches.length + breaches.length;
}

// Automatically closes tickets resolved for longer than the configured number of days.
export async function autoCloseResolved() {
  const { rows } = await query("SELECT value FROM settings WHERE key = 'tickets'");
  const days = Number(rows[0]?.value?.auto_close_after_days || 0);
  if (!days) return 0;
  const { rows: closed } = await query(
    `UPDATE tickets SET status = 'closed', closed_at = NOW()
      WHERE status = 'resolved' AND resolved_at < NOW() - ($1 || ' days')::interval AND deleted = FALSE
      RETURNING id`,
    [String(days)]
  );
  for (const t of closed) await logActivity(t.id, null, 'auto_closed', { after_days: days });
  return closed.length;
}

export function startJobs() {
  const safe = (name, fn) => async () => {
    try { await fn(); } catch (err) { console.error(`[job:${name}]`, err.message); }
  };
  setInterval(safe('sla', checkSlaBreaches), 60 * 1000);
  setInterval(safe('time_triggers', runTimeTriggers), 10 * 60 * 1000);
  setInterval(safe('auto_close', autoCloseResolved), 60 * 60 * 1000);
  setTimeout(safe('sla', checkSlaBreaches), 5000);
}
