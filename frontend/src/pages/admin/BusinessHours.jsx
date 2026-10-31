import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Clock } from 'lucide-react';
import { get, post, put, del, errorMessage } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { Spinner, Modal, Field, Badge, ConfirmDialog } from '../../components/ui.jsx';

const DAYS = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];

function HoursModal({ initial, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', description: '', time_zone: 'UTC', is_default: false, always_open: false, schedule: {}, holidays: [], ...initial });
  const [holiday, setHoliday] = useState({ name: '', date: '' });
  const setDay = (d, patch) => setForm({ ...form, schedule: { ...form.schedule, [d]: patch ? { ...(form.schedule[d] || { start: '09:00', end: '17:00' }), ...patch } : undefined } });
  const save = async () => {
    try { const r = initial?.id ? await put(`/settings/business-hours/${initial.id}`, form) : await post('/settings/business-hours', form); onSaved(r.data); } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <Modal title={initial?.id ? 'Edit business hours' : 'New business hours'} onClose={onClose} size="lg" footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={!form.name}>Save</button></>}>
      <div className="form-grid">
        <div className="form-row">
          <Field label="Name" required><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Time zone"><input className="input" value={form.time_zone} onChange={(e) => setForm({ ...form, time_zone: e.target.value })} placeholder="America/New_York" /></Field>
        </div>
        <Field label="Description"><input className="input" value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <div className="row gap-3"><label className="checkbox"><input type="checkbox" checked={form.always_open} onChange={(e) => setForm({ ...form, always_open: e.target.checked })} /> 24 × 7</label><label className="checkbox"><input type="checkbox" checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} /> Default</label></div>
        {!form.always_open && (
          <div className="col" style={{ gap: 6 }}>
            {DAYS.map(([k, label]) => {
              const d = form.schedule[k];
              return (
                <div key={k} className="schedule-row">
                  <label className="checkbox"><input type="checkbox" checked={!!d} onChange={(e) => setDay(k, e.target.checked ? {} : null)} />{label}</label>
                  {d ? <><input type="time" className="input input-sm" value={d.start} onChange={(e) => setDay(k, { start: e.target.value })} /><input type="time" className="input input-sm" value={d.end} onChange={(e) => setDay(k, { end: e.target.value })} /></> : <span className="muted small" style={{ gridColumn: 'span 2' }}>Closed</span>}
                  <span />
                </div>
              );
            })}
          </div>
        )}
        <Field label="Holidays">
          <div className="row wrap mb-2">{(form.holidays || []).map((h, i) => <span key={i} className="tag-chip">{h.name} · {h.date}<button type="button" onClick={() => setForm({ ...form, holidays: form.holidays.filter((_, j) => j !== i) })}>×</button></span>)}</div>
          <div className="row"><input className="input input-sm" placeholder="Holiday name" value={holiday.name} onChange={(e) => setHoliday({ ...holiday, name: e.target.value })} /><input type="date" className="input input-sm" value={holiday.date} onChange={(e) => setHoliday({ ...holiday, date: e.target.value })} /><button type="button" className="btn btn-sm" disabled={!holiday.name || !holiday.date} onClick={() => { setForm({ ...form, holidays: [...(form.holidays || []), holiday] }); setHoliday({ name: '', date: '' }); }}><Plus size={13} /></button></div>
        </Field>
      </div>
    </Modal>
  );
}

export default function BusinessHours() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [modal, setModal] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const load = () => get('/settings/business-hours').then((r) => setItems(r.data));
  useEffect(() => { load(); }, []);
  if (!items) return <Spinner block />;
  return (
    <div className="col gap-2">
      <div className="row-between"><div><h3>Business hours</h3><p className="muted small">Define when your team is available. Shown to customers and used for scheduling reports.</p></div>{isAdmin && <button className="btn btn-sm btn-primary" onClick={() => setModal({})}><Plus size={14} /> New schedule</button>}</div>
      {items.map((b) => (
        <div key={b.id} className="card">
          <div className="card-header"><div className="row"><Clock size={16} className="muted" /><h3>{b.name}</h3>{b.is_default && <Badge color="blue">Default</Badge>}<span className="muted small">· {b.time_zone}</span></div>{isAdmin && <div className="row"><button className="icon-btn" onClick={() => setModal(b)}><Pencil size={14} /></button>{!b.is_default && <button className="icon-btn" onClick={() => setConfirm(b)}><Trash2 size={14} /></button>}</div>}</div>
          <div className="card-body">
            {b.always_open ? <Badge color="green">Open 24 × 7</Badge> : <div className="grid" style={{ gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>{DAYS.map(([k, l]) => <div key={k} className="small center"><div className="strong">{l.slice(0, 3)}</div><div className="muted">{b.schedule[k] ? `${b.schedule[k].start}–${b.schedule[k].end}` : 'Closed'}</div></div>)}</div>}
            {b.holidays?.length > 0 && <div className="row wrap mt-2">{b.holidays.map((h, i) => <span key={i} className="tag-chip">{h.name} · {h.date}</span>)}</div>}
          </div>
        </div>
      ))}
      {modal && <HoursModal initial={modal} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); toast.success('Business hours saved'); }} />}
      {confirm && <ConfirmDialog title="Delete schedule?" message={`"${confirm.name}" will be removed.`} danger confirmLabel="Delete" onCancel={() => setConfirm(null)} onConfirm={async () => { try { await del(`/settings/business-hours/${confirm.id}`); load(); } catch (e) { toast.error(errorMessage(e)); } setConfirm(null); }} />}
    </div>
  );
}
