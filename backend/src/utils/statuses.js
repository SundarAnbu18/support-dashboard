import { query } from '../config/db.js';
import { STATUSES } from './helpers.js';
import { setPausedStatuses } from './sla.js';

// STATUSES is shared by reference, so route validation always sees the configured list.
export async function refreshStatuses() {
  const { rows } = await query('SELECT key, stops_sla FROM ticket_statuses ORDER BY position, key');
  STATUSES.length = 0;
  STATUSES.push(...rows.map((r) => r.key));
  setPausedStatuses(rows.filter((r) => r.stops_sla).map((r) => r.key));
}
