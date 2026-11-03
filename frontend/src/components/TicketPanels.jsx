import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Link2, ListTodo, MessagesSquare, Plus, Trash2, Unlink, X } from 'lucide-react';
import { get, post, patch, del, errorMessage } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { Field, Modal, StatusBadge, useDebounce } from './ui.jsx';
import { fmtRelative } from '../utils/format.js';

const TicketLine = ({ t, action }) => (
  <div className="row-between small" style={{ gap: 8 }}>
    <Link className="truncate" to={`/tickets/${t.id}`}>#{t.id} {t.subject}</Link>
    <span className="row" style={{ gap: 4, flexShrink: 0 }}><StatusBadge status={t.status} />{action}</span>
  </div>
);

function TicketPicker({ title, exclude, onPick, onClose, help }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const dq = useDebounce(q, 250);
  useEffect(() => { if (!dq.trim()) { setResults([]); return; } get('/tickets', { q: dq, per_page: 8, view: 'all' }).then((r) => setResults(r.data.filter((t) => t.id !== exclude))); }, [dq, exclude]);
  return (
    <Modal title={title} onClose={onClose}>
      {help && <p className="muted small mb-2">{help}</p>}
      <input className="input mb-2" autoFocus placeholder="Search by subject or #id" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="col" style={{ gap: 6 }}>{results.map((t) => <button key={t.id} className="btn" style={{ justifyContent: 'flex-start' }} onClick={() => onPick(t)}>#{t.id} <span className="truncate">{t.subject}</span></button>)}</div>
    </Modal>
  );
}

function Panel({ title, icon: Icon, count, children, defaultOpen }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="card sidebar-card">
      <button className="card-header" style={{ width: '100%', background: 'none', border: 0, cursor: 'pointer', borderBottom: open ? undefined : 0 }} aria-expanded={open} onClick={() => setOpen(!open)}>
        <h3 className="row" style={{ gap: 8 }}><Icon size={15} /> {title}{count > 0 && <span className="badge badge-blue">{count}</span>}</h3>
        <ChevronRight size={15} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .1s' }} />
      </button>
      {open && <div className="card-body col" style={{ gap: 10 }}>{children}</div>}
    </div>
  );
}

export default function TicketPanels({ ticketId, reloadToken, onChanged, agents = [] }) {
  const toast = useToast();
  const [x, setX] = useState(null);
  const [picker, setPicker] = useState(null);
  const [todo, setTodo] = useState('');
  const [thread, setThread] = useState(null);
  const [replies, setReplies] = useState({});
  const load = () => get(`/tickets/${ticketId}/extras`).then((r) => setX(r.data)).catch(() => {});
  useEffect(() => { load(); }, [ticketId, reloadToken]); // eslint-disable-line
  if (!x) return null;
  const run = (promise, after) => promise.then(() => { load(); after?.(); onChanged?.(); }).catch((e) => toast.error(errorMessage(e)));
  const addTodo = () => { if (todo.trim()) run(post(`/tickets/${ticketId}/todos`, { title: todo }), () => setTodo('')); };

  return (
    <>
      <Panel title="Parent & child tickets" icon={Link2} count={x.children.length + (x.parent ? 1 : 0)}>
        {x.parent && <><h4>Parent</h4><TicketLine t={x.parent} action={<button className="icon-btn" aria-label="Remove parent" onClick={() => run(post(`/tickets/${ticketId}/parent`, { parent_id: null }))}><X size={12} /></button>} /></>}
        {x.children.length > 0 && <h4>Children</h4>}
        {x.children.map((t) => <TicketLine key={t.id} t={t} />)}
        {!x.parent && <div className="row wrap">
          <Link className="btn btn-sm" to={`/tickets/new?parent_ticket_id=${ticketId}`}><Plus size={13} /> Add child</Link>
          {x.children.length === 0 && <button className="btn btn-sm" onClick={() => setPicker('parent')}>Link to parent</button>}
        </div>}
      </Panel>

      <Panel title="Linked tickets" icon={Link2} count={x.links.length}>
        {x.links.map((t) => <TicketLine key={t.id} t={t} action={<button className="icon-btn" aria-label={`Unlink ticket ${t.id}`} onClick={() => run(del(`/tickets/${ticketId}/links/${t.id}`))}><Unlink size={12} /></button>} />)}
        <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setPicker('link')}><Plus size={13} /> Link a ticket</button>
      </Panel>

      <Panel title="To-do" icon={ListTodo} count={x.todos.filter((t) => !t.is_done).length}>
        {x.todos.map((t) => (
          <div key={t.id} className="row-between small">
            <label className="checkbox"><input type="checkbox" checked={t.is_done} onChange={(e) => run(patch(`/tickets/${ticketId}/todos/${t.id}`, { is_done: e.target.checked }))} /><span style={t.is_done ? { textDecoration: 'line-through', color: 'var(--muted)' } : undefined}>{t.title}</span></label>
            <button className="icon-btn" aria-label={`Delete to-do ${t.title}`} onClick={() => run(del(`/tickets/${ticketId}/todos/${t.id}`))}><Trash2 size={12} /></button>
          </div>
        ))}
        <div className="row"><input className="input input-sm" aria-label="New to-do" placeholder="Add a to-do…" value={todo} onChange={(e) => setTodo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTodo()} /><button className="btn btn-sm" disabled={!todo.trim()} onClick={addTodo}>Add</button></div>
      </Panel>

      <Panel title="Threads" icon={MessagesSquare} count={x.threads.length}>
        <p className="muted small">Private chat with other agents. Customers never see it.</p>
        {x.threads.map((th) => (
          <div key={th.id} className="col" style={{ gap: 6, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
            <strong className="small">{th.title}</strong>
            {th.messages.map((m) => <div key={m.id} className="small"><span className="strong">{m.user_name}</span> <span className="muted">{fmtRelative(m.created_at)}</span><div className="msg-text">{m.body}</div></div>)}
            <div className="row"><input className="input input-sm" aria-label={`Reply to ${th.title}`} placeholder="Reply…" value={replies[th.id] || ''} onChange={(e) => setReplies({ ...replies, [th.id]: e.target.value })} />
              <button className="btn btn-sm" disabled={!replies[th.id]?.trim()} onClick={() => run(post(`/tickets/${ticketId}/threads/${th.id}/messages`, { body: replies[th.id] }), () => setReplies({ ...replies, [th.id]: '' }))}>Send</button></div>
          </div>
        ))}
        <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setThread({ title: '', body: '', notify_user_ids: [] })}><Plus size={13} /> Start a thread</button>
      </Panel>

      <Panel title="Requester's recent tickets" icon={ListTodo} count={x.timeline.length}>
        {x.timeline.length === 0 && <span className="muted small">No other tickets.</span>}
        {x.timeline.map((t) => <TicketLine key={t.id} t={t} />)}
      </Panel>

      {picker && <TicketPicker title={picker === 'link' ? 'Link a ticket' : 'Link to parent'} exclude={Number(ticketId)} help={picker === 'parent' ? 'This ticket becomes a child. The parent cannot be resolved until its children are.' : undefined} onClose={() => setPicker(null)}
        onPick={(t) => run(picker === 'link' ? post(`/tickets/${ticketId}/links`, { ticket_id: t.id }) : post(`/tickets/${ticketId}/parent`, { parent_id: t.id }), () => setPicker(null))} />}
      {thread && (
        <Modal title="Start a thread" onClose={() => setThread(null)} footer={<><button className="btn" onClick={() => setThread(null)}>Cancel</button><button className="btn btn-primary" disabled={!thread.title || !thread.body} onClick={() => run(post(`/tickets/${ticketId}/threads`, thread), () => setThread(null))}>Start</button></>}>
          <div className="form-grid">
            <Field label="Title" required><input className="input" value={thread.title} onChange={(e) => setThread({ ...thread, title: e.target.value })} /></Field>
            <Field label="Message" required><textarea className="textarea" value={thread.body} onChange={(e) => setThread({ ...thread, body: e.target.value })} /></Field>
            <Field label="Notify"><div className="col" style={{ gap: 4, maxHeight: 160, overflowY: 'auto' }}>{agents.map((a) => <label key={a.id} className="checkbox small"><input type="checkbox" checked={thread.notify_user_ids.includes(a.id)} onChange={(e) => setThread({ ...thread, notify_user_ids: e.target.checked ? [...thread.notify_user_ids, a.id] : thread.notify_user_ids.filter((i) => i !== a.id) })} /> {a.name}</label>)}</div></Field>
          </div>
        </Modal>
      )}
    </>
  );
}
