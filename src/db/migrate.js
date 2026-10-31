import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../config/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const fresh = process.argv.includes('--fresh');
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const client = await pool.connect();
  try {
    if (fresh) {
      await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
      console.log('Dropped and recreated schema');
    }
    await client.query(sql);
    console.log('Schema applied');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
