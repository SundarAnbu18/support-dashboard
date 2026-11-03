import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, X, Copy, RefreshCw, Download } from 'lucide-react';
import { get, post, put, del, downloadFile, errorMessage } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { Spinner, Modal, Field, Select, Badge, ConfirmDialog, EmptyState, TagInput } from '../../components/ui.jsx';
import { fmtDateTime, fmtRelative, loadStatuses, PRIORITY_OPTIONS, STATUS_OPTIONS, TYPE_OPTIONS, titleCase } from '../../utils/format.js';

// One field in a generic edit form. `type` matches the inputs used across the admin area.
function FormField({ f, form, setForm, ctx }) {
  const value = form[f.key];
  const set = (v) => setForm({ ...form, [f.key]: v });
  const input = (() => {
    switch (f.type) {
      case 'textarea': return <textarea className="textarea" style={{ minHeight: f.rows ? f.rows * 22 : 90 }} value={value ?? ''} onChange={(e) => set(e.target.value)} />;
      case 'checkbox': return <label className="checkbox"><input type="checkbox" checked={!!value} onChange={(e) => set(e.target.checked)} /> {f.hint || 'Yes'}</label>;
      case 'select': return <Select value={value == null ? '' : String(value)} placeholder={f.required ? undefined : '—'} onChange={set} options={typeof f.options === 'function' ? f.options(ctx, form) : f.options} />;
      case 'tags': return <TagInput value={value || []} onChange={set} suggestions={typeof f.suggestions === 'function' ? f.suggestions(ctx) : []} placeholder={f.placeholder} />;
      case 'lines': return <textarea className="textarea" value={(value || []).join('\n')} onChange={(e) => set(e.target.value.split('\n'))} />;
      case 'number': return <input className="input" type="number" value={value ?? ''} onChange={(e) => set(e.target.value)} />;
      default: return <input className="input" value={value ?? ''} placeholder={f.placeholder} onChange={(e) => set(e.target.value)} />;
    }
  })();
  return <Field label={f.type === 'checkbox' ? undefined : f.label} required={f.required} help={f.help}>{input}</Field>;
}

// List + edit modal + delete confirm for the simple config tables.
function ConfigList({ title, subtitle, endpoint, idKey = 'id', fields, columns, defaults = {}, ctx, canAdd = true, canEdit = () => true, canRemove = () => true, normalize = (v) => v, onChanged, extra }) {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const load = () => get(endpoint).then((r) => setRows(r.data));
  useEffect(() => { load(); }, [endpoint]); // eslint-disable-line
  const save = async () => {
    try {
      const payload = normalize({ ...form });
      if (form[idKey]) await put(`${endpoint}/${form[idKey]}`, payload); else await post(endpoint, payload);
      toast.success('Saved'); setForm(null); await load(); onChanged?.();
    } catch (e) { toast.error(errorMessage(e)); }
  };
  if (!rows) return <Spinner block />;
  const missing = form && fields.some((f) => f.required && !form[f.key]);
  return (
    <div className="card">
      <div className="card-header">
        <div><h3>{title} ({rows.length})</h3>{subtitle && <p className="muted small">{subtitle}</p>}</div>
        {isAdmin && canAdd && <button className="btn btn-sm btn-primary" onClick={() => setForm({ ...defaults })}><Plus size={14} /> Add</button>}
      </div>
      {extra}
      {rows.length === 0 ? <EmptyState title={`No ${title.toLowerCase()} yet`} /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr>{columns.map((c) => <th key={c.label}>{c.label}</th>)}<th /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r[idKey]}>
              {columns.map((c) => <td key={c.label}>{c.render ? c.render(r, load) : (r[c.key] ?? '—')}</td>)}
              <td><div className="row" style={{ justifyContent: 'flex-end' }}>
                {isAdmin && canEdit(r) && <button className="icon-btn" aria-label="Edit" onClick={() => setForm({ ...r })}><Pencil size={14} /></button>}
                {isAdmin && canRemove(r) && <button className="icon-btn" aria-label="Delete" onClick={() => setConfirm(r)}><Trash2 size={14} /></button>}
              </div></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {form && (
        <Modal title={`${form[idKey] ? 'Edit' : 'New'} — ${title}`} size="lg" onClose={() => setForm(null)} footer={<><button className="btn" onClick={() => setForm(null)}>Cancel</button><button className="btn btn-primary" disabled={missing} onClick={save}>Save</button></>}>
          <div className="form-grid">{fields.filter((f) => !f.when || f.when(form)).map((f) => <FormField key={f.key} f={f} form={form} setForm={setForm} ctx={ctx} />)}</div>
        </Modal>
      )}
      {confirm && <ConfirmDialog title="Delete this item?" message={`"${confirm.name || confirm.label}" will be removed.`} danger confirmLabel="Delete" onCancel={() => setConfirm(null)} onConfirm={async () => { try { await del(`${endpoint}/${confirm[idKey]}`); await load(); onChanged?.(); } catch (e) { toast.error(errorMessage(e)); } setConfirm(null); }} />}
    </div>
  );
}

function useLookups() {
  const [ctx, setCtx] = useState({ groups: [], agents: [], products: [], fields: [] });
  useEffect(() => {
    Promise.all([get('/groups'), get('/agents'), get('/config/products'), get('/settings/ticket-fields')])
      .then(([g, a, p, f]) => setCtx({ groups: g.data, agents: a.data, products: p.data, fields: f.data }));
  }, []);
  return ctx;
}
const opt = (rows) => rows.map((r) => ({ value: String(r.id), label: r.name }));

// ---------------------------------------------------------------- team
const PRIVILEGES = [
  ['reply_ticket', 'Reply to customers and forward tickets'],
  ['delete_ticket', 'Delete tickets'],
  ['merge_split_ticket', 'Merge and split tickets'],
  ['export_data', 'Export tickets, contacts and reports'],
  ['manage_contacts', 'Create and edit contacts and companies'],
  ['manage_kb', 'Create and publish knowledge base articles'],
  ['moderate_forums', 'Moderate forums'],
  ['view_reports', 'View reports and analytics'],
  ['manage_admin', 'Full admin access to settings'],
];

export function Roles() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [agents, setAgents] = useState([]);
  const [form, setForm] = useState(null);
  const load = () => get('/config/roles').then((r) => setRows(r.data));
  useEffect(() => { load(); get('/agents').then((r) => setAgents(r.data)); }, []);
  if (!rows) return <Spinner block />;
  const save = async () => {
    try { if (form.id) await put(`/config/roles/${form.id}`, form); else await post('/config/roles', form); setForm(null); toast.success('Role saved'); load(); } catch (e) { toast.error(errorMessage(e)); }
  };
  const toggle = (p) => setForm({ ...form, privileges: form.privileges.includes(p) ? form.privileges.filter((x) => x !== p) : [...form.privileges, p] });
  return (
    <div className="card">
      <div className="card-header"><div><h3>Roles ({rows.length})</h3><p className="muted small">Assign a role on the Agents page. Built-in roles can be viewed but not changed.</p></div>{isAdmin && <button className="btn btn-sm btn-primary" onClick={() => setForm({ name: '', description: '', privileges: [] })}><Plus size={14} /> New role</button>}</div>
      <table className="table"><thead><tr><th>Role</th><th className="num">Agents</th><th>Privileges</th><th /></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id}>
            <td><div className="strong">{r.name} {r.is_default && <Badge>Built-in</Badge>}</div><div className="muted small">{r.description}</div></td>
            <td className="num">{agents.filter((a) => a.role_id === r.id).length}</td>
            <td className="small muted">{r.privileges.length ? `${r.privileges.length} of ${PRIVILEGES.length}` : 'Notes only'}</td>
            <td><div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-sm" onClick={() => setForm({ ...r })}>{r.is_default || !isAdmin ? 'View' : 'Edit'}</button>
              {isAdmin && !r.is_default && <button className="icon-btn" aria-label="Delete role" onClick={() => del(`/config/roles/${r.id}`).then(load).catch((e) => toast.error(errorMessage(e)))}><Trash2 size={14} /></button>}
            </div></td>
          </tr>
        ))}</tbody></table>
      {form && (
        <Modal title={form.is_default ? form.name : form.id ? 'Edit role' : 'New role'} onClose={() => setForm(null)} footer={<><button className="btn" onClick={() => setForm(null)}>Close</button>{isAdmin && !form.is_default && <button className="btn btn-primary" disabled={!form.name} onClick={save}>Save</button>}</>}>
          <div className="form-grid">
            <Field label="Name" required><input className="input" disabled={form.is_default} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Description"><input className="input" disabled={form.is_default} value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <Field label="Privileges"><div className="col" style={{ gap: 6 }}>{PRIVILEGES.map(([k, label]) => <label key={k} className="checkbox"><input type="checkbox" disabled={form.is_default} checked={form.privileges.includes(k)} onChange={() => toggle(k)} /> {label}</label>)}</div></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

export const AgentStatuses = () => (
  <ConfigList title="Agent statuses" subtitle="Agents set their availability from the top bar. Round-robin skips statuses that don't accept tickets." endpoint="/config/agent-statuses" canRemove={(r) => !r.is_default} defaults={{ accepts_tickets: true }}
    fields={[{ key: 'name', label: 'Name', required: true }, { key: 'emoji', label: 'Emoji' }, { key: 'accepts_tickets', type: 'checkbox', hint: 'Can receive auto-assigned tickets' }, { key: 'position', label: 'Order', type: 'number' }]}
    normalize={({ name, emoji, accepts_tickets, position }) => ({ name, emoji, accepts_tickets, position: position || undefined })}
    columns={[{ label: 'Status', render: (r) => `${r.emoji || ''} ${r.name}` }, { label: 'Auto-assign', render: (r) => (r.accepts_tickets ? <Badge color="green">Yes</Badge> : <Badge>No</Badge>) }]} />
);

// ---------------------------------------------------------------- workflows
export const TicketStatuses = () => (
  <ConfigList title="Ticket statuses" subtitle="Custom statuses appear everywhere tickets are edited. Customers see the portal label." endpoint="/config/ticket-statuses" idKey="key" canRemove={(r) => !r.is_default} canEdit={() => true} onChanged={loadStatuses}
    fields={[{ key: 'label', label: 'Agent label', required: true }, { key: 'customer_label', label: 'Label shown to customers' }, { key: 'stops_sla', type: 'checkbox', hint: 'Stop the SLA timer while in this status' }, { key: 'position', label: 'Order', type: 'number' }]}
    normalize={({ label, customer_label, stops_sla, position }) => ({ label, customer_label, stops_sla, position: position || undefined })}
    columns={[{ label: 'Status', render: (r) => <span className="strong">{r.label}</span> }, { label: 'Customers see', key: 'customer_label' }, { label: 'SLA timer', render: (r) => (r.stops_sla ? <Badge color="amber">Stopped</Badge> : <Badge color="green">Running</Badge>) }, { label: 'Type', render: (r) => (r.is_default ? <Badge>Built-in</Badge> : <Badge color="blue">Custom</Badge>) }]} />
);

export function TicketForms() {
  const ctx = useLookups();
  return (
    <ConfigList title="Ticket forms" subtitle="Customers pick a form on the portal. The form sets the type, product and group." endpoint="/config/ticket-forms" ctx={ctx} defaults={{ is_active: true, field_names: [] }}
      fields={[{ key: 'name', label: 'Name', required: true }, { key: 'description', label: 'Description' }, { key: 'type', label: 'Ticket type', type: 'select', options: TYPE_OPTIONS }, { key: 'product_id', label: 'Product', type: 'select', options: (c) => opt(c.products) }, { key: 'group_id', label: 'Route to group', type: 'select', options: (c) => opt(c.groups) },
        { key: 'field_names', label: 'Custom fields on this form', type: 'tags', placeholder: 'Field key…', suggestions: (c) => c.fields.map((f) => f.name), help: 'Leave empty to show every customer-visible field.' }, { key: 'is_active', type: 'checkbox', hint: 'Show on the portal' }]}
      normalize={({ name, description, type, product_id, group_id, field_names, is_active }) => ({ name, description, type: type || null, product_id: product_id || null, group_id: group_id || null, field_names, is_active })}
      columns={[{ label: 'Form', render: (r) => <><div className="strong">{r.name}</div><div className="muted small">{r.description}</div></> }, { label: 'Type', render: (r) => titleCase(r.type) || '—' }, { label: 'Fields', render: (r) => r.field_names.join(', ') || 'All' }, { label: 'Portal', render: (r) => (r.is_active ? <Badge color="green">Visible</Badge> : <Badge>Hidden</Badge>) }]} />
  );
}

function ActionsEditor({ value, onChange, meta, ctx }) {
  return (
    <div className="col" style={{ gap: 8 }}>
      {value.map((a, i) => {
        const def = meta.find((x) => x.key === a.type);
        const update = (patch) => onChange(value.map((x, j) => (j === i ? { ...x, ...patch } : x)));
        const options = def?.value === 'select' ? def.options : def?.value === 'group' ? opt(ctx.groups) : def?.value === 'agent' ? opt(ctx.agents) : null;
        return (
          <div key={i} className="rule-row" style={{ gridTemplateColumns: '200px 1fr 36px' }}>
            <Select small value={a.type} onChange={(v) => onChange(value.map((x, j) => (j === i ? { type: v, value: '' } : x)))} options={meta.map((x) => ({ value: x.key, label: x.label }))} />
            {def?.value === 'none' ? <span className="muted small">No value needed</span>
              : options ? <Select small value={String(a.value ?? '')} placeholder="—" onChange={(v) => update({ value: v })} options={options} />
              : def?.value === 'textarea' ? <textarea className="textarea" style={{ minHeight: 50 }} value={a.value || ''} onChange={(e) => update({ value: e.target.value })} />
              : <input className="input input-sm" value={a.value || ''} onChange={(e) => update({ value: e.target.value })} />}
            <button className="icon-btn" aria-label="Remove action" onClick={() => onChange(value.filter((_, j) => j !== i))}><X size={14} /></button>
          </div>
        );
      })}
      <button type="button" className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => onChange([...value, { type: 'set_priority', value: 'high' }])}><Plus size={13} /> Add action</button>
    </div>
  );
}

export function Scenarios() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const ctx = useLookups();
  const [rows, setRows] = useState(null);
  const [meta, setMeta] = useState([]);
  const [form, setForm] = useState(null);
  const [q, setQ] = useState('');
  const load = () => get('/config/scenarios').then((r) => setRows(r.data));
  useEffect(() => { load(); get('/automations/meta').then((r) => setMeta(r.data.actions)); }, []);
  if (!rows) return <Spinner block />;
  const save = async () => {
    try { if (form.id) await put(`/config/scenarios/${form.id}`, form); else await post('/config/scenarios', form); setForm(null); toast.success('Scenario saved'); load(); } catch (e) { toast.error(errorMessage(e)); }
  };
  const shown = rows.filter((r) => r.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="card">
      <div className="card-header"><div><h3>Scenarios ({rows.length})</h3><p className="muted small">Run a set of actions on a ticket in one click, from the ticket or the bulk bar.</p></div>
        <div className="row"><input className="input input-sm" placeholder="Search scenarios…" value={q} onChange={(e) => setQ(e.target.value)} />{isAdmin && <button className="btn btn-sm btn-primary" onClick={() => setForm({ name: '', description: '', visibility: 'all', actions: [] })}><Plus size={14} /> New scenario</button>}</div></div>
      <table className="table"><thead><tr><th>Scenario</th><th>Available to</th><th className="num">Actions</th><th /></tr></thead>
        <tbody>{shown.map((r) => (
          <tr key={r.id}><td><div className="strong">{r.name}</div><div className="muted small">{r.description}</div></td><td>{r.visibility === 'group' ? r.group_name : r.visibility === 'personal' ? 'Only owner' : 'All agents'}</td><td className="num">{r.actions.length}</td>
            <td>{isAdmin && <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-sm" onClick={() => setForm({ ...r, id: undefined, name: `${r.name} (copy)` })}><Copy size={13} /> Clone</button>
              <button className="icon-btn" aria-label="Edit scenario" onClick={() => setForm(r)}><Pencil size={14} /></button>
              <button className="icon-btn" aria-label="Delete scenario" onClick={() => del(`/config/scenarios/${r.id}`).then(load)}><Trash2 size={14} /></button>
            </div>}</td></tr>
        ))}</tbody></table>
      {form && (
        <Modal title={form.id ? 'Edit scenario' : 'New scenario'} size="lg" onClose={() => setForm(null)} footer={<><button className="btn" onClick={() => setForm(null)}>Cancel</button><button className="btn btn-primary" disabled={!form.name} onClick={save}>Save</button></>}>
          <div className="form-grid">
            <Field label="Name" required><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Description"><input className="input" value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <div className="form-row">
              <Field label="Available to"><Select value={form.visibility} onChange={(v) => setForm({ ...form, visibility: v })} options={[{ value: 'all', label: 'All agents' }, { value: 'group', label: 'One group' }, { value: 'personal', label: 'Only me' }]} /></Field>
              {form.visibility === 'group' && <Field label="Group"><Select value={String(form.group_id || '')} placeholder="—" onChange={(v) => setForm({ ...form, group_id: v })} options={opt(ctx.groups)} /></Field>}
            </div>
            <Field label="Actions"><ActionsEditor value={form.actions} onChange={(a) => setForm({ ...form, actions: a })} meta={meta} ctx={ctx} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function TicketTemplates() {
  const ctx = useLookups();
  const [parents, setParents] = useState([]);
  useEffect(() => { get('/config/ticket-templates').then((r) => setParents(r.data.filter((t) => !t.parent_template_id))); }, []);
  return (
    <ConfigList title="Ticket templates" subtitle="Pre-fill the new ticket form. A template with child templates creates its child tickets too." endpoint="/config/ticket-templates" ctx={{ ...ctx, parents }} defaults={{ tags: [] }}
      fields={[{ key: 'name', label: 'Template name', required: true }, { key: 'description', label: 'Description' }, { key: 'parent_template_id', label: 'Child of template', type: 'select', options: (c) => opt(c.parents), help: 'Set this to make it a child template.' }, { key: 'subject', label: 'Subject' }, { key: 'body', label: 'Description text', type: 'textarea' },
        { key: 'priority', label: 'Priority', type: 'select', options: PRIORITY_OPTIONS }, { key: 'status', label: 'Status', type: 'select', options: () => STATUS_OPTIONS }, { key: 'type', label: 'Type', type: 'select', options: TYPE_OPTIONS }, { key: 'group_id', label: 'Group', type: 'select', options: (c) => opt(c.groups) }, { key: 'responder_id', label: 'Agent', type: 'select', options: (c) => opt(c.agents) }, { key: 'product_id', label: 'Product', type: 'select', options: (c) => opt(c.products) }, { key: 'tags', label: 'Tags', type: 'tags' }]}
      normalize={({ id, created_at, ...rest }) => rest}
      columns={[{ label: 'Template', render: (r) => <><div className="strong">{r.parent_template_id ? '↳ ' : ''}{r.name}</div><div className="muted small">{r.description}</div></> }, { label: 'Subject', key: 'subject' }, { label: 'Priority', render: (r) => titleCase(r.priority) || '—' }]} />
  );
}

export const Products = () => (
  <ConfigList title="Products" subtitle="Track tickets per product. Mailboxes and portal forms can route to a product." endpoint="/config/products"
    fields={[{ key: 'name', label: 'Name', required: true }, { key: 'description', label: 'Description' }, { key: 'support_email', label: 'Support email' }, { key: 'portal_name', label: 'Portal name' }]}
    normalize={({ name, description, support_email, portal_name }) => ({ name, description, support_email, portal_name })}
    columns={[{ label: 'Product', render: (r) => <span className="strong">{r.name}</span> }, { label: 'Description', key: 'description' }, { label: 'Support email', key: 'support_email' }, { label: 'Portal', key: 'portal_name' }]} />
);

export function EntityFields() {
  const [entity, setEntity] = useState('contact');
  return (
    <ConfigList key={entity} title={`${titleCase(entity)} fields`} subtitle="Custom fields shown and edited on the detail page." endpoint="/config/entity-fields" defaults={{ entity, field_type: 'text', options: [] }}
      extra={<div style={{ padding: '10px 18px', borderBottom: '1px solid var(--border)' }}><Select small value={entity} onChange={setEntity} options={[{ value: 'contact', label: 'Contact fields' }, { value: 'company', label: 'Company fields' }]} /></div>}
      fields={[{ key: 'entity', label: 'Applies to', type: 'select', required: true, options: ['contact', 'company'] }, { key: 'label', label: 'Label', required: true }, { key: 'field_type', label: 'Type', type: 'select', required: true, options: ['text', 'textarea', 'number', 'dropdown', 'checkbox', 'date'] }, { key: 'options', label: 'Options (one per line)', type: 'lines', when: (f) => f.field_type === 'dropdown' }]}
      normalize={({ entity: e, label, field_type, options }) => ({ entity: e, label, field_type, options: (options || []).map((o) => o.trim()).filter(Boolean) })}
      columns={[{ label: 'Label', render: (r) => <span className="strong">{r.label}</span> }, { label: 'Applies to', render: (r) => titleCase(r.entity) }, { label: 'Type', render: (r) => <Badge color="blue">{titleCase(r.field_type)}</Badge> }, { label: 'Options', render: (r) => (r.options || []).join(', ') || '—' }]} />
  );
}

export function Surveys() {
  const toast = useToast();
  return (
    <ConfigList title="Satisfaction surveys" subtitle="The active survey is shown to customers once their ticket is resolved. Only one can be active." endpoint="/config/surveys" defaults={{ question: 'How would you rate your experience?', labels: ['Very poor', 'Poor', 'Okay', 'Good', 'Excellent'] }}
      fields={[{ key: 'name', label: 'Name', required: true }, { key: 'question', label: 'Question', required: true }, { key: 'labels', label: 'Answers, worst to best (2 to 7, one per line)', type: 'lines' }, { key: 'is_active', type: 'checkbox', hint: 'Make this the active survey' }]}
      normalize={({ name, question, labels, is_active }) => ({ name, question, is_active, labels: labels.map((l) => l.trim()).filter(Boolean) })}
      columns={[{ label: 'Survey', render: (r) => <><div className="strong">{r.name}</div><div className="muted small">{r.question}</div></> }, { label: 'Scale', render: (r) => `${r.labels.length} point` },
        { label: 'Active', render: (r, reload) => <label className="checkbox"><input type="checkbox" aria-label={`Activate ${r.name}`} checked={r.is_active} onChange={(e) => put(`/config/surveys/${r.id}`, { is_active: e.target.checked }).then(reload).catch((err) => toast.error(errorMessage(err)))} /></label> }]} />
  );
}

export function EmailNotifications() {
  const toast = useToast();
  return (
    <div className="col gap-2">
      <ConfigList title="Email notifications" subtitle="Placeholders: {{ticket.id}} {{ticket.subject}} {{ticket.status}} {{ticket.priority}} {{requester.name}} {{agent.name}} {{reply.body}}" endpoint="/config/email-notifications" idKey="key" canAdd={false} canRemove={() => false}
        fields={[{ key: 'subject', label: 'Subject', required: true }, { key: 'body', label: 'Body', type: 'textarea', rows: 8, required: true }, { key: 'is_enabled', type: 'checkbox', hint: 'Send this email' }]}
        normalize={({ subject, body, is_enabled }) => ({ subject, body, is_enabled })}
        columns={[{ label: 'Notification', render: (r) => <span className="strong">{r.label}</span> }, { label: 'Sent to', render: (r) => titleCase(r.audience) },
          { label: 'Enabled', render: (r, reload) => <label className="checkbox"><input type="checkbox" aria-label={`Enable ${r.label}`} checked={r.is_enabled} onChange={(e) => put(`/config/email-notifications/${r.key}`, { is_enabled: e.target.checked }).then(reload).catch((err) => toast.error(errorMessage(err)))} /></label> }]} />
      <Outbox />
    </div>
  );
}

export function Outbox({ failedOnly }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { get('/config/outbox', failedOnly ? { status: 'failed' } : undefined).then((r) => setRows(r.data)); }, [failedOnly]);
  if (!rows) return <Spinner block />;
  const COLOR = { sent: 'green', logged: 'blue', failed: 'red' };
  return (
    <div className="card">
      <div className="card-header"><div><h3>{failedOnly ? 'Undelivered messages' : 'Email log'} ({rows.length})</h3><p className="muted small">"Logged" means saved here but not sent, because no SMTP server is configured (SMTP_HOST in backend/.env).</p></div></div>
      {rows.length === 0 ? <EmptyState title="No messages" /> : <div className="table-wrap"><table className="table"><thead><tr><th>To</th><th>Subject</th><th>Status</th><th>When</th></tr></thead>
        <tbody>{rows.map((m) => <tr key={m.id}><td>{m.to_email}</td><td>{m.subject}{m.error && <div className="error-text small">{m.error}</div>}</td><td><Badge color={COLOR[m.status]}>{titleCase(m.status)}</Badge></td><td className="muted small">{fmtRelative(m.created_at)}</td></tr>)}</tbody></table></div>}
    </div>
  );
}

// ---------------------------------------------------------------- channels
const PROVIDERS = [
  ['WhatsApp', 'whatsapp'], ['Facebook', 'facebook'], ['Phone', 'phone'], ['Chat', 'chat'],
];
export function Channels() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const ctx = useLookups();
  const [token, setToken] = useState(null);
  const api = `${window.location.origin}/api`;
  useEffect(() => { if (isAdmin) get('/config/channels/token').then((r) => setToken(r.data.token)); }, [isAdmin]);
  const rotate = () => post('/config/channels/token').then((r) => { setToken(r.data.token); toast.success('New token created. Update your providers.'); }).catch((e) => toast.error(errorMessage(e)));
  const embed = `<iframe src="${window.location.origin}/feedback" width="100%" height="560" title="Contact support"></iframe>`;
  return (
    <div className="col gap-2">
      <ConfigList title="Mailboxes" subtitle="Support addresses. Mail forwarded to the inbound endpoint is routed to the mailbox's group and product." endpoint="/config/mailboxes" ctx={ctx}
        fields={[{ key: 'name', label: 'Name', required: true }, { key: 'email', label: 'Email address', required: true }, { key: 'group_id', label: 'Assign to group', type: 'select', options: (c) => opt(c.groups) }, { key: 'product_id', label: 'Product', type: 'select', options: (c) => opt(c.products) }]}
        normalize={({ name, email, group_id, product_id }) => ({ name, email, group_id: group_id || null, product_id: product_id || null })}
        columns={[{ label: 'Mailbox', render: (r) => <span className="strong">{r.name}</span> }, { label: 'Address', key: 'email' }, { label: 'Group', render: (r) => ctx.groups.find((g) => g.id === r.group_id)?.name || '—' }]} />
      <div className="card">
        <div className="card-header"><div><h3>Inbound webhook</h3><p className="muted small">The bridge for mail gateways and messaging providers. Nothing is connected until you point a provider at these URLs.</p></div>
          {isAdmin && <button className="btn btn-sm" onClick={rotate}><RefreshCw size={13} /> {token ? 'Rotate token' : 'Create token'}</button>}</div>
        <div className="card-body form-grid">
          {isAdmin && <Field label="Token (send as the x-inbound-token header)"><input className="input" readOnly value={token || 'Not created yet: inbound requests are refused'} /></Field>}
          <table className="table"><thead><tr><th>Channel</th><th>POST URL</th></tr></thead><tbody>
            <tr><td>Email</td><td className="small"><code>{api}/inbound/email</code></td></tr>
            {PROVIDERS.map(([label, key]) => <tr key={key}><td>{label}</td><td className="small"><code>{`${api}/inbound/${key}`}</code></td></tr>)}
          </tbody></table>
          <p className="muted small">JSON body: <code>from_email</code> or <code>from_phone</code>, <code>from_name</code>, <code>subject</code>, <code>body</code>, <code>to</code>. A subject containing <code>[#123]</code> adds a reply to that ticket.</p>
        </div>
      </div>
      <div className="card"><div className="card-header"><div><h3>Feedback form</h3><p className="muted small">Embed on any website. Submissions become tickets.</p></div><a className="btn btn-sm" href="/feedback" target="_blank" rel="noreferrer">Open form</a></div>
        <div className="card-body"><textarea className="textarea" readOnly value={embed} aria-label="Embed code" /></div></div>
    </div>
  );
}

// ---------------------------------------------------------------- account
export function Security() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [s, setS] = useState(null);
  const [log, setLog] = useState([]);
  useEffect(() => { get('/settings').then((r) => setS(r.data.security)); if (isAdmin) get('/config/audit-log').then((r) => setLog(r.data)); }, [isAdmin]);
  if (!s) return <Spinner block />;
  const save = () => put('/settings/security', s).then(() => toast.success('Security settings saved')).catch((e) => toast.error(errorMessage(e)));
  return (
    <div className="col gap-2">
      <div className="card"><div className="card-header"><h3>Security</h3>{isAdmin && <button className="btn btn-sm btn-primary" onClick={save}>Save</button>}</div>
        <div className="card-body form-grid">
          <Field label="Minimum password length"><input className="input" type="number" min="6" disabled={!isAdmin} value={s.min_password_length} onChange={(e) => setS({ ...s, min_password_length: Number(e.target.value) })} /></Field>
          <Field label="Allowed portal sign-up domains" help="Leave empty to allow any email domain."><TagInput value={s.signup_domains || []} onChange={(v) => setS({ ...s, signup_domains: v })} placeholder="example.org" /></Field>
        </div>
      </div>
      {isAdmin && <div className="card"><div className="card-header"><div><h3>Audit log</h3><p className="muted small">Configuration changes, most recent first.</p></div></div>
        {log.length === 0 ? <EmptyState title="No changes recorded yet" /> : <div className="table-wrap"><table className="table"><thead><tr><th>Who</th><th>Action</th><th>Path</th><th>When</th></tr></thead>
          <tbody>{log.map((l) => <tr key={l.id}><td>{l.actor_label}</td><td><Badge>{l.method}</Badge></td><td className="small"><code>{l.path}</code></td><td className="muted small">{fmtDateTime(l.created_at)}</td></tr>)}</tbody></table></div>}
      </div>}
    </div>
  );
}

export function AccountExports() {
  const toast = useToast();
  const run = (path, name) => downloadFile(path, name).catch((e) => toast.error(errorMessage(e)));
  return (
    <div className="card"><div className="card-header"><div><h3>Account exports</h3><p className="muted small">Download all records as CSV. Scheduled exports are set on saved reports under Analytics.</p></div></div>
      <div className="card-body row wrap">
        <button className="btn" onClick={() => run('/tickets/export?view=all', 'tickets.csv')}><Download size={14} /> Tickets</button>
        <button className="btn" onClick={() => run('/contacts/export', 'contacts.csv')}><Download size={14} /> Contacts</button>
        <button className="btn" onClick={() => run('/companies/export', 'companies.csv')}><Download size={14} /> Companies</button>
      </div>
    </div>
  );
}
