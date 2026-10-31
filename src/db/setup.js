// Creates the application database if it does not exist yet.
import pg from 'pg';
import { env } from '../config/env.js';

const { Client } = pg;

async function main() {
  const client = new Client({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    database: env.db.adminDatabase,
  });
  await client.connect();
  const { rows } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [env.db.database]);
  if (rows.length === 0) {
    await client.query(`CREATE DATABASE "${env.db.database}"`);
    console.log(`Created database ${env.db.database}`);
  } else {
    console.log(`Database ${env.db.database} already exists`);
  }
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
