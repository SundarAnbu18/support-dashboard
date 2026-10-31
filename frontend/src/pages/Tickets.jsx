import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Filter, X, Save, Trash2, UserCheck, ArrowUpDown, RefreshCw, Paperclip, MessageSquare, Inbox, Download } from 'lucide-react';
import { get, post, del, errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Spinner, StatusBadge, PriorityBadge, SlaPill, Avatar, Pagination, EmptyState, Select, Modal, Field, useDebounce } from '../components/ui.jsx';
import { fmtRelative, fmtDue, STATUS_OPTIONS, PRIORITY_OPTIONS, TYPE_OPTIONS, SOURCE_OPTIONS, titleCase } from '../utils/format.js';

const VIEWS = [
  { key: 'all', label: 'All tickets', count: 'all_tickets' },
  { key: 'unresolved', label: 'All unresolved', count: 'unresolved' },
  { key: 'new_and_my_open', label: 'New & my open', count: null },
  { key: 'my_open', label: 'My open tickets', count: 'my_open' },
  { key: 'unassigned', label: 'Unassigned', count: 'unassigned' },
  { key: 'overdue', label: 'Overdue', count: 'overdue' },
  { key: 'due_today', label: 'Due today', count: 'due_today' },
  { key: 'open', label: 'Open', count: 'open' },
  { key: 'on_hold', label: 'Pending', count: 'pending' },
  { key: 'resolved', label: 'Resolved', count: 'resolved' },
  { key: 'closed', label: 'Closed', count: 'closed' },
  { key: 'watching', label: 'Watching', count: 'watching' },
  { key: 'spam', label: 'Spam', count: 'spam' },
  { key: 'trash', label: 'Trash', count: 'trash' },
];
const FILTER_KEYS = ['status', 'priority', 'type', 'source', 'responder_id', 'group_id', 'tags', 'created_from', 'created_to'];

function MultiCheck({ options, value = [], onChange, labels = {} }) {
  const toggle = (v) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <div className="col" style={{ gap: 4 }}>
      {options.map((o) => {
        const opt = typeof o === 'string' ? { value: o, label: labels[o] || titleCase(o) } : o;
        return <label key={opt.value} className="checkbox small"><input type="checkbox" checked={value.includes(String(opt.value))} onChange={() => toggle(String(opt.value))} />{opt.label}</label>;
      })}
    </div>
  );
}

export default function Tickets() {
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [counts, setCounts] = useState({});
  const [agents, setAgents] = useState([]);
  const [groups, setGroups] = useState([]);
  const [tags, setTags] = useState([]);
  const [views, setViews] = useState([]);
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saveView, setSaveView] = useState(false);
  const [q, setQ] = useState(params.get('q') || '');
  const dq = useDebounce(q, 350);

  const view = params.get('view') || 'all';
  const sort = params.get('sort') || 'created_at';
  const order = params.get('order') || 'desc';
  const page = Number(params.get('page') || 1);
  const filters = useMemo(() => Object.fromEntries(FILTER_KEYS.map((k) => [k, params.getAll(k)])), [params]);
  const activeFilterCount = FILTER_KEYS.reduce((n, k) => n + (filters[k].length ? 1 : 0), 0);

  const update = useCallback((changes, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      next.delete(k);
      if (Array.isArray(v)) v.forEach((x) => x && next.append(k, x)); else if (v) next.set(k, v);
    }
    if (resetPage) next.delete('page');
    setParams(next);
  }, [params, setParams]);

  useEffect(() => { if (dq !== (params.get('q') || '')) update({ q: dq }); }, [dq]); // eslint-disable-line

  useEffect(() => {
    Promise.all([get('/agents'), get('/groups'), get('/tags'), get('/saved-views')]).then(([a, g, t, v]) => { setAgents(a.data); setGroups(g.data); setTags(t.data); setViews(v.data); });
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    const query = { view, sort, order, page, per_page: 30, q: params.get('q') || undefined };
    for (const k of FILTER_KEYS) if (filters[k].length) query[k] = filters[k].join(',');
    Promise.all([get('/tickets', query), get('/tickets/counts')]).then(([t, c]) => { setData(t); setCounts(c.data); setSelected([]); }).catch((e) => toast.error(errorMessage(e))).finally(() => setLoading(false));
  }, [view, sort, order, page, params, filters]); // eslint-disable-line
  useEffect(() => { load(); }, [load]);

  const toggleSort = (col) => update({ sort: col, order: sort === col && order === 'desc' ? 'asc' : 'desc' });
  const allSelected = data?.data.length > 0 && selected.length === data.data.length;
  const bulk = async (action) => {
    try { await post('/tickets/bulk', { ids: selected, action }); toast.success(`Updated ${selected.length} ticket(s)`); load(); } catch (e) { toast.error(errorMessage(e)); }
  };
  const applySavedView = (v) => {
    const next = new URLSearchParams();
    for (const [k, val] of Object.entries(v.filters || {})) (Array.isArray(val) ? val : [val]).forEach((x) => next.append(k, x));
    next.set('view', v.filters?.view || 'all');
    setParams(next);
  };
  const clearFilters = () => update(Object.fromEntries(FILTER_KEYS.map((k) => [k, []])));

  const exportCsv = () => {
    if (!data) return;
    const rows = [['id', 'subject', 'status', 'priority', 'type', 'requester', 'assignee', 'group', 'created_at', 'due_by']];
    for (const t of data.data) rows.push([t.id, t.subject, t.status, t.priority, t.type || '', t.requester_name, t.responder_name || '', t.group_name || '', t.created_at, t.due_by || '']);
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'tickets.csv'; a.click();
  };

  return (
    <div className="content flush">
      <div className="ticket-layout">
        <aside className="filter-panel">
          <div>
            <h4>Views</h4>
            <div className="view-list">
              {VIEWS.map((v) => (
                <button key={v.key} className={view === v.key && activeFilterCount === 0 ? 'active' : view === v.key ? 'active' : ''} onClick={() => { clearFilters(); update({ view: v.key }); }}>
                  <span>{v.label}</span>{v.count && counts[v.count] !== undefined && <span className="count">{counts[v.count]}</span>}
                </button>
              ))}
            </div>
          </div>
          {views.length > 0 && (
            <div>
              <h4>Saved views</h4>
              <div className="view-list">
                {views.map((v) => (
                  <button key={v.id} onClick={() => applySavedView(v)}>
                    <span className="truncate">{v.name}</span>
                    {(v.user_id === user.id || user.role === 'admin') && <X size={13} className="muted" onClick={(e) => { e.stopPropagation(); del(`/saved-views/${v.id}`).then(() => setViews(views.filter((x) => x.id !== v.id))); }} />}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <div className="row-between"><h4 style={{ margin: 0 }}><Filter size={12} style={{ verticalAlign: -1 }} /> Filters {activeFilterCount > 0 && <span className="badge badge-blue">{activeFilterCount}</span>}</h4>{activeFilterCount > 0 && <button className="btn-link small" onClick={clearFilters}>Clear</button>}</div>
            <div className="col mt-2" style={{ gap: 14 }}>
              <Field label="Status"><MultiCheck options={STATUS_OPTIONS} value={filters.status} onChange={(v) => update({ status: v })} /></Field>
              <Field label="Priority"><MultiCheck options={PRIORITY_OPTIONS} value={filters.priority} onChange={(v) => update({ priority: v })} /></Field>
              <Field label="Agent"><Select small placeholder="Any agent" value={filters.responder_id[0] || ''} onChange={(v) => update({ responder_id: v ? [v] : [] })} options={[{ value: 'none', label: 'Unassigned' }, ...agents.map((a) => ({ value: String(a.id), label: a.name }))]} /></Field>
              <Field label="Group"><Select small placeholder="Any group" value={filters.group_id[0] || ''} onChange={(v) => update({ group_id: v ? [v] : [] })} options={groups.map((g) => ({ value: String(g.id), label: g.name }))} /></Field>
              <Field label="Type"><Select small placeholder="Any type" value={filters.type[0] || ''} onChange={(v) => update({ type: v ? [v] : [] })} options={TYPE_OPTIONS} /></Field>
              <Field label="Source"><Select small placeholder="Any source" value={filters.source[0] || ''} onChange={(v) => update({ source: v ? [v] : [] })} options={SOURCE_OPTIONS} /></Field>
              <Field label="Tag"><Select small placeholder="Any tag" value={filters.tags[0] || ''} onChange={(v) => update({ tags: v ? [v] : [] })} options={tags.map((t) => ({ value: t.name, label: `${t.name} (${t.ticket_count})` }))} /></Field>
              <Field label="Created between"><input type="date" className="input input-sm" value={filters.created_from[0] || ''} onChange={(e) => update({ created_from: [e.target.value] })} /><input type="date" className="input input-sm" value={filters.created_to[0] || ''} onChange={(e) => update({ created_to: [e.target.value] })} /></Field>
              {activeFilterCount > 0 && <button className="btn btn-sm" onClick={() => setSaveView(true)}><Save size={13} /> Save as view</button>}
            </div>
          </div>
        </aside>

        <section className="ticket-list">
          <div className="list-toolbar">
            <label className="checkbox"><input type="checkbox" checked={allSelected} onChange={(e) => setSelected(e.target.checked ? data.data.map((t) => t.id) : [])} /></label>
            <span className="title">{VIEWS.find((v) => v.key === view)?.label || 'Tickets'}</span>
            <span className="muted small">{data ? `${data.meta.total} tickets` : ''}</span>
            <input className="input input-sm" style={{ maxWidth: 260, marginLeft: 8 }} placeholder="Search in tickets…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="row" style={{ marginLeft: 'auto' }}>
              <span className="muted small">Sort</span>
              <Select small value={sort} onChange={(v) => update({ sort: v })} options={[{ value: 'created_at', label: 'Date created' }, { value: 'updated_at', label: 'Last modified' }, { value: 'due_by', label: 'Due by' }, { value: 'priority', label: 'Priority' }, { value: 'status', label: 'Status' }, { value: 'last_reply', label: 'Last reply' }]} />
              <button className="btn btn-sm" onClick={() => update({ order: order === 'desc' ? 'asc' : 'desc' })} title="Toggle order"><ArrowUpDown size={14} /> {order === 'desc' ? 'Desc' : 'Asc'}</button>
              <button className="btn btn-sm" onClick={load} title="Refresh"><RefreshCw size={14} /></button>
              <button className="btn btn-sm" onClick={exportCsv} title="Export page to CSV"><Download size={14} /></button>
            </div>
          </div>

          {selected.length > 0 && (
            <div className="bulk-bar">
              <strong>{selected.length} selected</strong>
              <Select small placeholder="Assign to…" value="" onChange={(v) => v && bulk({ responder_id: v === 'none' ? null : Number(v) })} options={[{ value: 'none', label: 'Unassign' }, ...agents.map((a) => ({ value: String(a.id), label: a.name }))]} />
              <Select small placeholder="Set status…" value="" onChange={(v) => v && bulk({ status: v })} options={STATUS_OPTIONS} />
              <Select small placeholder="Set priority…" value="" onChange={(v) => v && bulk({ priority: v })} options={PRIORITY_OPTIONS} />
              <Select small placeholder="Move to group…" value="" onChange={(v) => v && bulk({ group_id: Number(v) })} options={groups.map((g) => ({ value: String(g.id), label: g.name }))} />
              <button className="btn btn-sm" onClick={() => bulk({ responder_id: user.id })}><UserCheck size={13} /> Assign to me</button>
              {view === 'trash' || view === 'spam' ? <button className="btn btn-sm" onClick={() => bulk({ restore: true, spam: false })}>Restore</button> : <>
                <button className="btn btn-sm" onClick={() => bulk({ spam: true })}>Mark spam</button>
                <button className="btn btn-sm btn-danger" onClick={() => bulk({ delete: true })}><Trash2 size={13} /> Delete</button>
              </>}
              <button className="btn btn-sm btn-ghost" onClick={() => setSelected([])}>Clear</button>
            </div>
          )}

          <div className="list-scroll">
            {loading && !data ? <Spinner block /> : data.data.length === 0 ? (
              <EmptyState icon={Inbox} title="No tickets match" message="Try a different view or clear your filters." action={<Link to="/tickets/new" className="btn btn-primary">Create a ticket</Link>} />
            ) : data.data.map((t) => (
              <div key={t.id} className={`ticket-row ${selected.includes(t.id) ? 'selected' : ''}`} onClick={() => navigate(`/tickets/${t.id}`)}>
                <label className="checkbox" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.includes(t.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, t.id] : selected.filter((x) => x !== t.id))} /></label>
                <Avatar name={t.requester_name} src={t.requester_avatar} />
                <div className="flex-1" style={{ minWidth: 0 }}>
                  <div className="subject"><PriorityBadge priority={t.priority} dotOnly /><span className="truncate">{t.subject}</span><span className="muted" style={{ fontWeight: 400 }}>#{t.id}</span>{t.is_escalated && <span className="badge badge-red">Escalated</span>}</div>
                  <div className="meta">
                    <span>{t.requester_name}</span>{t.company_name && <span>· {t.company_name}</span>}<span>· {titleCase(t.source)}</span><span>· created {fmtRelative(t.created_at)}</span>
                    {Number(t.reply_count) > 0 && <span className="row" style={{ gap: 3 }}><MessageSquare size={12} />{t.reply_count}</span>}
                    {Number(t.attachment_count) > 0 && <span className="row" style={{ gap: 3 }}><Paperclip size={12} />{t.attachment_count}</span>}
                    {t.tags?.map((tag) => <span key={tag} className="tag-chip">{tag}</span>)}
                  </div>
                </div>
                <div className="cell hide-md"><span className="k">Status</span><StatusBadge status={t.status} /></div>
                <div className="cell hide-md"><span className="k">Priority</span><PriorityBadge priority={t.priority} /></div>
                <div className="cell"><span className="k">{t.responder_name ? 'Agent' : 'Unassigned'}</span><span className="truncate">{t.responder_name || t.group_name || '—'}</span>
                  {['open', 'pending'].includes(t.status) ? <SlaPill status={t.sla_status} dueBy={t.due_by} /> : <span className="muted small">{titleCase(t.status)} {fmtRelative(t.resolved_at || t.updated_at)}</span>}
                  {t.status === 'open' && t.due_by && <span className="small muted">{fmtDue(t.due_by)}</span>}
                </div>
              </div>
            ))}
          </div>
          {data && <Pagination meta={data.meta} onPage={(p) => update({ page: String(p) }, false)} />}
        </section>
      </div>
      {saveView && <SaveViewModal filters={{ ...Object.fromEntries(FILTER_KEYS.map((k) => [k, filters[k]]).filter(([, v]) => v.length)), view }} onClose={() => setSaveView(false)} onSaved={(v) => { setViews([...views, v]); setSaveView(false); toast.success('View saved'); }} />}
    </div>
  );
}

function SaveViewModal({ filters, onClose, onSaved }) {
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState('private');
  const toast = useToast();
  const save = async () => {
    try { const r = await post('/saved-views', { name, filters, visibility }); onSaved(r.data); } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <Modal title="Save view" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={!name}>Save view</button></>}>
      <div className="form-grid">
        <Field label="View name" required><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label="Visible to"><Select value={visibility} onChange={setVisibility} options={[{ value: 'private', label: 'Only me' }, { value: 'all_agents', label: 'All agents' }]} /></Field>
      </div>
    </Modal>
  );
}
