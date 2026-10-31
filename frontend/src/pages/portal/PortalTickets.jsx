import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Ticket } from 'lucide-react';
import { get } from '../../api/client.js';
import { Spinner, StatusBadge, PriorityBadge, EmptyState, Pagination, Select } from '../../components/ui.jsx';
import { fmtRelative, fmtSmart } from '../../utils/format.js';

export default function PortalTickets() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => { get('/tickets', { status: status || undefined, page, per_page: 20, sort: 'updated_at' }).then(setData); }, [status, page]);
  return (
    <div className="portal-container">
      <div className="page-header"><div><h1>My tickets</h1><p className="sub">{data ? `${data.meta.total} requests` : ''}</p></div>
        <div className="page-actions"><Select value={status} placeholder="All statuses" onChange={(v) => { setStatus(v); setPage(1); }} options={[{ value: 'open,pending', label: 'Open' }, { value: 'resolved,closed', label: 'Resolved' }]} /><Link to="/portal/tickets/new" className="btn btn-primary"><Plus size={15} /> New ticket</Link></div></div>
      <div className="card">
        {!data ? <Spinner block /> : data.data.length === 0 ? <EmptyState icon={Ticket} title="No tickets yet" message="Submit a request and track its progress here." action={<Link to="/portal/tickets/new" className="btn btn-primary">Submit a ticket</Link>} /> : (
          <table className="table"><thead><tr><th>#</th><th>Subject</th><th>Status</th><th>Priority</th><th>Agent</th><th>Last update</th><th>Created</th></tr></thead>
            <tbody>{data.data.map((t) => (
              <tr key={t.id} className="clickable" onClick={() => navigate(`/portal/tickets/${t.id}`)}><td className="muted">#{t.id}</td><td className="strong">{t.subject}</td><td><StatusBadge status={t.status} /></td><td><PriorityBadge priority={t.priority} /></td><td>{t.responder_name || <span className="muted">Not yet assigned</span>}</td><td className="small">{fmtSmart(t.updated_at)}</td><td className="muted small">{fmtRelative(t.created_at)}</td></tr>
            ))}</tbody></table>
        )}
        {data && <Pagination meta={data.meta} onPage={setPage} />}
      </div>
    </div>
  );
}
