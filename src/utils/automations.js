import { query } from '../config/db.js';
import { logActivity } from './activity.js';
import { notifyUser, notifyGroup } from './notifications.js';

// Fields exposed to automation conditions.
async function ticketContext(ticket) {
  const { rows } = await query(
    `SELECT c.email AS requester_email, c.name AS requester_name, co.name AS company_name,
            co.domains AS company_domains
       FROM contacts c LEFT JOIN companies co ON co.id = c.company_id
      WHERE c.id = $1`,
    [ticket.requester_id]
  );
  const extra = rows[0] || {};
  const now = Date.now();
  const hours = (d) => (d ? (now - new Date(d).getTime()) / 3600000 : null);
  return {
    ...ticket,
    requester_email: extra.requester_email,
    requester_name: extra.requester_name,
    company_name: extra.company_name,
    requester_domain: extra.requester_email ? extra.requester_email.split('@')[1] : null,
    hours_since_created: hours(ticket.created_at),
    hours_since_updated: hours(ticket.updated_at),
    hours_since_due: ticket.due_by ? (now - new Date(ticket.due_by).getTime()) / 3600000 : null,
    hours_until_due: ticket.due_by ? (new Date(ticket.due_by).getTime() - now) / 3600000 : null,
    has_responder: !!ticket.responder_id,
    first_responded: !!ticket.first_responded_at,
  };
}

function norm(v) {
  if (v === null || v === undefined) return '';
  return String(v).toLowerCase();
}

export function evaluateRule(rule, ctx) {
  const actual = ctx[rule.field];
  const expected = rule.value;
  const op = rule.operator || 'is';
  switch (op) {
    case 'is':
      if (typeof actual === 'boolean') return actual === (expected === true || norm(expected) === 'true');
      return norm(actual) === norm(expected);
    case 'is_not':
      if (typeof actual === 'boolean') return actual !== (expected === true || norm(expected) === 'true');
      return norm(actual) !== norm(expected);
    case 'contains':
      if (Array.isArray(actual)) return actual.map(norm).includes(norm(expected));
      return norm(actual).includes(norm(expected));
    case 'not_contains':
      if (Array.isArray(actual)) return !actual.map(norm).includes(norm(expected));
      return !norm(actual).includes(norm(expected));
    case 'starts_with':
      return norm(actual).startsWith(norm(expected));
    case 'ends_with':
      return norm(actual).endsWith(norm(expected));
    case 'in': {
      const list = Array.isArray(expected) ? expected : String(expected).split(',').map((s) => s.trim());
      return list.map(norm).includes(norm(actual));
    }
    case 'not_in': {
      const list = Array.isArray(expected) ? expected : String(expected).split(',').map((s) => s.trim());
      return !list.map(norm).includes(norm(actual));
    }
    case 'greater_than':
      return actual !== null && actual !== undefined && Number(actual) > Number(expected);
    case 'less_than':
      return actual !== null && actual !== undefined && Number(actual) < Number(expected);
    case 'is_empty':
      return actual === null || actual === undefined || actual === '' || (Array.isArray(actual) && actual.length === 0);
    case 'is_not_empty':
      return !(actual === null || actual === undefined || actual === '' || (Array.isArray(actual) && actual.length === 0));
    default:
      return false;
  }
}

export function evaluateConditions(conditions, ctx) {
  const rules = (conditions && conditions.rules) || [];
  if (rules.length === 0) return true;
  const match = (conditions && conditions.match) || 'all';
  const results = rules.map((r) => evaluateRule(r, ctx));
  return match === 'any' ? results.some(Boolean) : results.every(Boolean);
}

async function applyActions(actions, ticket, ruleName) {
  const updates = {};
  let tags = [...(ticket.tags || [])];
  const notes = [];
  const notifications = [];
  for (const a of actions || []) {
    switch (a.type) {
      case 'set_priority': updates.priority = a.value; break;
      case 'set_status': updates.status = a.value; break;
      case 'set_type': updates.type = a.value; break;
      case 'set_source': updates.source = a.value; break;
      case 'assign_group': updates.group_id = a.value ? Number(a.value) : null; break;
      case 'assign_agent': updates.responder_id = a.value ? Number(a.value) : null; break;
      case 'add_tag': if (a.value && !tags.includes(a.value)) tags.push(a.value); break;
      case 'remove_tag': tags = tags.filter((t) => t !== a.value); break;
      case 'mark_spam': updates.spam = true; break;
      case 'escalate': updates.is_escalated = true; break;
      case 'add_note': if (a.value) notes.push(a.value); break;
      case 'notify_agent': if (a.value) notifications.push({ user_id: Number(a.value), message: a.message }); break;
      case 'notify_group': if (a.value) notifications.push({ group_id: Number(a.value), message: a.message }); break;
      case 'notify_assignee': notifications.push({ assignee: true, message: a.message }); break;
      default: break;
    }
  }
  if (JSON.stringify(tags) !== JSON.stringify(ticket.tags || [])) updates.tags = tags;
  return { updates, notes, notifications };
}

// Runs automations for an event against a ticket. Returns the (possibly updated) ticket row.
export async function runAutomations(event, ticket) {
  const { rows: rules } = await query(
    'SELECT * FROM automations WHERE is_active = TRUE AND event = $1 ORDER BY position ASC, id ASC',
    [event]
  );
  if (rules.length === 0) return ticket;

  let current = ticket;
  for (const rule of rules) {
    const ctx = await ticketContext(current);
    if (!evaluateConditions(rule.conditions, ctx)) continue;

    const { updates, notes, notifications } = await applyActions(rule.actions, current, rule.name);
    const changes = {};
    for (const [k, v] of Object.entries(updates)) {
      if (JSON.stringify(current[k]) !== JSON.stringify(v)) changes[k] = { from: current[k], to: v };
    }

    if (Object.keys(changes).length) {
      const keys = Object.keys(changes);
      const sets = keys.map((k, i) => `${k} = $${i + 2}`);
      const vals = keys.map((k) => updates[k]);
      if (updates.status === 'resolved' && !current.resolved_at) { sets.push('resolved_at = NOW()'); }
      if (updates.status === 'closed' && !current.closed_at) { sets.push('closed_at = NOW()'); }
      const { rows } = await query(
        `UPDATE tickets SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
        [current.id, ...vals]
      );
      current = rows[0];
    }
    for (const n of notes) {
      await query(
        `INSERT INTO conversations (ticket_id, kind, is_private, body, source) VALUES ($1, 'note', TRUE, $2, 'automation')`,
        [current.id, n]
      );
    }
    for (const n of notifications) {
      const payload = {
        type: 'automation',
        title: `Automation "${rule.name}" on ticket #${current.id}`,
        body: n.message || current.subject,
        link: `/tickets/${current.id}`,
      };
      if (n.user_id) await notifyUser(n.user_id, payload);
      if (n.group_id) await notifyGroup(n.group_id, payload);
      if (n.assignee && current.responder_id) await notifyUser(current.responder_id, payload);
    }
    if (Object.keys(changes).length || notes.length || notifications.length) {
      await logActivity(current.id, null, 'automation', { rule: rule.name, changes, notes: notes.length });
    }
    await query('UPDATE automations SET run_count = run_count + 1, last_run_at = NOW() WHERE id = $1', [rule.id]);
  }
  return current;
}

// Time-based rules (Freshdesk "Supervisor"): evaluated periodically on unresolved tickets.
export async function runTimeTriggers() {
  const { rows: rules } = await query(
    "SELECT id FROM automations WHERE is_active = TRUE AND event = 'time_trigger'"
  );
  if (rules.length === 0) return 0;
  const { rows: tickets } = await query(
    "SELECT * FROM tickets WHERE status IN ('open','pending') AND deleted = FALSE AND spam = FALSE"
  );
  let touched = 0;
  for (const t of tickets) {
    const before = JSON.stringify(t);
    const after = await runAutomations('time_trigger', t);
    if (JSON.stringify(after) !== before) touched++;
  }
  return touched;
}
