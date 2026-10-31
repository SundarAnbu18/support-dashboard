import { useEffect, useState } from 'react';
import { Plus, Pencil, UserX } from 'lucide-react';
import { get, post, put, del, errorMessage } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { Spinner, Avatar, Modal, Field, Select, Badge, ConfirmDialog } from '../../components/ui.jsx';
import { fmtRelative } from '../../utils/format.js';

function AgentModal({ initial, groups, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'agent', job_title: '', phone: '', is_active: true, group_ids: (initial?.groups || []).map((g) => g.id), ...initial });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const save = async () => {
    try {
      const payload = { ...form }; if (!payload.password) delete payload.password;
      const r = initial?.id ? await put(`/agents/${initial.id}`, payload) : await post('/agents', payload);
      onSaved(r.data);
    } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <Modal title={initial?.id ? 'Edit agent' : 'Add agent'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={!form.name || !form.email || (!initial?.id && !form.password)}>Save</button></>}>
      <div className="form-grid">
        <div className="form-row">
          <Field label="Name" required><input className="input" value={form.name} onChange={set('name')} /></Field>
          <Field label="Email" required><input className="input" type="email" value={form.email} onChange={set('email')} /></Field>
        </div>
        <div className="form-row">
          <Field label="Role"><Select value={form.role} onChange={(v) => setForm({ ...form, role: v })} options={['agent', 'admin']} /></Field>
          <Field label={initial?.id ? 'New password (optional)' : 'Password'} required={!initial?.id}><input className="input" type="password" value={form.password || ''} onChange={set('password')} minLength={6} /></Field>
        </div>
        <div className="form-row">
          <Field label="Job title"><input className="input" value={form.job_title || ''} onChange={set('job_title')} /></Field>
          <Field label="Phone"><input className="input" value={form.phone || ''} onChange={set('phone')} /></Field>
        </div>
        <Field label="Groups"><div className="col" style={{ gap: 4 }}>{groups.map((g) => <label key={g.id} className="checkbox"><input type="checkbox" checked={form.group_ids.includes(g.id)} onChange={(e) => setForm({ ...form, group_ids: e.target.checked ? [...form.group_ids, g.id] : form.group_ids.filter((x) => x !== g.id) })} />{g.name}</label>)}</div></Field>
        {initial?.id && <label className="checkbox"><input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Active</label>}
      </div>
    </Modal>
  );
}

export default function Agents() {
  const { isAdmin, user } = useAuth();
  const toast = useToast();
  const [agents, setAgents] = useState(null);
  const [groups, setGroups] = useState([]);
  const [modal, setModal] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const load = () => get('/agents').then((r) => setAgents(r.data));
  useEffect(() => { load(); get('/groups').then((r) => setGroups(r.data)); }, []);
  if (!agents) return <Spinner block />;
  return (
    <div className="card">
      <div className="card-header"><h3>Agents ({agents.length})</h3>{isAdmin && <button className="btn btn-sm btn-primary" onClick={() => setModal({})}><Plus size={14} /> Add agent</button>}</div>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Agent</th><th>Role</th><th>Groups</th><th className="num">Open tickets</th><th>Last login</th><th>Status</th><th /></tr></thead>
        <tbody>{agents.map((a) => (
          <tr key={a.id}>
            <td><div className="row" style={{ gap: 10 }}><Avatar name={a.name} src={a.avatar_url} /><div><div className="strong">{a.name}</div><div className="muted small">{a.email}{a.job_title && ` · ${a.job_title}`}</div></div></div></td>
            <td><Badge color={a.role === 'admin' ? 'purple' : 'blue'}>{a.role}</Badge></td>
            <td><div className="row wrap">{a.groups.map((g) => <span key={g.id} className="tag-chip">{g.name}</span>)}</div></td>
            <td className="num">{a.open_tickets}</td><td className="muted small">{a.last_login_at ? fmtRelative(a.last_login_at) : 'Never'}</td>
            <td>{a.is_active ? <Badge color="green">Active</Badge> : <Badge color="gray">Deactivated</Badge>}</td>
            <td><div className="row">{(isAdmin || a.id === user.id) && <button className="icon-btn" onClick={() => setModal(a)}><Pencil size={14} /></button>}{isAdmin && a.is_active && a.id !== user.id && <button className="icon-btn" title="Deactivate" onClick={() => setConfirm(a)}><UserX size={14} /></button>}</div></td>
          </tr>
        ))}</tbody>
      </table></div>
      {modal && <AgentModal initial={modal} groups={groups} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); toast.success('Agent saved'); }} />}
      {confirm && <ConfirmDialog title="Deactivate agent?" message={`${confirm.name} will no longer be able to sign in. Their open tickets become unassigned.`} danger confirmLabel="Deactivate" onCancel={() => setConfirm(null)} onConfirm={async () => { try { await del(`/agents/${confirm.id}`); load(); } catch (e) { toast.error(errorMessage(e)); } setConfirm(null); }} />}
    </div>
  );
}
