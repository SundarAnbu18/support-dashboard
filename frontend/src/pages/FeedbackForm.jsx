import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { post, errorMessage } from '../api/client.js';
import { Field } from '../components/ui.jsx';

// Public, embeddable contact form. The "website" field is a hidden trap for bots.
export default function FeedbackForm() {
  const [form, setForm] = useState({ name: '', email: '', subject: '', description: '', website: '' });
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await post('/public/feedback', form); setDone(true); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };
  if (done) return <div className="portal-container" style={{ maxWidth: 560 }}><div className="alert alert-success"><CheckCircle2 size={16} /> Thanks! We received your message and will reply by email.</div></div>;
  return (
    <div className="portal-container" style={{ maxWidth: 560 }}>
      <form className="card" onSubmit={submit}><div className="card-header"><h3>Contact support</h3></div><div className="card-body form-grid">
        {error && <div className="alert alert-error">{error}</div>}
        <div className="form-row">
          <Field label="Your name"><input className="input" value={form.name} onChange={set('name')} /></Field>
          <Field label="Email" required><input className="input" type="email" required value={form.email} onChange={set('email')} /></Field>
        </div>
        <Field label="Subject" required><input className="input" required value={form.subject} onChange={set('subject')} /></Field>
        <Field label="How can we help?" required><textarea className="textarea" style={{ minHeight: 140 }} required value={form.description} onChange={set('description')} /></Field>
        <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', left: -9999 }} value={form.website} onChange={set('website')} />
        <div className="form-actions"><button className="btn btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send'}</button></div>
      </div></form>
    </div>
  );
}
