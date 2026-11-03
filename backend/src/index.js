import app from './app.js';
import { env } from './config/env.js';
import { pool } from './config/db.js';
import { startJobs } from './utils/jobs.js';
import { refreshStatuses } from './utils/statuses.js';

async function main() {
  try {
    await pool.query('SELECT 1');
    await refreshStatuses();
    console.log(`Connected to Postgres ${env.db.host}:${env.db.port}/${env.db.database}`);
  } catch (err) {
    console.error('Could not connect to Postgres:', err.message);
    console.error('Run `npm run db:setup && npm run db:migrate && npm run db:seed` first.');
    process.exit(1);
  }
  app.listen(env.port, () => {
    console.log(`SupportDesk API listening on http://localhost:${env.port}`);
    startJobs();
  });
}

main();
