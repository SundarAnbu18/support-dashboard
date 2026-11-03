import { useEffect, useState } from 'react';
import { EntityCustomFields } from './NewTicket.jsx';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Pencil, Trash2, Building2, ArrowLeft, Globe } from 'lucide-react';
import { get, del, errorMessage, put } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { Spinner, Avatar, StatusBadge, PriorityBadge, ConfirmDialog, Badge } from '../components/ui.jsx';
import { fmtRelative, fmtDate, titleCase } from '../utils/format.js';
import { CompanyForm } from './Companies.jsx';

const HEALTH = { happy: 'green', neutral: 'gray', at_risk: 'red' };

export default function CompanyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [c, setC] = useState(null);
  const [edit, setEdit] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const load = () => get(`/companies/${id}`).then((r) => setC(r.data)).catch(() => navigate('/companies'));
  useEffect(() => { load(); }, [id]); // eslint-disable-line
  if (!c) return <div className="content"><Spinner block /></div>;
  return (
    <div className="content">
      <div className="row small muted mb-2"><Link to="/companies" className="row" style={{ gap: 4 }}><ArrowLeft size={14} /> Companies</Link></div>
      <div className="detail-layout">
        <div className="col gap-2">
          <div className="card"><div className="card-body row" style={{ gap: 18, alignItems: 'flex-start' }}>
            <span className="avatar avatar-xl" style={{ background: 'var(--blue-50)', color: 'var(--blue-600)', borderRadius: 16 }}><Building2 size={30} /></span>
            <div className="flex-1">
              <div className="row wrap"><h1>{c.name}</h1><Badge color="blue">{titleCase(c.account_tier)}</Badge><Badge color={HEALTH[c.health_score]}>{titleCase(c.health_score)}</Badge></div>
              <div className="muted">{c.industry}</div>
              {c.domains?.length > 0 && <div className="row wrap mt-2 small"><Globe size={14} />{c.domains.map((d) => <span key={d} className="tag-chip">{d}</span>)}</div>}
              {c.description && <p className="mt-2">{c.description}</p>}
            </div>
            <div className="page-actions"><button className="btn" onClick={() => setEdit(true)}><Pencil size={15} /> Edit</button><button className="btn btn-danger" onClick={() => setConfirm(true)}><Trash2 size={15} /></button></div>
          </div></div>
          <div className="card">
            <div className="card-header"><h3>Tickets ({c.ticket_count})</h3><Link to={`/tickets?company_id=${c.id}`} className="small">View all</Link></div>
            <div className="card-body tight">
              {c.tickets.length === 0 ? <div className="muted" style={{ padding: 16 }}>No tickets yet.</div> : (
                <table className="table"><thead><tr><th>#</th><th>Subject</th><th>Requester</th><th>Status</th><th>Priority</th><th>Agent</th><th>Created</th></tr></thead>
                  <tbody>{c.tickets.map((t) => (
                    <tr key={t.id} className="clickable" onClick={() => navigate(`/tickets/${t.id}`)}><td className="muted">#{t.id}</td><td className="strong">{t.subject}</td><td>{t.requester_name}</td><td><StatusBadge status={t.status} /></td><td><PriorityBadge priority={t.priority} /></td><td>{t.responder_name || '—'}</td><td className="muted small">{fmtRelative(t.created_at)}</td></tr>
                  ))}</tbody></table>
              )}
            </div>
          </div>
        </div>
        <aside className="col gap-2">
          <EntityCustomFields entity="company" values={c.custom_fields} onSave={(v) => put(`/companies/${id}`, { custom_fields: v }).then(load)} />
          <div className="card"><div className="card-header"><h3>Account</h3></div><div className="card-body">
            <dl className="kv"><dt>Tier</dt><dd>{titleCase(c.account_tier)}</dd><dt>Health</dt><dd>{titleCase(c.health_score)}</dd><dt>Renewal</dt><dd>{fmtDate(c.renewal_date)}</dd><dt>Open tickets</dt><dd>{c.open_ticket_count}</dd><dt>Created</dt><dd>{fmtDate(c.created_at)}</dd></dl>
            {c.notes && <><div className="divider" /><h4>Internal notes</h4><p className="small mt-1" style={{ whiteSpace: 'pre-wrap' }}>{c.notes}</p></>}
          </div></div>
          <div className="card"><div className="card-header"><h3>Contacts ({c.contacts.length})</h3><Link to={`/contacts?company_id=${c.id}`} className="small">View all</Link></div>
            <div className="card-body col" style={{ gap: 8 }}>
              {c.contacts.length === 0 && <span className="muted">No contacts linked.</span>}
              {c.contacts.map((p) => <Link key={p.id} to={`/contacts/${p.id}`} className="row" style={{ gap: 10, color: 'inherit' }}><Avatar name={p.name} size="sm" /><span className="col" style={{ gap: 0 }}><span className="strong small">{p.name}</span><span className="muted small">{p.job_title || p.email}</span></span></Link>)}
            </div>
          </div>
        </aside>
      </div>
      {edit && <CompanyForm initial={c} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); load(); }} />}
      {confirm && <ConfirmDialog title="Delete company?" message="Contacts and tickets stay but lose their company link." danger confirmLabel="Delete" onCancel={() => setConfirm(false)} onConfirm={async () => { try { await del(`/companies/${id}`); toast.success('Company deleted'); navigate('/companies'); } catch (e) { toast.error(errorMessage(e)); } }} />}
    </div>
  );
}
