import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Plus, FolderPlus, Folder, BookOpen, Pencil, Trash2, Eye, ThumbsUp, ThumbsDown, Lock, Globe, Users } from 'lucide-react';
import { get, post, put, del, errorMessage } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { Spinner, EmptyState, Modal, Field, Select, Badge, ConfirmDialog, useDebounce } from '../components/ui.jsx';
import { fmtRelative } from '../utils/format.js';

const VIS_ICON = { public: Globe, logged_in: Users, agents: Lock };

function CategoryModal({ initial, onClose, onSaved }) {
  const [form, setForm] = useState({ name: '', description: '', visible_in_portal: true, ...initial });
  const toast = useToast();
  const save = async () => {
    try { const r = initial?.id ? await put(`/kb/categories/${initial.id}`, form) : await post('/kb/categories', form); onSaved(r.data); } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <Modal title={initial?.id ? 'Edit category' : 'New category'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={!form.name}>Save</button></>}>
      <div className="form-grid">
        <Field label="Name" required><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Field>
        <Field label="Description"><input className="input" value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <label className="checkbox"><input type="checkbox" checked={form.visible_in_portal} onChange={(e) => setForm({ ...form, visible_in_portal: e.target.checked })} /> Visible in customer portal</label>
      </div>
    </Modal>
  );
}

function FolderModal({ initial, categories, onClose, onSaved }) {
  const [form, setForm] = useState({ name: '', description: '', visibility: 'public', category_id: categories[0]?.id || '', ...initial });
  const toast = useToast();
  const save = async () => {
    try { const r = initial?.id ? await put(`/kb/folders/${initial.id}`, form) : await post('/kb/folders', form); onSaved(r.data); } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <Modal title={initial?.id ? 'Edit folder' : 'New folder'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={!form.name}>Save</button></>}>
      <div className="form-grid">
        <Field label="Name" required><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Field>
        <Field label="Category"><Select value={String(form.category_id)} onChange={(v) => setForm({ ...form, category_id: Number(v) })} options={categories.map((c) => ({ value: String(c.id), label: c.name }))} /></Field>
        <Field label="Visibility"><Select value={form.visibility} onChange={(v) => setForm({ ...form, visibility: v })} options={[{ value: 'public', label: 'Everyone (public)' }, { value: 'logged_in', label: 'Logged-in customers' }, { value: 'agents', label: 'Agents only' }]} /></Field>
        <Field label="Description"><input className="input" value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

export default function KnowledgeBase() {
  const navigate = useNavigate();
  const toast = useToast();
  const [cats, setCats] = useState(null);
  const [articles, setArticles] = useState([]);
  const [selected, setSelected] = useState({ type: 'all' });
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const dq = useDebounce(q, 300);
  const [modal, setModal] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const loadCats = () => get('/kb/categories').then((r) => setCats(r.data));
  const loadArticles = () => get('/kb/articles', { q: dq || undefined, status: status || undefined, folder_id: selected.type === 'folder' ? selected.id : undefined, category_id: selected.type === 'category' ? selected.id : undefined }).then((r) => setArticles(r.data));
  useEffect(() => { loadCats(); }, []);
  useEffect(() => { loadArticles(); }, [dq, status, selected]); // eslint-disable-line

  if (!cats) return <div className="content"><Spinner block /></div>;
  const allFolders = cats.flatMap((c) => c.folders);
  const title = selected.type === 'all' ? 'All articles' : selected.type === 'category' ? cats.find((c) => c.id === selected.id)?.name : allFolders.find((f) => f.id === selected.id)?.name;

  return (
    <div className="content flush">
      <div className="ticket-layout">
        <aside className="filter-panel" style={{ width: 290 }}>
          <div className="row-between"><h4 style={{ margin: 0 }}>Categories</h4><button className="btn btn-xs" onClick={() => setModal({ kind: 'category' })}><Plus size={12} /> Category</button></div>
          <div className="view-list">
            <button className={selected.type === 'all' ? 'active' : ''} onClick={() => setSelected({ type: 'all' })}><span><BookOpen size={14} style={{ verticalAlign: -2, marginRight: 6 }} />All articles</span></button>
            {cats.map((c) => (
              <div key={c.id}>
                <button className={selected.type === 'category' && selected.id === c.id ? 'active' : ''} onClick={() => setSelected({ type: 'category', id: c.id })} style={{ fontWeight: 600 }}>
                  <span className="truncate">{c.name}</span>
                  <span className="row" style={{ gap: 2 }} onClick={(e) => e.stopPropagation()}>
                    <Pencil size={12} className="muted" onClick={() => setModal({ kind: 'category', initial: c })} />
                    <Trash2 size={12} className="muted" onClick={() => setConfirm({ msg: `Delete category "${c.name}" and all its folders and articles?`, run: () => del(`/kb/categories/${c.id}`) })} />
                  </span>
                </button>
                {c.folders.map((f) => {
                  const Icon = VIS_ICON[f.visibility] || Folder;
                  return (
                    <button key={f.id} className={selected.type === 'folder' && selected.id === f.id ? 'active' : ''} style={{ paddingLeft: 24 }} onClick={() => setSelected({ type: 'folder', id: f.id })}>
                      <span className="truncate row" style={{ gap: 6 }}><Icon size={12} className="muted" />{f.name}</span>
                      <span className="row" style={{ gap: 4 }}><span className="count">{f.published_count}/{f.article_count}</span>
                        <span onClick={(e) => e.stopPropagation()} className="row" style={{ gap: 2 }}><Pencil size={12} className="muted" onClick={() => setModal({ kind: 'folder', initial: f })} /><Trash2 size={12} className="muted" onClick={() => setConfirm({ msg: `Delete folder "${f.name}" and its articles?`, run: () => del(`/kb/folders/${f.id}`) })} /></span></span>
                    </button>
                  );
                })}
                <button style={{ paddingLeft: 24, color: 'var(--blue-600)', fontSize: 12.5 }} onClick={() => setModal({ kind: 'folder', initial: { category_id: c.id } })}><span><FolderPlus size={12} style={{ verticalAlign: -2, marginRight: 6 }} />Add folder</span></button>
              </div>
            ))}
          </div>
        </aside>
        <section className="ticket-list">
          <div className="list-toolbar">
            <span className="title">{title}</span><span className="muted small">{articles.length} articles</span>
            <input className="input input-sm" style={{ maxWidth: 260, marginLeft: 8 }} placeholder="Search articles…" value={q} onChange={(e) => setQ(e.target.value)} />
            <Select small value={status} placeholder="All statuses" onChange={setStatus} options={['published', 'draft']} />
            <div style={{ marginLeft: 'auto' }}><Link to="/portal" className="btn btn-sm" target="_blank"><Eye size={14} /> View portal</Link> <button className="btn btn-sm btn-primary" onClick={() => navigate(`/solutions/articles/new${selected.type === 'folder' ? `?folder_id=${selected.id}` : ''}`)} disabled={!allFolders.length}><Plus size={14} /> New article</button></div>
          </div>
          <div className="list-scroll" style={{ padding: 20 }}>
            {articles.length === 0 ? <EmptyState icon={BookOpen} title="No articles" message={allFolders.length ? 'Create your first article in this folder.' : 'Create a category and a folder first.'} /> : (
              <div className="card"><table className="table">
                <thead><tr><th>Title</th><th>Folder</th><th>Status</th><th>Author</th><th className="num"><Eye size={13} /></th><th className="num"><ThumbsUp size={13} /></th><th className="num"><ThumbsDown size={13} /></th><th>Updated</th><th /></tr></thead>
                <tbody>{articles.map((a) => (
                  <tr key={a.id} className="clickable" onClick={() => navigate(`/solutions/articles/${a.id}`)}>
                    <td><div className="strong">{a.title}</div><div className="muted small truncate" style={{ maxWidth: 420 }}>{a.body?.slice(0, 120)}</div></td>
                    <td className="small">{a.category_name} › {a.folder_name}</td>
                    <td><Badge color={a.status === 'published' ? 'green' : 'amber'}>{a.status}</Badge></td>
                    <td className="small">{a.author_name || '—'}</td><td className="num">{a.views}</td><td className="num">{a.thumbs_up}</td><td className="num">{a.thumbs_down}</td>
                    <td className="muted small">{fmtRelative(a.updated_at)}</td>
                    <td onClick={(e) => e.stopPropagation()}><button className="icon-btn" onClick={() => setConfirm({ msg: `Delete article "${a.title}"?`, run: () => del(`/kb/articles/${a.id}`) })}><Trash2 size={14} /></button></td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </div>
        </section>
      </div>
      {modal?.kind === 'category' && <CategoryModal initial={modal.initial} onClose={() => setModal(null)} onSaved={() => { setModal(null); loadCats(); toast.success('Category saved'); }} />}
      {modal?.kind === 'folder' && <FolderModal initial={modal.initial} categories={cats} onClose={() => setModal(null)} onSaved={() => { setModal(null); loadCats(); toast.success('Folder saved'); }} />}
      {confirm && <ConfirmDialog message={confirm.msg} danger confirmLabel="Delete" onCancel={() => setConfirm(null)} onConfirm={async () => { try { await confirm.run(); loadCats(); loadArticles(); setSelected({ type: 'all' }); } catch (e) { toast.error(errorMessage(e)); } setConfirm(null); }} />}
    </div>
  );
}
