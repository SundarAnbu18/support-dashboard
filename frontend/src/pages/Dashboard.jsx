import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend } from 'recharts';
import { AlertTriangle, Clock, Inbox, UserX, CheckCircle2, Flame, Star, PauseCircle, CircleDot, MailWarning } from 'lucide-react';
import { get } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Spinner, StatCard, StatusBadge, PriorityBadge, SlaPill, Avatar, EmptyState, Select } from '../components/ui.jsx';
import { fmtRelative, fmtDue, activityText, titleCase } from '../utils/format.js';
import { format } from 'date-fns';

const STATUS_COLORS = { open: '#ef4444', pending: '#f59e0b', resolved: '#16a34a', closed: '#94a3b8' };
const PRIORITY_COLORS = { low: '#16a34a', medium: '#3b82f6', high: '#f59e0b', urgent: '#ef4444' };

function MiniList({ title, items, empty, extra, link }) {
  const navigate = useNavigate();
  return (
    <div className="card">
      <div className="card-header"><h3>{title}</h3>{link && <Link to={link} className="small">View all</Link>}</div>
      <div className="card-body tight">
        {items.length === 0 ? <div className="muted" style={{ padding: 16 }}>{empty}</div> : (
          <table className="table">
            <tbody>
              {items.map((t) => (
                <tr key={t.id} className="clickable" onClick={() => navigate(`/tickets/${t.id}`)}>
                  <td style={{ width: 24 }}><PriorityBadge priority={t.priority} dotOnly /></td>
                  <td><div className="strong truncate" style={{ maxWidth: 320 }}>{t.subject}</div><div className="muted small">#{t.id} · {t.requester_name}</div></td>
                  <td style={{ width: 90 }}><StatusBadge status={t.status} /></td>
                  <td className="small" style={{ width: 150 }}>{extra ? extra(t) : <SlaPill status={t.sla_status} dueBy={t.due_by} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// Percent change against yesterday, or nothing when yesterday has no number to compare.
function Delta({ now, before, lowerIsBetter }) {
  const a = Number(now);
  const b = Number(before);
  if (now === null || before === null || !b) return null;
  const pct = Math.round(((a - b) / b) * 100);
  if (!pct) return null;
  const good = lowerIsBetter ? pct < 0 : pct > 0;
  return <span className="small" style={{ color: good ? 'var(--green-600)' : 'var(--red-600)' }}>{pct > 0 ? '▲' : '▼'} {Math.abs(pct)}% vs yesterday</span>;
}

function TodayOverview({ go }) {
  const [filters, setFilters] = useState({ group_id: '', product_id: '' });
  const [lookups, setLookups] = useState({ groups: [], products: [] });
  const [d, setD] = useState(null);
  useEffect(() => { Promise.all([get('/groups'), get('/config/products')]).then(([g, p]) => setLookups({ groups: g.data, products: p.data })); }, []);
  useEffect(() => { get('/dashboard/today', { group_id: filters.group_id || undefined, product_id: filters.product_id || undefined }).then((r) => setD(r.data)); }, [filters]);
  if (!d) return <Spinner block />;
  const c = d.tiles;
  const hourly = d.hourly.map((h) => ({ hour: h.hour, Today: Number(h.today), Yesterday: Number(h.yesterday) }));
  return (
    <>
      <div className="row wrap mb-2">
        <Select small aria-label="Filter by group" value={filters.group_id} placeholder="All groups" onChange={(v) => setFilters({ ...filters, group_id: v })} options={lookups.groups.map((g) => ({ value: String(g.id), label: g.name }))} />
        <Select small aria-label="Filter by product" value={filters.product_id} placeholder="All products" onChange={(v) => setFilters({ ...filters, product_id: v })} options={lookups.products.map((p) => ({ value: String(p.id), label: p.name }))} />
      </div>
      <div className="grid grid-6 mb-3">
        <StatCard label="Unresolved" value={c.unresolved} icon={Inbox} onClick={go('unresolved')} />
        <StatCard label="Overdue" value={c.overdue} tone={Number(c.overdue) ? 'danger' : 'ok'} icon={AlertTriangle} onClick={go('overdue')} />
        <StatCard label="Due today" value={c.due_today} tone={Number(c.due_today) ? 'warn' : ''} icon={Clock} onClick={go('due_today')} />
        <StatCard label="Open" value={c.open} icon={CircleDot} onClick={go('open')} />
        <StatCard label="On hold" value={c.on_hold} icon={PauseCircle} onClick={go('on_hold')} />
        <StatCard label="Unassigned" value={c.unassigned} tone={Number(c.unassigned) ? 'warn' : ''} icon={UserX} onClick={go('unassigned')} />
      </div>
      <div className="grid grid-3 mb-3" style={{ gridTemplateColumns: '2fr 1fr 1fr' }}>
        <div className="card chart-card">
          <div className="card-header"><h3>Today's trends</h3><span className="muted small">Tickets created by hour</span></div>
          <div className="card-body"><ResponsiveContainer width="100%" height="100%">
            <LineChart data={hourly} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="hour" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} /><Tooltip /><Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="Today" stroke="#2563eb" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="Yesterday" stroke="#94a3b8" strokeWidth={2} strokeDasharray="4 3" dot={false} />
            </LineChart>
          </ResponsiveContainer></div>
        </div>
        <div className="card"><div className="card-header"><h3>Today so far</h3></div><div className="card-body col" style={{ gap: 12 }}>
          {[['Received', d.today.received, d.yesterday.received, ''], ['Resolved', d.today.resolved, d.yesterday.resolved, ''], ['Avg first response', d.today.avg_first_response_minutes, d.yesterday.avg_first_response_minutes, ' min', true], ['Resolved within SLA', d.today.sla_pct, d.yesterday.sla_pct, '%']].map(([label, now, before, unit, lower]) => (
            <div key={label}><div className="muted small">{label}</div><div className="row-between"><strong style={{ fontSize: 18 }}>{now ?? '—'}{now !== null ? unit : ''}</strong><Delta now={now} before={before} lowerIsBetter={lower} /></div></div>
          ))}
        </div></div>
        <div className="card"><div className="card-header"><h3>Unresolved by group</h3>{d.undelivered > 0 && <Link to="/undelivered" className="small row" style={{ gap: 4, color: 'var(--red-600)' }}><MailWarning size={13} /> {d.undelivered} undelivered</Link>}</div>
          <div className="card-body tight"><table className="table"><thead><tr><th>Group</th><th className="num">Open</th><th className="num">Unresolved</th></tr></thead>
            <tbody>{d.by_group.map((g) => <tr key={g.id || 'none'}><td>{g.name}</td><td className="num">{g.open}</td><td className="num strong">{g.unresolved}</td></tr>)}{d.by_group.length === 0 && <tr><td colSpan={3} className="muted">Nothing unresolved.</td></tr>}</tbody></table></div>
        </div>
      </div>
    </>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  useEffect(() => { get('/dashboard').then((r) => setData(r.data)); }, []);
  if (!data) return <div className="content"><Spinner block /></div>;
  const c = data.counts;
  const go = (view) => () => navigate(`/tickets?view=${view}`);
  const trend = data.trend.map((d) => ({ ...d, day: format(new Date(d.day), 'MMM d'), created: Number(d.created), resolved: Number(d.resolved) }));

  return (
    <div className="content">
      <div className="page-header">
        <div><h1>Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, {user.name.split(' ')[0]}</h1><p className="sub">Here is what is happening in your helpdesk today.</p></div>
        <div className="page-actions"><span className="muted small">{format(new Date(), 'EEEE, MMMM d, yyyy')}</span></div>
      </div>

      <TodayOverview go={go} />

      <div className="grid grid-3 mb-3" style={{ gridTemplateColumns: '2fr 1fr 1fr' }}>
        <div className="card chart-card">
          <div className="card-header"><h3>Ticket volume · last 14 days</h3><div className="legend"><span><i style={{ background: '#2563eb' }} />Created</span><span><i style={{ background: '#16a34a' }} />Resolved</span></div></div>
          <div className="card-body">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="gc" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2563eb" stopOpacity={.3} /><stop offset="100%" stopColor="#2563eb" stopOpacity={0} /></linearGradient>
                  <linearGradient id="gr" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#16a34a" stopOpacity={.3} /><stop offset="100%" stopColor="#16a34a" stopOpacity={0} /></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Area type="monotone" dataKey="created" stroke="#2563eb" fill="url(#gc)" strokeWidth={2} />
                <Area type="monotone" dataKey="resolved" stroke="#16a34a" fill="url(#gr)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card chart-card">
          <div className="card-header"><h3>By status</h3></div>
          <div className="card-body">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data.by_status.map((d) => ({ name: titleCase(d.label), value: Number(d.value), key: d.label }))} dataKey="value" innerRadius={55} outerRadius={85} paddingAngle={2}>
                  {data.by_status.map((d) => <Cell key={d.label} fill={STATUS_COLORS[d.label] || '#7c3aed'} />)}
                </Pie>
                <Tooltip /><Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h3>Customer satisfaction</h3><span className="muted small">30 days</span></div>
          <div className="card-body col" style={{ gap: 14 }}>
            <div className="row" style={{ gap: 14 }}>
              <span style={{ width: 56, height: 56, borderRadius: 14, background: 'var(--amber-100)', display: 'grid', placeItems: 'center' }}><Star size={28} color="#d97706" fill="#d97706" /></span>
              <div><div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1 }}>{data.csat.score_pct ?? '—'}{data.csat.score_pct !== null && '%'}</div><div className="muted small">positive ratings</div></div>
            </div>
            <div className="kv"><dt>Avg rating</dt><dd className="strong">{data.csat.avg_rating ?? '—'} / 5</dd><dt>Responses</dt><dd>{data.csat.responses}</dd><dt>Urgent open</dt><dd className="strong" style={{ color: 'var(--red-600)' }}>{c.urgent_open}</dd></div>
            <h4>Open by priority</h4>
            {data.by_priority.sort((a, b) => ['urgent', 'high', 'medium', 'low'].indexOf(a.label) - ['urgent', 'high', 'medium', 'low'].indexOf(b.label)).map((p) => {
              const total = data.by_priority.reduce((s, x) => s + Number(x.value), 0) || 1;
              return (
                <div key={p.label} className="col" style={{ gap: 3 }}>
                  <div className="row-between small"><span className="row"><span className={`priority-dot priority-${p.label}`} />{titleCase(p.label)}</span><span className="muted">{p.value}</span></div>
                  <div className="progress"><div style={{ width: `${(Number(p.value) / total) * 100}%`, background: PRIORITY_COLORS[p.label] }} /></div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-2 mb-3">
        <MiniList title="My open tickets" items={data.my_tickets} empty="You have no open tickets assigned. Nice!" link="/tickets?view=my_open" />
        <MiniList title="Overdue tickets" items={data.overdue} empty="No overdue tickets." link="/tickets?view=overdue" extra={(t) => <span style={{ color: 'var(--red-600)', fontWeight: 600 }}>{fmtDue(t.due_by)}</span>} />
      </div>
      <div className="grid grid-3" style={{ gridTemplateColumns: '1.3fr 1fr 1fr' }}>
        <MiniList title="Unassigned tickets" items={data.unassigned} empty="Every ticket has an owner." link="/tickets?view=unassigned" extra={(t) => <span className="muted">{t.group_name || 'No group'} · {fmtRelative(t.created_at)}</span>} />
        <div className="card">
          <div className="card-header"><h3>Agent workload</h3><Link to="/reports" className="small">Reports</Link></div>
          <div className="card-body col" style={{ gap: 10 }}>
            {data.agent_load.map((a) => {
              const max = Math.max(1, ...data.agent_load.map((x) => Number(x.open)));
              return (
                <div key={a.id} className="row" style={{ gap: 10 }}>
                  <Avatar name={a.name} src={a.avatar_url} size="sm" />
                  <div className="flex-1 col" style={{ gap: 3 }}>
                    <div className="row-between small"><span className="truncate">{a.name}</span><span className="muted">{a.open} open</span></div>
                    <div className="progress"><div style={{ width: `${(Number(a.open) / max) * 100}%` }} /></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h3>Recent activity</h3></div>
          <div className="card-body">
            {data.recent_activity.length === 0 ? <EmptyState title="No activity yet" /> : (
              <div className="timeline">
                {data.recent_activity.map((a) => (
                  <div key={a.id} className="timeline-item">
                    <span className="dot" />
                    <div className="flex-1">
                      <div><strong>{a.actor_label || 'System'}</strong> {activityText(a)} on <Link to={`/tickets/${a.ticket_id}`}>#{a.ticket_id}</Link></div>
                      <div className="when">{fmtRelative(a.created_at)} · <span className="truncate">{a.subject}</span></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
