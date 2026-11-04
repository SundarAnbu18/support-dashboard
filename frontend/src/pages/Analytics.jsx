import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { Download, Play, Save, Star, Trash2, Trophy } from 'lucide-react';
import { get, post, put, del, downloadFile, errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Avatar, Badge, EmptyState, Field, Modal, Select, Spinner } from '../components/ui.jsx';
import { STATUS_OPTIONS, PRIORITY_OPTIONS, titleCase } from '../utils/format.js';

const COLORS = ['#BF2026', '#059669', '#d97706', '#7c3aed'];
const TIME = ['day', 'week', 'month', 'hour'];
const EMPTY = { metrics: ['tickets_created'], dimension: 'status', days: 30, chart: 'bar' };

export default function ReportBuilder() {
  const { user } = useAuth();
  const toast = useToast();
  const [meta, setMeta] = useState(null);
  const [lookups, setLookups] = useState({ groups: [], products: [] });
  const [saved, setSaved] = useState([]);
  const [config, setConfig] = useState(EMPTY);
  const [active, setActive] = useState(null);
  const [result, setResult] = useState(null);
  const [saveForm, setSaveForm] = useState(null);
  const canExport = user?.privileges?.includes('export_data');
  const loadSaved = () => get('/analytics/reports').then((r) => setSaved(r.data));
  useEffect(() => {
    get('/analytics/report-meta').then((r) => setMeta(r.data));
    Promise.all([get('/groups'), get('/config/products')]).then(([g, p]) => setLookups({ groups: g.data, products: p.data }));
    loadSaved();
  }, []);

  const run = async (cfg = config) => {
    try { const r = await post('/analytics/run', cfg); setResult(r); } catch (e) { toast.error(errorMessage(e)); }
  };
  useEffect(() => { run(EMPTY); }, []); // eslint-disable-line
  const open = (r) => { const cfg = { ...EMPTY, ...r.config }; setConfig(cfg); setActive(r); run(cfg); };
  const toggleMetric = (k) => setConfig((c) => ({ ...c, metrics: c.metrics.includes(k) ? c.metrics.filter((m) => m !== k) : [...c.metrics, k] }));
  const save = async () => {
    try {
      const payload = { ...saveForm, config, recipients: String(saveForm.recipients || '').split(',').map((s) => s.trim()).filter(Boolean) };
      const r = saveForm.id ? await put(`/analytics/reports/${saveForm.id}`, payload) : await post('/analytics/reports', payload);
      setActive(r.data); setSaveForm(null); loadSaved(); toast.success('Report saved');
    } catch (e) { toast.error(errorMessage(e)); }
  };
  if (!meta) return <div className="content"><Spinner block /></div>;
  const labelFor = (k) => meta.metrics.find((m) => m.key === k)?.label || k;
  const rows = (result?.data || []).map((r) => ({ ...r, label: titleCase(r.label), ...Object.fromEntries(result.metrics.map((m) => [m, r[m] === null ? null : Number(r[m])])) }));
  const Chart = config.chart === 'line' ? LineChart : BarChart;

  return (
    <div className="content">
      <div className="page-header">
        <div><h1>{active?.name || 'Custom report'}</h1><p className="sub">Build a report from any metric, then save, share or schedule it. <Link to="/reports">Curated reports</Link></p></div>
        <div className="page-actions">
          {canExport && <button className="btn" onClick={() => downloadFile('/analytics/run.csv', 'report.csv', config).catch((e) => toast.error(errorMessage(e)))}><Download size={14} /> Export CSV</button>}
          <button className="btn btn-primary" onClick={() => setSaveForm(active ? { ...active, recipients: (active.recipients || []).join(', ') } : { name: '', folder: '', is_shared: false, schedule: '', recipients: '' })}><Save size={14} /> Save</button>
        </div>
      </div>
      <div className="detail-layout" style={{ gridTemplateColumns: '280px minmax(0, 1fr)' }}>
        <aside className="col gap-2">
          <div className="card"><div className="card-header"><h3>Configure</h3></div><div className="card-body form-grid">
            <Field label="Metrics"><div className="col" style={{ gap: 4 }}>{meta.metrics.map((m) => <label key={m.key} className="checkbox small"><input type="checkbox" checked={config.metrics.includes(m.key)} onChange={() => toggleMetric(m.key)} /> {m.label}</label>)}</div></Field>
            <Field label="Group by"><Select value={config.dimension} onChange={(v) => setConfig({ ...config, dimension: v, chart: TIME.includes(v) ? 'line' : 'bar' })} options={meta.dimensions.map((d) => ({ value: d.key, label: d.label }))} /></Field>
            <Field label="Created in the last"><Select value={String(config.days || '')} placeholder="All time" onChange={(v) => setConfig({ ...config, days: v ? Number(v) : undefined })} options={[7, 30, 90, 365].map((d) => ({ value: String(d), label: `${d} days` }))} /></Field>
            <Field label="Status"><Select value={config.status || ''} placeholder="Any" onChange={(v) => setConfig({ ...config, status: v || undefined })} options={STATUS_OPTIONS} /></Field>
            <Field label="Priority"><Select value={config.priority || ''} placeholder="Any" onChange={(v) => setConfig({ ...config, priority: v || undefined })} options={PRIORITY_OPTIONS} /></Field>
            <Field label="Group"><Select value={config.group_id || ''} placeholder="Any" onChange={(v) => setConfig({ ...config, group_id: v || undefined })} options={lookups.groups.map((g) => ({ value: String(g.id), label: g.name }))} /></Field>
            <Field label="Product"><Select value={config.product_id || ''} placeholder="Any" onChange={(v) => setConfig({ ...config, product_id: v || undefined })} options={lookups.products.map((p) => ({ value: String(p.id), label: p.name }))} /></Field>
            <Field label="Chart"><Select value={config.chart} onChange={(v) => setConfig({ ...config, chart: v })} options={[{ value: 'bar', label: 'Bars' }, { value: 'line', label: 'Line' }]} /></Field>
            <button className="btn btn-primary" disabled={!config.metrics.length} onClick={() => run()}><Play size={14} /> Run report</button>
          </div></div>
          <div className="card"><div className="card-header"><h3>Saved reports</h3></div><div className="card-body view-list" style={{ padding: 10 }}>
            {saved.length === 0 && <div className="muted small" style={{ padding: 8 }}>Nothing saved yet.</div>}
            {saved.map((r) => (
              <button key={r.id} className={active?.id === r.id ? 'active' : ''} onClick={() => open(r)}>
                <span className="truncate">{r.name}{r.schedule && <span className="muted small"> · {r.schedule}</span>}</span>
                <span className="row" style={{ gap: 4 }}>
                  <Star size={13} fill={r.is_favorite ? '#d97706' : 'none'} color="#d97706" onClick={(e) => { e.stopPropagation(); put(`/analytics/reports/${r.id}`, { is_favorite: !r.is_favorite }).then(loadSaved); }} />
                  {(r.user_id === user.id || user.role === 'admin') && <Trash2 size={13} className="muted" onClick={(e) => { e.stopPropagation(); del(`/analytics/reports/${r.id}`).then(() => { if (active?.id === r.id) setActive(null); loadSaved(); }); }} />}
                </span>
              </button>
            ))}
          </div></div>
        </aside>
        <section className="col gap-2">
          {!result ? <Spinner block /> : rows.length === 0 ? <div className="card"><EmptyState title="No tickets match these filters" /></div> : <>
            <div className="card chart-card" style={{ height: 340 }}><div className="card-body"><ResponsiveContainer width="100%" height="100%">
              <Chart data={rows} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip />
                {result.metrics.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
                {result.metrics.map((m, i) => (config.chart === 'line'
                  ? <Line key={m} type="monotone" dataKey={m} name={labelFor(m)} stroke={COLORS[i % 4]} strokeWidth={2} dot={false} connectNulls />
                  : <Bar key={m} dataKey={m} name={labelFor(m)} fill={COLORS[i % 4]} radius={[3, 3, 0, 0]} />))}
              </Chart>
            </ResponsiveContainer></div></div>
            <div className="card"><div className="table-wrap"><table className="table">
              <thead><tr><th>{meta.dimensions.find((d) => d.key === config.dimension)?.label}</th>{result.metrics.map((m) => <th key={m} className="num">{labelFor(m)}</th>)}</tr></thead>
              <tbody>{rows.map((r) => <tr key={r.label}><td className="strong">{r.label}</td>{result.metrics.map((m) => <td key={m} className="num">{r[m] ?? '—'}</td>)}</tr>)}</tbody>
            </table></div></div>
          </>}
        </section>
      </div>
      {saveForm && (
        <Modal title="Save report" onClose={() => setSaveForm(null)} footer={<><button className="btn" onClick={() => setSaveForm(null)}>Cancel</button><button className="btn btn-primary" disabled={!saveForm.name} onClick={save}>Save</button></>}>
          <div className="form-grid">
            <Field label="Name" required><input className="input" value={saveForm.name} onChange={(e) => setSaveForm({ ...saveForm, name: e.target.value })} /></Field>
            <Field label="Folder"><input className="input" value={saveForm.folder || ''} onChange={(e) => setSaveForm({ ...saveForm, folder: e.target.value })} /></Field>
            <label className="checkbox"><input type="checkbox" checked={!!saveForm.is_shared} onChange={(e) => setSaveForm({ ...saveForm, is_shared: e.target.checked })} /> Share with all agents</label>
            <div className="form-row">
              <Field label="Email schedule"><Select value={saveForm.schedule || ''} placeholder="Not scheduled" onChange={(v) => setSaveForm({ ...saveForm, schedule: v })} options={['daily', 'weekly']} /></Field>
              <Field label="Recipients" help="Comma separated"><input className="input" value={saveForm.recipients} onChange={(e) => setSaveForm({ ...saveForm, recipients: e.target.value })} /></Field>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function Arcade() {
  const [period, setPeriod] = useState('month');
  const [data, setData] = useState(null);
  useEffect(() => { get('/analytics/arcade', { period }).then(setData); }, [period]);
  if (!data) return <div className="content"><Spinner block /></div>;
  const s = data.settings;
  return (
    <div className="content">
      <div className="page-header">
        <div><h1><Trophy size={20} style={{ verticalAlign: -3 }} /> Arcade</h1><p className="sub">{s.resolve_points} points per resolved ticket, +{s.sla_bonus} within SLA, +{s.fast_reply_bonus} for a fast first reply, +{s.csat_bonus} for a happy customer.</p></div>
        <div className="page-actions"><Select value={period} onChange={setPeriod} options={[{ value: 'week', label: 'Last 7 days' }, { value: 'month', label: 'Last 30 days' }, { value: 'quarter', label: 'Last 90 days' }]} /></div>
      </div>
      <div className="card"><div className="table-wrap"><table className="table">
        <thead><tr><th style={{ width: 40 }}>#</th><th>Agent</th><th>Level</th><th className="num">Resolved</th><th className="num">Within SLA</th><th className="num">Fast replies</th><th className="num">Happy customers</th><th className="num">Points</th></tr></thead>
        <tbody>{data.data.map((a, i) => (
          <tr key={a.id}><td className="strong">{i + 1}</td><td><div className="row" style={{ gap: 10 }}><Avatar name={a.name} src={a.avatar_url} />{a.name}</div></td><td><Badge color="purple">{a.level}</Badge></td>
            <td className="num">{a.resolved}</td><td className="num">{a.within_sla}</td><td className="num">{a.fast_replies}</td><td className="num">{a.happy_customers}</td><td className="num strong">{a.points}</td></tr>
        ))}</tbody>
      </table></div></div>
    </div>
  );
}
