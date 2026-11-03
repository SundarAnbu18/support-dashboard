import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Paperclip, X } from 'lucide-react';
import { get, postForm, errorMessage } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { Field, Select, TagInput, useDebounce, Avatar } from '../components/ui.jsx';
import { statusOptions, PRIORITY_OPTIONS, TYPE_OPTIONS, SOURCE_OPTIONS } from '../utils/format.js';

export function CustomFields({ fields, values, onChange, customerView }) {
  const visible = fields.filter((f) => !customerView || f.visible_to_customers);
  if (!visible.length) return null;
  // Dependent dropdown options are keyed by the value chosen in the parent field.
  const dependentOptions = (f) => (f.options && !Array.isArray(f.options) ? f.options[values[f.parent_field]] || [] : []);
  return visible.map((f) => (
    <Field key={f.id} label={f.label} required={customerView ? f.required_for_customers : f.required_for_agents}>
      {f.field_type === 'dependent' ? <Select value={values[f.name] || ''} placeholder={values[f.parent_field] ? 'Select…' : 'Choose the parent field first'} disabled={!values[f.parent_field]} onChange={(v) => onChange({ ...values, [f.name]: v })} options={dependentOptions(f).map((o) => ({ value: o, label: o }))} />
        : f.field_type === 'dropdown' ? <Select value={values[f.name] || ''} placeholder="Select…" onChange={(v) => onChange({ ...values, [f.name]: v })} options={(f.options || []).map((o) => ({ value: o, label: o }))} />
        : f.field_type === 'textarea' ? <textarea className="textarea" style={{ minHeight: 70 }} value={values[f.name] || ''} onChange={(e) => onChange({ ...values, [f.name]: e.target.value })} />
        : f.field_type === 'checkbox' ? <label className="checkbox"><input type="checkbox" checked={!!values[f.name]} onChange={(e) => onChange({ ...values, [f.name]: e.target.checked })} /> Yes</label>
        : <input className="input" type={['number', 'decimal'].includes(f.field_type) ? 'number' : f.field_type === 'date' ? 'date' : 'text'} step={f.field_type === 'decimal' ? 'any' : undefined} value={values[f.name] || ''} onChange={(e) => onChange({ ...values, [f.name]: e.target.value })} />}
    </Field>
  ));
}

// Custom fields defined under Admin > Contact & company fields.
export function EntityCustomFields({ entity, values, onSave }) {
  const [defs, setDefs] = useState([]);
  useEffect(() => { get('/config/entity-fields').then((r) => setDefs(r.data.filter((f) => f.entity === entity))); }, [entity]);
  if (!defs.length) return null;
  return (
    <div className="card"><div className="card-header"><h3>Custom fields</h3></div><div className="card-body form-grid">
      <CustomFields fields={defs} values={values || {}} onChange={onSave} />
    </div></div>
  );
}

export default function NewTicket() {
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const [agents, setAgents] = useState([]);
  const [groups, setGroups] = useState([]);
  const [tags, setTags] = useState([]);
  const [fields, setFields] = useState([]);
  const [products, setProducts] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [contactQuery, setContactQuery] = useState('');
  const [contactResults, setContactResults] = useState([]);
  const [requester, setRequester] = useState(null);
  const dq = useDebounce(contactQuery, 250);
  const [form, setForm] = useState({ subject: '', description: '', priority: 'low', status: 'open', type: '', source: params.get('outbound') ? 'email' : 'phone', responder_id: '', group_id: '', product_id: '', tags: [], cc_emails: '', custom_fields: {} });
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    Promise.all([get('/agents'), get('/groups'), get('/tags'), get('/settings/ticket-fields')]).then(([a, g, t, f]) => { setAgents(a.data); setGroups(g.data); setTags(t.data); setFields(f.data); });
    get('/config/products').then((r) => setProducts(r.data)).catch(() => {});
    get('/config/ticket-templates').then((r) => setTemplates(r.data.filter((x) => !x.parent_template_id))).catch(() => {});
    const rid = params.get('requester_id');
    if (rid) get(`/contacts/${rid}`).then((r) => setRequester(r.data));
  }, []); // eslint-disable-line

  useEffect(() => {
    if (!dq.trim() || requester) { setContactResults([]); return; }
    get('/contacts', { q: dq, per_page: 6 }).then((r) => setContactResults(r.data));
  }, [dq, requester]);

  const applyTemplate = (id) => {
    setTemplateId(id);
    const t = templates.find((x) => String(x.id) === id);
    if (!t) return;
    setForm((f) => ({ ...f, subject: t.subject || f.subject, description: t.body || f.description, priority: t.priority || f.priority, status: t.status || f.status, type: t.type || f.type, group_id: t.group_id ? String(t.group_id) : f.group_id, responder_id: t.responder_id ? String(t.responder_id) : f.responder_id, product_id: t.product_id ? String(t.product_id) : f.product_id, tags: t.tags?.length ? t.tags : f.tags }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!requester && !contactQuery.includes('@')) return toast.error('Pick an existing contact or enter a new email address');
    setBusy(true);
    try {
      const payload = { ...form, cc_emails: form.cc_emails.split(',').map((s) => s.trim()).filter(Boolean), template_id: templateId || undefined, parent_ticket_id: params.get('parent_ticket_id') || undefined };
      if (requester) payload.requester_id = requester.id; else { payload.requester_email = contactQuery.trim(); payload.requester_name = contactQuery.split('@')[0]; }
      const r = await postForm('/tickets', payload, files);
      toast.success(`Ticket #${r.data.id} created`);
      navigate(`/tickets/${r.data.id}`);
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };

  return (
    <div className="content">
      <div className="page-header"><div><h1>{params.get('parent_ticket_id') ? `New child ticket of #${params.get('parent_ticket_id')}` : params.get('outbound') ? 'New outbound email' : 'New ticket'}</h1><p className="sub">{params.get('outbound') ? 'Start a conversation with a customer.' : 'Log a request on behalf of a customer.'}</p></div>
        {templates.length > 0 && <div className="page-actions"><Select aria-label="Use a template" value={templateId} placeholder="Use a template…" onChange={applyTemplate} options={templates.map((t) => ({ value: String(t.id), label: t.name }))} /></div>}
      </div>
      <form onSubmit={submit} className="detail-layout">
        <div className="card">
          <div className="card-body form-grid">
            <Field label="Requester" required help="Search existing contacts or type a new email address to create one.">
              {requester ? (
                <div className="row" style={{ justifyContent: 'space-between', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px' }}>
                  <span className="row"><Avatar name={requester.name} size="sm" /> <strong>{requester.name}</strong> <span className="muted">{requester.email}</span>{requester.company_name && <span className="badge badge-gray">{requester.company_name}</span>}</span>
                  <button type="button" className="icon-btn" onClick={() => { setRequester(null); setContactQuery(''); }}><X size={14} /></button>
                </div>
              ) : (
                <div style={{ position: 'relative' }}>
                  <input className="input" placeholder="Name, email or phone…" value={contactQuery} onChange={(e) => setContactQuery(e.target.value)} />
                  {contactResults.length > 0 && (
                    <div className="dropdown-menu" style={{ left: 0, right: 0, top: '100%' }}>
                      {contactResults.map((c) => <button type="button" key={c.id} onClick={() => { setRequester(c); setContactResults([]); }}><Avatar name={c.name} size="sm" /><span>{c.name}</span><span className="muted small">{c.email}</span></button>)}
                    </div>
                  )}
                </div>
              )}
            </Field>
            <Field label="Subject" required><input className="input" value={form.subject} onChange={(e) => set('subject')(e.target.value)} required /></Field>
            <Field label="Description" required><textarea className="textarea" style={{ minHeight: 180 }} value={form.description} onChange={(e) => set('description')(e.target.value)} required /></Field>
            <Field label="CC emails" help="Comma separated"><input className="input" value={form.cc_emails} onChange={(e) => set('cc_emails')(e.target.value)} /></Field>
            <Field label="Attachments">
              <div className="row wrap">
                <label className="btn btn-sm"><Paperclip size={14} /> Add files<input type="file" multiple hidden onChange={(e) => setFiles([...files, ...Array.from(e.target.files)])} /></label>
                {files.map((f, i) => <span key={i} className="tag-chip">{f.name}<button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))}><X size={12} /></button></span>)}
              </div>
            </Field>
            <CustomFields fields={fields} values={form.custom_fields} onChange={set('custom_fields')} />
          </div>
        </div>
        <div className="col" style={{ gap: 16 }}>
          <div className="card"><div className="card-header"><h3>Properties</h3></div>
            <div className="card-body props">
              <Field label="Status"><Select value={form.status} onChange={set('status')} options={statusOptions()} /></Field>
              <Field label="Priority"><Select value={form.priority} onChange={set('priority')} options={PRIORITY_OPTIONS} /></Field>
              <Field label="Type"><Select value={form.type} onChange={set('type')} placeholder="—" options={TYPE_OPTIONS} /></Field>
              <Field label="Source"><Select value={form.source} onChange={set('source')} options={SOURCE_OPTIONS} /></Field>
              <Field label="Group"><Select value={form.group_id} onChange={set('group_id')} placeholder="—" options={groups.map((g) => ({ value: String(g.id), label: g.name }))} /></Field>
              <Field label="Agent"><Select value={form.responder_id} onChange={set('responder_id')} placeholder="Unassigned" options={agents.map((a) => ({ value: String(a.id), label: a.name }))} /></Field>
              {products.length > 0 && <Field label="Product"><Select value={form.product_id} onChange={set('product_id')} placeholder="—" options={products.map((p) => ({ value: String(p.id), label: p.name }))} /></Field>}
              <Field label="Tags"><TagInput value={form.tags} onChange={set('tags')} suggestions={tags.map((t) => t.name)} /></Field>
            </div>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={() => navigate(-1)}>Cancel</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create ticket'}</button>
          </div>
        </div>
      </form>
    </div>
  );
}
