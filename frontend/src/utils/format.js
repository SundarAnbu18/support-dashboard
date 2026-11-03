import { format, formatDistanceToNowStrict, isToday, isYesterday, differenceInMinutes } from 'date-fns';

export const fmtDate = (d) => (d ? format(new Date(d), 'MMM d, yyyy') : '—');
export const fmtDateTime = (d) => (d ? format(new Date(d), 'MMM d, yyyy h:mm a') : '—');
export const fmtTime = (d) => (d ? format(new Date(d), 'h:mm a') : '');
export const fmtRelative = (d) => {
  if (!d) return '—';
  const date = new Date(d);
  const mins = Math.abs(differenceInMinutes(new Date(), date));
  if (mins < 1) return 'just now';
  const str = formatDistanceToNowStrict(date, { addSuffix: true });
  return str;
};
export const fmtSmart = (d) => {
  if (!d) return '—';
  const date = new Date(d);
  if (isToday(date)) return `Today, ${format(date, 'h:mm a')}`;
  if (isYesterday(date)) return `Yesterday, ${format(date, 'h:mm a')}`;
  return format(date, 'MMM d, h:mm a');
};
export const fmtDue = (d) => {
  if (!d) return 'No due date';
  const date = new Date(d);
  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  const h = Math.floor(abs / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  const span = h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  return diff < 0 ? `Overdue by ${span}` : `Due in ${span}`;
};
export const fmtMinutes = (mins) => {
  const n = Number(mins || 0);
  if (!n) return '0m';
  const h = Math.floor(n / 60);
  const m = n % 60;
  return h ? `${h}h ${m ? m + 'm' : ''}`.trim() : `${m}m`;
};
export const fmtHours = (h) => (h === null || h === undefined ? '—' : Number(h) < 1 ? `${Math.round(Number(h) * 60)}m` : `${Number(h).toFixed(1)}h`);

export const titleCase = (s) => (s ? String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '');
export const initials = (name = '') => name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';

export const STATUS_LABELS = { open: 'Open', pending: 'Pending', resolved: 'Resolved', closed: 'Closed' };
export const CUSTOMER_STATUS_LABELS = {};
export const PRIORITY_LABELS = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };
export const TYPE_OPTIONS = ['question', 'incident', 'problem', 'feature_request', 'refund', 'other'];
export const SOURCE_OPTIONS = ['email', 'portal', 'phone', 'chat', 'social', 'agent'];
export const STATUS_OPTIONS = ['open', 'pending', 'resolved', 'closed'];
export const PRIORITY_OPTIONS = ['low', 'medium', 'high', 'urgent'];

// Custom statuses come from the API; these lists are updated in place so every import sees them.
export async function loadStatuses() {
  const res = await fetch(`${import.meta.env.VITE_API_URL || '/api'}/config/ticket-statuses/public`);
  if (!res.ok) return;
  const { data } = await res.json();
  STATUS_OPTIONS.length = 0;
  for (const s of data) {
    STATUS_OPTIONS.push(s.key);
    STATUS_LABELS[s.key] = s.label;
    CUSTOMER_STATUS_LABELS[s.key] = s.customer_label;
  }
}
export const statusOptions = () => STATUS_OPTIONS.map((s) => ({ value: s, label: STATUS_LABELS[s] || titleCase(s) }));

export const SLA_LABELS = {
  within: 'Within SLA', overdue: 'Overdue', response_overdue: 'Response overdue', paused: 'Paused', met: 'SLA met', resolved_late: 'Resolved late',
};

export const avatarColor = (seed = '') => {
  const palette = ['#2563eb', '#7c3aed', '#db2777', '#059669', '#d97706', '#0891b2', '#dc2626', '#4f46e5'];
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
};

export const activityText = (a) => {
  const d = a.details || {};
  switch (a.action) {
    case 'created': return `created the ticket (${d.priority || ''} priority)`;
    case 'updated': {
      const parts = Object.entries(d.changes || {}).map(([k, v]) => {
        const to = Array.isArray(v.to) ? v.to.join(', ') : (v.to ?? '—');
        const from = Array.isArray(v.from) ? v.from.join(', ') : (v.from ?? '—');
        return `${titleCase(k)}: ${typeof from === 'object' ? 'updated' : from} → ${typeof to === 'object' ? 'updated' : to}`;
      });
      return `updated ${parts.join('; ')}`;
    }
    case 'agent_replied': return 'replied to the customer';
    case 'customer_replied': return 'replied';
    case 'note_added': return 'added a private note';
    case 'forwarded': return 'forwarded the ticket';
    case 'automation': return `automation "${d.rule}" ran${Object.keys(d.changes || {}).length ? ': ' + Object.entries(d.changes).map(([k, v]) => `${titleCase(k)} → ${Array.isArray(v.to) ? v.to.join(', ') : v.to}`).join(', ') : ''}`;
    case 'bulk_update': return 'applied a bulk update';
    case 'deleted': return 'moved the ticket to trash';
    case 'restored': return 'restored the ticket';
    case 'merged': return `merged this ticket into #${d.into}`;
    case 'merge_target': return `merged tickets ${(d.from || []).map((i) => '#' + i).join(', ')} into this one`;
    case 'time_logged': return `logged ${d.minutes} minutes`;
    case 'rated': return `rated the ticket ${d.rating}/5`;
    case 'sla_response_breached': return 'first response SLA was breached';
    case 'sla_resolution_breached': return 'resolution SLA was breached';
    case 'auto_closed': return 'ticket was auto-closed';
    case 'scenario': return `ran scenario "${d.rule}"`;
    case 'split_from': return `split this ticket from #${d.ticket}`;
    case 'split_to': return `split a reply into #${d.ticket}`;
    case 'linked': return `linked ticket #${d.ticket}`;
    case 'unlinked': return `unlinked ticket #${d.ticket}`;
    case 'parent_set': return `made this a child of #${d.ticket}`;
    case 'parent_removed': return `removed the link to parent #${d.ticket}`;
    case 'thread_started': return `started the thread "${d.title}"`;
    case 'converted_to_topic': return 'converted the ticket to a forum topic';
    default: return titleCase(a.action);
  }
};
