import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, Link } from 'react-router-dom';
import { LayoutDashboard, Ticket, Users, Building2, BookOpen, BarChart3, Settings, LogOut, Plus, Bell, Search, ChevronsLeft, ChevronsRight, Headset, User, MessageSquareText, MessagesSquare, Trophy, ChevronDown, FileText, Mail } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { get, post, patch, put } from '../api/client.js';
import { Avatar, Dropdown, useDebounce } from './ui.jsx';
import { fmtRelative } from '../utils/format.js';
import { StatusBadge } from './ui.jsx';

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [open, setOpen] = useState(false);
  const dq = useDebounce(q, 250);
  const navigate = useNavigate();
  useEffect(() => {
    if (!dq.trim()) { setResults(null); return; }
    let alive = true;
    get('/search', { q: dq }).then((r) => alive && setResults(r.data)).catch(() => {});
    return () => { alive = false; };
  }, [dq]);
  const go = (path) => { setOpen(false); setQ(''); navigate(path); };
  const total = results ? Object.values(results).reduce((a, b) => a + b.length, 0) : 0;
  return (
    <div className="search" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
      <Search size={16} />
      <input placeholder="Search tickets, contacts, companies, articles…" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === 'Enter' && q.trim()) go(`/tickets?q=${encodeURIComponent(q)}`); if (e.key === 'Escape') setOpen(false); }} />
      {open && results && (
        <div className="search-results">
          {total === 0 && <div className="muted" style={{ padding: 12 }}>No results for "{dq}"</div>}
          {results.tickets.length > 0 && <div className="group-title">Tickets</div>}
          {results.tickets.map((t) => <a key={t.id} href={`/tickets/${t.id}`} onMouseDown={(e) => { e.preventDefault(); go(`/tickets/${t.id}`); }}><span className="muted">#{t.id}</span><span className="flex-1 truncate">{t.subject}</span><StatusBadge status={t.status} /></a>)}
          {results.contacts.length > 0 && <div className="group-title">Contacts</div>}
          {results.contacts.map((c) => <a key={c.id} href={`/contacts/${c.id}`} onMouseDown={(e) => { e.preventDefault(); go(`/contacts/${c.id}`); }}><Avatar name={c.name} size="sm" /><span>{c.name}</span><span className="muted small">{c.email}</span></a>)}
          {results.companies.length > 0 && <div className="group-title">Companies</div>}
          {results.companies.map((c) => <a key={c.id} href={`/companies/${c.id}`} onMouseDown={(e) => { e.preventDefault(); go(`/companies/${c.id}`); }}><Building2 size={16} /><span>{c.name}</span></a>)}
          {results.articles.length > 0 && <div className="group-title">Knowledge base</div>}
          {results.articles.map((a) => <a key={a.id} href={`/solutions/articles/${a.id}`} onMouseDown={(e) => { e.preventDefault(); go(`/solutions/articles/${a.id}`); }}><BookOpen size={16} /><span className="flex-1 truncate">{a.title}</span><span className="badge badge-gray">{a.status}</span></a>)}
          {total > 0 && <a href={`/tickets?q=${encodeURIComponent(dq)}`} onMouseDown={(e) => { e.preventDefault(); go(`/tickets?q=${encodeURIComponent(dq)}`); }} style={{ color: 'var(--primary-600)', justifyContent: 'center' }}>Search all tickets for "{dq}"</a>}
        </div>
      )}
    </div>
  );
}

export function NotificationsMenu({ linkPrefix = '' }) {
  const [data, setData] = useState({ data: [], unread: 0 });
  const navigate = useNavigate();
  const load = () => get('/notifications').then(setData).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, []);
  const openItem = async (n) => {
    if (!n.is_read) await patch(`/notifications/${n.id}`, { is_read: true }).catch(() => {});
    load();
    if (n.link) navigate(n.link);
  };
  return (
    <Dropdown wide trigger={<button className="icon-btn" aria-label="Notifications"><Bell size={18} />{data.unread > 0 && <span className="dot">{data.unread}</span>}</button>}>
      <div className="row-between" style={{ padding: '6px 10px' }} onClick={(e) => e.stopPropagation()}>
        <strong>Notifications</strong>
        {data.unread > 0 && <button className="btn-link small" onClick={() => post('/notifications/read-all').then(load)}>Mark all read</button>}
      </div>
      <div className="notif-list" onClick={(e) => e.stopPropagation()}>
        {data.data.length === 0 && <div className="muted" style={{ padding: 14 }}>You're all caught up.</div>}
        {data.data.map((n) => (
          <div key={n.id} className={`notif ${n.is_read ? '' : 'unread'}`} onClick={() => openItem(n)}>
            <div className="col flex-1">
              <span className="title">{n.title}</span>
              {n.body && <span className="body truncate">{n.body}</span>}
              <span className="when">{fmtRelative(n.created_at)}</span>
            </div>
          </div>
        ))}
      </div>
    </Dropdown>
  );
}

// Agent availability; round-robin assignment respects it.
function AgentStatusMenu() {
  const { user, refresh } = useAuth();
  const [statuses, setStatuses] = useState([]);
  useEffect(() => { get('/config/agent-statuses').then((r) => setStatuses(r.data)).catch(() => {}); }, []);
  const current = statuses.find((s) => s.id === user?.agent_status_id) || statuses.find((s) => s.is_default);
  if (!current) return null;
  return (
    <Dropdown trigger={<button className="btn btn-sm btn-ghost" aria-label="Set your availability">{current.emoji} {current.name}<ChevronDown size={13} /></button>}>
      {statuses.map((s) => <button key={s.id} onClick={() => put('/auth/me', { agent_status_id: s.id }).then(refresh)}>{s.emoji} {s.name}</button>)}
    </Dropdown>
  );
}

export default function Layout() {
  const { user, logout, isAdmin } = useAuth();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sd_sidebar') === '1');
  const [counts, setCounts] = useState({});
  const navigate = useNavigate();
  useEffect(() => { localStorage.setItem('sd_sidebar', collapsed ? '1' : '0'); }, [collapsed]);
  useEffect(() => {
    const load = () => get('/tickets/counts').then((r) => setCounts(r.data)).catch(() => {});
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  const nav = [
    { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/tickets', icon: Ticket, label: 'Tickets', badge: counts.unresolved },
    { to: '/contacts', icon: Users, label: 'Contacts' },
    { to: '/companies', icon: Building2, label: 'Companies' },
    { to: '/solutions', icon: BookOpen, label: 'Knowledge Base' },
    { to: '/forums', icon: MessagesSquare, label: 'Forums' },
    { to: '/canned-responses', icon: MessageSquareText, label: 'Canned Responses' },
    ...(user?.privileges?.includes('view_reports') ? [{ to: '/reports', icon: BarChart3, label: 'Analytics' }] : []),
    { to: '/arcade', icon: Trophy, label: 'Arcade' },
  ];

  return (
    <div className="app-shell">
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-brand">
          <img className="brand-logo" src="/brand/wadhwani-logo.png" alt="Wadhwani Foundation" />
          <img className="brand-mark" src="/brand/wadhwani-mark.png" alt="Wadhwani Foundation" />
        </div>
        <nav className="sidebar-nav">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? 'active' : '')} title={n.label}>
              <n.icon size={18} /><span className="nav-label">{n.label}</span>
              {!collapsed && n.badge > 0 && <span className="nav-badge">{n.badge}</span>}
            </NavLink>
          ))}
          <div className="nav-section">Account</div>
          <NavLink to="/admin" className={({ isActive }) => (isActive ? 'active' : '')} title="Admin">
            <Settings size={18} /><span className="nav-label">{isAdmin ? 'Admin' : 'Settings'}</span>
          </NavLink>
          <NavLink to="/profile" className={({ isActive }) => (isActive ? 'active' : '')} title="Profile">
            <User size={18} /><span className="nav-label">My profile</span>
          </NavLink>
        </nav>
        <div className="sidebar-footer">
          <button onClick={() => setCollapsed((c) => !c)} title="Toggle sidebar">
            {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}<span className="nav-label">Collapse</span>
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <GlobalSearch />
          <div className="topbar-actions">
            <AgentStatusMenu />
            <Dropdown trigger={<button className="btn btn-primary"><Plus size={16} /> New <ChevronDown size={13} /></button>}>
              <button onClick={() => navigate('/tickets/new')}><Ticket size={15} /> Ticket</button>
              <button onClick={() => navigate('/tickets/new?outbound=1')}><Mail size={15} /> Email</button>
              <button onClick={() => navigate('/contacts?new=1')}><Users size={15} /> Contact</button>
              <button onClick={() => navigate('/companies?new=1')}><Building2 size={15} /> Company</button>
              <button onClick={() => navigate('/solutions/articles/new')}><FileText size={15} /> Article</button>
              <button onClick={() => navigate('/forums?new=1')}><MessagesSquare size={15} /> Forum topic</button>
            </Dropdown>
            <NotificationsMenu />
            <Dropdown trigger={<button className="icon-btn" style={{ width: 'auto', padding: '0 4px' }}><Avatar name={user?.name} src={user?.avatar_url} /></button>}>
              <div style={{ padding: '8px 10px' }} onClick={(e) => e.stopPropagation()}>
                <div className="strong">{user?.name}</div>
                <div className="muted small">{user?.email}</div>
                <div className="badge badge-blue mt-1">{user?.role}</div>
              </div>
              <div className="divider" style={{ margin: '4px 0' }} />
              <button onClick={() => navigate('/profile')}><User size={15} /> My profile</button>
              <button onClick={() => navigate('/portal')}><Headset size={15} /> View customer portal</button>
              <button className="danger" onClick={() => { logout(); navigate('/login'); }}><LogOut size={15} /> Sign out</button>
            </Dropdown>
          </div>
        </header>
        <Outlet context={{ counts }} />
      </div>
    </div>
  );
}
