// Adds sample data for the newer features to an existing database. Safe to re-run.
import { pool, query } from '../config/db.js';

const isEmpty = async (table) => Number((await query(`SELECT COUNT(*) FROM ${table}`)).rows[0].count) === 0;

async function main() {
  if (await isEmpty('products')) {
    await query(`INSERT INTO products (name, description, portal_name) VALUES ('Learning Platform', 'Courses, certificates and learner accounts', 'Learner Help'), ('Career Advisor', 'Career guidance tools', 'Career Help')`);
  }
  await query(
    `INSERT INTO ticket_fields (name, label, field_type, options, position) VALUES
       ('category', 'Category', 'dropdown', '["Account & Login","Course Access","Certificates","Name Change Request","Other"]', 20),
       ('severity', 'Severity', 'dropdown', '["P1","P2","P3","P4"]', 21)
     ON CONFLICT (name) DO NOTHING`
  );
  const { rows: groups } = await query('SELECT id, name FROM groups ORDER BY id');
  const firstGroup = groups[0]?.id || null;
  if (await isEmpty('scenarios')) {
    await query(
      `INSERT INTO scenarios (name, description, actions) VALUES
         ('Escalate to second line', 'Raises priority, escalates and leaves a note', $1),
         ('Close as duplicate', 'Tags the ticket and closes it', '[{"type":"add_tag","value":"duplicate"},{"type":"set_status","value":"closed"}]')`,
      [JSON.stringify([{ type: 'set_priority', value: 'high' }, ...(firstGroup ? [{ type: 'assign_group', value: String(firstGroup) }] : []), { type: 'escalate' }, { type: 'add_note', value: 'Escalated by scenario.' }])]
    );
  }
  if (await isEmpty('ticket_templates')) {
    const { rows: [parent] } = await query(
      `INSERT INTO ticket_templates (name, description, subject, body, priority, type, tags) VALUES
       ('Course migration', 'Parent ticket with one child per team', 'Course migration request', 'Please describe the course to migrate.', 'medium', 'other', '{migration}') RETURNING id`
    );
    await query(
      `INSERT INTO ticket_templates (name, parent_template_id, subject, body, priority) VALUES
       ('Migrate content', $1, 'Migrate course content', 'Move the course content to the new platform.', 'medium'),
       ('Verify enrolments', $1, 'Verify learner enrolments', 'Confirm enrolments after the migration.', 'medium')`, [parent.id]
    );
    await query(`INSERT INTO ticket_templates (name, description, subject, body, priority, type) VALUES ('Initiate a refund', 'For cancellation requests', 'Refund request', 'Order reference:\nReason:', 'medium', 'refund')`);
  }
  if (await isEmpty('ticket_forms')) {
    await query(`INSERT INTO ticket_forms (name, description, type, field_names) VALUES ('Report a problem', 'Something is not working as expected', 'problem', '{category,severity}'), ('Ask a question', 'Get help using the platform', 'question', '{category}')`);
  }
  if (await isEmpty('mailboxes')) {
    await query(`INSERT INTO mailboxes (name, email, is_default) VALUES ('Support', 'support@supportdesk.local', TRUE)`);
  }
  if (await isEmpty('forum_categories')) {
    const { rows: [cat] } = await query(`INSERT INTO forum_categories (name, description) VALUES ('Community', 'Ask questions and share ideas') RETURNING id`);
    const { rows: forums } = await query(
      `INSERT INTO forums (category_id, name, description, forum_type) VALUES
         ($1, 'Announcements', 'News from the team', 'announcements'),
         ($1, 'Feature Requests', 'Tell us what to build next', 'ideas'),
         ($1, 'Tips and Tricks', 'Help each other out', 'questions'),
         ($1, 'Report a problem', 'Tell us what went wrong', 'problems') RETURNING id, name`, [cat.id]
    );
    const { rows: [agent] } = await query("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
    const { rows: [topic] } = await query(
      `INSERT INTO forum_topics (forum_id, title, body, user_id, is_pinned) VALUES ($1, 'Welcome to the community', 'Introduce yourself and ask anything.', $2, TRUE) RETURNING id`,
      [forums[0].id, agent?.id || null]
    );
    await query('INSERT INTO forum_posts (topic_id, body, user_id) VALUES ($1, $2, $3)', [topic.id, 'Glad to have you here.', agent?.id || null]);
  }
  console.log('Sample data for parity features is in place.');
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
