import { useEffect, useState } from 'react';
import { get, put, errorMessage } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { Spinner, Field, Select } from '../../components/ui.jsx';
import { PRIORITY_OPTIONS } from '../../utils/format.js';

export default function General() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [s, setS] = useState(null);
  useEffect(() => { get('/settings').then((r) => setS(r.data)); }, []);
  if (!s) return <Spinner block />;
  const upd = (group, k, v) => setS({ ...s, [group]: { ...s[group], [k]: v } });
  const save = async (group) => {
    try { const r = await put(`/settings/${group}`, s[group]); setS({ ...s, [group]: r.data }); toast.success('Settings saved'); } catch (e) { toast.error(errorMessage(e)); }
  };
  const ro = !isAdmin;
  return (
    <div className="col gap-2">
      <div className="card"><div className="card-header"><h3>Helpdesk</h3>{isAdmin && <button className="btn btn-sm btn-primary" onClick={() => save('helpdesk')}>Save</button>}</div>
        <div className="card-body form-grid">
          <div className="form-row">
            <Field label="Helpdesk name"><input className="input" disabled={ro} value={s.helpdesk.name} onChange={(e) => upd('helpdesk', 'name', e.target.value)} /></Field>
            <Field label="Portal name"><input className="input" disabled={ro} value={s.helpdesk.portal_name} onChange={(e) => upd('helpdesk', 'portal_name', e.target.value)} /></Field>
          </div>
          <div className="form-row">
            <Field label="Support email"><input className="input" disabled={ro} value={s.helpdesk.support_email} onChange={(e) => upd('helpdesk', 'support_email', e.target.value)} /></Field>
            <Field label="Time zone"><input className="input" disabled={ro} value={s.helpdesk.time_zone} onChange={(e) => upd('helpdesk', 'time_zone', e.target.value)} /></Field>
          </div>
          <label className="checkbox"><input type="checkbox" disabled={ro} checked={!!s.helpdesk.portal_signup_enabled} onChange={(e) => upd('helpdesk', 'portal_signup_enabled', e.target.checked)} /> Allow customers to sign up on the portal</label>
        </div>
      </div>
      <div className="card"><div className="card-header"><h3>Tickets</h3>{isAdmin && <button className="btn btn-sm btn-primary" onClick={() => save('tickets')}>Save</button>}</div>
        <div className="card-body form-grid">
          <div className="form-row">
            <Field label="Default priority"><Select disabled={ro} value={s.tickets.default_priority} onChange={(v) => upd('tickets', 'default_priority', v)} options={PRIORITY_OPTIONS} /></Field>
            <Field label="Auto-close resolved tickets after (days)" help="0 disables auto-close. Runs hourly."><input className="input" type="number" min="0" disabled={ro} value={s.tickets.auto_close_after_days} onChange={(e) => upd('tickets', 'auto_close_after_days', Number(e.target.value))} /></Field>
          </div>
          <label className="checkbox"><input type="checkbox" disabled={ro} checked={!!s.tickets.allow_customer_close} onChange={(e) => upd('tickets', 'allow_customer_close', e.target.checked)} /> Customers can close their own tickets</label>
          <label className="checkbox"><input type="checkbox" disabled={ro} checked={!!s.tickets.csat_enabled} onChange={(e) => upd('tickets', 'csat_enabled', e.target.checked)} /> Ask for a satisfaction rating when a ticket is resolved</label>
          <label className="checkbox"><input type="checkbox" disabled={ro} checked={!!s.tickets.agent_collision} onChange={(e) => upd('tickets', 'agent_collision', e.target.checked)} /> Show agent collision warnings</label>
        </div>
      </div>
      <div className="card"><div className="card-header"><h3>Notifications</h3>{isAdmin && <button className="btn btn-sm btn-primary" onClick={() => save('notifications')}>Save</button>}</div>
        <div className="card-body form-grid">
          <label className="checkbox"><input type="checkbox" disabled={ro} checked={!!s.notifications.notify_assignee} onChange={(e) => upd('notifications', 'notify_assignee', e.target.checked)} /> Notify agent when a ticket is assigned to them</label>
          <label className="checkbox"><input type="checkbox" disabled={ro} checked={!!s.notifications.notify_group_on_new} onChange={(e) => upd('notifications', 'notify_group_on_new', e.target.checked)} /> Notify group members on new unassigned tickets</label>
          <label className="checkbox"><input type="checkbox" disabled={ro} checked={!!s.notifications.notify_requester_on_reply} onChange={(e) => upd('notifications', 'notify_requester_on_reply', e.target.checked)} /> Notify requester when an agent replies</label>
        </div>
      </div>
    </div>
  );
}
