const db = require('../db');
const dotenv = require('dotenv');
dotenv.config();

async function run() {
  try {
    const res = await db.query('DELETE FROM files RETURNING *');
    console.log(`Cleaned up ${res.rows.length} stale file records.`);
  } catch (err) {
    console.error('Error cleaning files:', err);
  }
}

run();
