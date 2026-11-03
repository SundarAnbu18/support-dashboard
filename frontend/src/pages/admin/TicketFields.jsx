import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, ListPlus } from 'lucide-react';
import { get, post, put, del, errorMessage } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { Spinner, Modal, Field, Select, Badge, ConfirmDialog, EmptyState } from '../../components/ui.jsx';
import { titleCase } from '../../utils/format.js';

function FieldModal({ initial, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ label: '', field_type: 'text', options: [], required_for_agents: false, required_for_customers: false, visible_to_customers: true, ...initial });
  const [optText, setOptText] = useState(Array.isArray(initial?.options) ? initial.options.join('\n') : '');
  // Dependent fields are edited as one "Parent value: a, b" line per parent option.
  const [depText, setDepText] = useState(initial?.options && !Array.isArray(initial.options) ? Object.entries(initial.options).map(([k, v]) => `${k}: ${v.join(', ')}`).join('\n') : '');
  const parseDependent = () => Object.fromEntries(depText.split('\n').map((l) => l.split(':')).filter((p) => p.length > 1 && p[0].trim()).map(([k, ...v]) => [k.trim(), v.join(':').split(',').map((o) => o.trim()).filter(Boolean)]));
  const save = async () => {
    try {
      const payload = { ...form, options: form.field_type === 'dropdown' ? optText.split('\n').map((s) => s.trim()).filter(Boolean) : form.field_type === 'dependent' ? parseDependent() : [] };
      const r = initial?.id ? await put(`/settings/ticket-fields/${initial.id}`, payload) : await post('/settings/ticket-fields', payload);
      onSaved(r.data);
    } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <Modal title={initial?.id ? 'Edit field' : 'New ticket field'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={!form.label}>Save</button></>}>
      <div className="form-grid">
        <div className="form-row">
          <Field label="Label" required><input className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></Field>
          <Field label="Type"><Select value={form.field_type} onChange={(v) => setForm({ ...form, field_type: v })} options={['text', 'textarea', 'number', 'decimal', 'dropdown', 'dependent', 'checkbox', 'date']} /></Field>
        </div>
        {form.field_type === 'dependent' && <>
          <Field label="Parent field key" help="The dropdown this field depends on, such as category"><input className="input" value={form.parent_field || ''} onChange={(e) => setForm({ ...form, parent_field: e.target.value })} /></Field>
          <Field label="Options" help="One line per parent value. Example: Certificates: Name change, Download issue"><textarea className="textarea" value={depText} onChange={(e) => setDepText(e.target.value)} /></Field>
        </>}
        {form.field_type === 'dropdown' && <Field label="Options" help="One per line"><textarea className="textarea" value={optText} onChange={(e) => setOptText(e.target.value)} /></Field>}
        <label className="checkbox"><input type="checkbox" checked={form.visible_to_customers} onChange={(e) => setForm({ ...form, visible_to_customers: e.target.checked })} /> Visible to customers in the portal</label>
        <label className="checkbox"><input type="checkbox" checked={form.required_for_agents} onChange={(e) => setForm({ ...form, required_for_agents: e.target.checked })} /> Required for agents</label>
        <label className="checkbox"><input type="checkbox" checked={form.required_for_customers} onChange={(e) => setForm({ ...form, required_for_customers: e.target.checked })} /> Required for customers</label>
      </div>
    </Modal>
  );
}

export default function TicketFields() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [fields, setFields] = useState(null);
  const [modal, setModal] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const load = () => get('/settings/ticket-fields').then((r) => setFields(r.data));
  useEffect(() => { load(); }, []);
  if (!fields) return <Spinner block />;
  return (
    <div className="card">
      <div className="card-header"><div><h3>Custom ticket fields</h3><p className="muted small">Shown on the ticket form and properties panel alongside the built-in fields.</p></div>{isAdmin && <button className="btn btn-sm btn-primary" onClick={() => setModal({})}><Plus size={14} /> New field</button>}</div>
      {fields.length === 0 ? <EmptyState icon={ListPlus} title="No custom fields" /> : (
        <table className="table"><thead><tr><th>Label</th><th>Key</th><th>Type</th><th>Options</th><th>Customers</th><th>Required</th><th /></tr></thead>
          <tbody>{fields.map((f) => (
            <tr key={f.id}><td className="strong">{f.label}</td><td className="muted small">{f.name}</td><td><Badge color="blue">{titleCase(f.field_type)}</Badge></td><td className="small muted">{Array.isArray(f.options) ? f.options.join(', ') || '—' : `Depends on ${f.parent_field}`}</td>
              <td>{f.visible_to_customers ? 'Visible' : 'Hidden'}</td><td className="small">{[f.required_for_agents && 'agents', f.required_for_customers && 'customers'].filter(Boolean).join(', ') || '—'}</td>
              <td>{isAdmin && <div className="row" style={{ justifyContent: 'flex-end' }}><button className="icon-btn" onClick={() => setModal(f)}><Pencil size={14} /></button><button className="icon-btn" onClick={() => setConfirm(f)}><Trash2 size={14} /></button></div>}</td></tr>
          ))}</tbody></table>
      )}
      {modal && <FieldModal initial={modal} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); toast.success('Field saved'); }} />}
      {confirm && <ConfirmDialog title="Delete field?" message={`Values stored for "${confirm.label}" stay on tickets but are no longer shown.`} danger confirmLabel="Delete" onCancel={() => setConfirm(null)} onConfirm={async () => { try { await del(`/settings/ticket-fields/${confirm.id}`); load(); } catch (e) { toast.error(errorMessage(e)); } setConfirm(null); }} />}
    </div>
  );
}
