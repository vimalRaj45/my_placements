const { Pool } = require('@neondatabase/serverless');
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Error: DATABASE_URL is missing in .env');
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
});

async function changePassword() {
  const newPassword = 'Vimalboss@45';
  console.log(`Hashing new password: "${newPassword}"...`);
  const hash = await bcrypt.hash(newPassword, 12);

  const client = await pool.connect();
  try {
    console.log('Connecting to database and updating auth password...');
    
    // Check if a record exists
    const checkRes = await client.query('SELECT COUNT(*) FROM auth');
    const count = parseInt(checkRes.rows[0].count, 10);
    
    if (count === 0) {
      await client.query('INSERT INTO auth (password_hash) VALUES ($1)', [hash]);
      console.log('Successfully inserted new password hash!');
    } else {
      await client.query('UPDATE auth SET password_hash = $1', [hash]);
      console.log('Successfully updated existing password hash!');
    }
  } catch (err) {
    console.error('Failed to update password:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

changePassword();
