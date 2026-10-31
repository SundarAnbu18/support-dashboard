import { NavLink, Outlet } from 'react-router-dom';
import { Settings, Users, UsersRound, Timer, Zap, Tag, Clock, ListPlus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';

const NAV = [
  { to: '/admin', end: true, icon: Settings, label: 'General' },
  { to: '/admin/agents', icon: Users, label: 'Agents' },
  { to: '/admin/groups', icon: UsersRound, label: 'Groups' },
  { to: '/admin/sla', icon: Timer, label: 'SLA policies' },
  { to: '/admin/automations', icon: Zap, label: 'Automations' },
  { to: '/admin/tags', icon: Tag, label: 'Tags' },
  { to: '/admin/business-hours', icon: Clock, label: 'Business hours' },
  { to: '/admin/ticket-fields', icon: ListPlus, label: 'Ticket fields' },
];

export default function AdminLayout() {
  const { isAdmin } = useAuth();
  return (
    <div className="content">
      <div className="page-header"><div><h1>Admin</h1><p className="sub">{isAdmin ? 'Configure your helpdesk.' : 'You can view settings; only admins can change them.'}</p></div></div>
      <div className="admin-layout">
        <nav className="card admin-nav">
          {NAV.map((n) => <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}><n.icon size={16} />{n.label}</NavLink>)}
        </nav>
        <div><Outlet /></div>
      </div>
    </div>
  );
}
