import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { errorMessage } from '../api/client.js';
import { Field } from '../components/ui.jsx';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', phone: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await register(form); navigate('/portal'); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <div className="auth-form" style={{ minHeight: '100vh' }}>
      <form className="auth-card" onSubmit={submit}>
        <div><h2>Create your account</h2><p className="muted">Track your support requests and browse the help center.</p></div>
        {error && <div className="alert alert-error">{error}</div>}
        <Field label="Full name" required><input className="input" value={form.name} onChange={set('name')} required /></Field>
        <Field label="Work email" required><input className="input" type="email" value={form.email} onChange={set('email')} required /></Field>
        <Field label="Phone"><input className="input" value={form.phone} onChange={set('phone')} /></Field>
        <Field label="Password" required help="At least 6 characters"><input className="input" type="password" value={form.password} onChange={set('password')} required minLength={6} /></Field>
        <button className="btn btn-primary" disabled={busy} style={{ padding: 11 }}>{busy ? 'Creating…' : 'Create account'}</button>
        <p className="muted center small">Already registered? <Link to="/login">Sign in</Link></p>
      </form>
    </div>
  );
}
