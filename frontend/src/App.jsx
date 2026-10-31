import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { Spinner } from './components/ui.jsx';
import Layout from './components/Layout.jsx';
import PortalLayout from './components/PortalLayout.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Tickets from './pages/Tickets.jsx';
import TicketDetail from './pages/TicketDetail.jsx';
import NewTicket from './pages/NewTicket.jsx';
import Contacts from './pages/Contacts.jsx';
import ContactDetail from './pages/ContactDetail.jsx';
import Companies from './pages/Companies.jsx';
import CompanyDetail from './pages/CompanyDetail.jsx';
import KnowledgeBase from './pages/KnowledgeBase.jsx';
import ArticleEditor from './pages/ArticleEditor.jsx';
import CannedResponses from './pages/CannedResponses.jsx';
import Reports from './pages/Reports.jsx';
import Profile from './pages/Profile.jsx';
import AdminLayout from './pages/admin/AdminLayout.jsx';
import General from './pages/admin/General.jsx';
import Agents from './pages/admin/Agents.jsx';
import Groups from './pages/admin/Groups.jsx';
import SlaPolicies from './pages/admin/SlaPolicies.jsx';
import Automations from './pages/admin/Automations.jsx';
import Tags from './pages/admin/Tags.jsx';
import BusinessHours from './pages/admin/BusinessHours.jsx';
import TicketFields from './pages/admin/TicketFields.jsx';
import PortalHome from './pages/portal/PortalHome.jsx';
import PortalArticle from './pages/portal/PortalArticle.jsx';
import PortalTickets from './pages/portal/PortalTickets.jsx';
import PortalTicketDetail from './pages/portal/PortalTicketDetail.jsx';
import PortalNewTicket from './pages/portal/PortalNewTicket.jsx';

function RequireAgent() {
  const { user, loading, isAgent } = useAuth();
  if (loading) return <Spinner block />;
  if (!user) return <Navigate to="/login" replace />;
  if (!isAgent) return <Navigate to="/portal" replace />;
  return <Outlet />;
}

function RequireUser() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner block />;
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function Home() {
  const { user, loading, isAgent } = useAuth();
  if (loading) return <Spinner block />;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={isAgent ? '/dashboard' : '/portal'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      <Route element={<RequireAgent />}>
        <Route element={<Layout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/tickets" element={<Tickets />} />
          <Route path="/tickets/new" element={<NewTicket />} />
          <Route path="/tickets/:id" element={<TicketDetail />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/contacts/:id" element={<ContactDetail />} />
          <Route path="/companies" element={<Companies />} />
          <Route path="/companies/:id" element={<CompanyDetail />} />
          <Route path="/solutions" element={<KnowledgeBase />} />
          <Route path="/solutions/articles/new" element={<ArticleEditor />} />
          <Route path="/solutions/articles/:id" element={<ArticleEditor />} />
          <Route path="/canned-responses" element={<CannedResponses />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<General />} />
            <Route path="agents" element={<Agents />} />
            <Route path="groups" element={<Groups />} />
            <Route path="sla" element={<SlaPolicies />} />
            <Route path="automations" element={<Automations />} />
            <Route path="tags" element={<Tags />} />
            <Route path="business-hours" element={<BusinessHours />} />
            <Route path="ticket-fields" element={<TicketFields />} />
          </Route>
        </Route>
      </Route>

      <Route path="/portal" element={<PortalLayout />}>
        <Route index element={<PortalHome />} />
        <Route path="articles/:slug" element={<PortalArticle />} />
        <Route element={<RequireUser />}>
          <Route path="tickets" element={<PortalTickets />} />
          <Route path="tickets/new" element={<PortalNewTicket />} />
          <Route path="tickets/:id" element={<PortalTicketDetail />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
