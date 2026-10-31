import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, MessageSquareText, Copy } from 'lucide-react';
import { get, post, put, del, errorMessage } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { Spinner, EmptyState, Modal, Field, Select, Badge, ConfirmDialog } from '../components/ui.jsx';

function CannedModal({ initial, groups, onClose, onSaved }) {
  const [form, setForm] = useState({ title: '', content: '', folder: 'General', visibility: 'all', group_id: '', ...initial });
  const toast = useToast();
  const save = async () => {
    try {
      const payload = { ...form, group_id: form.visibility === 'group' ? form.group_id || null : null };
      const r = initial?.id ? await put(`/canned-responses/${initial.id}`, payload) : await post('/canned-responses', payload);
      onSaved(r.data);
    } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <Modal title={initial?.id ? 'Edit canned response' : 'New canned response'} onClose={onClose} size="lg" footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={!form.title || !form.content}>Save</button></>}>
      <div className="form-grid">
        <div className="form-row">
          <Field label="Title" required><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} autoFocus /></Field>
          <Field label="Folder"><input className="input" value={form.folder} onChange={(e) => setForm({ ...form, folder: e.target.value })} list="folders" /></Field>
        </div>
        <div className="form-row">
          <Field label="Available to"><Select value={form.visibility} onChange={(v) => setForm({ ...form, visibility: v })} options={[{ value: 'all', label: 'All agents' }, { value: 'group', label: 'A specific group' }, { value: 'personal', label: 'Only me' }]} /></Field>
          {form.visibility === 'group' && <Field label="Group"><Select value={String(form.group_id || '')} placeholder="Select group" onChange={(v) => setForm({ ...form, group_id: v })} options={groups.map((g) => ({ value: String(g.id), label: g.name }))} /></Field>}
        </div>
        <Field label="Content" required help="Placeholders: {{requester_name}}, {{ticket_id}}, {{agent_name}}, {{subject}}"><textarea className="textarea" style={{ minHeight: 200 }} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

export default function CannedResponses() {
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [groups, setGroups] = useState([]);
  const [modal, setModal] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [folder, setFolder] = useState('');
  const load = () => get('/canned-responses').then((r) => setItems(r.data));
  useEffect(() => { load(); get('/groups').then((r) => setGroups(r.data)); }, []);
  if (!items) return <div className="content"><Spinner block /></div>;
  const folders = [...new Set(items.map((i) => i.folder))].sort();
  const shown = items.filter((i) => !folder || i.folder === folder);
  return (
    <div className="content">
      <div className="page-header">
        <div><h1>Canned responses</h1><p className="sub">Pre-written replies agents can insert with one click.</p></div>
        <div className="page-actions"><Select value={folder} placeholder="All folders" onChange={setFolder} options={folders.map((f) => ({ value: f, label: f }))} /><button className="btn btn-primary" onClick={() => setModal({})}><Plus size={16} /> New response</button></div>
      </div>
      <datalist id="folders">{folders.map((f) => <option key={f} value={f} />)}</datalist>
      {shown.length === 0 ? <div className="card"><EmptyState icon={MessageSquareText} title="No canned responses" /></div> : (
        <div className="grid grid-2">
          {shown.map((c) => (
            <div key={c.id} className="card">
              <div className="card-header"><div><h3>{c.title}</h3><div className="muted small">{c.folder} · used {c.usage_count}×{c.owner_name && ` · by ${c.owner_name}`}</div></div>
                <div className="row"><Badge color={c.visibility === 'all' ? 'blue' : c.visibility === 'group' ? 'purple' : 'gray'}>{c.visibility === 'group' ? c.group_name || 'Group' : c.visibility === 'all' ? 'All agents' : 'Personal'}</Badge>
                  <button className="icon-btn" title="Copy" onClick={() => { navigator.clipboard.writeText(c.content); toast.info('Copied'); }}><Copy size={14} /></button>
                  <button className="icon-btn" onClick={() => setModal(c)}><Pencil size={14} /></button><button className="icon-btn" onClick={() => setConfirm(c)}><Trash2 size={14} /></button></div></div>
              <div className="card-body"><pre className="small" style={{ color: 'var(--gray-700)', maxHeight: 160, overflow: 'hidden' }}>{c.content}</pre></div>
            </div>
          ))}
        </div>
      )}
      {modal && <CannedModal initial={modal} groups={groups} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); toast.success('Saved'); }} />}
      {confirm && <ConfirmDialog title="Delete response?" message={`"${confirm.title}" will be removed.`} danger confirmLabel="Delete" onCancel={() => setConfirm(null)} onConfirm={async () => { await del(`/canned-responses/${confirm.id}`); setConfirm(null); load(); }} />}
    </div>
  );
}
