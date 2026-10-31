import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Pencil, Trash2, Plus, Mail, Phone, Building2, Ban, ArrowLeft, Merge } from 'lucide-react';
import { get, put, del, post, errorMessage } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { Spinner, Avatar, StatusBadge, PriorityBadge, ConfirmDialog, Modal, useDebounce } from '../components/ui.jsx';
import { fmtRelative, fmtDate } from '../utils/format.js';
import { ContactForm } from './Contacts.jsx';

export default function ContactDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [c, setC] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [edit, setEdit] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [merge, setMerge] = useState(false);
  const load = () => get(`/contacts/${id}`).then((r) => setC(r.data)).catch(() => navigate('/contacts'));
  useEffect(() => { load(); get('/companies', { per_page: 200 }).then((r) => setCompanies(r.data)); }, [id]); // eslint-disable-line
  if (!c) return <div className="content"><Spinner block /></div>;
  return (
    <div className="content">
      <div className="row small muted mb-2"><Link to="/contacts" className="row" style={{ gap: 4 }}><ArrowLeft size={14} /> Contacts</Link></div>
      <div className="detail-layout">
        <div className="col gap-2">
          <div className="card"><div className="card-body row" style={{ gap: 18, alignItems: 'flex-start' }}>
            <Avatar name={c.name} src={c.avatar_url} size="xl" />
            <div className="flex-1">
              <div className="row wrap"><h1>{c.name}</h1>{c.is_blocked && <span className="badge badge-red"><Ban size={11} /> Blocked</span>}{c.tags?.map((t) => <span key={t} className="tag-chip">{t}</span>)}</div>
              <div className="muted">{c.job_title}{c.job_title && c.company_name && ' · '}{c.company_name && <Link to={`/companies/${c.company_id}`}>{c.company_name}</Link>}</div>
              <div className="row wrap mt-2 small">
                {c.email && <span className="row"><Mail size={14} /> {c.email}</span>}
                {c.phone && <span className="row"><Phone size={14} /> {c.phone}</span>}
                {c.company_name && <span className="row"><Building2 size={14} /> {c.company_name}</span>}
              </div>
              {c.description && <p className="mt-2">{c.description}</p>}
            </div>
            <div className="page-actions">
              <Link to={`/tickets/new?requester_id=${c.id}`} className="btn btn-primary"><Plus size={15} /> New ticket</Link>
              <button className="btn" onClick={() => setEdit(true)}><Pencil size={15} /> Edit</button>
              <button className="btn" onClick={() => setMerge(true)}><Merge size={15} /> Merge</button>
              <button className="btn" onClick={() => put(`/contacts/${id}`, { is_blocked: !c.is_blocked }).then(load)}><Ban size={15} /> {c.is_blocked ? 'Unblock' : 'Block'}</button>
              <button className="btn btn-danger" onClick={() => setConfirm(true)}><Trash2 size={15} /></button>
            </div>
          </div></div>
          <div className="card">
            <div className="card-header"><h3>Tickets ({c.ticket_count})</h3><Link to={`/tickets?requester_id=${c.id}`} className="small">View all</Link></div>
            <div className="card-body tight">
              {c.tickets.length === 0 ? <div className="muted" style={{ padding: 16 }}>No tickets yet.</div> : (
                <table className="table"><thead><tr><th>#</th><th>Subject</th><th>Status</th><th>Priority</th><th>Agent</th><th>Created</th></tr></thead>
                  <tbody>{c.tickets.map((t) => (
                    <tr key={t.id} className="clickable" onClick={() => navigate(`/tickets/${t.id}`)}><td className="muted">#{t.id}</td><td className="strong">{t.subject}</td><td><StatusBadge status={t.status} /></td><td><PriorityBadge priority={t.priority} /></td><td>{t.responder_name || <span className="muted">—</span>}</td><td className="muted small">{fmtRelative(t.created_at)}</td></tr>
                  ))}</tbody></table>
              )}
            </div>
          </div>
        </div>
        <aside className="col gap-2">
          <div className="card"><div className="card-header"><h3>Details</h3></div><div className="card-body">
            <dl className="kv">
              <dt>Email</dt><dd>{c.email || '—'}</dd><dt>Phone</dt><dd>{c.phone || '—'}</dd><dt>Mobile</dt><dd>{c.mobile || '—'}</dd>
              <dt>Address</dt><dd>{c.address || '—'}</dd><dt>Time zone</dt><dd>{c.time_zone}</dd><dt>Language</dt><dd>{c.language}</dd>
              <dt>Portal access</dt><dd>{c.has_portal_access ? <span className="badge badge-green">Enabled</span> : <span className="muted">Not set up</span>}</dd>
              <dt>Open tickets</dt><dd>{c.open_ticket_count}</dd><dt>Created</dt><dd>{fmtDate(c.created_at)}</dd>
            </dl>
          </div></div>
        </aside>
      </div>
      {edit && <ContactForm initial={{ ...c, company_id: c.company_id ? String(c.company_id) : '' }} companies={companies} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); load(); }} />}
      {confirm && <ConfirmDialog title="Delete contact?" message={`This removes ${c.name} and all of their tickets. This cannot be undone.`} danger confirmLabel="Delete" onCancel={() => setConfirm(false)} onConfirm={async () => { try { await del(`/contacts/${id}`); toast.success('Contact deleted'); navigate('/contacts'); } catch (e) { toast.error(errorMessage(e)); } }} />}
      {merge && <MergeContacts primary={c} onClose={() => setMerge(false)} onDone={() => { setMerge(false); load(); toast.success('Contacts merged'); }} />}
    </div>
  );
}

function MergeContacts({ primary, onClose, onDone }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [chosen, setChosen] = useState([]);
  const dq = useDebounce(q, 250);
  const toast = useToast();
  useEffect(() => { get('/contacts', { q: dq || undefined, per_page: 10 }).then((r) => setResults(r.data.filter((x) => x.id !== primary.id))); }, [dq, primary]);
  return (
    <Modal title={`Merge contacts into ${primary.name}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!chosen.length} onClick={() => post(`/contacts/${primary.id}/merge`, { contact_ids: chosen }).then(onDone).catch((e) => toast.error(errorMessage(e)))}>Merge {chosen.length || ''}</button></>}>
      <p className="muted mb-2">Tickets from the selected contacts move to {primary.name}; the duplicates are deleted.</p>
      <input className="input mb-2" placeholder="Search duplicates…" value={q} onChange={(e) => setQ(e.target.value)} />
      <table className="table"><tbody>{results.map((r) => <tr key={r.id}><td style={{ width: 30 }}><input type="checkbox" checked={chosen.includes(r.id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, r.id] : chosen.filter((x) => x !== r.id))} /></td><td><strong>{r.name}</strong><div className="muted small">{r.email} · {r.ticket_count} tickets</div></td></tr>)}</tbody></table>
    </Modal>
  );
}
