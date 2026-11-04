import { useEffect, useRef, useState } from 'react';
import { X, Inbox, ChevronLeft, ChevronRight } from 'lucide-react';
import { initials, avatarColor, STATUS_LABELS, CUSTOMER_STATUS_LABELS, PRIORITY_LABELS, SLA_LABELS, titleCase } from '../utils/format.js';

export function Spinner({ block }) {
  if (block) return <div className="loading-block"><div className="spinner" /></div>;
  return <div className="spinner" />;
}

export function Avatar({ name, src, size = '' , title }) {
  return (
    <span className={`avatar ${size ? 'avatar-' + size : ''}`} style={{ background: avatarColor(name) }} title={title || name}>
      {src ? <img src={src} alt={name} /> : initials(name)}
    </span>
  );
}

const STATUS_COLORS = { open: 'badge-red', pending: 'badge-amber', resolved: 'badge-green', closed: 'badge-gray' };
export function StatusBadge({ status }) {
  const onPortal = window.location.pathname.startsWith('/portal');
  const label = (onPortal && CUSTOMER_STATUS_LABELS[status]) || STATUS_LABELS[status] || titleCase(status);
  return <span className={`badge ${STATUS_COLORS[status] || 'badge-purple'}`}>{label}</span>;
}

export function PriorityBadge({ priority, dotOnly }) {
  if (dotOnly) return <span className={`priority-dot priority-${priority}`} title={PRIORITY_LABELS[priority]} />;
  return (
    <span className="badge badge-outline">
      <span className={`priority-dot priority-${priority}`} /> {PRIORITY_LABELS[priority] || titleCase(priority)}
    </span>
  );
}

export function SlaPill({ status, dueBy }) {
  if (!status) return null;
  return <span className={`sla-pill sla-${status}`} title={dueBy ? new Date(dueBy).toLocaleString() : ''}>{SLA_LABELS[status] || status}</span>;
}

export function Badge({ color = 'gray', children }) {
  return <span className={`badge badge-${color}`}>{children}</span>;
}

export function Modal({ title, onClose, children, footer, size = '' }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${size}`}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ title = 'Are you sure?', message, confirmLabel = 'Confirm', danger, onConfirm, onCancel, busy }) {
  return (
    <Modal title={title} onClose={onCancel} footer={
      <>
        <button className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy}>{busy ? 'Working…' : confirmLabel}</button>
      </>
    }>
      <p>{message}</p>
    </Modal>
  );
}

export function Dropdown({ trigger, children, align = 'right', wide }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);
  return (
    <div className="dropdown" ref={ref}>
      <div onClick={() => setOpen((o) => !o)}>{trigger}</div>
      {open && (
        <div className={`dropdown-menu ${wide ? 'wide' : ''}`} style={align === 'left' ? { left: 0, right: 'auto' } : undefined} onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title = 'Nothing here', message, action }) {
  return (
    <div className="empty">
      <Icon size={40} />
      <h3>{title}</h3>
      {message && <p>{message}</p>}
      {action}
    </div>
  );
}

export function Pagination({ meta, onPage }) {
  if (!meta) return null;
  const pages = Math.max(1, Math.ceil(meta.total / meta.per_page));
  const start = meta.total ? (meta.page - 1) * meta.per_page + 1 : 0;
  const end = Math.min(meta.total, meta.page * meta.per_page);
  return (
    <div className="pagination">
      <span>{start}–{end} of {meta.total}</span>
      <div className="row">
        <button className="btn btn-sm" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}><ChevronLeft size={14} /> Prev</button>
        <span>Page {meta.page} of {pages}</span>
        <button className="btn btn-sm" disabled={meta.page >= pages} onClick={() => onPage(meta.page + 1)}>Next <ChevronRight size={14} /></button>
      </div>
    </div>
  );
}

export function Field({ label, required, help, children, error }) {
  return (
    <div className="field">
      {label && <label>{label}{required && <span className="req">*</span>}</label>}
      {children}
      {help && <span className="help">{help}</span>}
      {error && <span className="error-text">{error}</span>}
    </div>
  );
}

export function Select({ value, onChange, options, placeholder, small, ...rest }) {
  return (
    <select className={`select ${small ? 'select-sm' : ''}`} value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => {
        const opt = typeof o === 'string' ? { value: o, label: titleCase(o) } : o;
        return <option key={opt.value} value={opt.value}>{opt.label}</option>;
      })}
    </select>
  );
}

export function TagInput({ value = [], onChange, suggestions = [], placeholder = 'Add tag…' }) {
  const [text, setText] = useState('');
  const add = (t) => {
    const v = t.trim().toLowerCase();
    if (v && !value.includes(v)) onChange([...value, v]);
    setText('');
  };
  const filtered = suggestions.filter((s) => s.toLowerCase().includes(text.toLowerCase()) && !value.includes(s)).slice(0, 6);
  return (
    <div className="col">
      <div className="row wrap" style={{ gap: 6 }}>
        {value.map((t) => (
          <span key={t} className="tag-chip">{t}<button type="button" onClick={() => onChange(value.filter((x) => x !== t))}><X size={12} /></button></span>
        ))}
      </div>
      <div style={{ position: 'relative' }}>
        <input className="input input-sm" value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(text); } if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1)); }}
          list="tag-suggestions" />
        {text && filtered.length > 0 && (
          <div className="dropdown-menu" style={{ left: 0, right: 'auto', top: '100%' }}>
            {filtered.map((s) => <button type="button" key={s} onClick={() => add(s)}>{s}</button>)}
          </div>
        )}
      </div>
    </div>
  );
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button key={t.key} className={active === t.key ? 'active' : ''} onClick={() => onChange(t.key)}>
          {t.icon && <t.icon size={15} />}{t.label}{t.count !== undefined && <span className="count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function StatCard({ label, value, hint, tone, icon: Icon, onClick }) {
  return (
    <div className="card stat" onClick={onClick}>
      <div className="row-between"><div className="label">{label}</div>{Icon && <span className={`stat-icon ${tone || ''}`}><Icon size={15} /></span>}</div>
      <div className={`value ${tone || ''}`}>{value ?? '—'}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function useDebounce(value, delay = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), delay); return () => clearTimeout(t); }, [value, delay]);
  return v;
}
