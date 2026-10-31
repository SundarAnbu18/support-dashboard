import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ThumbsUp, ThumbsDown, FileText, Printer } from 'lucide-react';
import { get, post } from '../../api/client.js';
import { Spinner } from '../../components/ui.jsx';
import { fmtDate } from '../../utils/format.js';

export default function PortalArticle() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [a, setA] = useState(null);
  const [voted, setVoted] = useState(null);
  useEffect(() => { setA(null); setVoted(null); get(`/kb/portal/articles/${slug}`).then((r) => setA(r.data)).catch(() => navigate('/portal')); }, [slug, navigate]);
  if (!a) return <Spinner block />;
  const vote = async (helpful) => { if (voted !== null) return; await post(`/kb/portal/articles/${slug}/feedback`, { helpful }); setVoted(helpful); };
  return (
    <div className="portal-container">
      <div className="row small muted mb-2"><Link to="/portal" className="row" style={{ gap: 4 }}><ArrowLeft size={14} /> Help Center</Link><span>›</span><span>{a.category_name}</span><span>›</span><span>{a.folder_name}</span></div>
      <div className="detail-layout" style={{ gridTemplateColumns: 'minmax(0,1fr) 280px' }}>
        <article className="card"><div className="card-body" style={{ padding: 32 }}>
          <h1 style={{ fontSize: 28, marginBottom: 8 }}>{a.title}</h1>
          <p className="muted small mb-3">Updated {fmtDate(a.updated_at)}{a.author_name && ` · by ${a.author_name}`} · {a.views} views</p>
          <div className="article-body">{a.body}</div>
          <div className="divider" style={{ margin: '28px 0' }} />
          <div className="row-between wrap">
            <div className="row"><span className="strong">Was this article helpful?</span>
              <button className={`btn btn-sm ${voted === true ? 'btn-primary' : ''}`} onClick={() => vote(true)} disabled={voted !== null}><ThumbsUp size={14} /> Yes</button>
              <button className={`btn btn-sm ${voted === false ? 'btn-primary' : ''}`} onClick={() => vote(false)} disabled={voted !== null}><ThumbsDown size={14} /> No</button>
              {voted !== null && <span className="muted small">Thanks for your feedback!</span>}</div>
            <button className="btn btn-sm btn-ghost" onClick={() => window.print()}><Printer size={14} /> Print</button>
          </div>
        </div></article>
        <aside className="col gap-2">
          {a.related.length > 0 && <div className="card"><div className="card-header"><h3>Related articles</h3></div><div className="card-body col" style={{ gap: 8 }}>{a.related.map((r) => <Link key={r.id} to={`/portal/articles/${r.slug}`} className="row small" style={{ gap: 6 }}><FileText size={14} />{r.title}</Link>)}</div></div>}
          <div className="card"><div className="card-body col" style={{ gap: 8 }}><h3>Still need help?</h3><p className="muted small">If this article didn't solve your problem, our team is here for you.</p><Link to="/portal/tickets/new" className="btn btn-primary">Submit a ticket</Link></div></div>
        </aside>
      </div>
    </div>
  );
}
