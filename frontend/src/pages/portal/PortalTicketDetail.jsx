import { useEffect, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Paperclip, X, Send, Star } from 'lucide-react';
import { get, patch, post, postForm, errorMessage } from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Spinner, StatusBadge, PriorityBadge } from '../../components/ui.jsx';
import { fmtSmart, titleCase } from '../../utils/format.js';
import { Conversation } from '../TicketDetail.jsx';

export default function PortalTicketDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [t, setT] = useState(null);
  const [body, setBody] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState('');
  const load = useCallback(() => get(`/tickets/${id}`).then((r) => setT(r.data)).catch(() => navigate('/portal/tickets')), [id, navigate]);
  useEffect(() => { load(); }, [load]);
  if (!t) return <Spinner block />;
  const resolved = ['resolved', 'closed'].includes(t.status);
  const send = async () => {
    if (!body.trim()) return; setBusy(true);
    try { await postForm(`/tickets/${id}/reply`, { body }, files); setBody(''); setFiles([]); toast.success(resolved ? 'Reply sent — ticket reopened' : 'Reply sent'); load(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const rate = async () => { try { await post(`/tickets/${id}/satisfaction`, { rating, feedback }); toast.success('Thanks for your feedback!'); load(); } catch (e) { toast.error(errorMessage(e)); } };
  return (
    <div className="portal-container">
      <div className="row small muted mb-2"><Link to="/portal/tickets" className="row" style={{ gap: 4 }}><ArrowLeft size={14} /> My tickets</Link></div>
      <div className="detail-layout" style={{ gridTemplateColumns: 'minmax(0,1fr) 280px' }}>
        <div>
          <div className="detail-header"><div><h1><span className="ticket-id">#{t.id}</span>{t.subject}</h1><div className="row wrap small muted mt-1"><StatusBadge status={t.status} /><PriorityBadge priority={t.priority} /><span>· Created {fmtSmart(t.created_at)}</span></div></div>
            <div className="page-actions">{!resolved && <button className="btn" onClick={() => patch(`/tickets/${id}`, { status: 'closed' }).then(load)}>Mark as closed</button>}</div></div>
          <Conversation items={t.conversations} ticket={t} />
          {resolved && !t.satisfaction && (
            <div className="card mt-3" style={{ borderColor: '#fde68a', background: '#fffbeb' }}><div className="card-body col" style={{ gap: 10 }}>
              <h3><Star size={16} style={{ verticalAlign: -3 }} /> How did we do?</h3><p className="muted small">Rate your experience with this ticket.</p>
              <div className="rating-stars">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" className={rating >= n ? 'on' : ''} onClick={() => setRating(n)}>★</button>)}</div>
              <textarea className="textarea" style={{ minHeight: 60 }} placeholder="Any comments? (optional)" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
              <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={!rating} onClick={rate}>Submit rating</button>
            </div></div>
          )}
          {t.satisfaction && <div className="alert alert-success mt-3"><Star size={16} /> You rated this ticket {t.satisfaction.rating}/5. Thank you!</div>}
          <div className="reply-box mt-3">
            <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={resolved ? 'Replying will reopen this ticket…' : 'Write a reply…'} />
            <div className="reply-footer"><label className="btn btn-sm"><Paperclip size={14} /> Attach<input type="file" multiple hidden onChange={(e) => setFiles([...files, ...Array.from(e.target.files)])} /></label>{files.map((f, i) => <span key={i} className="tag-chip">{f.name}<button onClick={() => setFiles(files.filter((_, j) => j !== i))}><X size={12} /></button></span>)}
              <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={send} disabled={busy || !body.trim()}><Send size={14} /> Send reply</button></div>
          </div>
        </div>
        <aside className="card" style={{ alignSelf: 'start' }}><div className="card-header"><h3>Details</h3></div><div className="card-body"><dl className="kv">
          <dt>Status</dt><dd><StatusBadge status={t.status} /></dd><dt>Priority</dt><dd>{titleCase(t.priority)}</dd><dt>Type</dt><dd>{t.type ? titleCase(t.type) : '—'}</dd>
          <dt>Agent</dt><dd>{t.responder_name || 'Not yet assigned'}</dd><dt>Created</dt><dd>{fmtSmart(t.created_at)}</dd><dt>Updated</dt><dd>{fmtSmart(t.updated_at)}</dd>
          {t.resolved_at && <><dt>Resolved</dt><dd>{fmtSmart(t.resolved_at)}</dd></>}
          {Object.entries(t.custom_fields || {}).map(([k, v]) => <><dt key={k + 'k'}>{titleCase(k)}</dt><dd key={k + 'v'}>{String(v)}</dd></>)}
        </dl></div></aside>
      </div>
    </div>
  );
}
