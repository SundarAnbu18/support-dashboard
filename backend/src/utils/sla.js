import { query } from '../config/db.js';

// Statuses configured to stop the SLA clock; kept current by refreshStatuses().
let pausedStatuses = new Set(['pending']);
export function setPausedStatuses(keys) { pausedStatuses = new Set(keys); }

const DEFAULT_TARGETS = {
  urgent: { respond_within: 60, resolve_within: 240 },
  high: { respond_within: 240, resolve_within: 480 },
  medium: { respond_within: 480, resolve_within: 1440 },
  low: { respond_within: 1440, resolve_within: 4320 },
};

function matchesList(list, value) {
  if (!Array.isArray(list) || list.length === 0) return true;
  return list.map(String).includes(String(value));
}

// Picks the first active, non-default policy whose conditions match; otherwise the default.
export async function pickSlaPolicy(ticket) {
  const { rows } = await query(
    'SELECT * FROM sla_policies WHERE is_active = TRUE ORDER BY is_default ASC, position ASC, id ASC'
  );
  let fallback = null;
  for (const p of rows) {
    if (p.is_default) { fallback = fallback || p; continue; }
    const c = p.conditions || {};
    if (
      matchesList(c.priority, ticket.priority) &&
      matchesList(c.type, ticket.type) &&
      matchesList(c.source, ticket.source) &&
      matchesList(c.group_id, ticket.group_id) &&
      matchesList(c.company_id, ticket.company_id)
    ) {
      return p;
    }
  }
  return fallback;
}

export function computeDueDates(policy, priority, from = new Date()) {
  const targets = (policy && policy.targets && policy.targets[priority]) || DEFAULT_TARGETS[priority] || DEFAULT_TARGETS.low;
  const base = new Date(from).getTime();
  return {
    fr_due_by: new Date(base + Number(targets.respond_within || 60) * 60000),
    due_by: new Date(base + Number(targets.resolve_within || 240) * 60000),
  };
}

export async function applySla(ticket) {
  const policy = await pickSlaPolicy(ticket);
  const due = computeDueDates(policy, ticket.priority, ticket.created_at || new Date());
  return { sla_policy_id: policy ? policy.id : null, ...due };
}

export function slaStatus(ticket, now = new Date()) {
  if (ticket.status === 'resolved' || ticket.status === 'closed') {
    const breached = ticket.resolved_at && ticket.due_by && new Date(ticket.resolved_at) > new Date(ticket.due_by);
    return breached ? 'resolved_late' : 'met';
  }
  if (pausedStatuses.has(ticket.status)) return 'paused';
  if (ticket.due_by && new Date(ticket.due_by) < now) return 'overdue';
  if (!ticket.first_responded_at && ticket.fr_due_by && new Date(ticket.fr_due_by) < now) return 'response_overdue';
  return 'within';
}

export { DEFAULT_TARGETS };
