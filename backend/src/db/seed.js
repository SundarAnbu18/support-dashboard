// Seeds a realistic demo helpdesk. Safe to re-run after `db:migrate --fresh`.
import bcrypt from 'bcryptjs';
import { pool, query } from '../config/db.js';
import { computeDueDates } from '../utils/sla.js';

// Deterministic pseudo-random so the demo looks the same each time.
let seedState = 42;
const rand = () => { seedState = (seedState * 1103515245 + 12345) & 0x7fffffff; return seedState / 0x7fffffff; };
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;
const hoursAgo = (h) => new Date(Date.now() - h * 3600000);
const addHours = (d, h) => new Date(new Date(d).getTime() + h * 3600000);

async function main() {
  const { rows: existing } = await query('SELECT COUNT(*) FROM users');
  if (Number(existing[0].count) > 0) {
    console.log('Database already seeded. Run `npm run db:reset` for a fresh seed.');
    await pool.end();
    return;
  }

  const hash = await bcrypt.hash('password123', 10);

  // ---------------- agents
  const agentsData = [
    ['Sundar Anbu', 'admin@supportdesk.local', 'admin', 'Head of Support'],
    ['Priya Raman', 'priya@supportdesk.local', 'agent', 'Support Engineer'],
    ['Marcus Lee', 'marcus@supportdesk.local', 'agent', 'Support Engineer'],
    ['Elena Novak', 'elena@supportdesk.local', 'agent', 'Billing Specialist'],
    ['Diego Alvarez', 'diego@supportdesk.local', 'agent', 'Technical Support Lead'],
    ['Aisha Khan', 'aisha@supportdesk.local', 'agent', 'Customer Success'],
  ];
  const agents = [];
  for (const [name, email, role, title] of agentsData) {
    const { rows } = await query(
      'INSERT INTO users (name, email, password_hash, role, job_title, signature) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [name, email, hash, role, title, `Best regards,\n${name}\n${title} · SupportDesk`]
    );
    agents.push(rows[0]);
  }
  const [admin, priya, marcus, elena, diego, aisha] = agents;

  // ---------------- groups
  const groupsData = [
    ['Tier 1 Support', 'First line of response for all incoming tickets', [priya, marcus, aisha], true],
    ['Technical Support', 'Bugs, integrations and escalations', [diego, marcus], false],
    ['Billing', 'Invoices, refunds and subscription changes', [elena], false],
    ['Customer Success', 'Onboarding and account management', [aisha, admin], false],
  ];
  const groups = [];
  for (const [name, desc, members, auto] of groupsData) {
    const { rows } = await query('INSERT INTO groups (name, description, auto_assign, escalate_to_user_id) VALUES ($1,$2,$3,$4) RETURNING *', [name, desc, auto, admin.id]);
    for (const m of members) await query('INSERT INTO group_members (group_id, user_id) VALUES ($1,$2)', [rows[0].id, m.id]);
    groups.push(rows[0]);
  }
  const [tier1, tech, billing, success] = groups;

  // ---------------- companies
  const companiesData = [
    ['Acme Corporation', ['acme.com'], 'Manufacturing', 'enterprise', 'happy'],
    ['Globex Industries', ['globex.io'], 'Logistics', 'enterprise', 'at_risk'],
    ['Initech', ['initech.com'], 'Software', 'standard', 'neutral'],
    ['Umbrella Health', ['umbrella-health.org'], 'Healthcare', 'premium', 'happy'],
    ['Stark Retail', ['starkretail.com'], 'Retail', 'standard', 'neutral'],
    ['Wayne Financial', ['waynefin.com'], 'Finance', 'premium', 'neutral'],
  ];
  const companies = [];
  for (const [name, domains, industry, tier, health] of companiesData) {
    const { rows } = await query(
      'INSERT INTO companies (name, domains, industry, account_tier, health_score, description, renewal_date) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [name, domains, industry, tier, health, `${name} is a ${industry.toLowerCase()} customer on the ${tier} plan.`, new Date(Date.now() + (30 + Math.floor(rand() * 300)) * 86400000)]
    );
    companies.push(rows[0]);
  }

  // ---------------- contacts (first one has portal access)
  const first = ['James', 'Olivia', 'Liam', 'Emma', 'Noah', 'Ava', 'Ethan', 'Sophia', 'Mason', 'Isabella', 'Lucas', 'Mia', 'Aiden', 'Charlotte', 'Rahul', 'Meera', 'Chen', 'Yuki', 'Fatima', 'Carlos'];
  const last = ['Smith', 'Johnson', 'Brown', 'Taylor', 'Anderson', 'Thomas', 'Jackson', 'White', 'Harris', 'Martin', 'Patel', 'Nair', 'Wang', 'Tanaka', 'Hassan', 'Garcia'];
  const contacts = [];
  const { rows: demoContact } = await query(
    'INSERT INTO contacts (name, email, phone, company_id, job_title, password_hash, is_verified, tags) VALUES ($1,$2,$3,$4,$5,$6,TRUE,$7) RETURNING *',
    ['Jane Customer', 'customer@acme.com', '+1 555 0100', companies[0].id, 'Operations Manager', hash, ['vip']]
  );
  contacts.push(demoContact[0]);
  for (let i = 0; i < 26; i++) {
    const fn = first[i % first.length];
    const ln = last[(i * 7) % last.length];
    const company = chance(0.8) ? pick(companies) : null;
    const domain = company ? company.domains[0] : pick(['gmail.com', 'outlook.com', 'yahoo.com']);
    const email = `${fn.toLowerCase()}.${ln.toLowerCase()}${i}@${domain}`;
    const { rows } = await query(
      'INSERT INTO contacts (name, email, phone, company_id, job_title, tags, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [`${fn} ${ln}`, email, chance(0.6) ? `+1 555 01${String(i).padStart(2, '0')}` : null, company?.id || null, pick(['IT Manager', 'Developer', 'Procurement', 'Office Admin', 'CTO', 'Analyst', null]), chance(0.2) ? ['vip'] : [], hoursAgo(24 * (10 + rand() * 120))]
    );
    contacts.push(rows[0]);
  }

  // ---------------- tags
  const tagNames = ['billing', 'bug', 'login', 'feature-request', 'urgent-escalation', 'integration', 'api', 'mobile', 'refund', 'onboarding', 'performance', 'vip'];
  const colors = ['#2563eb', '#dc2626', '#d97706', '#7c3aed', '#db2777', '#059669', '#0891b2', '#4f46e5', '#ea580c', '#16a34a', '#9333ea', '#f59e0b'];
  for (let i = 0; i < tagNames.length; i++) await query('INSERT INTO tags (name, color) VALUES ($1,$2)', [tagNames[i], colors[i]]);

  // ---------------- SLA policies
  const { rows: [defaultSla] } = await query(
    `INSERT INTO sla_policies (name, description, is_default, position, targets) VALUES ($1,$2,TRUE,99,$3) RETURNING *`,
    ['Default policy', 'Applies to every ticket not matched by another policy.', JSON.stringify({
      urgent: { respond_within: 60, resolve_within: 240 },
      high: { respond_within: 240, resolve_within: 480 },
      medium: { respond_within: 480, resolve_within: 1440 },
      low: { respond_within: 1440, resolve_within: 4320 },
    })]
  );
  const { rows: [enterpriseSla] } = await query(
    `INSERT INTO sla_policies (name, description, position, conditions, targets) VALUES ($1,$2,1,$3,$4) RETURNING *`,
    ['Enterprise accounts', 'Faster targets for enterprise and premium customers.',
      JSON.stringify({ company_id: companies.filter((c) => c.account_tier !== 'standard').map((c) => c.id) }),
      JSON.stringify({
        urgent: { respond_within: 30, resolve_within: 120 },
        high: { respond_within: 60, resolve_within: 240 },
        medium: { respond_within: 240, resolve_within: 720 },
        low: { respond_within: 480, resolve_within: 1440 },
      })]
  );

  // ---------------- automations
  await query(
    `INSERT INTO automations (name, description, event, conditions, actions, position) VALUES
     ($1,$2,'ticket_created',$3,$4,1), ($5,$6,'ticket_created',$7,$8,2), ($9,$10,'ticket_created',$11,$12,3), ($13,$14,'time_trigger',$15,$16,1), ($17,$18,'ticket_updated',$19,$20,1)`,
    [
      'Route billing questions', 'Send anything mentioning invoices or refunds to the Billing group.',
      JSON.stringify({ match: 'any', rules: [{ field: 'subject', operator: 'contains', value: 'invoice' }, { field: 'subject', operator: 'contains', value: 'refund' }, { field: 'type', operator: 'is', value: 'refund' }] }),
      JSON.stringify([{ type: 'assign_group', value: billing.id }, { type: 'add_tag', value: 'billing' }]),
      'Escalate urgent incidents', 'Urgent incidents go straight to Technical Support and get flagged.',
      JSON.stringify({ match: 'all', rules: [{ field: 'priority', operator: 'is', value: 'urgent' }, { field: 'type', operator: 'is', value: 'incident' }] }),
      JSON.stringify([{ type: 'assign_group', value: tech.id }, { type: 'add_tag', value: 'urgent-escalation' }, { type: 'notify_group', value: tech.id, message: 'Urgent incident needs attention' }]),
      'Tag enterprise tickets as VIP', 'Tickets from Acme are tagged for visibility.',
      JSON.stringify({ match: 'all', rules: [{ field: 'requester_domain', operator: 'is', value: 'acme.com' }] }),
      JSON.stringify([{ type: 'add_tag', value: 'vip' }]),
      'Nudge stale tickets', 'If a ticket is unassigned for over 24 hours, bump priority and notify Tier 1.',
      JSON.stringify({ match: 'all', rules: [{ field: 'has_responder', operator: 'is', value: false }, { field: 'hours_since_created', operator: 'greater_than', value: 24 }, { field: 'priority', operator: 'is', value: 'low' }] }),
      JSON.stringify([{ type: 'set_priority', value: 'medium' }, { type: 'notify_group', value: tier1.id, message: 'Unassigned ticket waiting more than 24h' }, { type: 'add_note', value: 'Automation: priority raised because the ticket stayed unassigned for more than 24 hours.' }]),
      'Notify assignee on reopen', 'When a resolved ticket is reopened, tell the assignee.',
      JSON.stringify({ match: 'all', rules: [{ field: 'status', operator: 'is', value: 'open' }, { field: 'first_responded', operator: 'is', value: true }] }),
      JSON.stringify([{ type: 'notify_assignee', message: 'A ticket you handled is open again' }]),
    ]
  );

  // ---------------- canned responses
  const canned = [
    ['Greeting & acknowledgement', 'Hi {{requester_name}},\n\nThanks for reaching out to us. I have picked up your request (#{{ticket_id}}) and I am looking into it right now. I will get back to you shortly with an update.\n\n{{agent_name}}', 'General'],
    ['Need more information', 'Hi {{requester_name}},\n\nTo investigate this further, could you please share:\n1. The exact steps you took before the issue appeared\n2. Any error message you saw (a screenshot helps)\n3. Your browser or app version\n\nOnce I have these I can dig in right away.\n\n{{agent_name}}', 'General'],
    ['Password reset steps', 'Hi {{requester_name}},\n\nYou can reset your password by visiting the login page and clicking "Forgot password". You will receive an email with a reset link that is valid for 30 minutes. If the email does not arrive, please check your spam folder.\n\n{{agent_name}}', 'Account'],
    ['Refund processed', 'Hi {{requester_name}},\n\nGood news: your refund has been processed. Depending on your bank it can take 5-10 business days for the amount to appear on your statement.\n\nLet us know if there is anything else we can help with.\n\n{{agent_name}}', 'Billing'],
    ['Issue resolved - closing', 'Hi {{requester_name}},\n\nI am glad we could sort this out. I am marking this ticket as resolved; if anything comes up again just reply to this message and it will reopen automatically.\n\n{{agent_name}}', 'General'],
    ['Escalated to engineering', 'Hi {{requester_name}},\n\nI have escalated this to our engineering team as a confirmed bug. We will keep this ticket updated as the fix progresses and let you know as soon as it is released.\n\n{{agent_name}}', 'Technical'],
  ];
  for (const [title, content, folder] of canned) await query('INSERT INTO canned_responses (title, content, folder, user_id) VALUES ($1,$2,$3,$4)', [title, content, folder, admin.id]);

  // ---------------- knowledge base
  const kb = [
    ['Getting Started', 'Everything you need to set up your account', [
      ['Account setup', [
        ['Creating your account', 'To create an account, click Sign up on the login page and fill in your name, work email and a password of at least 6 characters.\n\nIf your company already uses SupportDesk, your account is linked to it automatically based on your email domain.\n\nAfter signing up you can immediately submit tickets and track them in the portal.'],
        ['Inviting teammates', 'Account admins can invite teammates from Admin > Agents. Each agent receives a login and can be added to one or more groups.\n\nGroups control which tickets an agent sees by default and who gets notified about new tickets.'],
        ['Resetting your password', 'Use the Forgot password link on the login page. A reset link is emailed to you and remains valid for 30 minutes.\n\nIf you do not receive the email within a few minutes, check your spam folder or contact support.'],
      ]],
      ['Submitting tickets', [
        ['How to submit a support ticket', 'Go to the Help Center and click New ticket. Describe the issue, pick a priority and attach screenshots if you have them.\n\nYou will receive a ticket number you can use to follow the conversation. Replies from our team appear in the portal and by email.'],
        ['Understanding ticket statuses', 'Open: we are working on it.\nPending: we are waiting for information from you.\nResolved: we believe the issue is fixed; reply to reopen.\nClosed: the conversation is complete.'],
      ]],
    ]],
    ['Billing & Payments', 'Invoices, plans and refunds', [
      ['Invoices', [
        ['Where to find your invoices', 'Invoices are available under Account > Billing. Each invoice can be downloaded as a PDF. Invoices are issued on the first day of each billing cycle.'],
        ['Updating payment details', 'Open Account > Billing > Payment method and enter the new card. The change applies to the next invoice. Previous failed payments are retried automatically within 24 hours.'],
      ]],
      ['Refunds', [
        ['Our refund policy', 'We offer a full refund within 14 days of a new subscription or upgrade. Refunds are returned to the original payment method within 5-10 business days.\n\nTo request a refund, submit a ticket with the type Refund and include the invoice number.'],
      ]],
    ]],
    ['Troubleshooting', 'Fixes for common problems', [
      ['Login issues', [
        ['I cannot log in', 'First confirm you are using the correct email address. If you recently changed your password, try resetting it again.\n\nClear your browser cache or try a private window. If single sign-on is enabled for your company, log in through your identity provider instead.'],
        ['Two-factor authentication problems', 'If your authenticator app is out of sync, re-sync the time in the app settings. Backup codes were provided when 2FA was enabled; each can be used once. Contact support to disable 2FA if you have lost both.'],
      ]],
      ['Integrations & API', [
        ['Generating an API key', 'API keys are created under Admin > Integrations > API. Keys are shown once; store them securely. Rotate keys at least every 90 days.\n\nAll requests must include the header Authorization: Bearer <key>.'],
        ['Webhook delivery failures', 'Webhooks retry 5 times with exponential backoff. Check that your endpoint responds with a 2xx status within 10 seconds, and that it accepts POST requests with a JSON body.'],
        ['Slack integration setup', 'Install the SupportDesk Slack app from Admin > Integrations. Choose a channel for new ticket notifications and optionally enable reply-from-Slack for agents.'],
      ]],
    ]],
  ];
  let catPos = 1;
  for (const [cname, cdesc, folders] of kb) {
    const { rows: [cat] } = await query('INSERT INTO kb_categories (name, description, position) VALUES ($1,$2,$3) RETURNING *', [cname, cdesc, catPos++]);
    let fPos = 1;
    for (const [fname, articles] of folders) {
      const { rows: [folder] } = await query('INSERT INTO kb_folders (category_id, name, position) VALUES ($1,$2,$3) RETURNING *', [cat.id, fname, fPos++]);
      for (const [title, body] of articles) {
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        await query(
          'INSERT INTO kb_articles (folder_id, title, slug, body, status, author_id, views, thumbs_up, thumbs_down, published_at, tags) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
          [folder.id, title, slug, body, 'published', pick(agents).id, Math.floor(rand() * 900), Math.floor(rand() * 40), Math.floor(rand() * 6), hoursAgo(24 * rand() * 90), [fname.toLowerCase().split(' ')[0]]]
        );
      }
    }
  }
  await query(
    'INSERT INTO kb_articles (folder_id, title, slug, body, status, author_id) VALUES ((SELECT id FROM kb_folders ORDER BY id LIMIT 1), $1,$2,$3,$4,$5)',
    ['Mobile app overview (draft)', 'mobile-app-overview', 'Draft article describing the upcoming mobile app features.', 'draft', priya.id]
  );

  // ---------------- business hours, ticket fields, settings
  await query(
    `INSERT INTO business_hours (name, description, time_zone, is_default, schedule) VALUES ($1,$2,$3,TRUE,$4)`,
    ['Default business hours', 'Monday to Friday, 9am to 6pm', 'America/New_York', JSON.stringify({ mon: { start: '09:00', end: '18:00' }, tue: { start: '09:00', end: '18:00' }, wed: { start: '09:00', end: '18:00' }, thu: { start: '09:00', end: '18:00' }, fri: { start: '09:00', end: '18:00' } })]
  );
  await query(
    `INSERT INTO ticket_fields (name, label, field_type, options, position, visible_to_customers) VALUES
     ('product', 'Product', 'dropdown', '["Web app","Mobile app","API","Billing portal"]', 1, TRUE),
     ('environment', 'Environment', 'dropdown', '["Production","Staging","Development"]', 2, FALSE),
     ('order_number', 'Order number', 'text', '[]', 3, TRUE)`
  );
  await query(
    `INSERT INTO settings (key, value) VALUES
     ('helpdesk', '{"name":"SupportDesk","portal_name":"SupportDesk Help Center","support_email":"support@supportdesk.local","primary_color":"#2563eb","time_zone":"America/New_York","portal_signup_enabled":true}'),
     ('tickets', '{"default_priority":"low","default_status":"open","auto_close_after_days":7,"allow_customer_close":true,"csat_enabled":true,"agent_collision":true}')`
  );

  // ---------------- tickets
  const subjects = [
    ['Cannot log in after password reset', 'incident', 'high', ['login'], 'I reset my password this morning but the new password is rejected on the login page. I have tried three times and I am now locked out.'],
    ['Invoice #4471 shows wrong amount', 'question', 'medium', ['billing'], 'Our latest invoice lists 25 seats but we only have 18 active users. Can you correct this before our finance team processes it?'],
    ['API returns 500 on /v2/orders', 'problem', 'urgent', ['api', 'bug'], 'Since about 10am UTC every call to /v2/orders returns a 500 error. Our checkout flow is down. Request id: 8f3a-22c1.'],
    ['Feature request: dark mode in mobile app', 'feature_request', 'low', ['mobile', 'feature-request'], 'Many of our field staff use the app at night. A dark mode would really help readability.'],
    ['Refund for duplicate charge', 'refund', 'medium', ['refund', 'billing'], 'We were charged twice on the 3rd. Please refund the duplicate payment of $349.'],
    ['Webhook deliveries failing intermittently', 'problem', 'high', ['integration'], 'About 1 in 10 webhook calls never reaches our endpoint. We see nothing in our logs for those events.'],
    ['How to export all contacts to CSV?', 'question', 'low', [], 'Is there a way to bulk export our contact list? I only see export per page.'],
    ['Dashboard loads very slowly', 'problem', 'medium', ['performance'], 'The reports dashboard takes 40+ seconds to load for our account. Other pages are fine.'],
    ['Need to add 10 more agent seats', 'question', 'medium', ['billing'], 'We are onboarding a new team next week. Please add 10 agent seats to our plan and send an updated quote.'],
    ['Slack integration not posting messages', 'incident', 'medium', ['integration'], 'The Slack app was working until yesterday. New ticket notifications have stopped appearing in #support.'],
    ['Two-factor codes not accepted', 'incident', 'high', ['login'], 'Authenticator codes are rejected for two of our users. Backup codes work.'],
    ['Request for SOC 2 report', 'question', 'low', [], 'Our security team needs your latest SOC 2 Type II report for vendor review.'],
    ['Mobile app crashes on launch (iOS 18)', 'incident', 'urgent', ['mobile', 'bug'], 'After updating to iOS 18 the app crashes immediately on launch for all our users.'],
    ['Onboarding call scheduling', 'question', 'low', ['onboarding'], 'We would like to schedule an onboarding session for our new admins. What times are available next week?'],
    ['Change billing email address', 'question', 'low', ['billing'], 'Please update our billing contact to accounts@globex.io.'],
    ['Attachments larger than 10MB fail', 'problem', 'medium', ['bug'], 'Uploading a 12MB PDF to a ticket fails with a generic error. Smaller files work.'],
    ['Custom domain SSL certificate expired', 'incident', 'urgent', ['bug'], 'Our help center at help.initech.com shows a certificate warning since this morning.'],
    ['Question about data retention', 'question', 'low', [], 'How long do you retain closed tickets and attachments? We need this for our compliance documentation.'],
    ['Agent cannot see Billing group tickets', 'problem', 'medium', [], 'Elena was added to the Billing group but still cannot see its tickets in her view.'],
    ['Bulk import of knowledge base articles', 'feature_request', 'low', ['feature-request'], 'We have 200 articles in Confluence. Is there any way to import them in bulk?'],
    ['Email notifications arriving hours late', 'problem', 'high', ['bug'], 'Customers report that reply notifications arrive 3-4 hours after the agent responds.'],
    ['Downgrade plan at renewal', 'question', 'medium', ['billing'], 'We want to move from Enterprise to Premium at our renewal date. What is the process?'],
    ['Search does not find tickets by phone number', 'feature_request', 'low', ['feature-request'], 'Our phone agents need to search tickets by the requester phone number.'],
    ['Reports show incorrect resolution time', 'problem', 'medium', ['bug'], 'Average resolution time in reports shows 0 hours for last week even though we resolved 30 tickets.'],
    ['Customer portal logo not updating', 'question', 'low', [], 'I uploaded a new logo in settings but the portal still shows the old one.'],
    ['Rate limit too low for our integration', 'question', 'medium', ['api'], 'We hit the 100 req/min API limit during peak. Can this be raised for our account?'],
    ['Payment failed - card declined', 'incident', 'high', ['billing'], 'Our monthly payment failed and the account shows a warning banner. The card is valid and has funds.'],
    ['Translate help center to Spanish', 'feature_request', 'low', ['feature-request'], 'A large share of our customers are Spanish speaking. Does the help center support multiple languages?'],
    ['Duplicate contacts created from email', 'problem', 'medium', ['bug'], 'When a customer emails from an alias we end up with duplicate contacts. Can these be merged automatically?'],
    ['Thank you for the quick fix!', 'other', 'low', [], 'Just wanted to say thanks to Marcus for resolving our login issue so quickly yesterday.'],
    ['Cannot assign ticket to group', 'problem', 'low', [], 'The group dropdown in the ticket sidebar is empty for one of our agents.'],
    ['Need invoice in EUR', 'question', 'low', ['billing'], 'Our finance team requires invoices in EUR rather than USD. Is this possible?'],
    ['Ticket merge removed attachments', 'problem', 'high', ['bug'], 'After merging two tickets, the attachments from the secondary ticket disappeared.'],
    ['SSO login loop', 'incident', 'urgent', ['login', 'bug'], 'Users authenticating via Okta are redirected back to the login page in a loop.'],
    ['Weekly report email not received', 'question', 'low', [], 'The weekly summary email stopped arriving two weeks ago. Nothing in spam.'],
    ['Suggestion: keyboard shortcuts', 'feature_request', 'low', ['feature-request'], 'Keyboard shortcuts for reply, assign and resolve would speed up our agents a lot.'],
    ['Spam: You have won a prize', 'other', 'low', [], 'Congratulations!!! Click here to claim your reward now.'],
  ];
  const sources = ['email', 'email', 'portal', 'portal', 'phone', 'chat', 'email'];
  const agentPool = [priya, marcus, elena, diego, aisha];
  const replies = [
    'Thanks for reaching out. I am looking into this now and will update you shortly.',
    'Could you share a screenshot of the error and the time it happened? That will help us trace it in the logs.',
    'I have reproduced the issue on our side and escalated it to engineering. I will keep you posted.',
    'This has been fixed on our end. Could you try again and confirm it works for you?',
    'I have updated your account as requested. Please allow a few minutes for the change to apply.',
    'Thanks for confirming. I am marking this as resolved; reply any time if it comes back.',
  ];
  const customerReplies = [
    'Thanks, that worked. Appreciate the quick help!',
    'Still seeing the same problem after trying that. Screenshot attached.',
    'Here is the extra information you asked for.',
    'Any update on this? It is becoming urgent for our team.',
  ];

  const ticketIds = [];
  for (let i = 0; i < subjects.length; i++) {
    const [subject, type, priority, tags, description] = subjects[i];
    const requester = i === 0 || i === 4 || i === 29 ? contacts[0] : pick(contacts);
    const createdAt = hoursAgo(i < 6 ? rand() * 48 : 48 + rand() * 24 * 28);
    const isSpam = subject.startsWith('Spam:');
    const policy = requester.company_id && companies.find((c) => c.id === requester.company_id)?.account_tier !== 'standard' ? enterpriseSla : defaultSla;
    const due = computeDueDates(policy, priority, createdAt);

    const roll = rand();
    let status = 'open';
    if (i >= 6) status = roll < 0.35 ? 'closed' : roll < 0.6 ? 'resolved' : roll < 0.8 ? 'pending' : 'open';
    if (i < 6) status = i % 3 === 0 ? 'open' : 'pending';
    if (isSpam) status = 'open';

    const group = tags.includes('billing') || tags.includes('refund') ? billing : (type === 'incident' || type === 'problem') ? (chance(0.6) ? tech : tier1) : tier1;
    let responder = null;
    if (!isSpam && (status !== 'open' || chance(0.6))) {
      responder = group.id === billing.id ? elena : group.id === tech.id ? pick([diego, marcus]) : pick([priya, marcus, aisha]);
    }
    const firstResponded = responder ? addHours(createdAt, 0.3 + rand() * (priority === 'urgent' ? 1.5 : 10)) : null;
    const resolvedAt = ['resolved', 'closed'].includes(status) ? addHours(firstResponded || createdAt, 1 + rand() * 60) : null;
    const closedAt = status === 'closed' ? addHours(resolvedAt, 24 * (1 + rand() * 5)) : null;

    const { rows: [t] } = await query(
      `INSERT INTO tickets (subject, description, status, priority, type, source, requester_id, responder_id, group_id, company_id, tags, sla_policy_id, fr_due_by, due_by,
                            first_responded_at, resolved_at, closed_at, spam, is_escalated, custom_fields, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING *`,
      [subject, description, status, priority, type, pick(sources), requester.id, responder?.id || null, group.id, requester.company_id, tags, policy.id, due.fr_due_by, due.due_by,
       firstResponded, resolvedAt, closedAt, isSpam, !resolvedAt && due.due_by < new Date() && status !== 'pending',
       JSON.stringify({ product: pick(['Web app', 'Mobile app', 'API', 'Billing portal']) }), createdAt, closedAt || resolvedAt || firstResponded || createdAt]
    );
    ticketIds.push(t.id);
    await query('INSERT INTO ticket_activities (ticket_id, contact_id, actor_label, action, details, created_at) VALUES ($1,$2,$3,$4,$5,$6)', [t.id, requester.id, requester.name, 'created', JSON.stringify({ status: 'open', priority }), createdAt]);

    // Conversation thread
    if (responder && firstResponded) {
      let cursor = firstResponded;
      const n = 1 + Math.floor(rand() * 3);
      for (let r = 0; r < n; r++) {
        await query(
          'INSERT INTO conversations (ticket_id, user_id, kind, body, source, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
          [t.id, responder.id, 'reply', `Hi ${requester.name.split(' ')[0]},\n\n${replies[Math.min(r, replies.length - 1)]}\n\n${responder.name}`, 'agent', cursor]
        );
        await query('INSERT INTO ticket_activities (ticket_id, user_id, actor_label, action, details, created_at) VALUES ($1,$2,$3,$4,$5,$6)', [t.id, responder.id, responder.name, 'agent_replied', '{}', cursor]);
        if (chance(0.7) && (!resolvedAt || cursor < resolvedAt)) {
          cursor = addHours(cursor, 1 + rand() * 12);
          await query(
            'INSERT INTO conversations (ticket_id, contact_id, kind, body, source, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
            [t.id, requester.id, 'reply', pick(customerReplies), 'portal', cursor]
          );
        }
        cursor = addHours(cursor, 1 + rand() * 8);
      }
      if (chance(0.5)) {
        await query(
          'INSERT INTO conversations (ticket_id, user_id, kind, is_private, body, source, created_at) VALUES ($1,$2,$3,TRUE,$4,$5,$6)',
          [t.id, responder.id, 'note', pick(['Checked the logs - looks like a config issue on their account.', 'Customer is VIP, prioritise this.', 'Waiting on engineering ticket ENG-1422.', 'Called the customer, left voicemail.']), 'agent', addHours(firstResponded, 0.5)]
        );
      }
      if (chance(0.6)) {
        await query('INSERT INTO time_entries (ticket_id, user_id, minutes, note, billable, started_at) VALUES ($1,$2,$3,$4,$5,$6)', [t.id, responder.id, 10 + Math.floor(rand() * 80), pick(['Investigation', 'Customer call', 'Fix and verification', null]), chance(0.7), firstResponded]);
      }
      if (resolvedAt) {
        await query('INSERT INTO ticket_activities (ticket_id, user_id, actor_label, action, details, created_at) VALUES ($1,$2,$3,$4,$5,$6)', [t.id, responder.id, responder.name, 'updated', JSON.stringify({ changes: { status: { from: 'pending', to: 'resolved' } } }), resolvedAt]);
        if (chance(0.65)) {
          const rating = pick([5, 5, 5, 4, 4, 3, 2, 1]);
          await query('INSERT INTO satisfaction_ratings (ticket_id, contact_id, agent_id, rating, feedback, created_at) VALUES ($1,$2,$3,$4,$5,$6)', [t.id, requester.id, responder.id, rating, rating >= 4 ? pick(['Great support, thank you!', 'Fast and friendly.', 'Solved my problem quickly.', null]) : pick(['Took too long to get a response.', 'Issue was not fully resolved.', null]), addHours(resolvedAt, 2)]);
        }
      }
    }
  }

  // Watchers, saved views, notifications
  await query('INSERT INTO ticket_watchers (ticket_id, user_id) VALUES ($1,$2), ($3,$2)', [ticketIds[2], admin.id, ticketIds[12]]);
  await query(
    `INSERT INTO saved_views (user_id, name, filters, visibility) VALUES
     ($1, 'Urgent & high priority', '{"priority":["urgent","high"],"status":["open","pending"]}', 'all_agents'),
     ($1, 'Billing queue', '{"group_id":[${billing.id}],"status":["open","pending"]}', 'all_agents'),
     ($1, 'Bugs awaiting fix', '{"tags":["bug"],"status":["open","pending"]}', 'private')`, [admin.id]
  );
  await query(
    `INSERT INTO notifications (user_id, type, title, body, link) VALUES
     ($1, 'ticket_assigned', 'Ticket #${ticketIds[2]} assigned to you', 'API returns 500 on /v2/orders', '/tickets/${ticketIds[2]}'),
     ($1, 'sla_breach', 'Resolution overdue on #${ticketIds[0]}', 'Cannot log in after password reset', '/tickets/${ticketIds[0]}'),
     ($1, 'csat', 'Jane Customer rated ticket #${ticketIds[29]}: 5/5', 'Great support, thank you!', '/tickets/${ticketIds[29]}')`, [admin.id]
  );

  console.log(`Seeded ${agents.length} agents, ${groups.length} groups, ${companies.length} companies, ${contacts.length} contacts, ${subjects.length} tickets.`);
  console.log('Agent login:    admin@supportdesk.local / password123  (admin)');
  console.log('Agent login:    priya@supportdesk.local / password123  (agent)');
  console.log('Customer login: customer@acme.com / password123        (portal)');
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
