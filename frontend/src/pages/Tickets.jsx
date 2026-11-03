import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Filter, X, Save, Trash2, UserCheck, ArrowUpDown, RefreshCw, Paperclip, MessageSquare, Inbox, Download, Search, LayoutList, Table2, Play, MailWarning } from 'lucide-react';
import { get, post, patch, del, downloadFile, errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Spinner, StatusBadge, PriorityBadge, SlaPill, Avatar, Pagination, EmptyState, Select, Modal, Field, useDebounce } from '../components/ui.jsx';
import { fmtRelative, fmtDue, statusOptions, PRIORITY_OPTIONS, TYPE_OPTIONS, SOURCE_OPTIONS, titleCase } from '../utils/format.js';

const VIEWS = [
  { key: 'all', label: 'All tickets', count: 'all_tickets' },
  { key: 'unresolved', label: 'All unresolved', count: 'unresolved' },
  { key: 'new_and_my_open', label: 'New & my open', count: null },
  { key: 'my_open', label: 'My open tickets', count: 'my_open' },
  { key: 'unassigned', label: 'Unassigned', count: 'unassigned' },
  { key: 'overdue', label: 'Overdue', count: 'overdue' },
  { key: 'due_today', label: 'Due today', count: 'due_today' },
  { key: 'open', label: 'Open', count: 'open' },
  { key: 'on_hold', label: 'On hold', count: 'pending' },
  { key: 'resolved', label: 'Resolved', count: 'resolved' },
  { key: 'closed', label: 'Closed', count: 'closed' },
  { key: 'raised', label: 'Tickets I raised', count: 'raised' },
  { key: 'mentioned', label: "Tickets I'm mentioned in", count: 'mentioned' },
  { key: 'watching', label: "Tickets I'm watching", count: 'watching' },
  { key: 'archive', label: 'Archive', count: 'archive' },
  { key: 'spam', label: 'Spam', count: 'spam' },
  { key: 'trash', label: 'Trash', count: 'trash' },
];
const FILTER_KEYS = ['status', 'priority', 'type', 'source', 'responder_id', 'group_id', 'product_id', 'tags', 'created_from', 'created_to', 'due_from', 'due_to', 'resolved_from', 'resolved_to', 'closed_from', 'closed_to'];

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
  const [products, setProducts] = useState([]);
  const [scenarios, setScenarios] = useState([]);
  const [viewSearch, setViewSearch] = useState('');
  const [layout, setLayout] = useState(() => localStorage.getItem('sd_ticket_layout') || 'card');
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
    get('/config/products').then((r) => setProducts(r.data)).catch(() => {});
    get('/config/scenarios').then((r) => setScenarios(r.data)).catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    const query = { view, sort, order, page, per_page: 30, q: params.get('q') || undefined };
    for (const k of FILTER_KEYS) if (filters[k].length) query[k] = filters[k].join(',');
    Promise.all([get('/tickets', query), get('/tickets/counts')]).then(([t, c]) => { setData(t); setCounts(c.data); setSelected([]); sessionStorage.setItem('sd_ticket_ids', JSON.stringify(t.data.map((x) => x.id))); }).catch((e) => toast.error(errorMessage(e))).finally(() => setLoading(false));
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

  // Exports everything matching the current view and filters, not just this page.
  const exportCsv = () => {
    const query = new URLSearchParams({ view });
    if (params.get('q')) query.set('q', params.get('q'));
    for (const k of FILTER_KEYS) if (filters[k].length) query.set(k, filters[k].join(','));
    downloadFile(`/tickets/export?${query}`, 'tickets.csv').catch((e) => toast.error(errorMessage(e)));
  };
  const quickUpdate = (id, changes) => patch(`/tickets/${id}`, changes).then(load).catch((e) => toast.error(errorMessage(e)));
  const switchLayout = (next) => { setLayout(next); localStorage.setItem('sd_ticket_layout', next); };
  const bulkScenario = async (sid) => {
    try { await post('/tickets/bulk-scenario', { scenario_id: Number(sid), ids: selected }); toast.success(`Scenario applied to ${selected.length} ticket(s)`); load(); } catch (e) { toast.error(errorMessage(e)); }
  };
  const matchesViewSearch = (label) => label.toLowerCase().includes(viewSearch.trim().toLowerCase());
  const personalViews = views.filter((v) => v.visibility === 'private' && matchesViewSearch(v.name));
  const sharedViews = views.filter((v) => v.visibility !== 'private' && matchesViewSearch(v.name));
  const savedViewButton = (v) => (
    <button key={v.id} onClick={() => applySavedView(v)}>
      <span className="truncate">{v.name}</span>
      {(v.user_id === user.id || user.role === 'admin') && <X size={13} className="muted" onClick={(e) => { e.stopPropagation(); del(`/saved-views/${v.id}`).then(() => setViews(views.filter((x) => x.id !== v.id))); }} />}
    </button>
  );

  return (
    <div className="content flush">
      <div className="ticket-layout">
        <aside className="filter-panel">
          <div style={{ position: 'relative' }}><Search size={14} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--gray-400)' }} /><input className="input input-sm" style={{ paddingLeft: 28 }} aria-label="Search for a view" placeholder="Search for a view" value={viewSearch} onChange={(e) => setViewSearch(e.target.value)} /></div>
          {personalViews.length > 0 && <div><h4>Personal</h4><div className="view-list">{personalViews.map(savedViewButton)}</div></div>}
          {sharedViews.length > 0 && <div><h4>Shared</h4><div className="view-list">{sharedViews.map(savedViewButton)}</div></div>}
          <div>
            <h4>Default</h4>
            <div className="view-list">
              {VIEWS.filter((v) => matchesViewSearch(v.label)).map((v) => (
                <button key={v.key} className={view === v.key && activeFilterCount === 0 ? 'active' : view === v.key ? 'active' : ''} onClick={() => { clearFilters(); update({ view: v.key }); }}>
                  <span>{v.label}</span>{v.count && counts[v.count] !== undefined && <span className="count">{counts[v.count]}</span>}
                </button>
              ))}
            </div>
          </div>
          <div className="view-list"><Link className="row small muted" style={{ padding: '4px 8px', gap: 6 }} to="/undelivered"><MailWarning size={14} /> All undelivered messages</Link></div>
          <div>
            <div className="row-between"><h4 style={{ margin: 0 }}><Filter size={12} style={{ verticalAlign: -1 }} /> Filters {activeFilterCount > 0 && <span className="badge badge-blue">{activeFilterCount}</span>}</h4>{activeFilterCount > 0 && <button className="btn-link small" onClick={clearFilters}>Clear</button>}</div>
            <div className="col mt-2" style={{ gap: 14 }}>
              <Field label="Status"><MultiCheck options={statusOptions()} value={filters.status} onChange={(v) => update({ status: v })} /></Field>
              <Field label="Priority"><MultiCheck options={PRIORITY_OPTIONS} value={filters.priority} onChange={(v) => update({ priority: v })} /></Field>
              <Field label="Agent"><Select small placeholder="Any agent" value={filters.responder_id[0] || ''} onChange={(v) => update({ responder_id: v ? [v] : [] })} options={[{ value: 'none', label: 'Unassigned' }, ...agents.map((a) => ({ value: String(a.id), label: a.name }))]} /></Field>
              <Field label="Group"><Select small placeholder="Any group" value={filters.group_id[0] || ''} onChange={(v) => update({ group_id: v ? [v] : [] })} options={groups.map((g) => ({ value: String(g.id), label: g.name }))} /></Field>
              {products.length > 0 && <Field label="Product"><Select small placeholder="Any product" value={filters.product_id[0] || ''} onChange={(v) => update({ product_id: v ? [v] : [] })} options={products.map((p) => ({ value: String(p.id), label: p.name }))} /></Field>}
              <Field label="Type"><Select small placeholder="Any type" value={filters.type[0] || ''} onChange={(v) => update({ type: v ? [v] : [] })} options={TYPE_OPTIONS} /></Field>
              <Field label="Source"><Select small placeholder="Any source" value={filters.source[0] || ''} onChange={(v) => update({ source: v ? [v] : [] })} options={SOURCE_OPTIONS} /></Field>
              <Field label="Tag"><Select small placeholder="Any tag" value={filters.tags[0] || ''} onChange={(v) => update({ tags: v ? [v] : [] })} options={tags.map((t) => ({ value: t.name, label: `${t.name} (${t.ticket_count})` }))} /></Field>
              <Field label="Created between"><input type="date" className="input input-sm" value={filters.created_from[0] || ''} onChange={(e) => update({ created_from: [e.target.value] })} /><input type="date" className="input input-sm" value={filters.created_to[0] || ''} onChange={(e) => update({ created_to: [e.target.value] })} /></Field>
              {[['due', 'Resolution due between'], ['resolved', 'Resolved between'], ['closed', 'Closed between']].map(([key, label]) => (
                <Field key={key} label={label}><input type="date" aria-label={`${label} from`} className="input input-sm" value={filters[`${key}_from`][0] || ''} onChange={(e) => update({ [`${key}_from`]: [e.target.value] })} /><input type="date" aria-label={`${label} to`} className="input input-sm" value={filters[`${key}_to`][0] || ''} onChange={(e) => update({ [`${key}_to`]: [e.target.value] })} /></Field>
              ))}
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
              <button className="btn btn-sm" aria-label={layout === 'card' ? 'Switch to table layout' : 'Switch to card layout'} title={layout === 'card' ? 'Table layout' : 'Card layout'} onClick={() => switchLayout(layout === 'card' ? 'table' : 'card')}>{layout === 'card' ? <Table2 size={14} /> : <LayoutList size={14} />}</button>
              {user.privileges?.includes('export_data') && <button className="btn btn-sm" onClick={exportCsv} title="Export all matching tickets to CSV"><Download size={14} /> Export</button>}
            </div>
          </div>

          {selected.length > 0 && (
            <div className="bulk-bar">
              <strong>{selected.length} selected</strong>
              <Select small placeholder="Assign to…" value="" onChange={(v) => v && bulk({ responder_id: v === 'none' ? null : Number(v) })} options={[{ value: 'none', label: 'Unassign' }, ...agents.map((a) => ({ value: String(a.id), label: a.name }))]} />
              <Select small placeholder="Set status…" value="" onChange={(v) => v && bulk({ status: v })} options={statusOptions()} />
              {scenarios.length > 0 && <Select small placeholder="Run scenario…" value="" onChange={(v) => v && bulkScenario(v)} options={scenarios.map((s) => ({ value: String(s.id), label: s.name }))} />}
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
            ) : layout === 'table' ? (
              <div className="table-wrap"><table className="table">
                <thead><tr><th style={{ width: 32 }} /><th>Subject</th><th>Requester</th><th>State</th><th>Priority</th><th>Status</th><th>Group</th><th>Agent</th><th>Due</th></tr></thead>
                <tbody>{data.data.map((t) => (
                  <tr key={t.id} className="clickable" onClick={() => navigate(`/tickets/${t.id}`)}>
                    <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ticket ${t.id}`} checked={selected.includes(t.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, t.id] : selected.filter((x) => x !== t.id))} /></td>
                    <td><span className="strong">{t.subject}</span> <span className="muted">#{t.id}</span></td><td>{t.requester_name}</td><td><SlaPill status={t.sla_status} dueBy={t.due_by} /></td>
                    <td><PriorityBadge priority={t.priority} /></td><td><StatusBadge status={t.status} /></td><td>{t.group_name || '—'}</td><td>{t.responder_name || '—'}</td><td className="small muted">{t.due_by ? fmtDue(t.due_by) : '—'}</td>
                  </tr>
                ))}</tbody>
              </table></div>
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
                <div className="cell hide-md" onClick={(e) => e.stopPropagation()}><span className="k">Status</span><Select small aria-label={`Status of ticket ${t.id}`} value={t.status} onChange={(v) => quickUpdate(t.id, { status: v })} options={statusOptions()} /></div>
                <div className="cell hide-md" onClick={(e) => e.stopPropagation()}><span className="k">Priority</span><Select small aria-label={`Priority of ticket ${t.id}`} value={t.priority} onChange={(v) => quickUpdate(t.id, { priority: v })} options={PRIORITY_OPTIONS} /></div>
                <div className="cell"><span className="k">{t.responder_name ? 'Agent' : 'Unassigned'}</span><span className="truncate">{t.responder_name || t.group_name || '—'}</span>
                  {!['resolved', 'closed'].includes(t.status) ? <SlaPill status={t.sla_status} dueBy={t.due_by} /> : <span className="muted small">{titleCase(t.status)} {fmtRelative(t.resolved_at || t.updated_at)}</span>}
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
