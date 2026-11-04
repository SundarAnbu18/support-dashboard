import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, Link } from 'react-router-dom';
import { LogOut, Ticket, BookOpen, Plus, LayoutDashboard, MessagesSquare } from 'lucide-react';
import { get } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Avatar, Dropdown } from './ui.jsx';
import { NotificationsMenu } from './Layout.jsx';

export default function PortalLayout() {
  const { user, logout, isAgent } = useAuth();
  const navigate = useNavigate();
  const [brand, setBrand] = useState('Help Center');
  useEffect(() => { get('/settings/public').then((r) => setBrand(r.data.portal_name || 'Help Center')).catch(() => {}); }, []);
  return (
    <div className="portal-shell">
      <nav className="portal-nav">
        <div className="inner">
          <Link to="/portal" className="brand"><img className="brand-logo" src="/brand/wadhwani-logo.png" alt="Wadhwani Foundation" /> {brand}</Link>
          <div className="links">
            <NavLink to="/portal" end><BookOpen size={15} style={{ verticalAlign: -2, marginRight: 6 }} />Knowledge base</NavLink>
            <NavLink to="/portal/community"><MessagesSquare size={15} style={{ verticalAlign: -2, marginRight: 6 }} />Community</NavLink>
            {user && <NavLink to="/portal/tickets"><Ticket size={15} style={{ verticalAlign: -2, marginRight: 6 }} />My tickets</NavLink>}
          </div>
          <div className="topbar-actions">
            <Link to="/portal/tickets/new" className="btn btn-primary"><Plus size={16} /> New ticket</Link>
            {user ? (
              <>
                <NotificationsMenu />
                <Dropdown trigger={<button className="icon-btn" style={{ width: 'auto', padding: '0 4px' }}><Avatar name={user.name} src={user.avatar_url} /></button>}>
                  <div style={{ padding: '8px 10px' }} onClick={(e) => e.stopPropagation()}>
                    <div className="strong">{user.name}</div>
                    <div className="muted small">{user.email}</div>
                  </div>
                  <div className="divider" style={{ margin: '4px 0' }} />
                  {isAgent && <button onClick={() => navigate('/dashboard')}><LayoutDashboard size={15} /> Back to agent dashboard</button>}
                  <button className="danger" onClick={() => { logout(); navigate('/login'); }}><LogOut size={15} /> Sign out</button>
                </Dropdown>
              </>
            ) : (
              <Link to="/login" className="btn">Sign in</Link>
            )}
          </div>
        </div>
      </nav>
      <Outlet />
    </div>
  );
}
