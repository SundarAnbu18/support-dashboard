import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Reply, StickyNote, Forward, Paperclip, X, Clock, Eye, EyeOff, Merge, Trash2, MoreHorizontal, Lock, Zap, Star, Send, FileText, RotateCcw, Printer, ArrowLeft } from 'lucide-react';
import { get, patch, post, del, postForm, errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Spinner, StatusBadge, PriorityBadge, SlaPill, Avatar, Select, Field, TagInput, Modal, ConfirmDialog, Dropdown, Tabs, Badge } from '../components/ui.jsx';
import { fmtSmart, fmtDateTime, fmtRelative, fmtDue, fmtMinutes, activityText, titleCase, STATUS_OPTIONS, PRIORITY_OPTIONS, TYPE_OPTIONS, SOURCE_OPTIONS } from '../utils/format.js';
import { CustomFields } from './NewTicket.jsx';

function AttachmentList({ items, onDelete }) {
  if (!items?.length) return null;
  return (
    <div className="attachment-list">
      {items.map((a) => (
        <a key={a.id} className="attachment" href={a.path} target="_blank" rel="noreferrer">
          <Paperclip size={13} />{a.file_name} <span className="muted">({Math.round(a.size / 1024)} KB)</span>
          {onDelete && <X size={12} onClick={(e) => { e.preventDefault(); onDelete(a); }} />}
        </a>
      ))}
    </div>
  );
}

export function Conversation({ items, ticket, onDelete }) {
  return (
    <div className="conversation">
      <div className="msg customer">
        <Avatar name={ticket.requester_name} src={ticket.requester_avatar} />
        <div className="msg-body">
          <div className="msg-head"><span className="who">{ticket.requester_name}</span><span className="muted">reported via {titleCase(ticket.source)}</span><span className="when">{fmtSmart(ticket.created_at)}</span></div>
          <div className="msg-text">{ticket.description || <em className="muted">No description</em>}</div>
          <AttachmentList items={ticket.attachments} />
        </div>
      </div>
      {items.map((c) => {
        const who = c.user_name || c.contact_name || (c.source === 'automation' ? 'Automation' : 'System');
        const cls = c.is_private ? 'private' : c.user_id ? 'agent' : c.source === 'merge' || c.source === 'automation' ? 'system' : 'customer';
        return (
          <div key={c.id} className={`msg ${cls}`}>
            <Avatar name={who} src={c.user_avatar || c.contact_avatar} />
            <div className="msg-body">
              <div className="msg-head">
                <span className="who">{who}</span>
                {c.kind === 'note' && <Badge color="amber"><Lock size={11} /> Private note</Badge>}
                {c.kind === 'forward' && <Badge color="purple"><Forward size={11} /> Forwarded to {c.to_emails?.join(', ')}</Badge>}
                {c.kind === 'reply' && c.user_id && <span className="muted">replied</span>}
                {c.kind === 'reply' && !c.user_id && <span className="muted">replied via {titleCase(c.source)}</span>}
                {c.source === 'automation' && <Badge color="blue"><Zap size={11} /> Automation</Badge>}
                <span className="when">{fmtSmart(c.created_at)}</span>
                {onDelete && c.kind !== 'reply' && <button className="icon-btn" style={{ width: 24, height: 24 }} onClick={() => onDelete(c)} title="Delete note"><X size={13} /></button>}
              </div>
              <div className="msg-text">{c.body}</div>
              <AttachmentList items={c.attachments} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function TicketDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const [t, setT] = useState(null);
  const [agents, setAgents] = useState([]);
  const [groups, setGroups] = useState([]);
  const [tags, setTags] = useState([]);
  const [fields, setFields] = useState([]);
  const [canned, setCanned] = useState([]);
  const [mode, setMode] = useState('reply');
  const [body, setBody] = useState('');
  const [replyStatus, setReplyStatus] = useState('');
  const [toEmails, setToEmails] = useState('');
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [tab, setTab] = useState('conversation');
  const [timeModal, setTimeModal] = useState(false);
  const [mergeModal, setMergeModal] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const textRef = useRef(null);

  const load = useCallback(() => get(`/tickets/${id}`).then((r) => setT(r.data)).catch((e) => { toast.error(errorMessage(e)); navigate('/tickets'); }), [id]); // eslint-disable-line
  useEffect(() => { load(); setBody(''); setFiles([]); setTab('conversation'); }, [load]);
  useEffect(() => {
    Promise.all([get('/agents'), get('/groups'), get('/tags'), get('/settings/ticket-fields'), get('/canned-responses')]).then(([a, g, tg, f, c]) => { setAgents(a.data); setGroups(g.data); setTags(tg.data); setFields(f.data); setCanned(c.data); });
  }, []);

  const update = async (changes) => {
    try { const r = await patch(`/tickets/${id}`, changes); setT((prev) => ({ ...prev, ...r.data })); load(); } catch (e) { toast.error(errorMessage(e)); }
  };

  const send = async () => {
    if (!body.trim()) return;
    setSending(true);
    try {
      const fieldsToSend = { body, status: replyStatus || undefined };
      if (mode === 'forward') fieldsToSend.to_emails = toEmails.split(',').map((s) => s.trim()).filter(Boolean);
      await postForm(`/tickets/${id}/${mode}`, fieldsToSend, files);
      toast.success(mode === 'reply' ? 'Reply sent' : mode === 'note' ? 'Note added' : 'Forwarded');
      setBody(''); setFiles([]); setReplyStatus(''); setToEmails('');
      load();
    } catch (e) { toast.error(errorMessage(e)); } finally { setSending(false); }
  };

  const insertCanned = async (c) => {
    const r = await post(`/canned-responses/${c.id}/use`, { requester_name: t.requester_name?.split(' ')[0], ticket_id: t.id, agent_name: user.name, subject: t.subject });
    setBody((b) => (b ? b + '\n\n' : '') + r.data.content);
    textRef.current?.focus();
  };

  const toggleWatch = async () => {
    if (t.is_watching) await del(`/tickets/${id}/watch`); else await post(`/tickets/${id}/watch`);
    load();
  };

  if (!t) return <div className="content"><Spinner block /></div>;
  const isResolved = ['resolved', 'closed'].includes(t.status);
  const totalMinutes = t.time_entries.reduce((s, e) => s + e.minutes, 0);

  return (
    <div className="content">
      <div className="detail-header">
        <div className="flex-1">
          <div className="row small muted mb-2"><Link to="/tickets" className="row" style={{ gap: 4 }}><ArrowLeft size={14} /> Tickets</Link>{t.merged_into_ticket_id && <span className="badge badge-gray">Merged into <Link to={`/tickets/${t.merged_into_ticket_id}`}>#{t.merged_into_ticket_id}</Link></span>}{t.deleted && <span className="badge badge-red">In trash</span>}{t.spam && <span className="badge badge-red">Spam</span>}</div>
          <h1><span className="ticket-id">#{t.id}</span>{t.subject}{t.is_escalated && <span className="badge badge-red">Escalated</span>}</h1>
          <div className="row wrap small muted mt-1">
            <StatusBadge status={t.status} /><PriorityBadge priority={t.priority} /><span>·</span><span>Created {fmtRelative(t.created_at)} via {titleCase(t.source)}</span><span>·</span>
            {['open', 'pending'].includes(t.status) ? <><SlaPill status={t.sla_status} dueBy={t.due_by} /><span className={t.sla_status === 'overdue' ? 'strong' : ''} style={t.sla_status === 'overdue' ? { color: 'var(--red-600)' } : {}}>{fmtDue(t.due_by)}</span></> : <span>{titleCase(t.status)} {fmtRelative(t.resolved_at || t.closed_at)}</span>}
            {t.sla_policy && <span>· SLA: {t.sla_policy.name}</span>}
          </div>
        </div>
        <div className="page-actions">
          {!isResolved && <button className="btn" onClick={() => update({ status: 'resolved' })}>Resolve</button>}
          {t.status === 'resolved' && <button className="btn" onClick={() => update({ status: 'closed' })}>Close</button>}
          {isResolved && <button className="btn" onClick={() => update({ status: 'open' })}><RotateCcw size={14} /> Reopen</button>}
          <button className="btn" onClick={toggleWatch} title={t.is_watching ? 'Stop watching' : 'Watch ticket'}>{t.is_watching ? <EyeOff size={14} /> : <Eye size={14} />}{t.is_watching ? 'Watching' : 'Watch'}</button>
          <Dropdown trigger={<button className="btn"><MoreHorizontal size={16} /></button>}>
            <button onClick={() => setTimeModal(true)}><Clock size={15} /> Log time</button>
            <button onClick={() => setMergeModal(true)}><Merge size={15} /> Merge tickets into this</button>
            <button onClick={() => window.print()}><Printer size={15} /> Print</button>
            {!t.spam && <button onClick={() => update({ spam: true })}><Zap size={15} /> Mark as spam</button>}
            {(t.spam || t.deleted) && <button onClick={() => post(`/tickets/${id}/restore`).then(load)}><RotateCcw size={15} /> Restore</button>}
            {!t.deleted && <button className="danger" onClick={() => setConfirm({ title: 'Move to trash?', message: 'The ticket can be restored from the Trash view.', danger: true, label: 'Delete', run: async () => { await del(`/tickets/${id}`); toast.success('Ticket moved to trash'); navigate('/tickets'); } })}><Trash2 size={15} /> Delete</button>}
            {t.deleted && user.role === 'admin' && <button className="danger" onClick={() => setConfirm({ title: 'Delete permanently?', message: 'This cannot be undone.', danger: true, label: 'Delete forever', run: async () => { await del(`/tickets/${id}`, { permanent: 'true' }); navigate('/tickets?view=trash'); } })}><Trash2 size={15} /> Delete permanently</button>}
          </Dropdown>
        </div>
      </div>

      <div className="detail-layout">
        <div>
          <Tabs active={tab} onChange={setTab} tabs={[
            { key: 'conversation', label: 'Conversation', count: t.conversations.length },
            { key: 'activity', label: 'Activity', count: t.activities.length },
            { key: 'time', label: 'Time tracked', count: fmtMinutes(totalMinutes) },
          ]} />

          {tab === 'conversation' && (
            <>
              <Conversation items={t.conversations} ticket={t} onDelete={(c) => setConfirm({ title: 'Delete this note?', message: 'Private notes and forwards can be removed.', danger: true, label: 'Delete', run: async () => { await del(`/tickets/${id}/conversations/${c.id}`); load(); } })} />
              {t.satisfaction && (
                <div className="alert alert-success mt-3"><Star size={16} /> Customer rated this ticket {t.satisfaction.rating}/5 {t.satisfaction.feedback && <>· “{t.satisfaction.feedback}”</>}</div>
              )}
              <div className={`reply-box mt-3 ${mode === 'note' ? 'note' : ''}`}>
                <div className="reply-tabs">
                  <button className={mode === 'reply' ? 'active' : ''} onClick={() => setMode('reply')}><Reply size={14} /> Reply</button>
                  <button className={mode === 'note' ? 'active' : ''} onClick={() => setMode('note')}><StickyNote size={14} /> Private note</button>
                  <button className={mode === 'forward' ? 'active' : ''} onClick={() => setMode('forward')}><Forward size={14} /> Forward</button>
                  <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', paddingRight: 8 }}>
                    <Dropdown trigger={<button className="btn btn-sm btn-ghost"><FileText size={14} /> Canned responses</button>}>
                      <div className="quick-reply-menu">
                        {canned.length === 0 && <div className="muted" style={{ padding: 10 }}>No canned responses yet.</div>}
                        {canned.map((c) => <button key={c.id} onClick={() => insertCanned(c)}><span className="col" style={{ gap: 0 }}><span>{c.title}</span><span className="muted small">{c.folder}</span></span></button>)}
                      </div>
                    </Dropdown>
                    {user.signature && <button className="btn btn-sm btn-ghost" onClick={() => setBody((b) => b + '\n\n' + user.signature)}>Insert signature</button>}
                  </div>
                </div>
                {mode === 'forward' && <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)' }}><input className="input input-sm" placeholder="To: email@example.com, another@example.com" value={toEmails} onChange={(e) => setToEmails(e.target.value)} /></div>}
                <textarea ref={textRef} value={body} onChange={(e) => setBody(e.target.value)} placeholder={mode === 'reply' ? `Reply to ${t.requester_name}…` : mode === 'note' ? 'Add an internal note visible only to agents…' : 'Add a message to forward with the ticket…'} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') send(); }} />
                <div className="reply-footer">
                  <label className="btn btn-sm"><Paperclip size={14} /> Attach<input type="file" multiple hidden onChange={(e) => setFiles([...files, ...Array.from(e.target.files)])} /></label>
                  {files.map((f, i) => <span key={i} className="tag-chip">{f.name}<button onClick={() => setFiles(files.filter((_, j) => j !== i))}><X size={12} /></button></span>)}
                  <div className="row" style={{ marginLeft: 'auto' }}>
                    {mode !== 'forward' && <Select small value={replyStatus} onChange={setReplyStatus} placeholder={mode === 'reply' ? `Send & set status (default: ${t.status === 'open' ? 'pending' : t.status})` : 'Keep status'} options={STATUS_OPTIONS.map((s) => ({ value: s, label: `Set as ${titleCase(s)}` }))} />}
                    <button className="btn btn-primary" onClick={send} disabled={sending || !body.trim()}><Send size={14} /> {sending ? 'Sending…' : mode === 'reply' ? 'Send reply' : mode === 'note' ? 'Add note' : 'Forward'}</button>
                  </div>
                </div>
              </div>
              <p className="muted small mt-1">Tip: press <kbd>⌘</kbd>+<kbd>Enter</kbd> to send.</p>
            </>
          )}

          {tab === 'activity' && (
            <div className="card"><div className="card-body">
              <div className="timeline">
                {t.activities.map((a) => (
                  <div key={a.id} className="timeline-item"><span className="dot" /><div><div><strong>{a.actor_label || 'System'}</strong> {activityText(a)}</div><div className="when">{fmtDateTime(a.created_at)}</div></div></div>
                ))}
              </div>
            </div></div>
          )}

          {tab === 'time' && (
            <div className="card">
              <div className="card-header"><h3>Time entries · {fmtMinutes(totalMinutes)} total</h3><button className="btn btn-sm btn-primary" onClick={() => setTimeModal(true)}><Clock size={14} /> Log time</button></div>
              <div className="card-body tight">
                {t.time_entries.length === 0 ? <div className="muted" style={{ padding: 16 }}>No time logged yet.</div> : (
                  <table className="table"><thead><tr><th>Agent</th><th>Note</th><th>Billable</th><th>Started</th><th className="num">Duration</th><th /></tr></thead>
                    <tbody>{t.time_entries.map((e) => (
                      <tr key={e.id}><td>{e.user_name}</td><td>{e.note || '—'}</td><td>{e.billable ? 'Yes' : 'No'}</td><td>{fmtDateTime(e.started_at)}</td><td className="num strong">{fmtMinutes(e.minutes)}</td>
                        <td><button className="icon-btn" onClick={() => del(`/tickets/${id}/time_entries/${e.id}`).then(load)}><X size={14} /></button></td></tr>
                    ))}</tbody></table>
                )}
              </div>
            </div>
          )}
        </div>

        <aside className="col gap-2">
          <div className="card sidebar-card"><div className="card-header"><h3>Properties</h3></div>
            <div className="card-body props">
              <Field label="Status"><Select value={t.status} onChange={(v) => update({ status: v })} options={STATUS_OPTIONS} /></Field>
              <Field label="Priority"><Select value={t.priority} onChange={(v) => update({ priority: v })} options={PRIORITY_OPTIONS} /></Field>
              <Field label="Type"><Select value={t.type || ''} placeholder="—" onChange={(v) => update({ type: v || null })} options={TYPE_OPTIONS} /></Field>
              <Field label="Source"><Select value={t.source} onChange={(v) => update({ source: v })} options={SOURCE_OPTIONS} /></Field>
              <Field label="Group"><Select value={t.group_id || ''} placeholder="—" onChange={(v) => update({ group_id: v || null })} options={groups.map((g) => ({ value: String(g.id), label: g.name }))} /></Field>
              <Field label="Agent">
                <Select value={t.responder_id || ''} placeholder="Unassigned" onChange={(v) => update({ responder_id: v || null })} options={agents.filter((a) => a.is_active).map((a) => ({ value: String(a.id), label: a.name }))} />
                {t.responder_id !== user.id && <button className="btn-link small" style={{ alignSelf: 'flex-start' }} onClick={() => update({ responder_id: user.id })}>Assign to me</button>}
              </Field>
              <Field label="Tags"><TagInput value={t.tags || []} onChange={(v) => update({ tags: v })} suggestions={tags.map((x) => x.name)} /></Field>
              <Field label="Due by"><input type="datetime-local" className="input input-sm" value={t.due_by ? new Date(new Date(t.due_by).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''} onChange={(e) => update({ due_by: e.target.value ? new Date(e.target.value).toISOString() : null })} /></Field>
              <CustomFields fields={fields} values={t.custom_fields || {}} onChange={(v) => update({ custom_fields: v })} />
            </div>
          </div>
          <div className="card sidebar-card"><div className="card-header"><h3>Requester</h3><Link to={`/contacts/${t.requester_id}`} className="small">View</Link></div>
            <div className="card-body col" style={{ gap: 10 }}>
              <div className="row" style={{ gap: 10 }}><Avatar name={t.requester.name} src={t.requester.avatar_url} size="lg" /><div><div className="strong">{t.requester.name}</div><div className="muted small">{t.requester.email}</div></div></div>
              <dl className="kv">
                {t.requester.phone && <><dt>Phone</dt><dd>{t.requester.phone}</dd></>}
                {t.requester.company_name && <><dt>Company</dt><dd><Link to={`/companies/${t.requester.company_id}`}>{t.requester.company_name}</Link></dd></>}
                {t.requester.job_title && <><dt>Title</dt><dd>{t.requester.job_title}</dd></>}
                <dt>Tickets</dt><dd><Link to={`/tickets?requester_id=${t.requester_id}`}>{t.requester.ticket_count} total</Link></dd>
                <dt>Portal</dt><dd>{t.requester.has_portal_access ? 'Has access' : 'No account'}</dd>
                {t.cc_emails?.length > 0 && <><dt>CC</dt><dd>{t.cc_emails.join(', ')}</dd></>}
              </dl>
              {t.requester.tags?.length > 0 && <div className="row wrap">{t.requester.tags.map((x) => <span key={x} className="tag-chip">{x}</span>)}</div>}
            </div>
          </div>
          <div className="card sidebar-card"><div className="card-header"><h3>SLA & timeline</h3></div>
            <div className="card-body">
              <dl className="kv">
                <dt>First response</dt><dd>{t.first_responded_at ? <span style={{ color: new Date(t.first_responded_at) <= new Date(t.fr_due_by) ? 'var(--green-600)' : 'var(--red-600)' }}>{fmtSmart(t.first_responded_at)}</span> : <span className="muted">Due {fmtSmart(t.fr_due_by)}</span>}</dd>
                <dt>Resolution due</dt><dd>{fmtSmart(t.due_by)}</dd>
                <dt>Resolved</dt><dd>{t.resolved_at ? fmtSmart(t.resolved_at) : '—'}</dd>
                <dt>Closed</dt><dd>{t.closed_at ? fmtSmart(t.closed_at) : '—'}</dd>
                <dt>Last update</dt><dd>{fmtSmart(t.updated_at)}</dd>
                <dt>Time spent</dt><dd>{fmtMinutes(totalMinutes)}</dd>
              </dl>
              {t.watchers.length > 0 && <div className="mt-2"><h4>Watchers</h4><div className="row mt-1">{t.watchers.map((w) => <Avatar key={w.id} name={w.name} src={w.avatar_url} size="sm" />)}</div></div>}
              {t.merged_tickets.length > 0 && <div className="mt-2"><h4>Merged tickets</h4>{t.merged_tickets.map((m) => <div key={m.id} className="small"><Link to={`/tickets/${m.id}`}>#{m.id}</Link> {m.subject}</div>)}</div>}
            </div>
          </div>
        </aside>
      </div>

      {timeModal && <TimeModal ticketId={id} onClose={() => setTimeModal(false)} onSaved={() => { setTimeModal(false); load(); toast.success('Time logged'); }} />}
      {mergeModal && <MergeModal ticket={t} onClose={() => setMergeModal(false)} onMerged={() => { setMergeModal(false); load(); toast.success('Tickets merged'); }} />}
      {confirm && <ConfirmDialog title={confirm.title} message={confirm.message} danger={confirm.danger} confirmLabel={confirm.label} onCancel={() => setConfirm(null)} onConfirm={async () => { try { await confirm.run(); } catch (e) { toast.error(errorMessage(e)); } setConfirm(null); }} />}
    </div>
  );
}

function TimeModal({ ticketId, onClose, onSaved }) {
  const [form, setForm] = useState({ hours: 0, minutes: 30, note: '', billable: true });
  const toast = useToast();
  const save = async () => {
    const minutes = Number(form.hours) * 60 + Number(form.minutes);
    try { await post(`/tickets/${ticketId}/time_entries`, { minutes, note: form.note, billable: form.billable }); onSaved(); } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <Modal title="Log time" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save}>Save entry</button></>}>
      <div className="form-grid">
        <div className="form-row">
          <Field label="Hours"><input className="input" type="number" min="0" value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} /></Field>
          <Field label="Minutes"><input className="input" type="number" min="0" max="59" value={form.minutes} onChange={(e) => setForm({ ...form, minutes: e.target.value })} /></Field>
        </div>
        <Field label="Note"><input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="What did you work on?" /></Field>
        <label className="checkbox"><input type="checkbox" checked={form.billable} onChange={(e) => setForm({ ...form, billable: e.target.checked })} /> Billable</label>
      </div>
    </Modal>
  );
}

function MergeModal({ ticket, onClose, onMerged }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [chosen, setChosen] = useState([]);
  const toast = useToast();
  useEffect(() => {
    get('/tickets', { q: q || undefined, requester_id: q ? undefined : ticket.requester_id, per_page: 10, view: 'all' }).then((r) => setResults(r.data.filter((x) => x.id !== ticket.id)));
  }, [q, ticket]);
  const merge = async () => {
    try { await post(`/tickets/${ticket.id}/merge`, { ticket_ids: chosen }); onMerged(); } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <Modal title={`Merge tickets into #${ticket.id}`} onClose={onClose} size="lg" footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!chosen.length} onClick={merge}>Merge {chosen.length || ''} ticket(s)</button></>}>
      <p className="muted mb-2">Selected tickets will be closed and their conversations copied here as private notes.</p>
      <input className="input mb-2" placeholder="Search by subject or #id (defaults to this requester's tickets)" value={q} onChange={(e) => setQ(e.target.value)} />
      <table className="table"><tbody>
        {results.map((r) => (
          <tr key={r.id}><td style={{ width: 30 }}><input type="checkbox" checked={chosen.includes(r.id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, r.id] : chosen.filter((x) => x !== r.id))} /></td><td><strong>#{r.id}</strong> {r.subject}<div className="muted small">{r.requester_name} · {fmtRelative(r.created_at)}</div></td><td><StatusBadge status={r.status} /></td></tr>
        ))}
        {results.length === 0 && <tr><td className="muted">No matching tickets</td></tr>}
      </tbody></table>
    </Modal>
  );
}
