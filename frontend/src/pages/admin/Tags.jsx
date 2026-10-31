import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { get, post, put, del, errorMessage } from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Spinner } from '../../components/ui.jsx';

export default function Tags() {
  const toast = useToast();
  const [tags, setTags] = useState(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#6366f1');
  const [editing, setEditing] = useState(null);
  const load = () => get('/tags').then((r) => setTags(r.data));
  useEffect(() => { load(); }, []);
  const add = async (e) => { e.preventDefault(); try { await post('/tags', { name, color }); setName(''); load(); } catch (err) { toast.error(errorMessage(err)); } };
  const save = async () => { try { await put(`/tags/${editing.id}`, { name: editing.name, color: editing.color }); setEditing(null); load(); } catch (err) { toast.error(errorMessage(err)); } };
  if (!tags) return <Spinner block />;
  return (
    <div className="card">
      <div className="card-header"><h3>Tags ({tags.length})</h3>
        <form className="row" onSubmit={add}><input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 34, height: 32, border: '1px solid var(--border)', borderRadius: 6, padding: 2 }} /><input className="input input-sm" placeholder="new-tag" value={name} onChange={(e) => setName(e.target.value)} /><button className="btn btn-sm btn-primary" disabled={!name}><Plus size={14} /> Add</button></form></div>
      <table className="table"><thead><tr><th>Tag</th><th className="num">Tickets</th><th /></tr></thead>
        <tbody>{tags.map((t) => (
          <tr key={t.id}>
            <td>{editing?.id === t.id ? <div className="row"><input type="color" value={editing.color} onChange={(e) => setEditing({ ...editing, color: e.target.value })} /><input className="input input-sm" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div> : <span className="tag-chip" style={{ borderColor: t.color, background: t.color + '22', color: t.color }}><span className="color-swatch" style={{ background: t.color }} />{t.name}</span>}</td>
            <td className="num"><Link to={`/tickets?tags=${t.name}`}>{t.ticket_count}</Link></td>
            <td><div className="row" style={{ justifyContent: 'flex-end' }}>{editing?.id === t.id ? <><button className="icon-btn" onClick={save}><Check size={14} /></button><button className="icon-btn" onClick={() => setEditing(null)}><X size={14} /></button></> : <><button className="icon-btn" onClick={() => setEditing(t)}><Pencil size={14} /></button><button className="icon-btn" onClick={() => del(`/tags/${t.id}`).then(load)}><Trash2 size={14} /></button></>}</div></td>
          </tr>
        ))}</tbody></table>
    </div>
  );
}
