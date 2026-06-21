const db = require('../db');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config();

async function run() {
  try {
    const res = await db.query('SELECT * FROM files');
    console.log('--- FILES IN DATABASE ---');
    console.table(res.rows.map(r => ({
      id: r.id,
      label: r.label,
      type: r.type,
      r2_key: r.r2_key,
      mime_type: r.mime_type
    })));

    console.log('\n--- CHECKING DISK ---');
    const uploadsDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadsDir)) {
      console.log('Uploads directory does not exist!');
      return;
    }

    const filesOnDisk = fs.readdirSync(uploadsDir);
    console.log('Files on disk:', filesOnDisk);

    for (const file of res.rows) {
      const safeKey = path.basename(file.r2_key);
      const targetPath = path.join(uploadsDir, safeKey);
      const exists = fs.existsSync(targetPath);
      console.log(`File ID ${file.id} ("${file.label}", key: "${file.r2_key}") -> SafeKey: "${safeKey}" -> Exists on disk: ${exists ? '✅ YES' : '❌ NO'}`);
    }
  } catch (err) {
    console.error('Error:', err);
  }
}

run();
