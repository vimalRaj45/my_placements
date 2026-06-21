const { Pool } = require('@neondatabase/serverless');
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');

dotenv.config();

const databaseUrl = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_MYNt3Ecjv5Bx@ep-royal-base-ad144vf6-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require';

const pool = new Pool({
  connectionString: databaseUrl,
});

const schemaSql = `
CREATE TABLE IF NOT EXISTS auth (
  id SERIAL PRIMARY KEY,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS companies (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT,
  status TEXT NOT NULL DEFAULT 'applied', -- 'applied' | 'interview' | 'offer' | 'rejected'
  applied_date DATE,
  package TEXT,
  location TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rounds (
  id SERIAL PRIMARY KEY,
  company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  round_name TEXT NOT NULL,        -- e.g. 'OA', 'Technical 1', 'HR'
  scheduled_date TIMESTAMPTZ,
  result TEXT,                     -- 'pending' | 'passed' | 'failed'
  feedback TEXT,
  reminder_sent BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notes (
  id SERIAL PRIMARY KEY,
  title TEXT,
  content TEXT NOT NULL,           -- markdown
  company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  round_id INTEGER REFERENCES rounds(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS files (
  id SERIAL PRIMARY KEY,
  label TEXT NOT NULL,
  type TEXT NOT NULL,              -- 'certificate' | 'resume' | 'offer_letter' | 'resource' | 'other'
  company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  r2_key TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,
  is_shared BOOLEAN DEFAULT FALSE, -- true = shows in resource hub
  folder TEXT,                     -- folder name for grouping
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_logs (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL,              -- 'resume_review' | 'mock_interview' | 'email_classify' | 'chat'
  input TEXT,
  output TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS emails (
  id SERIAL PRIMARY KEY,
  gmail_message_id TEXT UNIQUE NOT NULL,
  sender TEXT,
  subject TEXT,
  snippet TEXT,
  received_at TIMESTAMPTZ,
  is_important BOOLEAN DEFAULT FALSE,
  classified_by TEXT,              -- 'keyword' | 'mistral'
  created_at TIMESTAMPTZ DEFAULT now()
);
`;

async function runMigration() {
  console.log('Connecting to database...');
  const client = await pool.connect();
  try {
    console.log('Running schema migrations...');
    await client.query(schemaSql);
    console.log('Schema tables verified/created successfully.');
    await client.query('ALTER TABLE files ADD COLUMN IF NOT EXISTS folder TEXT');

    // Seed password if not present
    const res = await client.query('SELECT COUNT(*) FROM auth');
    const count = parseInt(res.rows[0].count, 10);
    if (count === 0) {
      console.log('Seeding default single-user login password...');
      const rawPassword = 'rrzu iydo mncy bjsg';
      const hash = await bcrypt.hash(rawPassword, 12);
      await client.query('INSERT INTO auth (password_hash) VALUES ($1)', [hash]);
      console.log('Password successfully seeded.');
    } else {
      console.log('Auth table is not empty, skipping seeding.');
    }
  } catch (err) {
    console.error('Error running migrations:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration().then(() => {
  console.log('Migration process finished.');
});
