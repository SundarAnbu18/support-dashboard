import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Paperclip, X } from 'lucide-react';
import { get, postForm, errorMessage } from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Field, Select } from '../../components/ui.jsx';
import { CustomFields } from '../NewTicket.jsx';

export default function PortalNewTicket() {
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState({ subject: '', description: '', priority: 'low', type: '', custom_fields: {} });
  const [fields, setFields] = useState([]);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  useEffect(() => { get('/settings/ticket-fields').then((r) => setFields(r.data)).catch(() => {}); }, []);
  useEffect(() => { if (form.subject.length < 4) { setSuggestions([]); return; } const t = setTimeout(() => get('/kb/portal/search', { q: form.subject }).then((r) => setSuggestions(r.data.slice(0, 3))), 300); return () => clearTimeout(t); }, [form.subject]);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { const r = await postForm('/tickets', form, files); toast.success(`Ticket #${r.data.id} submitted`); navigate(`/portal/tickets/${r.data.id}`); } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <div className="portal-container" style={{ maxWidth: 760 }}>
      <div className="page-header"><div><h1>Submit a ticket</h1><p className="sub">Tell us what's going on and we'll get back to you as soon as we can.</p></div></div>
      <form className="card" onSubmit={submit}><div className="card-body form-grid">
        <Field label="Subject" required><input className="input" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} required placeholder="Brief summary of the issue" /></Field>
        {suggestions.length > 0 && <div className="alert alert-info col" style={{ gap: 4 }}><strong>These articles might help:</strong>{suggestions.map((s) => <a key={s.id} href={`/portal/articles/${s.slug}`} target="_blank" rel="noreferrer">{s.title}</a>)}</div>}
        <div className="form-row">
          <Field label="Type"><Select value={form.type} placeholder="Select…" onChange={(v) => setForm({ ...form, type: v })} options={['question', 'incident', 'problem', 'feature_request', 'refund', 'other']} /></Field>
          <Field label="Priority"><Select value={form.priority} onChange={(v) => setForm({ ...form, priority: v })} options={['low', 'medium', 'high', 'urgent']} /></Field>
        </div>
        <Field label="Description" required><textarea className="textarea" style={{ minHeight: 200 }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required placeholder="Include steps to reproduce, error messages and anything else that helps." /></Field>
        <CustomFields fields={fields} values={form.custom_fields} onChange={(v) => setForm({ ...form, custom_fields: v })} customerView />
        <Field label="Attachments"><div className="row wrap"><label className="btn btn-sm"><Paperclip size={14} /> Add files<input type="file" multiple hidden onChange={(e) => setFiles([...files, ...Array.from(e.target.files)])} /></label>{files.map((f, i) => <span key={i} className="tag-chip">{f.name}<button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))}><X size={12} /></button></span>)}</div></Field>
        <div className="form-actions"><button type="button" className="btn" onClick={() => navigate(-1)}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit ticket'}</button></div>
      </div></form>
    </div>
  );
}
