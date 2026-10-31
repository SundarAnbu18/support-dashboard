import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { put, post, errorMessage } from '../api/client.js';
import { Avatar, Field } from '../components/ui.jsx';

export default function Profile() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ name: user.name || '', phone: user.phone || '', job_title: user.job_title || '', time_zone: user.time_zone || 'UTC', signature: user.signature || '', avatar_url: user.avatar_url || '' });
  const [pw, setPw] = useState({ current_password: '', new_password: '', confirm: '' });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const save = async (e) => {
    e.preventDefault();
    try { const r = await put('/auth/me', form); setUser({ ...user, ...r.user }); toast.success('Profile updated'); } catch (err) { toast.error(errorMessage(err)); }
  };
  const changePw = async (e) => {
    e.preventDefault();
    if (pw.new_password !== pw.confirm) return toast.error('Passwords do not match');
    try { await post('/auth/change-password', pw); setPw({ current_password: '', new_password: '', confirm: '' }); toast.success('Password changed'); } catch (err) { toast.error(errorMessage(err)); }
  };

  return (
    <div className="content">
      <div className="page-header"><div><h1>My profile</h1><p className="sub">Your personal details and reply signature.</p></div></div>
      <div className="grid grid-2">
        <form className="card" onSubmit={save}>
          <div className="card-header"><h3>Details</h3></div>
          <div className="card-body form-grid">
            <div className="row" style={{ gap: 14 }}><Avatar name={form.name} src={form.avatar_url} size="xl" /><div><div className="strong" style={{ fontSize: 16 }}>{user.name}</div><div className="muted">{user.email} · {user.role}</div></div></div>
            <Field label="Full name"><input className="input" value={form.name} onChange={set('name')} /></Field>
            <div className="form-row">
              <Field label="Phone"><input className="input" value={form.phone} onChange={set('phone')} /></Field>
              <Field label="Job title"><input className="input" value={form.job_title} onChange={set('job_title')} /></Field>
            </div>
            <Field label="Time zone"><input className="input" value={form.time_zone} onChange={set('time_zone')} placeholder="e.g. America/New_York" /></Field>
            <Field label="Avatar URL"><input className="input" value={form.avatar_url} onChange={set('avatar_url')} placeholder="https://…" /></Field>
            {user.kind === 'user' && <Field label="Reply signature" help="Appended when you insert it into a reply."><textarea className="textarea" value={form.signature} onChange={set('signature')} /></Field>}
            <div className="form-actions"><button className="btn btn-primary">Save changes</button></div>
          </div>
        </form>
        <form className="card" onSubmit={changePw} style={{ alignSelf: 'start' }}>
          <div className="card-header"><h3>Change password</h3></div>
          <div className="card-body form-grid">
            <Field label="Current password"><input className="input" type="password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} required /></Field>
            <Field label="New password"><input className="input" type="password" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} required minLength={6} /></Field>
            <Field label="Confirm new password"><input className="input" type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required /></Field>
            <div className="form-actions"><button className="btn">Update password</button></div>
          </div>
        </form>
      </div>
    </div>
  );
}
