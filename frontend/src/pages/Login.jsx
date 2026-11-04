import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { errorMessage } from '../api/client.js';
import { Field } from '../components/ui.jsx';

export default function Login() {
  const { login, user, isAgent, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!loading && user) navigate(isAgent ? '/dashboard' : '/portal', { replace: true }); }, [user, loading, isAgent, navigate]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const u = await login(email, password);
      navigate(u.kind === 'user' ? '/dashboard' : '/portal');
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };
  const fill = (e, p) => { setEmail(e); setPassword(p); };

  return (
    <div className="auth-page">
      <div className="auth-hero">
        <div className="row" style={{ gap: 12 }}>
          <img src="/brand/wadhwani-logo.png" alt="Wadhwani Foundation" style={{ height: 72, width: 'auto' }} />
          <span style={{ fontSize: 22, fontWeight: 600 }}>Support</span>
        </div>
        <h1>Every conversation, one inbox.</h1>
        <p>A complete help desk with ticketing, SLAs, automations, knowledge base, customer portal and reporting.</p>
        <ul>
          {['Omnichannel ticket inbox with views & bulk actions', 'SLA policies with breach alerts', 'Automation rules & round-robin assignment', 'Knowledge base and self-service portal', 'Agent, group and CSAT reporting'].map((t) => (
            <li key={t}><CheckCircle2 size={18} color="#BF2026" /> {t}</li>
          ))}
        </ul>
      </div>
      <div className="auth-form">
        <form className="auth-card" onSubmit={submit}>
          <div>
            <h2>Welcome back</h2>
            <p className="muted">Sign in to your agent or customer account.</p>
          </div>
          {error && <div className="alert alert-error">{error}</div>}
          <Field label="Email"><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
          <Field label="Password"><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
          <button className="btn btn-primary" disabled={busy} style={{ padding: 11 }}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <div className="demo-creds">
            <strong>Demo accounts (password: password123)</strong>
            <button type="button" onClick={() => fill('admin@supportdesk.local', 'password123')}>admin@supportdesk.local — Admin</button>
            <button type="button" onClick={() => fill('priya@supportdesk.local', 'password123')}>priya@supportdesk.local — Agent</button>
            <button type="button" onClick={() => fill('customer@acme.com', 'password123')}>customer@acme.com — Customer portal</button>
          </div>
          <p className="muted center small">New customer? <Link to="/register">Create a portal account</Link> · <Link to="/portal">Browse help center</Link></p>
        </form>
      </div>
    </div>
  );
}
