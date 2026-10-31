import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Building2, Search } from 'lucide-react';
import { get, post, put, errorMessage } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { Spinner, Pagination, EmptyState, Modal, Field, Select, Badge, useDebounce } from '../components/ui.jsx';
import { fmtRelative, titleCase } from '../utils/format.js';

const HEALTH = { happy: 'green', neutral: 'gray', at_risk: 'red' };

export function CompanyForm({ initial, onSaved, onClose }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', domains: '', description: '', notes: '', industry: '', account_tier: 'standard', health_score: 'neutral', renewal_date: '', ...initial, domains: (initial?.domains || []).join(', ') });
  const set = (k) => (e) => setForm({ ...form, [k]: e?.target ? e.target.value : e });
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const payload = { ...form, domains: form.domains.split(',').map((s) => s.trim()).filter(Boolean), renewal_date: form.renewal_date ? String(form.renewal_date).slice(0, 10) : null };
      const r = initial?.id ? await put(`/companies/${initial.id}`, payload) : await post('/companies', payload);
      toast.success('Company saved'); onSaved(r.data);
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Modal title={initial?.id ? 'Edit company' : 'New company'} onClose={onClose} size="lg" footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={busy}>Save company</button></>}>
      <form className="form-grid" onSubmit={save}>
        <Field label="Company name" required><input className="input" value={form.name} onChange={set('name')} required /></Field>
        <Field label="Email domains" help="Comma separated. Contacts with these email domains are linked automatically."><input className="input" value={form.domains} onChange={set('domains')} placeholder="acme.com, acme.co.uk" /></Field>
        <div className="form-row">
          <Field label="Industry"><input className="input" value={form.industry || ''} onChange={set('industry')} /></Field>
          <Field label="Account tier"><Select value={form.account_tier} onChange={(v) => setForm({ ...form, account_tier: v })} options={['standard', 'premium', 'enterprise']} /></Field>
        </div>
        <div className="form-row">
          <Field label="Health score"><Select value={form.health_score} onChange={(v) => setForm({ ...form, health_score: v })} options={['happy', 'neutral', 'at_risk']} /></Field>
          <Field label="Renewal date"><input className="input" type="date" value={form.renewal_date ? String(form.renewal_date).slice(0, 10) : ''} onChange={set('renewal_date')} /></Field>
        </div>
        <Field label="Description"><textarea className="textarea" style={{ minHeight: 70 }} value={form.description || ''} onChange={set('description')} /></Field>
        <Field label="Internal notes"><textarea className="textarea" style={{ minHeight: 70 }} value={form.notes || ''} onChange={set('notes')} /></Field>
      </form>
    </Modal>
  );
}

export default function Companies() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [modal, setModal] = useState(false);
  const [q, setQ] = useState('');
  const dq = useDebounce(q, 300);
  const page = Number(params.get('page') || 1);
  const load = useCallback(() => get('/companies', { q: dq || undefined, page, per_page: 25 }).then(setData), [dq, page]);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="content">
      <div className="page-header">
        <div><h1>Companies</h1><p className="sub">{data ? `${data.meta.total} accounts` : ''}</p></div>
        <div className="page-actions">
          <div style={{ position: 'relative' }}><Search size={15} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--gray-400)' }} /><input className="input" style={{ paddingLeft: 32, width: 260 }} placeholder="Search companies…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <button className="btn btn-primary" onClick={() => setModal(true)}><Plus size={16} /> New company</button>
        </div>
      </div>
      <div className="card">
        {!data ? <Spinner block /> : data.data.length === 0 ? <EmptyState icon={Building2} title="No companies found" /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Company</th><th>Domains</th><th>Industry</th><th>Tier</th><th>Health</th><th className="num">Contacts</th><th className="num">Tickets</th><th className="num">Open</th><th>Added</th></tr></thead>
            <tbody>{data.data.map((c) => (
              <tr key={c.id} className="clickable" onClick={() => navigate(`/companies/${c.id}`)}>
                <td><div className="row" style={{ gap: 10 }}><span className="avatar" style={{ background: 'var(--gray-100)', color: 'var(--gray-600)' }}><Building2 size={15} /></span><span className="strong">{c.name}</span></div></td>
                <td className="muted small">{c.domains?.join(', ') || '—'}</td><td>{c.industry || '—'}</td><td><Badge color="blue">{titleCase(c.account_tier)}</Badge></td><td><Badge color={HEALTH[c.health_score]}>{titleCase(c.health_score)}</Badge></td>
                <td className="num">{c.contact_count}</td><td className="num">{c.ticket_count}</td><td className="num">{Number(c.open_ticket_count) ? <span className="badge badge-red">{c.open_ticket_count}</span> : 0}</td><td className="muted small">{fmtRelative(c.created_at)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {data && <Pagination meta={data.meta} onPage={(p) => { const n = new URLSearchParams(params); n.set('page', String(p)); setParams(n); }} />}
      </div>
      {modal && <CompanyForm onClose={() => setModal(false)} onSaved={(c) => { setModal(false); navigate(`/companies/${c.id}`); }} />}
    </div>
  );
}
