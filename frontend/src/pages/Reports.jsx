import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend, LineChart, Line } from 'recharts';
import { format, subDays } from 'date-fns';
import { Download } from 'lucide-react';
import { get } from '../api/client.js';
import { Spinner, StatCard, Tabs, Avatar, Badge } from '../components/ui.jsx';
import { fmtHours, fmtMinutes, titleCase } from '../utils/format.js';

const COLORS = ['#2563eb', '#7c3aed', '#db2777', '#059669', '#d97706', '#0891b2', '#dc2626', '#4f46e5'];
const STATUS_COLORS = { open: '#ef4444', pending: '#f59e0b', resolved: '#16a34a', closed: '#94a3b8' };
const PRIORITY_COLORS = { low: '#16a34a', medium: '#3b82f6', high: '#f59e0b', urgent: '#ef4444' };

function Donut({ data, colors }) {
  const d = data.map((x, i) => ({ name: titleCase(x.label), value: Number(x.value), fill: colors ? colors[x.label] : COLORS[i % COLORS.length] }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart><Pie data={d} dataKey="value" innerRadius={55} outerRadius={85} paddingAngle={2}>{d.map((x, i) => <Cell key={i} fill={x.fill} />)}</Pie><Tooltip /><Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} /></PieChart>
    </ResponsiveContainer>
  );
}

function downloadCsv(name, rows) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const csv = [keys.join(','), ...rows.map((r) => keys.map((k) => `"${String(r[k] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `${name}.csv`; a.click();
}

export default function Reports() {
  const [tab, setTab] = useState('overview');
  const [from, setFrom] = useState(format(subDays(new Date(), 29), 'yyyy-MM-dd'));
  const [to, setTo] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const eps = { overview: ['overview', 'tags'], agents: ['agents', 'time-tracking'], groups: ['groups'], companies: ['companies'], satisfaction: ['satisfaction'] }[tab];
    Promise.all(eps.map((e) => get(`/reports/${e}`, { from, to }))).then((rs) => { const d = {}; eps.forEach((e, i) => { d[e] = rs[i].data; }); setData(d); }).finally(() => setLoading(false));
  }, [tab, from, to]);

  const presets = [['7d', 6], ['30d', 29], ['90d', 89]];

  return (
    <div className="content">
      <div className="page-header">
        <div><h1>Reports & analytics</h1><p className="sub">Helpdesk performance for the selected period.</p></div>
        <div className="page-actions">
          {presets.map(([l, d]) => <button key={l} className="btn btn-sm" onClick={() => { setFrom(format(subDays(new Date(), d), 'yyyy-MM-dd')); setTo(format(new Date(), 'yyyy-MM-dd')); }}>Last {l}</button>)}
          <input type="date" className="input input-sm" value={from} onChange={(e) => setFrom(e.target.value)} /><span className="muted">to</span><input type="date" className="input input-sm" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      <Tabs active={tab} onChange={setTab} tabs={[{ key: 'overview', label: 'Overview' }, { key: 'agents', label: 'Agent performance' }, { key: 'groups', label: 'Groups' }, { key: 'companies', label: 'Companies' }, { key: 'satisfaction', label: 'Satisfaction' }]} />
      {loading ? <Spinner block /> : (
        <>
          {tab === 'overview' && data.overview && <Overview d={data.overview} tags={data.tags} />}
          {tab === 'agents' && data.agents && <AgentsReport rows={data.agents} />}
          {tab === 'groups' && data.groups && <GroupsReport rows={data.groups} />}
          {tab === 'companies' && data.companies && <CompaniesReport rows={data.companies} />}
          {tab === 'satisfaction' && data.satisfaction && <SatisfactionReport d={data.satisfaction} />}
        </>
      )}
    </div>
  );
}

function Overview({ d, tags }) {
  const t = d.totals;
  const trend = d.trend.map((x) => ({ ...x, day: format(new Date(x.day), 'MMM d'), created: Number(x.created), resolved: Number(x.resolved) }));
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const byWeekday = weekdays.map((w, i) => ({ day: w, value: Number(d.by_weekday.find((x) => Number(x.weekday) === i + 1)?.value || 0) }));
  const byHour = Array.from({ length: 24 }, (_, h) => ({ hour: `${h}h`, value: Number(d.by_hour.find((x) => Number(x.hour) === h)?.value || 0) }));
  return (
    <>
      <div className="grid grid-6 mb-3">
        <StatCard label="Created" value={t.created} /><StatCard label="Resolved" value={t.resolved} tone="ok" /><StatCard label="Unresolved" value={t.unresolved} tone={Number(t.unresolved) ? 'warn' : ''} />
        <StatCard label="Avg first response" value={fmtHours(t.avg_first_response_hours)} /><StatCard label="Avg resolution" value={fmtHours(t.avg_resolution_hours)} hint={`median ${fmtHours(t.median_resolution_hours)}`} /><StatCard label="Avg replies / ticket" value={t.avg_replies ?? '—'} />
      </div>
      <div className="grid grid-4 mb-3">
        <StatCard label="First response SLA" value={d.sla.first_response_pct !== null ? `${d.sla.first_response_pct}%` : '—'} tone={d.sla.first_response_pct >= 90 ? 'ok' : d.sla.first_response_pct !== null ? 'warn' : ''} hint={`${d.sla.responded_in_sla} of ${d.sla.responded} on time`} />
        <StatCard label="Resolution SLA" value={d.sla.resolution_pct !== null ? `${d.sla.resolution_pct}%` : '—'} tone={d.sla.resolution_pct >= 90 ? 'ok' : d.sla.resolution_pct !== null ? 'warn' : ''} hint={`${d.sla.resolved_in_sla} of ${d.sla.resolved} on time`} />
        <StatCard label="Currently overdue" value={d.sla.currently_overdue} tone={Number(d.sla.currently_overdue) ? 'danger' : 'ok'} />
        <StatCard label="CSAT" value={d.csat.score_pct !== null ? `${d.csat.score_pct}%` : '—'} hint={`${d.csat.responses} responses · avg ${d.csat.avg_rating ?? '—'}/5`} tone="ok" />
      </div>
      <div className="card chart-card mb-3"><div className="card-header"><h3>Created vs resolved</h3></div><div className="card-body">
        <ResponsiveContainer width="100%" height="100%"><BarChart data={trend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="day" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} /><Tooltip /><Legend wrapperStyle={{ fontSize: 12 }} /><Bar dataKey="created" fill="#2563eb" radius={[3, 3, 0, 0]} /><Bar dataKey="resolved" fill="#16a34a" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer>
      </div></div>
      <div className="grid grid-4 mb-3">
        <div className="card chart-card"><div className="card-header"><h3>By status</h3></div><div className="card-body"><Donut data={d.by_status} colors={STATUS_COLORS} /></div></div>
        <div className="card chart-card"><div className="card-header"><h3>By priority</h3></div><div className="card-body"><Donut data={d.by_priority} colors={PRIORITY_COLORS} /></div></div>
        <div className="card chart-card"><div className="card-header"><h3>By type</h3></div><div className="card-body"><Donut data={d.by_type} /></div></div>
        <div className="card chart-card"><div className="card-header"><h3>By source</h3></div><div className="card-body"><Donut data={d.by_source} /></div></div>
      </div>
      <div className="grid grid-3">
        <div className="card chart-card"><div className="card-header"><h3>Tickets by weekday</h3></div><div className="card-body"><ResponsiveContainer width="100%" height="100%"><BarChart data={byWeekday} margin={{ top: 10, right: 10, left: -20 }}><XAxis dataKey="day" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="value" fill="#7c3aed" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div></div>
        <div className="card chart-card"><div className="card-header"><h3>Tickets by hour of day</h3></div><div className="card-body"><ResponsiveContainer width="100%" height="100%"><LineChart data={byHour} margin={{ top: 10, right: 10, left: -20 }}><XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={2} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} /><Tooltip /><Line type="monotone" dataKey="value" stroke="#0891b2" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></div></div>
        <div className="card chart-card"><div className="card-header"><h3>Top tags</h3></div><div className="card-body"><ResponsiveContainer width="100%" height="100%"><BarChart data={(tags || []).slice(0, 8).map((x) => ({ ...x, value: Number(x.value) }))} layout="vertical" margin={{ left: 20, right: 10 }}><XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="label" width={90} tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="value" fill="#db2777" radius={[0, 3, 3, 0]} /></BarChart></ResponsiveContainer></div></div>
      </div>
    </>
  );
}

function AgentsReport({ rows }) {
  return (
    <>
      <div className="card mb-3"><div className="card-header"><h3>Agent performance</h3><button className="btn btn-sm" onClick={() => downloadCsv('agents', rows)}><Download size={14} /> CSV</button></div>
        <div className="table-wrap"><table className="table"><thead><tr><th>Agent</th><th className="num">Assigned</th><th className="num">Resolved</th><th className="num">Open</th><th className="num">Replies</th><th className="num">Avg 1st response</th><th className="num">Avg resolution</th><th className="num">Resolved in SLA</th><th className="num">CSAT</th><th className="num">Time logged</th></tr></thead>
          <tbody>{rows.map((a) => (
            <tr key={a.id}><td><div className="row" style={{ gap: 10 }}><Avatar name={a.name} src={a.avatar_url} size="sm" /><span className="strong">{a.name}</span>{a.role === 'admin' && <Badge color="blue">admin</Badge>}</div></td>
              <td className="num">{a.assigned}</td><td className="num">{a.resolved}</td><td className="num">{a.open}</td><td className="num">{a.replies}</td><td className="num">{fmtHours(a.avg_first_response_hours)}</td><td className="num">{fmtHours(a.avg_resolution_hours)}</td>
              <td className="num">{Number(a.resolved) ? `${Math.round((Number(a.resolved_in_sla) / Number(a.resolved)) * 100)}%` : '—'}</td><td className="num">{a.csat ? `${a.csat} (${a.csat_responses})` : '—'}</td><td className="num">{fmtMinutes(a.minutes_logged)}</td></tr>
          ))}</tbody></table></div></div>
      <div className="card chart-card"><div className="card-header"><h3>Resolved tickets by agent</h3></div><div className="card-body"><ResponsiveContainer width="100%" height="100%"><BarChart data={rows.map((r) => ({ name: r.name.split(' ')[0], resolved: Number(r.resolved), assigned: Number(r.assigned) }))} margin={{ top: 10, right: 10, left: -20 }}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} /><Tooltip /><Legend wrapperStyle={{ fontSize: 12 }} /><Bar dataKey="assigned" fill="#94a3b8" radius={[3, 3, 0, 0]} /><Bar dataKey="resolved" fill="#2563eb" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div></div>
    </>
  );
}

function GroupsReport({ rows }) {
  return (
    <div className="card"><div className="card-header"><h3>Group performance</h3><button className="btn btn-sm" onClick={() => downloadCsv('groups', rows)}><Download size={14} /> CSV</button></div>
      <div className="table-wrap"><table className="table"><thead><tr><th>Group</th><th className="num">Assigned</th><th className="num">Resolved</th><th className="num">Open</th><th className="num">Overdue</th><th className="num">Avg 1st response</th><th className="num">Avg resolution</th></tr></thead>
        <tbody>{rows.map((g) => <tr key={g.id}><td className="strong">{g.name}</td><td className="num">{g.assigned}</td><td className="num">{g.resolved}</td><td className="num">{g.open}</td><td className="num">{Number(g.overdue) ? <span className="badge badge-red">{g.overdue}</span> : 0}</td><td className="num">{fmtHours(g.avg_first_response_hours)}</td><td className="num">{fmtHours(g.avg_resolution_hours)}</td></tr>)}</tbody></table></div></div>
  );
}

function CompaniesReport({ rows }) {
  return (
    <div className="card"><div className="card-header"><h3>Tickets by company</h3><button className="btn btn-sm" onClick={() => downloadCsv('companies', rows)}><Download size={14} /> CSV</button></div>
      <div className="table-wrap"><table className="table"><thead><tr><th>Company</th><th>Tier</th><th>Health</th><th className="num">Tickets</th><th className="num">Open</th><th className="num">High/urgent</th><th className="num">Avg resolution</th><th className="num">CSAT</th></tr></thead>
        <tbody>{rows.map((c) => <tr key={c.id}><td className="strong">{c.name}</td><td>{titleCase(c.account_tier)}</td><td><Badge color={{ happy: 'green', neutral: 'gray', at_risk: 'red' }[c.health_score]}>{titleCase(c.health_score)}</Badge></td><td className="num">{c.tickets}</td><td className="num">{c.open}</td><td className="num">{c.high_priority}</td><td className="num">{fmtHours(c.avg_resolution_hours)}</td><td className="num">{c.csat ?? '—'}</td></tr>)}</tbody></table></div></div>
  );
}

function SatisfactionReport({ d }) {
  const dist = [1, 2, 3, 4, 5].map((r) => ({ rating: `${r} ★`, value: Number(d.distribution.find((x) => Number(x.label) === r)?.value || 0) }));
  return (
    <div className="grid grid-2" style={{ gridTemplateColumns: '1fr 1.4fr' }}>
      <div className="card chart-card"><div className="card-header"><h3>Rating distribution</h3></div><div className="card-body"><ResponsiveContainer width="100%" height="100%"><BarChart data={dist} margin={{ top: 10, right: 10, left: -20 }}><XAxis dataKey="rating" tick={{ fontSize: 12 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="value" radius={[3, 3, 0, 0]}>{dist.map((x, i) => <Cell key={i} fill={['#dc2626', '#f59e0b', '#94a3b8', '#3b82f6', '#16a34a'][i]} />)}</Bar></BarChart></ResponsiveContainer></div></div>
      <div className="card"><div className="card-header"><h3>Recent feedback</h3></div><div className="card-body tight">
        <table className="table"><thead><tr><th>Rating</th><th>Ticket</th><th>Customer</th><th>Agent</th><th>Feedback</th></tr></thead>
          <tbody>{d.recent.map((r) => <tr key={r.id}><td><span style={{ color: 'var(--amber-500)' }}>{'★'.repeat(r.rating)}</span><span style={{ color: 'var(--gray-300)' }}>{'★'.repeat(5 - r.rating)}</span></td><td><a href={`/tickets/${r.ticket_id}`}>#{r.ticket_id}</a> <span className="small muted">{r.subject?.slice(0, 40)}</span></td><td>{r.contact_name}</td><td>{r.agent_name || '—'}</td><td className="small muted">{r.feedback || '—'}</td></tr>)}
            {d.recent.length === 0 && <tr><td colSpan={5} className="muted center">No ratings in this period.</td></tr>}</tbody></table>
      </div></div>
    </div>
  );
}
