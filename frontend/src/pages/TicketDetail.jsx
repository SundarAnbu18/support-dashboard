import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Reply, StickyNote, Forward, Paperclip, X, Clock, Eye, EyeOff, Merge, Trash2, MoreHorizontal, Lock, Zap, Star, Send, FileText, RotateCcw, Printer, ArrowLeft, ChevronLeft, ChevronRight, Scissors, Play, Pencil, MessagesSquare, BookOpen, Users, Keyboard } from 'lucide-react';
import { get, patch, post, del, postForm, errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Spinner, StatusBadge, PriorityBadge, SlaPill, Avatar, Select, Field, TagInput, Modal, ConfirmDialog, Dropdown, Tabs, Badge } from '../components/ui.jsx';
import { fmtSmart, fmtDateTime, fmtRelative, fmtDue, fmtMinutes, activityText, titleCase, statusOptions, PRIORITY_OPTIONS, TYPE_OPTIONS, SOURCE_OPTIONS } from '../utils/format.js';
import TicketPanels from '../components/TicketPanels.jsx';
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

export function Conversation({ items, ticket, onDelete, onSplit }) {
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
                {onSplit && c.contact_id && c.kind === 'reply' && <button className="icon-btn" style={{ width: 24, height: 24 }} onClick={() => onSplit(c)} title="Split into a new ticket" aria-label="Split into a new ticket"><Scissors size={13} /></button>}
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
  const [products, setProducts] = useState([]);
  const [scenarios, setScenarios] = useState([]);
  const [scenarioModal, setScenarioModal] = useState(false);
  const [editModal, setEditModal] = useState(false);
  const [forumModal, setForumModal] = useState(false);
  const [articleModal, setArticleModal] = useState(false);
  const [shortcutHelp, setShortcutHelp] = useState(false);
  const [viewers, setViewers] = useState([]);
  const [panelToken, setPanelToken] = useState(0);
  const canReply = user.privileges?.includes('reply_ticket');
  const can = (p) => user.privileges?.includes(p);
  // Order of the last list the agent opened, for previous/next navigation.
  const listIds = JSON.parse(sessionStorage.getItem('sd_ticket_ids') || '[]');
  const listIndex = listIds.indexOf(Number(id));
  const goTo = (offset) => { const next = listIds[listIndex + offset]; if (listIndex >= 0 && next) navigate(`/tickets/${next}`); };

  const load = useCallback(() => get(`/tickets/${id}`).then((r) => { setT(r.data); setPanelToken((n) => n + 1); }).catch((e) => { toast.error(errorMessage(e)); navigate('/tickets'); }), [id]); // eslint-disable-line
  useEffect(() => { load(); setBody(''); setFiles([]); setTab('conversation'); setMode(canReply ? 'reply' : 'note'); }, [load]); // eslint-disable-line
  useEffect(() => {
    Promise.all([get('/agents'), get('/groups'), get('/tags'), get('/settings/ticket-fields'), get('/canned-responses')]).then(([a, g, tg, f, c]) => { setAgents(a.data); setGroups(g.data); setTags(tg.data); setFields(f.data); setCanned(c.data); });
    get('/config/products').then((r) => setProducts(r.data)).catch(() => {});
    get('/config/scenarios').then((r) => setScenarios(r.data)).catch(() => {});
  }, []);

  // Tells other agents this ticket is open, and shows who else has it open.
  useEffect(() => {
    const ping = () => post(`/tickets/${id}/presence`, { replying: !!textRef.current?.value }).then((r) => setViewers(r.data)).catch(() => {});
    ping();
    const timer = setInterval(ping, 10000);
    return () => clearInterval(timer);
  }, [id]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || document.querySelector('.modal-backdrop')) return;
      const actions = {
        r: () => { if (canReply) { setMode('reply'); setTab('conversation'); setTimeout(() => textRef.current?.focus()); } },
        n: () => { setMode('note'); setTab('conversation'); setTimeout(() => textRef.current?.focus()); },
        f: () => { if (canReply) { setMode('forward'); setTab('conversation'); setTimeout(() => textRef.current?.focus()); } },
        w: () => toggleWatch(), m: () => setTimeModal(true), s: () => setScenarioModal(true), e: () => setEditModal(true),
        j: () => goTo(1), k: () => goTo(-1), '?': () => setShortcutHelp(true),
      };
      if (actions[e.key]) { e.preventDefault(); actions[e.key](); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const update = async (changes) => {
    try { const r = await patch(`/tickets/${id}`, changes); setT((prev) => ({ ...prev, ...r.data })); load(); } catch (e) { toast.error(errorMessage(e)); }
  };

  const send = async () => {
    if (!body.trim()) return;
    setSending(true);
    try {
      const fieldsToSend = { body, status: replyStatus || undefined };
      // "@Agent Name" in a note notifies that agent and files the ticket under their mentions.
      if (mode === 'note') fieldsToSend.notify_user_ids = agents.filter((a) => body.toLowerCase().includes(`@${a.name.toLowerCase()}`)).map((a) => a.id);
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

  const runScenario = async (s) => {
    try { await post(`/tickets/${id}/scenarios/${s.id}`); toast.success(`Scenario "${s.name}" applied`); setScenarioModal(false); load(); } catch (e) { toast.error(errorMessage(e)); }
  };
  const split = (c) => setConfirm({ title: 'Split into a new ticket?', message: 'This reply moves out of this conversation into a new ticket for the same customer.', label: 'Split', run: async () => { const r = await post(`/tickets/${id}/split`, { conversation_id: c.id }); toast.success(`Created ticket #${r.data.id}`); navigate(`/tickets/${r.data.id}`); } });

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
            {!['resolved', 'closed'].includes(t.status) ? <><SlaPill status={t.sla_status} dueBy={t.due_by} /><span className={t.sla_status === 'overdue' ? 'strong' : ''} style={t.sla_status === 'overdue' ? { color: 'var(--red-600)' } : {}}>{fmtDue(t.due_by)}</span></> : <span>{titleCase(t.status)} {fmtRelative(t.resolved_at || t.closed_at)}</span>}
            {t.sla_policy && <span>· SLA: {t.sla_policy.name}</span>}
          </div>
        </div>
        <div className="page-actions">
          {!isResolved && <button className="btn" onClick={() => update({ status: 'resolved' })}>Resolve</button>}
          {t.status === 'resolved' && <button className="btn" onClick={() => update({ status: 'closed' })}>Close</button>}
          {isResolved && <button className="btn" onClick={() => update({ status: 'open' })}><RotateCcw size={14} /> Reopen</button>}
          <div className="row" style={{ gap: 2 }}>
            <button className="btn" disabled={listIndex <= 0} aria-label="Previous ticket" title="Previous (k)" onClick={() => goTo(-1)}><ChevronLeft size={16} /></button>
            <button className="btn" disabled={listIndex < 0 || listIndex >= listIds.length - 1} aria-label="Next ticket" title="Next (j)" onClick={() => goTo(1)}><ChevronRight size={16} /></button>
          </div>
          <button className="btn" onClick={() => setScenarioModal(true)} title="Execute scenario (s)"><Play size={14} /> Scenario</button>
          <button className="btn" onClick={toggleWatch} title={t.is_watching ? 'Stop watching' : 'Watch ticket'}>{t.is_watching ? <EyeOff size={14} /> : <Eye size={14} />}{t.is_watching ? 'Watching' : 'Watch'}</button>
          <Dropdown trigger={<button className="btn"><MoreHorizontal size={16} /></button>}>
            <button onClick={() => setEditModal(true)}><Pencil size={15} /> Edit ticket details</button>
            <button onClick={() => setTimeModal(true)}><Clock size={15} /> Log time</button>
            {can('merge_split_ticket') && <button onClick={() => setMergeModal(true)}><Merge size={15} /> Merge tickets into this</button>}
            {can('moderate_forums') && <button onClick={() => setForumModal(true)}><MessagesSquare size={15} /> Convert to forum topic</button>}
            <button onClick={() => setShortcutHelp(true)}><Keyboard size={15} /> Keyboard shortcuts</button>
            <button onClick={() => window.print()}><Printer size={15} /> Print</button>
            {!t.spam && <button onClick={() => update({ spam: true })}><Zap size={15} /> Mark as spam</button>}
            {(t.spam || t.deleted) && <button onClick={() => post(`/tickets/${id}/restore`).then(load)}><RotateCcw size={15} /> Restore</button>}
            {!t.deleted && can('delete_ticket') && <button className="danger" onClick={() => setConfirm({ title: 'Move to trash?', message: 'The ticket can be restored from the Trash view.', danger: true, label: 'Delete', run: async () => { await del(`/tickets/${id}`); toast.success('Ticket moved to trash'); navigate('/tickets'); } })}><Trash2 size={15} /> Delete</button>}
            {t.deleted && user.role === 'admin' && <button className="danger" onClick={() => setConfirm({ title: 'Delete permanently?', message: 'This cannot be undone.', danger: true, label: 'Delete forever', run: async () => { await del(`/tickets/${id}`, { permanent: 'true' }); navigate('/tickets?view=trash'); } })}><Trash2 size={15} /> Delete permanently</button>}
          </Dropdown>
        </div>
      </div>

      {viewers.length > 0 && <div className="collision mb-2"><Users size={14} /> {viewers.map((v) => `${v.name}${v.replying ? ' is replying' : ' is viewing'}`).join(', ')}</div>}
      <div className="detail-layout">
        <div>
          <Tabs active={tab} onChange={setTab} tabs={[
            { key: 'conversation', label: 'Conversation', count: t.conversations.length },
            { key: 'activity', label: 'Activity', count: t.activities.length },
            { key: 'time', label: 'Time tracked', count: fmtMinutes(totalMinutes) },
          ]} />

          {tab === 'conversation' && (
            <>
              <Conversation items={t.conversations} ticket={t} onSplit={can('merge_split_ticket') ? split : undefined} onDelete={(c) => setConfirm({ title: 'Delete this note?', message: 'Private notes and forwards can be removed.', danger: true, label: 'Delete', run: async () => { await del(`/tickets/${id}/conversations/${c.id}`); load(); } })} />
              {t.satisfaction && (
                <div className="alert alert-success mt-3"><Star size={16} /> Customer rated this ticket {t.satisfaction.rating}/5 {t.satisfaction.feedback && <>· “{t.satisfaction.feedback}”</>}</div>
              )}
              <div className={`reply-box mt-3 ${mode === 'note' ? 'note' : ''}`}>
                <div className="reply-tabs">
                  {canReply && <button className={mode === 'reply' ? 'active' : ''} onClick={() => setMode('reply')}><Reply size={14} /> Reply</button>}
                  <button className={mode === 'note' ? 'active' : ''} onClick={() => setMode('note')}><StickyNote size={14} /> Private note</button>
                  {canReply && <button className={mode === 'forward' ? 'active' : ''} onClick={() => setMode('forward')}><Forward size={14} /> Forward</button>}
                  <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', paddingRight: 8 }}>
                    <Dropdown trigger={<button className="btn btn-sm btn-ghost"><FileText size={14} /> Canned responses</button>}>
                      <div className="quick-reply-menu">
                        {canned.length === 0 && <div className="muted" style={{ padding: 10 }}>No canned responses yet.</div>}
                        {canned.map((c) => <button key={c.id} onClick={() => insertCanned(c)}><span className="col" style={{ gap: 0 }}><span>{c.title}</span><span className="muted small">{c.folder}</span></span></button>)}
                      </div>
                    </Dropdown>
                    <button className="btn btn-sm btn-ghost" onClick={() => setArticleModal(true)}><BookOpen size={14} /> Solution article</button>
                    {user.signature && <button className="btn btn-sm btn-ghost" onClick={() => setBody((b) => b + '\n\n' + user.signature)}>Insert signature</button>}
                  </div>
                </div>
                {mode === 'forward' && <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)' }}><input className="input input-sm" placeholder="To: email@example.com, another@example.com" value={toEmails} onChange={(e) => setToEmails(e.target.value)} /></div>}
                <textarea ref={textRef} value={body} onChange={(e) => setBody(e.target.value)} placeholder={mode === 'reply' ? `Reply to ${t.requester_name}…` : mode === 'note' ? 'Add an internal note visible only to agents. Type @Agent Name to notify someone…' : 'Add a message to forward with the ticket…'} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') send(); }} />
                <div className="reply-footer">
                  <label className="btn btn-sm"><Paperclip size={14} /> Attach<input type="file" multiple hidden onChange={(e) => setFiles([...files, ...Array.from(e.target.files)])} /></label>
                  {files.map((f, i) => <span key={i} className="tag-chip">{f.name}<button onClick={() => setFiles(files.filter((_, j) => j !== i))}><X size={12} /></button></span>)}
                  <div className="row" style={{ marginLeft: 'auto' }}>
                    {mode !== 'forward' && <Select small value={replyStatus} onChange={setReplyStatus} placeholder={mode === 'reply' ? `Send & set status (default: ${t.status === 'open' ? 'pending' : t.status})` : 'Keep status'} options={statusOptions().map((s) => ({ value: s.value, label: `Set as ${s.label}` }))} />}
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
              <Field label="Status"><Select value={t.status} onChange={(v) => update({ status: v })} options={statusOptions()} /></Field>
              <Field label="Priority"><Select value={t.priority} onChange={(v) => update({ priority: v })} options={PRIORITY_OPTIONS} /></Field>
              <Field label="Type"><Select value={t.type || ''} placeholder="—" onChange={(v) => update({ type: v || null })} options={TYPE_OPTIONS} /></Field>
              <Field label="Source"><Select value={t.source} onChange={(v) => update({ source: v })} options={SOURCE_OPTIONS} /></Field>
              <Field label="Group"><Select value={t.group_id || ''} placeholder="—" onChange={(v) => update({ group_id: v || null })} options={groups.map((g) => ({ value: String(g.id), label: g.name }))} /></Field>
              <Field label="Agent">
                <Select value={t.responder_id || ''} placeholder="Unassigned" onChange={(v) => update({ responder_id: v || null })} options={agents.filter((a) => a.is_active).map((a) => ({ value: String(a.id), label: a.name }))} />
                {t.responder_id !== user.id && <button className="btn-link small" style={{ alignSelf: 'flex-start' }} onClick={() => update({ responder_id: user.id })}>Assign to me</button>}
              </Field>
              {products.length > 0 && <Field label="Product"><Select value={t.product_id || ''} placeholder="—" onChange={(v) => update({ product_id: v || null })} options={products.map((p) => ({ value: String(p.id), label: p.name }))} /></Field>}
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
          <TicketPanels ticketId={id} reloadToken={panelToken} agents={agents} onChanged={load} />
        </aside>
      </div>

      {scenarioModal && <Modal title="Execute scenario" onClose={() => setScenarioModal(false)}>
        {scenarios.length === 0 ? <p className="muted">No scenarios yet. Create them under Admin, Scenarios.</p> : <div className="col" style={{ gap: 6 }}>{scenarios.map((s) => <button key={s.id} className="btn" style={{ justifyContent: 'flex-start', height: 'auto', padding: '8px 12px' }} onClick={() => runScenario(s)}><span className="col" style={{ gap: 0, alignItems: 'flex-start' }}><strong>{s.name}</strong><span className="muted small">{s.description}</span></span></button>)}</div>}
      </Modal>}
      {editModal && <EditDetailsModal ticket={t} onClose={() => setEditModal(false)} onSave={async (changes) => { await update(changes); setEditModal(false); }} />}
      {forumModal && <ForumModal ticket={t} onClose={() => setForumModal(false)} onDone={(topic) => { setForumModal(false); toast.success('Forum topic created'); navigate(`/forums/topics/${topic.id}`); }} />}
      {articleModal && <ArticleModal onClose={() => setArticleModal(false)} onPick={(a) => { setBody((b) => `${b}${b ? '\n\n' : ''}${a.title}\n${window.location.origin}/portal/articles/${a.slug}`); setArticleModal(false); textRef.current?.focus(); }} />}
      {shortcutHelp && <Modal title="Keyboard shortcuts" onClose={() => setShortcutHelp(false)}>
        <dl className="kv">{[['r', 'Reply'], ['n', 'Add note'], ['f', 'Forward'], ['s', 'Execute scenario'], ['e', 'Edit ticket details'], ['m', 'Log time'], ['w', 'Watch or unwatch'], ['j', 'Next ticket'], ['k', 'Previous ticket'], ['?', 'Show this list']].map(([k, label]) => <><dt key={`${k}-k`}><kbd>{k}</kbd></dt><dd key={`${k}-v`}>{label}</dd></>)}</dl>
      </Modal>}
      {timeModal && <TimeModal ticketId={id} onClose={() => setTimeModal(false)} onSaved={() => { setTimeModal(false); load(); toast.success('Time logged'); }} />}
      {mergeModal && <MergeModal ticket={t} onClose={() => setMergeModal(false)} onMerged={() => { setMergeModal(false); load(); toast.success('Tickets merged'); }} />}
      {confirm && <ConfirmDialog title={confirm.title} message={confirm.message} danger={confirm.danger} confirmLabel={confirm.label} onCancel={() => setConfirm(null)} onConfirm={async () => { try { await confirm.run(); } catch (e) { toast.error(errorMessage(e)); } setConfirm(null); }} />}
    </div>
  );
}

function EditDetailsModal({ ticket, onClose, onSave }) {
  const [form, setForm] = useState({ subject: ticket.subject, description: ticket.description });
  return (
    <Modal title="Edit ticket details" size="lg" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!form.subject} onClick={() => onSave(form)}>Save</button></>}>
      <div className="form-grid">
        <Field label="Subject" required><input className="input" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></Field>
        <Field label="Description"><textarea className="textarea" style={{ minHeight: 180 }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function ForumModal({ ticket, onClose, onDone }) {
  const toast = useToast();
  const [forums, setForums] = useState([]);
  const [form, setForm] = useState({ forum_id: '', title: ticket.subject });
  useEffect(() => { get('/forums').then((r) => setForums(r.data.flatMap((c) => c.forums))); }, []);
  const save = () => post(`/tickets/${ticket.id}/to-forum`, form).then((r) => onDone(r.data)).catch((e) => toast.error(errorMessage(e)));
  return (
    <Modal title="Convert to forum topic" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!form.forum_id} onClick={save}>Create topic</button></>}>
      <p className="muted mb-2">The ticket stays open. Its description is posted publicly, so check it holds no private details.</p>
      <div className="form-grid">
        <Field label="Forum" required><Select value={form.forum_id} placeholder="Choose…" onChange={(v) => setForm({ ...form, forum_id: v })} options={forums.map((f) => ({ value: String(f.id), label: f.name }))} /></Field>
        <Field label="Title"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function ArticleModal({ onClose, onPick }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  useEffect(() => { get('/kb/articles', { q: q || undefined, status: 'published', per_page: 10 }).then((r) => setResults(r.data)).catch(() => {}); }, [q]);
  return (
    <Modal title="Insert a solution article" onClose={onClose}>
      <input className="input mb-2" autoFocus placeholder="Search articles…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="col" style={{ gap: 6 }}>{results.map((a) => <button key={a.id} className="btn" style={{ justifyContent: 'flex-start' }} onClick={() => onPick(a)}><span className="truncate">{a.title}</span></button>)}{results.length === 0 && <span className="muted">No articles found.</span>}</div>
    </Modal>
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
