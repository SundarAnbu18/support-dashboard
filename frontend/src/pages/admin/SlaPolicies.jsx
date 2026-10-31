import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Timer } from 'lucide-react';
import { get, post, put, del, errorMessage } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { Spinner, Modal, Field, Badge, ConfirmDialog } from '../../components/ui.jsx';
import { PRIORITY_OPTIONS, TYPE_OPTIONS, SOURCE_OPTIONS, titleCase } from '../../utils/format.js';

const fmtMin = (m) => { m = Number(m || 0); if (m % 1440 === 0) return `${m / 1440}d`; if (m % 60 === 0) return `${m / 60}h`; return `${m}m`; };

function MinutesInput({ value, onChange }) {
  const units = [['minutes', 1], ['hours', 60], ['days', 1440]];
  const unit = value % 1440 === 0 && value >= 1440 ? 1440 : value % 60 === 0 && value >= 60 ? 60 : 1;
  const [u, setU] = useState(unit);
  return (
    <div className="row">
      <input className="input input-sm" type="number" min="1" style={{ width: 80 }} value={Math.round(value / u)} onChange={(e) => onChange(Number(e.target.value) * u)} />
      <select className="select select-sm" value={u} onChange={(e) => { const nu = Number(e.target.value); setU(nu); onChange(Math.max(1, Math.round(value / u)) * nu); }}>{units.map(([l, v]) => <option key={v} value={v}>{l}</option>)}</select>
    </div>
  );
}

function PolicyModal({ initial, groups, companies, defaults, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', description: '', is_active: true, ...initial, conditions: { priority: [], type: [], source: [], group_id: [], company_id: [], ...(initial?.conditions || {}) }, targets: { ...defaults, ...(initial?.targets || {}) } });
  const toggle = (k, v) => setForm({ ...form, conditions: { ...form.conditions, [k]: form.conditions[k].map(String).includes(String(v)) ? form.conditions[k].filter((x) => String(x) !== String(v)) : [...form.conditions[k], v] } });
  const save = async () => {
    try { const r = initial?.id ? await put(`/sla-policies/${initial.id}`, form) : await post('/sla-policies', form); onSaved(r.data); } catch (e) { toast.error(errorMessage(e)); }
  };
  const condList = (label, k, options) => (
    <Field label={label}><div className="row wrap">{options.map((o) => { const opt = typeof o === 'string' ? { value: o, label: titleCase(o) } : o; const on = form.conditions[k].map(String).includes(String(opt.value)); return <button type="button" key={opt.value} className={`btn btn-xs ${on ? 'btn-primary' : ''}`} onClick={() => toggle(k, opt.value)}>{opt.label}</button>; })}</div></Field>
  );
  return (
    <Modal title={initial?.id ? 'Edit SLA policy' : 'New SLA policy'} onClose={onClose} size="lg" footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={!form.name}>Save policy</button></>}>
      <div className="form-grid">
        <div className="form-row">
          <Field label="Name" required><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Description"><input className="input" value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        </div>
        {!form.is_default && (
          <div className="card" style={{ boxShadow: 'none' }}><div className="card-body form-grid">
            <h4>Apply to tickets matching (leave empty for any)</h4>
            {condList('Priority', 'priority', PRIORITY_OPTIONS)}{condList('Type', 'type', TYPE_OPTIONS)}{condList('Source', 'source', SOURCE_OPTIONS)}
            {condList('Group', 'group_id', groups.map((g) => ({ value: g.id, label: g.name })))}{condList('Company', 'company_id', companies.map((c) => ({ value: c.id, label: c.name })))}
          </div></div>
        )}
        <h4>Targets (calendar hours)</h4>
        <table className="table"><thead><tr><th>Priority</th><th>Respond within</th><th>Resolve within</th></tr></thead>
          <tbody>{['urgent', 'high', 'medium', 'low'].map((p) => (
            <tr key={p}><td><span className={`priority-dot priority-${p}`} /> {titleCase(p)}</td>
              <td><MinutesInput value={Number(form.targets[p]?.respond_within || 60)} onChange={(v) => setForm({ ...form, targets: { ...form.targets, [p]: { ...form.targets[p], respond_within: v } } })} /></td>
              <td><MinutesInput value={Number(form.targets[p]?.resolve_within || 240)} onChange={(v) => setForm({ ...form, targets: { ...form.targets, [p]: { ...form.targets[p], resolve_within: v } } })} /></td></tr>
          ))}</tbody></table>
        {!form.is_default && <label className="checkbox"><input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Active</label>}
      </div>
    </Modal>
  );
}

export default function SlaPolicies() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [groups, setGroups] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [modal, setModal] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const load = () => get('/sla-policies').then(setData);
  useEffect(() => { load(); get('/groups').then((r) => setGroups(r.data)); get('/companies', { per_page: 200 }).then((r) => setCompanies(r.data)); }, []);
  if (!data) return <Spinner block />;
  const label = (k, ids, lookup) => ids?.length ? `${k}: ${ids.map((i) => lookup ? lookup.find((x) => String(x.id) === String(i))?.name || i : titleCase(i)).join(', ')}` : null;
  return (
    <div className="col gap-2">
      <div className="row-between"><div><h3>SLA policies</h3><p className="muted small">Policies are evaluated top to bottom; the first match applies. The default policy catches everything else. Breaches are checked every minute.</p></div>{isAdmin && <button className="btn btn-sm btn-primary" onClick={() => setModal({})}><Plus size={14} /> New policy</button>}</div>
      {data.data.map((p) => (
        <div key={p.id} className="card">
          <div className="card-header"><div className="row"><Timer size={16} className="muted" /><h3>{p.name}</h3>{p.is_default && <Badge color="blue">Default</Badge>}{!p.is_active && <Badge color="gray">Inactive</Badge>}<span className="muted small">· {p.ticket_count} tickets</span></div>
            {isAdmin && <div className="row"><button className="icon-btn" onClick={() => setModal(p)}><Pencil size={14} /></button>{!p.is_default && <button className="icon-btn" onClick={() => setConfirm(p)}><Trash2 size={14} /></button>}</div>}</div>
          <div className="card-body">
            {p.description && <p className="muted small mb-2">{p.description}</p>}
            {!p.is_default && <div className="row wrap small mb-2">{[label('Priority', p.conditions.priority), label('Type', p.conditions.type), label('Source', p.conditions.source), label('Group', p.conditions.group_id, groups), label('Company', p.conditions.company_id, companies)].filter(Boolean).map((l) => <span key={l} className="badge badge-outline">{l}</span>)}{!Object.values(p.conditions).some((v) => v?.length) && <span className="muted">Matches all tickets</span>}</div>}
            <div className="grid grid-4">{['urgent', 'high', 'medium', 'low'].map((pr) => <div key={pr} className="small"><div className="row strong"><span className={`priority-dot priority-${pr}`} />{titleCase(pr)}</div><div className="muted">Respond {fmtMin(p.targets[pr]?.respond_within)} · Resolve {fmtMin(p.targets[pr]?.resolve_within)}</div></div>)}</div>
          </div>
        </div>
      ))}
      {modal && <PolicyModal initial={modal} groups={groups} companies={companies} defaults={data.defaults} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); toast.success('Policy saved'); }} />}
      {confirm && <ConfirmDialog title="Delete policy?" message={`Tickets using "${confirm.name}" keep their current due dates.`} danger confirmLabel="Delete" onCancel={() => setConfirm(null)} onConfirm={async () => { try { await del(`/sla-policies/${confirm.id}`); load(); } catch (e) { toast.error(errorMessage(e)); } setConfirm(null); }} />}
    </div>
  );
}
