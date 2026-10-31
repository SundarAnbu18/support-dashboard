import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { ArrowLeft, Eye, Save, Globe, Trash2 } from 'lucide-react';
import { get, post, put, del, errorMessage } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { Spinner, Field, Select, TagInput, Badge, ConfirmDialog } from '../components/ui.jsx';
import { fmtDateTime } from '../utils/format.js';

export default function ArticleEditor() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [cats, setCats] = useState([]);
  const [article, setArticle] = useState(null);
  const [form, setForm] = useState({ title: '', body: '', folder_id: params.get('folder_id') || '', status: 'draft', tags: [], keywords: [], slug: '' });
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const isNew = !id;

  useEffect(() => {
    get('/kb/categories').then((r) => { setCats(r.data); if (!form.folder_id && !id) setForm((f) => ({ ...f, folder_id: String(r.data[0]?.folders[0]?.id || '') })); });
    if (id) get(`/kb/articles/${id}`).then((r) => { setArticle(r.data); setForm({ title: r.data.title, body: r.data.body, folder_id: String(r.data.folder_id), status: r.data.status, tags: r.data.tags || [], keywords: r.data.keywords || [], slug: r.data.slug }); });
  }, [id]); // eslint-disable-line

  const save = async (status) => {
    setBusy(true);
    try {
      const payload = { ...form, status: status || form.status, folder_id: Number(form.folder_id) };
      const r = isNew ? await post('/kb/articles', payload) : await put(`/kb/articles/${id}`, payload);
      toast.success(status === 'published' ? 'Article published' : 'Article saved');
      if (isNew) navigate(`/solutions/articles/${r.data.id}`, { replace: true }); else { setArticle(r.data); setForm((f) => ({ ...f, status: r.data.status, slug: r.data.slug })); }
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  if (!isNew && !article) return <div className="content"><Spinner block /></div>;
  const folderOptions = cats.flatMap((c) => c.folders.map((f) => ({ value: String(f.id), label: `${c.name} › ${f.name}` })));

  return (
    <div className="content">
      <div className="page-header">
        <div><div className="row small muted mb-2"><Link to="/solutions" className="row" style={{ gap: 4 }}><ArrowLeft size={14} /> Knowledge base</Link></div><h1>{isNew ? 'New article' : 'Edit article'} {!isNew && <Badge color={form.status === 'published' ? 'green' : 'amber'}>{form.status}</Badge>}</h1></div>
        <div className="page-actions">
          {!isNew && form.status === 'published' && <a className="btn" href={`/portal/articles/${form.slug}`} target="_blank" rel="noreferrer"><Eye size={14} /> View in portal</a>}
          {!isNew && <button className="btn btn-danger" onClick={() => setConfirm(true)}><Trash2 size={14} /></button>}
          <button className="btn" onClick={() => save('draft')} disabled={busy || !form.title}><Save size={14} /> Save draft</button>
          <button className="btn btn-primary" onClick={() => save('published')} disabled={busy || !form.title}><Globe size={14} /> {form.status === 'published' ? 'Update' : 'Publish'}</button>
        </div>
      </div>
      <div className="detail-layout">
        <div className="card"><div className="card-body form-grid">
          <Field label="Title" required><input className="input" style={{ fontSize: 18, fontWeight: 600 }} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="How do I…" /></Field>
          <Field label="Content" help="Plain text. Blank lines create paragraphs."><textarea className="textarea" style={{ minHeight: 420, fontSize: 15, lineHeight: 1.7 }} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></Field>
        </div></div>
        <aside className="col gap-2">
          <div className="card"><div className="card-header"><h3>Settings</h3></div><div className="card-body props">
            <Field label="Folder" required><Select value={form.folder_id} onChange={(v) => setForm({ ...form, folder_id: v })} options={folderOptions} /></Field>
            <Field label="URL slug" help="Auto-generated from the title if blank."><input className="input input-sm" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} /></Field>
            <Field label="Tags"><TagInput value={form.tags} onChange={(v) => setForm({ ...form, tags: v })} /></Field>
            <Field label="Search keywords" help="Extra terms that should find this article."><TagInput value={form.keywords} onChange={(v) => setForm({ ...form, keywords: v })} placeholder="Add keyword…" /></Field>
          </div></div>
          {article && <div className="card"><div className="card-header"><h3>Stats</h3></div><div className="card-body"><dl className="kv"><dt>Views</dt><dd>{article.views}</dd><dt>Helpful</dt><dd>{article.thumbs_up} 👍 · {article.thumbs_down} 👎</dd><dt>Author</dt><dd>{article.author_name}</dd><dt>Published</dt><dd>{article.published_at ? fmtDateTime(article.published_at) : '—'}</dd><dt>Updated</dt><dd>{fmtDateTime(article.updated_at)}</dd></dl></div></div>}
        </aside>
      </div>
      {confirm && <ConfirmDialog title="Delete article?" message="This cannot be undone." danger confirmLabel="Delete" onCancel={() => setConfirm(false)} onConfirm={async () => { await del(`/kb/articles/${id}`); toast.success('Article deleted'); navigate('/solutions'); }} />}
    </div>
  );
}
