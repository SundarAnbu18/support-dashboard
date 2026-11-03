import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Settings, Users, UsersRound, Timer, Zap, Tag, Clock, ListPlus, ShieldCheck, CircleDot, ListChecks, FileStack, Play, FileText, Package, Contact, Smile, Mail, Radio, Lock, Download, Search } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';

const SECTIONS = [
  { title: 'Team', items: [
    { to: '/admin/agents', icon: Users, label: 'Agents' },
    { to: '/admin/groups', icon: UsersRound, label: 'Groups' },
    { to: '/admin/roles', icon: ShieldCheck, label: 'Roles' },
    { to: '/admin/business-hours', icon: Clock, label: 'Business hours' },
    { to: '/admin/agent-statuses', icon: CircleDot, label: 'Agent statuses' },
  ] },
  { title: 'Channels', items: [
    { to: '/admin/channels', icon: Radio, label: 'Email & channels' },
    { to: '/admin/email-notifications', icon: Mail, label: 'Email notifications' },
  ] },
  { title: 'Workflows', items: [
    { to: '/admin/ticket-fields', icon: ListPlus, label: 'Ticket fields' },
    { to: '/admin/ticket-statuses', icon: ListChecks, label: 'Ticket statuses' },
    { to: '/admin/ticket-forms', icon: FileStack, label: 'Ticket forms' },
    { to: '/admin/sla', icon: Timer, label: 'SLA policies' },
    { to: '/admin/automations', icon: Zap, label: 'Automations' },
    { to: '/admin/surveys', icon: Smile, label: 'Satisfaction surveys' },
  ] },
  { title: 'Agent productivity', items: [
    { to: '/admin/ticket-templates', icon: FileText, label: 'Ticket templates' },
    { to: '/admin/scenarios', icon: Play, label: 'Scenarios' },
    { to: '/admin/tags', icon: Tag, label: 'Tags' },
  ] },
  { title: 'Support operations', items: [
    { to: '/admin/entity-fields', icon: Contact, label: 'Contact & company fields' },
    { to: '/admin/products', icon: Package, label: 'Products' },
  ] },
  { title: 'Account', items: [
    { to: '/admin', end: true, icon: Settings, label: 'General' },
    { to: '/admin/security', icon: Lock, label: 'Security' },
    { to: '/admin/exports', icon: Download, label: 'Account exports' },
  ] },
];

export default function AdminLayout() {
  const { isAdmin } = useAuth();
  const [q, setQ] = useState('');
  const match = (label) => label.toLowerCase().includes(q.trim().toLowerCase());
  return (
    <div className="content">
      <div className="page-header"><div><h1>Admin</h1><p className="sub">{isAdmin ? 'Configure your helpdesk.' : 'You can view settings; only admins can change them.'}</p></div></div>
      <div className="admin-layout">
        <nav className="card admin-nav">
          <div style={{ position: 'relative', marginBottom: 8 }}><Search size={14} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--gray-400)' }} /><input className="input input-sm" style={{ paddingLeft: 28 }} aria-label="Search settings" placeholder="Search settings…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          {SECTIONS.map((s) => {
            const items = s.items.filter((n) => match(n.label));
            if (!items.length) return null;
            return (
              <div key={s.title}>
                <div className="muted small strong" style={{ padding: '10px 10px 4px' }}>{s.title}</div>
                {items.map((n) => <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}><n.icon size={16} />{n.label}</NavLink>)}
              </div>
            );
          })}
        </nav>
        <div><Outlet /></div>
      </div>
    </div>
  );
}
