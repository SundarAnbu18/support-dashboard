import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Lock, MessageSquare, Pin, Plus, Search, ThumbsUp, Trash2 } from 'lucide-react';
import { get, post, patch, put, del, errorMessage } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Avatar, Badge, EmptyState, Field, Modal, Pagination, Select, Spinner, useDebounce } from '../components/ui.jsx';
import { fmtRelative, titleCase } from '../utils/format.js';

const STAMPS = { questions: ['answered', 'unanswered'], ideas: ['planned', 'in_progress', 'implemented', 'not_taken'], problems: ['investigating', 'solved'], announcements: [] };

function TopicModal({ categories, forumId, onClose, onSaved }) {
  const toast = useToast();
  const { isAgent } = useAuth();
  const forums = categories.flatMap((c) => c.forums).filter((f) => isAgent || f.forum_type !== 'announcements');
  const [form, setForm] = useState({ forum_id: forumId || forums[0]?.id || '', title: '', body: '' });
  const save = async () => {
    try { const r = await post('/forums/topics', form); onSaved(r.data); } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <Modal title="New topic" size="lg" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!form.title || !form.body || !form.forum_id} onClick={save}>Post topic</button></>}>
      <div className="form-grid">
        <Field label="Forum" required><Select value={String(form.forum_id)} onChange={(v) => setForm({ ...form, forum_id: v })} options={forums.map((f) => ({ value: String(f.id), label: f.name }))} /></Field>
        <Field label="Title" required><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
        <Field label="Message" required><textarea className="textarea" style={{ minHeight: 160 }} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function ForumAdmin({ category, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', description: '', forum_type: 'questions', visibility: 'public' });
  const save = async () => {
    try { await post('/forums/forums', { ...form, category_id: category.id }); onSaved(); } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <Modal title={`New forum in ${category.name}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!form.name} onClick={save}>Create</button></>}>
      <div className="form-grid">
        <Field label="Name" required><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Description"><input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        <div className="form-row">
          <Field label="Type"><Select value={form.forum_type} onChange={(v) => setForm({ ...form, forum_type: v })} options={['questions', 'ideas', 'problems', 'announcements']} /></Field>
          <Field label="Visible to"><Select value={form.visibility} onChange={(v) => setForm({ ...form, visibility: v })} options={[{ value: 'public', label: 'Everyone' }, { value: 'logged_in', label: 'Logged-in users' }, { value: 'agents', label: 'Agents only' }]} /></Field>
        </div>
      </div>
    </Modal>
  );
}

// `base` lets the agent app and the customer portal share these screens.
export default function Forums({ base = '/forums' }) {
  const { user, isAgent } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [categories, setCategories] = useState(null);
  const [topics, setTopics] = useState(null);
  const [counts, setCounts] = useState(null);
  const [waitingPosts, setWaitingPosts] = useState([]);
  const [modal, setModal] = useState(() => new URLSearchParams(window.location.search).has('new'));
  const [forumModal, setForumModal] = useState(null);
  const [q, setQ] = useState('');
  const dq = useDebounce(q, 300);
  const canModerate = isAgent && user?.privileges?.includes('moderate_forums');
  const forumId = params.get('forum') || '';
  const status = params.get('status') || 'published';
  const mine = params.get('mine') === '1';
  const page = Number(params.get('page') || 1);

  const loadTopics = useCallback(() => {
    get('/forums/topics', { forum_id: forumId || undefined, status, mine: mine ? '1' : undefined, q: dq || undefined, page }).then(setTopics).catch((e) => toast.error(errorMessage(e)));
    if (canModerate) {
      get('/forums/moderation/counts').then((r) => setCounts(r.data));
      if (status !== 'published') get('/forums/moderation/posts', { status }).then((r) => setWaitingPosts(r.data));
    }
  }, [forumId, status, mine, dq, page, canModerate]); // eslint-disable-line
  const loadCategories = () => get('/forums').then((r) => setCategories(r.data));
  useEffect(() => { loadCategories(); }, []);
  useEffect(() => { loadTopics(); }, [loadTopics]);

  const choose = (changes) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(changes)) if (v) next.set(k, v);
    setParams(next);
  };
  const moderatePost = (post_, changes) => patch(`/forums/posts/${post_.id}`, changes).then(loadTopics).catch((e) => toast.error(errorMessage(e)));
  if (!categories) return <div className="content"><Spinner block /></div>;
  const currentForum = categories.flatMap((c) => c.forums).find((f) => String(f.id) === forumId);

  return (
    <div className={base === '/forums' ? 'content' : 'portal-container'}>
      <div className="page-header">
        <div><h1>{currentForum ? currentForum.name : status === 'waiting' ? 'Waiting for approval' : status === 'spam' ? 'Spam' : mine ? 'Your topics' : 'Community forums'}</h1><p className="sub">{currentForum?.description || 'Ask questions, share ideas and help each other.'}</p></div>
        <div className="page-actions">
          <div style={{ position: 'relative' }}><Search size={15} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--gray-400)' }} /><input className="input" style={{ paddingLeft: 32, width: 240 }} placeholder="Search topics…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          {user ? <button className="btn btn-primary" onClick={() => setModal(true)}><Plus size={16} /> Add topic</button> : <Link className="btn btn-primary" to="/login">Sign in to post</Link>}
        </div>
      </div>
      <div className="detail-layout" style={{ gridTemplateColumns: '240px minmax(0, 1fr)' }}>
        <aside className="card" style={{ alignSelf: 'start' }}><div className="card-body view-list" style={{ padding: 10 }}>
          <button className={!forumId && status === 'published' && !mine ? 'active' : ''} onClick={() => choose({})}><span>All activity</span></button>
          {user && <button className={mine ? 'active' : ''} onClick={() => choose({ mine: '1' })}><span>Your topics</span></button>}
          {canModerate && <>
            <button className={status === 'waiting' ? 'active' : ''} onClick={() => choose({ status: 'waiting' })}><span>Waiting for approval</span><span className="count">{counts?.waiting ?? 0}</span></button>
            <button className={status === 'spam' ? 'active' : ''} onClick={() => choose({ status: 'spam' })}><span>Spam</span><span className="count">{counts?.spam ?? 0}</span></button>
          </>}
          {categories.map((c) => (
            <div key={c.id} className="mt-2">
              <div className="row-between"><h4 style={{ margin: '4px 8px' }}>{c.name}</h4>{canModerate && <button className="icon-btn" aria-label={`Add forum to ${c.name}`} onClick={() => setForumModal(c)}><Plus size={13} /></button>}</div>
              {c.forums.map((f) => <button key={f.id} className={forumId === String(f.id) ? 'active' : ''} onClick={() => choose({ forum: String(f.id) })}><span className="truncate">{f.name}</span><span className="count">{f.topic_count}</span></button>)}
            </div>
          ))}
        </div></aside>
        <section className="col gap-2">
          {status !== 'published' && waitingPosts.map((p) => (
            <div key={p.id} className="card"><div className="card-body col" style={{ gap: 8 }}>
              <div className="small muted">Reply by {p.author_name} on <Link to={`${base}/topics/${p.topic_id}`}>{p.topic_title}</Link> · {fmtRelative(p.created_at)}</div>
              <div className="msg-text">{p.body}</div>
              <div className="row"><button className="btn btn-sm btn-primary" onClick={() => moderatePost(p, { status: 'published' })}>Approve</button>{p.status !== 'spam' && <button className="btn btn-sm" onClick={() => moderatePost(p, { status: 'spam' })}>Mark spam</button>}<button className="btn btn-sm btn-danger" onClick={() => del(`/forums/posts/${p.id}`).then(loadTopics)}>Delete</button></div>
            </div></div>
          ))}
          <div className="card">
            {!topics ? <Spinner block /> : topics.data.length === 0 ? <EmptyState icon={MessageSquare} title="No topics here yet" /> : topics.data.map((t) => (
              <div key={t.id} className="ticket-row" style={{ gridTemplateColumns: '44px 1fr 110px' }} onClick={() => navigate(`${base}/topics/${t.id}`)}>
                <Avatar name={t.author_name} />
                <div style={{ minWidth: 0 }}>
                  <div className="subject">{t.is_pinned && <Pin size={13} />}{t.is_locked && <Lock size={13} />}<span className="truncate">{t.title}</span>{t.stamp && <Badge color="purple">{titleCase(t.stamp)}</Badge>}{t.status === 'waiting' && <Badge color="amber">Awaiting approval</Badge>}</div>
                  <div className="meta"><span>{t.author_name}</span><span>· {t.forum_name}</span><span>· updated {fmtRelative(t.updated_at)}</span></div>
                </div>
                <div className="row small muted" style={{ justifyContent: 'flex-end' }}><span className="row" style={{ gap: 3 }}><ThumbsUp size={12} />{t.votes}</span><span className="row" style={{ gap: 3 }}><MessageSquare size={12} />{t.reply_count}</span></div>
              </div>
            ))}
            {topics && <Pagination meta={topics.meta} onPage={(p) => { const n = new URLSearchParams(params); n.set('page', String(p)); setParams(n); }} />}
          </div>
        </section>
      </div>
      {modal && <TopicModal categories={categories} forumId={forumId} onClose={() => setModal(false)} onSaved={(t) => { setModal(false); toast.success(t.status === 'waiting' ? 'Posted. A moderator will review it shortly.' : 'Topic posted'); navigate(`${base}/topics/${t.id}`); }} />}
      {forumModal && <ForumAdmin category={forumModal} onClose={() => setForumModal(null)} onSaved={() => { setForumModal(null); loadCategories(); }} />}
    </div>
  );
}

export function ForumTopic({ base = '/forums' }) {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [t, setT] = useState(null);
  const [body, setBody] = useState('');
  const load = useCallback(() => get(`/forums/topics/${id}`).then((r) => setT(r.data)).catch(() => navigate(base)), [id]); // eslint-disable-line
  useEffect(() => { load(); }, [load]);
  if (!t) return <div className="content"><Spinner block /></div>;
  const act = (fn) => fn.then(load).catch((e) => toast.error(errorMessage(e)));
  const reply = async () => {
    try {
      const r = await post(`/forums/topics/${id}/posts`, { body });
      setBody('');
      toast.success(r.data.status === 'waiting' ? 'Reply sent. A moderator will review it shortly.' : 'Reply posted');
      load();
    } catch (e) { toast.error(errorMessage(e)); }
  };
  const updateTopic = (changes) => act(patch(`/forums/topics/${id}`, changes));
  return (
    <div className={base === '/forums' ? 'content' : 'portal-container'}>
      <div className="row small muted mb-2"><Link to={base} className="row" style={{ gap: 4 }}><ArrowLeft size={14} /> Forums</Link><span>/</span><Link to={`${base}?forum=${t.forum_id}`}>{t.forum_name}</Link></div>
      <div className="detail-header">
        <div className="flex-1"><h1>{t.is_locked && <Lock size={18} />} {t.title} {t.stamp && <Badge color="purple">{titleCase(t.stamp)}</Badge>}</h1><div className="small muted mt-1">{t.views} views · {t.votes} votes</div></div>
        <div className="page-actions">
          {user && <button className={`btn ${t.has_voted ? 'btn-primary' : ''}`} onClick={() => act(post(`/forums/topics/${id}/vote`))}><ThumbsUp size={14} /> {t.has_voted ? 'Voted' : 'Vote'}</button>}
          {t.can_moderate && <>
            {t.status !== 'published' && <button className="btn btn-primary" onClick={() => updateTopic({ status: 'published' })}>Approve</button>}
            {t.status !== 'spam' && <button className="btn" onClick={() => updateTopic({ status: 'spam' })}>Mark spam</button>}
            <button className="btn" onClick={() => updateTopic({ is_pinned: !t.is_pinned })}><Pin size={14} /> {t.is_pinned ? 'Unpin' : 'Pin'}</button>
            <button className="btn" onClick={() => updateTopic({ is_locked: !t.is_locked })}><Lock size={14} /> {t.is_locked ? 'Unlock' : 'Lock'}</button>
            {STAMPS[t.forum_type]?.length > 0 && <Select small aria-label="Topic status" value={t.stamp || ''} placeholder="No status" onChange={(v) => updateTopic({ stamp: v || null })} options={STAMPS[t.forum_type]} />}
            <button className="btn btn-danger" aria-label="Delete topic" onClick={() => del(`/forums/topics/${id}`).then(() => navigate(base))}><Trash2 size={14} /></button>
          </>}
        </div>
      </div>
      <div className="conversation">
        <div className="msg customer"><Avatar name={t.author_name} /><div className="msg-body"><div className="msg-head"><span className="who">{t.author_name}</span>{t.by_agent && <Badge color="blue">Staff</Badge>}<span className="when">{fmtRelative(t.created_at)}</span></div><div className="msg-text">{t.body}</div></div></div>
        {t.posts.map((p) => (
          <div key={p.id} className={`msg ${p.by_agent ? 'agent' : 'customer'}`}><Avatar name={p.author_name} /><div className="msg-body">
            <div className="msg-head"><span className="who">{p.author_name}</span>{p.by_agent && <Badge color="blue">Staff</Badge>}{p.is_answer && <Badge color="green"><CheckCircle2 size={11} /> Answer</Badge>}{p.status !== 'published' && <Badge color="amber">{titleCase(p.status)}</Badge>}<span className="when">{fmtRelative(p.created_at)}</span>
              {t.can_moderate && <span className="row" style={{ marginLeft: 'auto' }}>
                {p.status !== 'published' && <button className="btn-link small" onClick={() => act(patch(`/forums/posts/${p.id}`, { status: 'published' }))}>Approve</button>}
                <button className="btn-link small" onClick={() => act(patch(`/forums/posts/${p.id}`, { is_answer: !p.is_answer }))}>{p.is_answer ? 'Unmark answer' : 'Mark as answer'}</button>
                <button className="btn-link small" onClick={() => act(del(`/forums/posts/${p.id}`))}>Delete</button></span>}
            </div>
            <div className="msg-text">{p.body}</div></div></div>
        ))}
      </div>
      {t.is_locked && !t.can_moderate ? <div className="alert alert-info mt-3"><Lock size={15} /> This topic is locked.</div> : user ? (
        <div className="reply-box mt-3"><textarea aria-label="Reply" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a reply…" /><div className="reply-footer"><button className="btn btn-primary" style={{ marginLeft: 'auto' }} disabled={!body.trim()} onClick={reply}>Post reply</button></div></div>
      ) : <div className="alert alert-info mt-3"><Link to="/login">Sign in</Link> to reply.</div>}
    </div>
  );
}
