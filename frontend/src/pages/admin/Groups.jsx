import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, UsersRound } from 'lucide-react';
import { get, post, put, del, errorMessage } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { Spinner, Avatar, Modal, Field, Select, ConfirmDialog, EmptyState } from '../../components/ui.jsx';

function GroupModal({ initial, agents, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', description: '', auto_assign: false, escalate_to_user_id: '', ...initial, member_ids: (initial?.members || []).map((m) => m.id) });
  const save = async () => {
    try {
      const payload = { ...form, escalate_to_user_id: form.escalate_to_user_id || null };
      const r = initial?.id ? await put(`/groups/${initial.id}`, payload) : await post('/groups', payload);
      onSaved(r.data);
    } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <Modal title={initial?.id ? 'Edit group' : 'New group'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={!form.name}>Save</button></>}>
      <div className="form-grid">
        <Field label="Name" required><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Description"><input className="input" value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <Field label="Escalation contact" help="Notified when tickets in this group breach SLA."><Select value={String(form.escalate_to_user_id || '')} placeholder="—" onChange={(v) => setForm({ ...form, escalate_to_user_id: v })} options={agents.map((a) => ({ value: String(a.id), label: a.name }))} /></Field>
        <label className="checkbox"><input type="checkbox" checked={form.auto_assign} onChange={(e) => setForm({ ...form, auto_assign: e.target.checked })} /> Automatically assign new tickets to the least-loaded member (round robin)</label>
        <Field label="Members"><div className="col" style={{ gap: 4, maxHeight: 220, overflowY: 'auto' }}>{agents.map((a) => <label key={a.id} className="checkbox"><input type="checkbox" checked={form.member_ids.includes(a.id)} onChange={(e) => setForm({ ...form, member_ids: e.target.checked ? [...form.member_ids, a.id] : form.member_ids.filter((x) => x !== a.id) })} />{a.name} <span className="muted small">{a.email}</span></label>)}</div></Field>
      </div>
    </Modal>
  );
}

export default function Groups() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [groups, setGroups] = useState(null);
  const [agents, setAgents] = useState([]);
  const [modal, setModal] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const load = () => get('/groups').then((r) => setGroups(r.data));
  useEffect(() => { load(); get('/agents', { active: 'true' }).then((r) => setAgents(r.data)); }, []);
  if (!groups) return <Spinner block />;
  return (
    <div className="col gap-2">
      <div className="row-between"><h3>Groups ({groups.length})</h3>{isAdmin && <button className="btn btn-sm btn-primary" onClick={() => setModal({})}><Plus size={14} /> New group</button>}</div>
      {groups.length === 0 && <div className="card"><EmptyState icon={UsersRound} title="No groups yet" /></div>}
      <div className="grid grid-2">
        {groups.map((g) => (
          <div key={g.id} className="card">
            <div className="card-header"><div><h3>{g.name}</h3><div className="muted small">{g.description}</div></div>
              {isAdmin && <div className="row"><button className="icon-btn" onClick={() => setModal(g)}><Pencil size={14} /></button><button className="icon-btn" onClick={() => setConfirm(g)}><Trash2 size={14} /></button></div>}</div>
            <div className="card-body col" style={{ gap: 10 }}>
              <div className="row wrap small"><span className="badge badge-gray">{g.open_tickets} open tickets</span>{g.auto_assign && <span className="badge badge-blue">Round-robin on</span>}</div>
              <div className="col" style={{ gap: 6 }}>{g.members.length === 0 && <span className="muted small">No members</span>}{g.members.map((m) => <div key={m.id} className="row" style={{ gap: 8 }}><Avatar name={m.name} src={m.avatar_url} size="sm" /><span className="small">{m.name}</span><span className="muted small">{m.email}</span></div>)}</div>
            </div>
          </div>
        ))}
      </div>
      {modal && <GroupModal initial={modal} agents={agents} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); toast.success('Group saved'); }} />}
      {confirm && <ConfirmDialog title="Delete group?" message={`Tickets in "${confirm.name}" will be left without a group.`} danger confirmLabel="Delete" onCancel={() => setConfirm(null)} onConfirm={async () => { try { await del(`/groups/${confirm.id}`); load(); } catch (e) { toast.error(errorMessage(e)); } setConfirm(null); }} />}
    </div>
  );
}
