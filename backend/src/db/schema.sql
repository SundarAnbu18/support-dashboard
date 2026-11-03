-- SupportDesk schema -------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('admin','agent')),
  avatar_url TEXT,
  phone TEXT,
  job_title TEXT,
  time_zone TEXT DEFAULT 'UTC',
  signature TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS groups (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  escalate_to_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  auto_assign BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS companies (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  domains TEXT[] NOT NULL DEFAULT '{}',
  description TEXT,
  notes TEXT,
  industry TEXT,
  account_tier TEXT DEFAULT 'standard',
  health_score TEXT DEFAULT 'neutral' CHECK (health_score IN ('at_risk','neutral','happy')),
  renewal_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contacts (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  phone TEXT,
  mobile TEXT,
  company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  job_title TEXT,
  address TEXT,
  time_zone TEXT DEFAULT 'UTC',
  language TEXT DEFAULT 'en',
  tags TEXT[] NOT NULL DEFAULT '{}',
  description TEXT,
  password_hash TEXT,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sla_policies (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  position INTEGER NOT NULL DEFAULT 1,
  -- conditions: { "priority": [], "group_id": [], "type": [], "source": [], "company_id": [] }
  conditions JSONB NOT NULL DEFAULT '{}',
  -- targets: { "urgent": {"respond_within": 30, "resolve_within": 240}, ... } (minutes)
  targets JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tickets (
  id SERIAL PRIMARY KEY,
  subject TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','pending','resolved','closed')),
  priority TEXT NOT NULL DEFAULT 'low' CHECK (priority IN ('low','medium','high','urgent')),
  type TEXT CHECK (type IN ('question','incident','problem','feature_request','refund','other')),
  source TEXT NOT NULL DEFAULT 'portal' CHECK (source IN ('email','portal','phone','chat','social','agent')),
  requester_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  responder_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
  company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  cc_emails TEXT[] NOT NULL DEFAULT '{}',
  custom_fields JSONB NOT NULL DEFAULT '{}',
  sla_policy_id INTEGER REFERENCES sla_policies(id) ON DELETE SET NULL,
  fr_due_by TIMESTAMPTZ,
  due_by TIMESTAMPTZ,
  first_responded_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  is_escalated BOOLEAN NOT NULL DEFAULT FALSE,
  fr_escalated BOOLEAN NOT NULL DEFAULT FALSE,
  spam BOOLEAN NOT NULL DEFAULT FALSE,
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  merged_into_ticket_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS tickets_status_idx ON tickets(status);
CREATE INDEX IF NOT EXISTS tickets_responder_idx ON tickets(responder_id);
CREATE INDEX IF NOT EXISTS tickets_requester_idx ON tickets(requester_id);
CREATE INDEX IF NOT EXISTS tickets_created_idx ON tickets(created_at);
CREATE INDEX IF NOT EXISTS tickets_tags_idx ON tickets USING GIN(tags);

CREATE TABLE IF NOT EXISTS ticket_watchers (
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (ticket_id, user_id)
);

CREATE TABLE IF NOT EXISTS conversations (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'reply' CHECK (kind IN ('reply','note','forward','system')),
  is_private BOOLEAN NOT NULL DEFAULT FALSE,
  body TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'portal',
  to_emails TEXT[] NOT NULL DEFAULT '{}',
  cc_emails TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS conversations_ticket_idx ON conversations(ticket_id);

CREATE TABLE IF NOT EXISTS attachments (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
  article_id INTEGER,
  file_name TEXT NOT NULL,
  content_type TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  path TEXT NOT NULL,
  uploaded_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  uploaded_by_contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ticket_activities (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  actor_label TEXT,
  action TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS activities_ticket_idx ON ticket_activities(ticket_id);

CREATE TABLE IF NOT EXISTS tags (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT DEFAULT '#6366f1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS canned_responses (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  folder TEXT NOT NULL DEFAULT 'General',
  visibility TEXT NOT NULL DEFAULT 'all' CHECK (visibility IN ('all','personal','group')),
  group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kb_categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  position INTEGER NOT NULL DEFAULT 1,
  visible_in_portal BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kb_folders (
  id SERIAL PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES kb_categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','logged_in','agents')),
  position INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kb_articles (
  id SERIAL PRIMARY KEY,
  folder_id INTEGER NOT NULL REFERENCES kb_folders(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  keywords TEXT[] NOT NULL DEFAULT '{}',
  views INTEGER NOT NULL DEFAULT 0,
  thumbs_up INTEGER NOT NULL DEFAULT 0,
  thumbs_down INTEGER NOT NULL DEFAULT 0,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS automations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  event TEXT NOT NULL CHECK (event IN ('ticket_created','ticket_updated','time_trigger')),
  -- conditions: { "match": "all"|"any", "rules": [{"field","operator","value"}] }
  conditions JSONB NOT NULL DEFAULT '{"match":"all","rules":[]}',
  -- actions: [{"type": "set_priority", "value": "high"}, ...]
  actions JSONB NOT NULL DEFAULT '[]',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  position INTEGER NOT NULL DEFAULT 1,
  run_count INTEGER NOT NULL DEFAULT 0,
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS time_entries (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  minutes INTEGER NOT NULL CHECK (minutes > 0),
  note TEXT,
  billable BOOLEAN NOT NULL DEFAULT TRUE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS satisfaction_ratings (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER NOT NULL UNIQUE REFERENCES tickets(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  agent_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  feedback TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, is_read);

CREATE TABLE IF NOT EXISTS saved_views (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}',
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','all_agents')),
  position INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS business_hours (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  time_zone TEXT NOT NULL DEFAULT 'UTC',
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  always_open BOOLEAN NOT NULL DEFAULT FALSE,
  -- schedule: { "mon": {"start":"09:00","end":"17:00"}, ... } missing day = closed
  schedule JSONB NOT NULL DEFAULT '{}',
  holidays JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ticket_fields (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'text' CHECK (field_type IN ('text','textarea','number','dropdown','checkbox','date')),
  options JSONB NOT NULL DEFAULT '[]',
  required_for_agents BOOLEAN NOT NULL DEFAULT FALSE,
  required_for_customers BOOLEAN NOT NULL DEFAULT FALSE,
  visible_to_customers BOOLEAN NOT NULL DEFAULT TRUE,
  position INTEGER NOT NULL DEFAULT 1,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- updated_at trigger ------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','groups','companies','contacts','sla_policies','tickets','canned_responses','kb_articles','automations']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_set_updated_at ON %I', t, t);
    EXECUTE format('CREATE TRIGGER %I_set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END $$;

-- Help desk parity additions (additive, safe to re-apply) ---------------------

CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  privileges TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO roles (name, description, is_default, privileges) VALUES
  ('Account Administrator', 'Complete control over the help desk and organisation settings.', TRUE, ARRAY['reply_ticket','delete_ticket','merge_split_ticket','export_data','manage_contacts','manage_kb','moderate_forums','view_reports','manage_admin']),
  ('Administrator', 'Can configure all features through the Admin area.', TRUE, ARRAY['reply_ticket','delete_ticket','merge_split_ticket','export_data','manage_contacts','manage_kb','moderate_forums','view_reports','manage_admin']),
  ('Supervisor', 'Can perform all agent activities and access reports.', TRUE, ARRAY['reply_ticket','delete_ticket','merge_split_ticket','export_data','manage_contacts','manage_kb','moderate_forums','view_reports']),
  ('Agent', 'Can log, view, reply to, update and resolve tickets and manage contacts.', TRUE, ARRAY['reply_ticket','merge_split_ticket','manage_contacts','manage_kb','view_reports']),
  ('Ticket Collaborator', 'Can work on assigned tickets and add private notes, but cannot reply to customers.', TRUE, ARRAY[]::TEXT[]),
  ('Analytics Collaborator', 'Can view reports in the Analytics module.', TRUE, ARRAY['view_reports','export_data'])
ON CONFLICT (name) DO NOTHING;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id INTEGER REFERENCES roles(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS agent_statuses (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  emoji TEXT,
  accepts_tickets BOOLEAN NOT NULL DEFAULT TRUE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  position INTEGER NOT NULL DEFAULT 1
);
INSERT INTO agent_statuses (name, emoji, accepts_tickets, is_default, position) VALUES
  ('Available', '🟢', TRUE, TRUE, 1), ('Busy', '🔴', TRUE, FALSE, 2), ('On a break', '☕', FALSE, FALSE, 3), ('Offline', '⚪', FALSE, FALSE, 4)
ON CONFLICT (name) DO NOTHING;
ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_status_id INTEGER REFERENCES agent_statuses(id) ON DELETE SET NULL;

-- Custom ticket statuses replace the fixed CHECK list.
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_status_check;
CREATE TABLE IF NOT EXISTS ticket_statuses (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  customer_label TEXT NOT NULL,
  stops_sla BOOLEAN NOT NULL DEFAULT FALSE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  position INTEGER NOT NULL DEFAULT 1
);
INSERT INTO ticket_statuses (key, label, customer_label, stops_sla, is_default, position) VALUES
  ('open', 'Open', 'Being processed', FALSE, TRUE, 1),
  ('pending', 'Pending', 'Awaiting your reply', TRUE, TRUE, 2),
  ('resolved', 'Resolved', 'Resolved', FALSE, TRUE, 3),
  ('closed', 'Closed', 'Closed', FALSE, TRUE, 4),
  ('on_hold', 'On hold', 'Being processed', TRUE, FALSE, 5),
  ('user_response_awaited', 'User Response Awaited', 'Awaiting your reply', TRUE, FALSE, 6)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  support_email TEXT,
  portal_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS product_id INTEGER REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS parent_ticket_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS tickets_parent_idx ON tickets(parent_ticket_id);

CREATE TABLE IF NOT EXISTS ticket_links (
  ticket_a INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  ticket_b INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ticket_a, ticket_b),
  CHECK (ticket_a < ticket_b)
);
CREATE TABLE IF NOT EXISTS ticket_todos (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  is_done BOOLEAN NOT NULL DEFAULT FALSE,
  due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS ticket_threads (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS ticket_thread_messages (
  id SERIAL PRIMARY KEY,
  thread_id INTEGER NOT NULL REFERENCES ticket_threads(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS ticket_mentions (
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (ticket_id, user_id)
);

CREATE TABLE IF NOT EXISTS scenarios (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  visibility TEXT NOT NULL DEFAULT 'all' CHECK (visibility IN ('all','group','personal')),
  group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actions JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS ticket_templates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  parent_template_id INTEGER REFERENCES ticket_templates(id) ON DELETE CASCADE,
  subject TEXT,
  body TEXT,
  priority TEXT,
  status TEXT,
  type TEXT,
  group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
  responder_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS ticket_forms (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
  field_names TEXT[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  position INTEGER NOT NULL DEFAULT 1
);

-- Custom fields for contacts and companies; decimal and dependent ticket fields.
ALTER TABLE ticket_fields DROP CONSTRAINT IF EXISTS ticket_fields_field_type_check;
ALTER TABLE ticket_fields ADD CONSTRAINT ticket_fields_field_type_check CHECK (field_type IN ('text','textarea','number','decimal','dropdown','dependent','checkbox','date'));
ALTER TABLE ticket_fields ADD COLUMN IF NOT EXISTS parent_field TEXT;
CREATE TABLE IF NOT EXISTS entity_fields (
  id SERIAL PRIMARY KEY,
  entity TEXT NOT NULL CHECK (entity IN ('contact','company')),
  name TEXT NOT NULL,
  label TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'text' CHECK (field_type IN ('text','textarea','number','dropdown','checkbox','date')),
  options JSONB NOT NULL DEFAULT '[]',
  position INTEGER NOT NULL DEFAULT 1,
  UNIQUE (entity, name)
);
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS surveys (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  question TEXT NOT NULL DEFAULT 'How would you rate your experience?',
  labels JSONB NOT NULL DEFAULT '["Very poor","Poor","Okay","Good","Excellent"]',
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO surveys (name, is_active) SELECT 'Default Survey', TRUE WHERE NOT EXISTS (SELECT 1 FROM surveys);
ALTER TABLE satisfaction_ratings ADD COLUMN IF NOT EXISTS survey_id INTEGER REFERENCES surveys(id) ON DELETE SET NULL;
ALTER TABLE satisfaction_ratings ADD COLUMN IF NOT EXISTS answer TEXT;

CREATE TABLE IF NOT EXISTS email_notifications (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  audience TEXT NOT NULL CHECK (audience IN ('requester','agent')),
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  subject TEXT NOT NULL,
  body TEXT NOT NULL
);
INSERT INTO email_notifications (key, label, audience, subject, body) VALUES
  ('new_ticket_requester', 'New ticket created', 'requester', 'We received your request [#{{ticket.id}}]', 'Hi {{requester.name}},

We have received your request "{{ticket.subject}}" and will get back to you soon.'),
  ('agent_reply_requester', 'Agent adds a reply', 'requester', 'Re: {{ticket.subject}} [#{{ticket.id}}]', '{{reply.body}}'),
  ('ticket_resolved_requester', 'Agent resolves the ticket', 'requester', 'Your request has been resolved [#{{ticket.id}}]', 'Hi {{requester.name}},

Your request "{{ticket.subject}}" has been resolved. Reply to this email to reopen it, or rate your experience in the portal.'),
  ('ticket_assigned_agent', 'Ticket assigned to agent', 'agent', 'Ticket #{{ticket.id}} assigned to you', '"{{ticket.subject}}" has been assigned to you.'),
  ('requester_reply_agent', 'Requester replies to a ticket', 'agent', 'New reply on #{{ticket.id}}', '{{requester.name}} replied on "{{ticket.subject}}":

{{reply.body}}')
ON CONFLICT (key) DO NOTHING;
CREATE TABLE IF NOT EXISTS email_outbox (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'logged' CHECK (status IN ('logged','sent','failed')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS mailboxes (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS forum_categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  position INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS forums (
  id SERIAL PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES forum_categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  forum_type TEXT NOT NULL DEFAULT 'questions' CHECK (forum_type IN ('questions','ideas','problems','announcements')),
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','logged_in','agents')),
  position INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS forum_topics (
  id SERIAL PRIMARY KEY,
  forum_id INTEGER NOT NULL REFERENCES forums(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','waiting','spam')),
  is_locked BOOLEAN NOT NULL DEFAULT FALSE,
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  stamp TEXT,
  views INTEGER NOT NULL DEFAULT 0,
  ticket_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS forum_posts (
  id SERIAL PRIMARY KEY,
  topic_id INTEGER NOT NULL REFERENCES forum_topics(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','waiting','spam')),
  is_answer BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS forum_votes (
  topic_id INTEGER NOT NULL REFERENCES forum_topics(id) ON DELETE CASCADE,
  voter TEXT NOT NULL,
  PRIMARY KEY (topic_id, voter)
);

CREATE TABLE IF NOT EXISTS saved_reports (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  folder TEXT,
  config JSONB NOT NULL DEFAULT '{}',
  is_shared BOOLEAN NOT NULL DEFAULT FALSE,
  is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
  schedule TEXT CHECK (schedule IN ('daily','weekly')),
  recipients TEXT[] NOT NULL DEFAULT '{}',
  last_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_label TEXT,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
