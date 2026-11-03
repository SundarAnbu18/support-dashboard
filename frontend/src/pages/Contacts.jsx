import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Users, Search, Upload, Download } from 'lucide-react';
import { get, post, put, errorMessage, downloadFile } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Spinner, Avatar, Pagination, EmptyState, Modal, Field, Select, TagInput, useDebounce } from '../components/ui.jsx';
import { fmtRelative } from '../utils/format.js';

export function ContactForm({ initial, companies, onSaved, onClose }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', email: '', phone: '', mobile: '', company_id: '', job_title: '', address: '', time_zone: 'UTC', language: 'en', tags: [], description: '', password: '', ...initial });
  const set = (k) => (e) => setForm({ ...form, [k]: e?.target ? e.target.value : e });
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const payload = { ...form, company_id: form.company_id || null };
      if (!payload.password) delete payload.password;
      const r = initial?.id ? await put(`/contacts/${initial.id}`, payload) : await post('/contacts', payload);
      toast.success(initial?.id ? 'Contact updated' : 'Contact created'); onSaved(r.data);
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Modal title={initial?.id ? 'Edit contact' : 'New contact'} onClose={onClose} size="lg" footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save contact'}</button></>}>
      <form className="form-grid" onSubmit={save}>
        <div className="form-row">
          <Field label="Full name" required><input className="input" value={form.name} onChange={set('name')} required /></Field>
          <Field label="Email"><input className="input" type="email" value={form.email || ''} onChange={set('email')} /></Field>
        </div>
        <div className="form-row">
          <Field label="Phone"><input className="input" value={form.phone || ''} onChange={set('phone')} /></Field>
          <Field label="Mobile"><input className="input" value={form.mobile || ''} onChange={set('mobile')} /></Field>
        </div>
        <div className="form-row">
          <Field label="Company"><Select value={form.company_id || ''} placeholder="— None —" onChange={(v) => setForm({ ...form, company_id: v })} options={companies.map((c) => ({ value: String(c.id), label: c.name }))} /></Field>
          <Field label="Job title"><input className="input" value={form.job_title || ''} onChange={set('job_title')} /></Field>
        </div>
        <div className="form-row">
          <Field label="Time zone"><input className="input" value={form.time_zone || ''} onChange={set('time_zone')} /></Field>
          <Field label="Language"><input className="input" value={form.language || ''} onChange={set('language')} /></Field>
        </div>
        <Field label="Address"><input className="input" value={form.address || ''} onChange={set('address')} /></Field>
        <Field label="Tags"><TagInput value={form.tags || []} onChange={set('tags')} suggestions={['vip', 'partner', 'trial']} /></Field>
        <Field label="Notes"><textarea className="textarea" style={{ minHeight: 70 }} value={form.description || ''} onChange={set('description')} /></Field>
        <Field label={initial?.id ? 'Set new portal password' : 'Portal password'} help="Optional. Lets this contact sign in to the customer portal."><input className="input" type="password" value={form.password} onChange={set('password')} minLength={6} /></Field>
      </form>
    </Modal>
  );
}


// Reads a chosen CSV file and sends it to the import endpoint.
function ImportExport({ path, name, onDone }) {
  const toast = useToast();
  const { user } = useAuth();
  const onFile = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { data } = await post(`${path}/import`, { csv: await file.text() });
      toast.success(`Imported: ${data.created} created, ${data.updated} updated${data.errors.length ? `, ${data.errors.length} skipped` : ''}`);
      if (data.errors.length) toast.error(data.errors.slice(0, 3).join(' · '));
      onDone();
    } catch (err) { toast.error(errorMessage(err)); }
  };
  return (
    <>
      <label className="btn"><Upload size={15} /> Import<input type="file" accept=".csv,text/csv" hidden onChange={onFile} /></label>
      {user?.privileges?.includes('export_data') && <button className="btn" onClick={() => downloadFile(`${path}/export`, `${name}.csv`).catch((err) => toast.error(errorMessage(err)))}><Download size={15} /> Export</button>}
    </>
  );
}

export default function Contacts() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [modal, setModal] = useState(() => new URLSearchParams(window.location.search).has('new'));
  const [q, setQ] = useState(params.get('q') || '');
  const dq = useDebounce(q, 300);
  const page = Number(params.get('page') || 1);
  const companyId = params.get('company_id') || '';

  useEffect(() => { get('/companies', { per_page: 200 }).then((r) => setCompanies(r.data)); }, []);
  const load = useCallback(() => get('/contacts', { q: dq || undefined, page, company_id: companyId || undefined, per_page: 25 }).then(setData), [dq, page, companyId]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="content">
      <div className="page-header">
        <div><h1>Contacts</h1><p className="sub">{data ? `${data.meta.total} people` : ''}</p></div>
        <div className="page-actions">
          <div style={{ position: 'relative' }}><Search size={15} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--gray-400)' }} /><input className="input" style={{ paddingLeft: 32, width: 260 }} placeholder="Search contacts…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <Select value={companyId} placeholder="All companies" onChange={(v) => { const n = new URLSearchParams(params); n.delete('page'); v ? n.set('company_id', v) : n.delete('company_id'); setParams(n); }} options={companies.map((c) => ({ value: String(c.id), label: c.name }))} />
          <ImportExport path="/contacts" name="contacts" onDone={load} />
          <button className="btn btn-primary" onClick={() => setModal(true)}><Plus size={16} /> New contact</button>
        </div>
      </div>
      <div className="card">
        {!data ? <Spinner block /> : data.data.length === 0 ? <EmptyState icon={Users} title="No contacts found" /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Contact</th><th>Company</th><th>Phone</th><th>Tags</th><th className="num">Tickets</th><th className="num">Open</th><th>Portal</th><th>Added</th></tr></thead>
            <tbody>
              {data.data.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => navigate(`/contacts/${c.id}`)}>
                  <td><div className="row" style={{ gap: 10 }}><Avatar name={c.name} src={c.avatar_url} /><div><div className="strong">{c.name}</div><div className="muted small">{c.email || '—'}</div></div></div></td>
                  <td>{c.company_name || <span className="muted">—</span>}</td>
                  <td>{c.phone || c.mobile || <span className="muted">—</span>}</td>
                  <td><div className="row wrap">{c.tags?.map((t) => <span key={t} className="tag-chip">{t}</span>)}</div></td>
                  <td className="num">{c.ticket_count}</td>
                  <td className="num">{Number(c.open_ticket_count) ? <span className="badge badge-red">{c.open_ticket_count}</span> : <span className="muted">0</span>}</td>
                  <td>{c.has_portal_access ? <span className="badge badge-green">Active</span> : <span className="muted small">—</span>}</td>
                  <td className="muted small">{fmtRelative(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        {data && <Pagination meta={data.meta} onPage={(p) => { const n = new URLSearchParams(params); n.set('page', String(p)); setParams(n); }} />}
      </div>
      {modal && <ContactForm companies={companies} onClose={() => setModal(false)} onSaved={(c) => { setModal(false); navigate(`/contacts/${c.id}`); }} />}
    </div>
  );
}
