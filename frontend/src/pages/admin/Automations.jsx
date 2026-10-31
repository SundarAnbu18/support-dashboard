import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Zap, Play, X } from 'lucide-react';
import { get, post, put, del, errorMessage } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { Spinner, Modal, Field, Select, Badge, ConfirmDialog, Tabs } from '../../components/ui.jsx';
import { titleCase, fmtRelative } from '../../utils/format.js';

const EVENT_LABELS = { ticket_created: 'When a ticket is created', ticket_updated: 'When a ticket is updated', time_trigger: 'Time-based (runs every 10 minutes)' };

function ValueInput({ field, value, onChange, agents, groups }) {
  if (!field) return <input className="input input-sm" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
  if (field.type === 'select') return <Select small value={value ?? ''} placeholder="—" onChange={onChange} options={field.options} />;
  if (field.type === 'group') return <Select small value={String(value ?? '')} placeholder="—" onChange={onChange} options={groups.map((g) => ({ value: String(g.id), label: g.name }))} />;
  if (field.type === 'agent') return <Select small value={String(value ?? '')} placeholder="—" onChange={onChange} options={agents.map((a) => ({ value: String(a.id), label: a.name }))} />;
  if (field.type === 'boolean') return <Select small value={String(value ?? 'true')} onChange={(v) => onChange(v === 'true')} options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />;
  if (field.type === 'number') return <input className="input input-sm" type="number" value={value ?? ''} onChange={(e) => onChange(Number(e.target.value))} />;
  return <input className="input input-sm" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
}

function RuleModal({ initial, meta, agents, groups, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', description: '', event: 'ticket_created', is_active: true, conditions: { match: 'all', rules: [] }, actions: [], ...initial });
  const rules = form.conditions.rules || [];
  const setRules = (r) => setForm({ ...form, conditions: { ...form.conditions, rules: r } });
  const setActions = (a) => setForm({ ...form, actions: a });
  const save = async () => {
    try { const r = initial?.id ? await put(`/automations/${initial.id}`, form) : await post('/automations', form); onSaved(r.data); } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <Modal title={initial?.id ? 'Edit automation' : 'New automation'} onClose={onClose} size="xl" footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={!form.name || !form.actions.length}>Save rule</button></>}>
      <div className="form-grid">
        <div className="form-row">
          <Field label="Rule name" required><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Runs"><Select value={form.event} onChange={(v) => setForm({ ...form, event: v })} options={meta.events.map((e) => ({ value: e, label: EVENT_LABELS[e] }))} /></Field>
        </div>
        <Field label="Description"><input className="input" value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>

        <div className="card" style={{ boxShadow: 'none' }}><div className="card-body form-grid">
          <div className="row-between"><h4 style={{ margin: 0 }}>Conditions</h4><div className="row small">Match <Select small value={form.conditions.match || 'all'} onChange={(v) => setForm({ ...form, conditions: { ...form.conditions, match: v } })} options={[{ value: 'all', label: 'all of the following' }, { value: 'any', label: 'any of the following' }]} /></div></div>
          {rules.length === 0 && <p className="muted small">No conditions: the rule applies to every ticket for this event.</p>}
          {rules.map((r, i) => {
            const field = meta.fields.find((f) => f.key === r.field);
            const noValue = ['is_empty', 'is_not_empty'].includes(r.operator);
            return (
              <div key={i} className="rule-row">
                <Select small value={r.field} onChange={(v) => setRules(rules.map((x, j) => (j === i ? { ...x, field: v, value: '' } : x)))} options={meta.fields.map((f) => ({ value: f.key, label: f.label }))} />
                <Select small value={r.operator} onChange={(v) => setRules(rules.map((x, j) => (j === i ? { ...x, operator: v } : x)))} options={meta.operators.map((o) => ({ value: o, label: titleCase(o) }))} />
                {noValue ? <span className="muted small">—</span> : <ValueInput field={field} value={r.value} onChange={(v) => setRules(rules.map((x, j) => (j === i ? { ...x, value: v } : x)))} agents={agents} groups={groups} />}
                <button className="icon-btn" onClick={() => setRules(rules.filter((_, j) => j !== i))}><X size={14} /></button>
              </div>
            );
          })}
          <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setRules([...rules, { field: 'priority', operator: 'is', value: 'urgent' }])}><Plus size={13} /> Add condition</button>
        </div></div>

        <div className="card" style={{ boxShadow: 'none' }}><div className="card-body form-grid">
          <h4>Actions</h4>
          {form.actions.map((a, i) => {
            const def = meta.actions.find((x) => x.key === a.type);
            const vf = def?.value === 'select' ? { type: 'select', options: def.options } : def?.value === 'group' ? { type: 'group' } : def?.value === 'agent' ? { type: 'agent' } : null;
            return (
              <div key={i} className="rule-row" style={{ gridTemplateColumns: '200px 1fr 36px' }}>
                <Select small value={a.type} onChange={(v) => setActions(form.actions.map((x, j) => (j === i ? { type: v, value: '' } : x)))} options={meta.actions.map((x) => ({ value: x.key, label: x.label }))} />
                {def?.value === 'none' ? <span className="muted small">No value needed</span> : def?.value === 'textarea' ? <textarea className="textarea" style={{ minHeight: 50 }} value={a.value || ''} onChange={(e) => setActions(form.actions.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} /> : <ValueInput field={vf} value={a.value} onChange={(v) => setActions(form.actions.map((x, j) => (j === i ? { ...x, value: v } : x)))} agents={agents} groups={groups} />}
                <button className="icon-btn" onClick={() => setActions(form.actions.filter((_, j) => j !== i))}><X size={14} /></button>
              </div>
            );
          })}
          <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setActions([...form.actions, { type: 'set_priority', value: 'high' }])}><Plus size={13} /> Add action</button>
        </div></div>
        <label className="checkbox"><input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Rule is active</label>
      </div>
    </Modal>
  );
}

export default function Automations() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [rules, setRules] = useState(null);
  const [meta, setMeta] = useState(null);
  const [agents, setAgents] = useState([]);
  const [groups, setGroups] = useState([]);
  const [event, setEvent] = useState('ticket_created');
  const [modal, setModal] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const load = () => get('/automations').then((r) => setRules(r.data));
  useEffect(() => { load(); get('/automations/meta').then((r) => setMeta(r.data)); get('/agents').then((r) => setAgents(r.data)); get('/groups').then((r) => setGroups(r.data)); }, []);
  if (!rules || !meta) return <Spinner block />;
  const shown = rules.filter((r) => r.event === event);
  const describeRule = (r) => { const f = meta.fields.find((x) => x.key === r.field); const v = f?.type === 'group' ? groups.find((g) => String(g.id) === String(r.value))?.name : f?.type === 'agent' ? agents.find((a) => String(a.id) === String(r.value))?.name : String(r.value); return `${f?.label || r.field} ${titleCase(r.operator).toLowerCase()} ${['is_empty', 'is_not_empty'].includes(r.operator) ? '' : v}`; };
  const describeAction = (a) => { const d = meta.actions.find((x) => x.key === a.type); const v = d?.value === 'group' ? groups.find((g) => String(g.id) === String(a.value))?.name : d?.value === 'agent' ? agents.find((x) => String(x.id) === String(a.value))?.name : d?.value === 'none' ? '' : String(a.value || ''); return `${d?.label || a.type}${v ? `: ${v}` : ''}`; };
  return (
    <div className="col gap-2">
      <div className="row-between"><div><h3>Automations</h3><p className="muted small">Rules run in order. Ticket-created and ticket-updated rules fire instantly; time-based rules sweep unresolved tickets every 10 minutes.</p></div>
        <div className="row">{isAdmin && event === 'time_trigger' && <button className="btn btn-sm" onClick={() => post('/automations/run-time-triggers').then((r) => toast.success(`Ran time triggers: ${r.tickets_updated} ticket(s) updated`)).catch((e) => toast.error(errorMessage(e)))}><Play size={14} /> Run now</button>}{isAdmin && <button className="btn btn-sm btn-primary" onClick={() => setModal({ event })}><Plus size={14} /> New rule</button>}</div></div>
      <Tabs active={event} onChange={setEvent} tabs={meta.events.map((e) => ({ key: e, label: EVENT_LABELS[e], count: rules.filter((r) => r.event === e).length }))} />
      {shown.length === 0 && <div className="card"><div className="empty"><Zap size={36} /><h3>No rules for this event</h3></div></div>}
      {shown.map((r) => (
        <div key={r.id} className="card">
          <div className="card-header"><div className="row"><Zap size={16} color={r.is_active ? 'var(--amber-500)' : 'var(--gray-300)'} /><h3>{r.name}</h3>{!r.is_active && <Badge color="gray">Inactive</Badge>}<span className="muted small">· ran {r.run_count}× {r.last_run_at && `· last ${fmtRelative(r.last_run_at)}`}</span></div>
            {isAdmin && <div className="row"><button className="btn btn-xs" onClick={() => put(`/automations/${r.id}`, { is_active: !r.is_active }).then(load)}>{r.is_active ? 'Disable' : 'Enable'}</button><button className="icon-btn" onClick={() => setModal(r)}><Pencil size={14} /></button><button className="icon-btn" onClick={() => setConfirm(r)}><Trash2 size={14} /></button></div>}</div>
          <div className="card-body grid grid-2">
            <div><h4>If {r.conditions.match === 'any' ? 'any' : 'all'} of</h4>{(r.conditions.rules || []).length === 0 ? <div className="muted small mt-1">Every ticket</div> : <ul className="small mt-1" style={{ margin: 0, paddingLeft: 18 }}>{r.conditions.rules.map((x, i) => <li key={i}>{describeRule(x)}</li>)}</ul>}</div>
            <div><h4>Then</h4><ul className="small mt-1" style={{ margin: 0, paddingLeft: 18 }}>{(r.actions || []).map((a, i) => <li key={i}>{describeAction(a)}</li>)}</ul></div>
          </div>
        </div>
      ))}
      {modal && <RuleModal initial={modal} meta={meta} agents={agents} groups={groups} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); toast.success('Rule saved'); }} />}
      {confirm && <ConfirmDialog title="Delete rule?" message={`"${confirm.name}" will stop running.`} danger confirmLabel="Delete" onCancel={() => setConfirm(null)} onConfirm={async () => { try { await del(`/automations/${confirm.id}`); load(); } catch (e) { toast.error(errorMessage(e)); } setConfirm(null); }} />}
    </div>
  );
}
