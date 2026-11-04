import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, Folder, FileText, Ticket, Plus, TrendingUp } from 'lucide-react';
import { get } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { Spinner, useDebounce } from '../../components/ui.jsx';

export default function PortalHome() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const dq = useDebounce(q, 250);
  useEffect(() => { get('/kb/portal').then((r) => setData(r.data)); }, [user]);
  useEffect(() => { if (!dq.trim()) { setResults(null); return; } get('/kb/portal/search', { q: dq }).then((r) => setResults(r.data)); }, [dq]);
  return (
    <>
      <div className="portal-hero">
        <h1>How can we help?</h1>
        <p>Search our knowledge base or raise a ticket with our support team.</p>
        <div className="search"><Search size={18} /><input placeholder="Search for articles…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></div>
      </div>
      <div className="portal-container">
        {results ? (
          <div className="card"><div className="card-header"><h3>{results.length} result{results.length === 1 ? '' : 's'} for "{dq}"</h3><button className="btn btn-sm" onClick={() => setQ('')}>Clear</button></div>
            <div className="card-body col gap-2">
              {results.length === 0 && <div className="col center" style={{ padding: 20 }}><p className="muted">We couldn't find an article for that.</p><Link to="/portal/tickets/new" className="btn btn-primary mt-2"><Plus size={14} /> Raise a ticket instead</Link></div>}
              {results.map((a) => <Link key={a.id} to={`/portal/articles/${a.slug}`} className="col" style={{ gap: 2, color: 'inherit' }}><span className="strong row" style={{ gap: 6 }}><FileText size={15} color="var(--primary-600)" />{a.title}</span><span className="muted small">{a.category_name} › {a.folder_name}</span><span className="small">{a.excerpt}…</span></Link>)}
            </div></div>
        ) : !data ? <Spinner block /> : (
          <>
            <div className="grid grid-3 mb-3" style={{ gridTemplateColumns: '2fr 1fr' }}>
              <div className="card"><div className="card-header"><h3><TrendingUp size={16} style={{ verticalAlign: -3, marginRight: 6 }} />Popular articles</h3></div>
                <div className="card-body col" style={{ gap: 8 }}>{data.popular.map((a) => <Link key={a.id} to={`/portal/articles/${a.slug}`} className="row" style={{ gap: 8 }}><FileText size={15} />{a.title}<span className="muted small" style={{ marginLeft: 'auto' }}>{a.views} views</span></Link>)}</div></div>
              <div className="card" style={{ background: 'linear-gradient(135deg, #FEF4E9, #fff)' }}><div className="card-body col" style={{ gap: 12 }}>
                <span style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--primary-600)', display: 'grid', placeItems: 'center' }}><Ticket size={22} color="#fff" /></span>
                <h3>Can't find what you need?</h3><p className="muted small">Our team usually responds within a few hours during business hours.</p>
                <button className="btn btn-primary" onClick={() => navigate('/portal/tickets/new')}><Plus size={15} /> Submit a ticket</button>
                {user && <Link to="/portal/tickets" className="small">View my tickets →</Link>}
              </div></div>
            </div>
            <div className="grid grid-3">
              {data.categories.map((c) => (
                <div key={c.id} className="card kb-cat">
                  <h3>{c.name}</h3><p className="muted small">{c.description}</p>
                  <div className="folders">{c.folders.map((f) => (
                    <div key={f.id} className="kb-folder"><div className="fname"><Folder size={14} color="var(--amber-500)" />{f.name} <span className="muted small">({f.articles.length})</span></div>
                      {f.articles.slice(0, 5).map((a) => <Link key={a.id} to={`/portal/articles/${a.slug}`}>{a.title}</Link>)}
                      {f.articles.length > 5 && <span className="muted small" style={{ paddingLeft: 22 }}>+{f.articles.length - 5} more</span>}</div>
                  ))}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
