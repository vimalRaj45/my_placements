const dotenv = require('dotenv');
const { Pool } = require('@neondatabase/serverless');
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { ImapFlow } = require('imapflow');

dotenv.config();

const BASE_URL = 'http://localhost:3000';
const DEFAULT_PASSWORD = 'rrzu iydo mncy bjsg';

console.log('==================================================');
console.log('      PLACEMENT PREP HUB - FULL SYSTEM TESTS      ');
console.log('==================================================\n');

// Direct connection checks
async function testDirectDatabase() {
  console.log('[1/10] Checking Direct Database Access...');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const res = await pool.query('SELECT now(), count(*) FROM auth');
    console.log('  ✅ Database Connected successfully!');
    console.log(`  👤 Auth accounts seeded: ${res.rows[0].count}\n`);
    return true;
  } catch (err) {
    console.error('  ❌ Database Connection failed:');
    console.error(`     Error details: ${err.message}\n`);
    return false;
  } finally {
    await pool.end();
  }
}

async function testDirectMistral() {
  console.log('[2/10] Checking Direct Mistral AI Access...');
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    console.error('  ❌ Mistral API Key is missing in .env\n');
    return false;
  }

  try {
    const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'mistral-large-latest',
        messages: [{ role: 'user', content: 'Ping' }],
        max_tokens: 5
      })
    });

    if (response.ok) {
      console.log('  ✅ Mistral AI connected successfully!\n');
      return true;
    } else {
      const errText = await response.text();
      console.error(`  ❌ Mistral API returned status ${response.status}: ${errText}\n`);
      return false;
    }
  } catch (err) {
    console.error(`  ❌ Mistral AI Connection failed: ${err.message}\n`);
    return false;
  }
}

async function testDirectGmailIMAP() {
  console.log('[3/10] Checking Direct Gmail IMAP Sync Access...');
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;

  if (!user || !pass || user.includes('placeholder')) {
    console.error('  ❌ Gmail credentials missing or default in .env\n');
    return false;
  }

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const status = client.mailbox;
      console.log('  ✅ Gmail IMAP authenticated successfully!');
      console.log(`  📬 Total messages in INBOX: ${status.exists}\n`);
    } finally {
      lock.release();
    }
    await client.logout();
    return true;
  } catch (err) {
    console.error(`  ❌ Gmail IMAP connection failed: ${err.message}\n`);
    return false;
  }
}

// REST API endpoint checks
async function runRestTests() {
  console.log('==================================================');
  console.log('            FASTIFY SERVER REST API TESTS         ');
  console.log('==================================================\n');

  let sessionCookie = '';

  // 4. Authenticate
  console.log('[4/10] Testing API Authentication (/api/login)...');
  try {
    const res = await fetch(`${BASE_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: DEFAULT_PASSWORD })
    });

    if (res.ok) {
      const data = await res.json();
      const cookieHeader = res.headers.get('set-cookie');
      if (cookieHeader) {
        sessionCookie = cookieHeader.split(';')[0];
        console.log('  ✅ Successfully logged in and session cookie extracted.');
      } else {
        console.warn('  ⚠️ Logged in, but no Set-Cookie header found.');
      }
    } else {
      console.error(`  ❌ Login failed with status ${res.status}`);
      return;
    }
  } catch (err) {
    console.error(`  ❌ Login request failed: ${err.message}`);
    return;
  }

  if (!sessionCookie) {
    console.error('  ❌ Cannot proceed without session cookie.\n');
    return;
  }

  // 5. Check Session
  console.log('\n[5/10] Checking Session Validity (/api/session)...');
  try {
    const res = await fetch(`${BASE_URL}/api/session`, {
      headers: { 'cookie': sessionCookie }
    });
    const data = await res.json();
    if (res.ok && data.authenticated) {
      console.log('  ✅ Session verified successfully.');
    } else {
      console.error('  ❌ Session verification failed:', data);
    }
  } catch (err) {
    console.error('  ❌ Session endpoint error:', err.message);
  }

  let testCompanyId = null;

  // 6. CRUD Companies
  console.log('\n[6/10] Testing Kanban Company CRUD Endpoints (/api/companies)...');
  try {
    // Create
    const createRes = await fetch(`${BASE_URL}/api/companies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'cookie': sessionCookie
      },
      body: JSON.stringify({
        name: 'SystemTestCorp',
        role: 'Test Engineer',
        status: 'applied',
        applied_date: new Date().toISOString().split('T')[0],
        package: '12 LPA',
        location: 'Remote'
      })
    });
    const company = await createRes.json();
    if (createRes.ok && company.id) {
      testCompanyId = company.id;
      console.log(`  ✅ Company created successfully (ID: ${testCompanyId}).`);
    } else {
      console.error('  ❌ Company creation failed:', company);
    }

    // List
    const listRes = await fetch(`${BASE_URL}/api/companies`, {
      headers: { 'cookie': sessionCookie }
    });
    const companies = await listRes.json();
    const found = companies.some(c => c.id === testCompanyId);
    if (listRes.ok && found) {
      console.log('  ✅ Company list verified (test company found).');
    } else {
      console.error('  ❌ Company list verification failed.');
    }

    // Update status
    const updateRes = await fetch(`${BASE_URL}/api/companies/${testCompanyId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'cookie': sessionCookie
      },
      body: JSON.stringify({ status: 'interview' })
    });
    const updatedCompany = await updateRes.json();
    if (updateRes.ok && updatedCompany.status === 'interview') {
      console.log('  ✅ Company status update verified.');
    } else {
      console.error('  ❌ Company update failed.');
    }
  } catch (err) {
    console.error('  ❌ Company CRUD request failed:', err.message);
  }

  // 7. Scheduling Rounds
  if (testCompanyId) {
    console.log('\n[7/10] Testing Interview Rounds CRUD Endpoints...');
    try {
      const addRoundRes = await fetch(`${BASE_URL}/api/companies/${testCompanyId}/rounds`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cookie': sessionCookie
        },
        body: JSON.stringify({
          round_name: 'Online Assessment',
          scheduled_date: new Date(Date.now() + 86400000).toISOString(), // 24h from now
          feedback: 'Verify mock integration testing'
        })
      });
      const round = await addRoundRes.json();
      if (addRoundRes.ok && round.id) {
        console.log(`  ✅ Scheduled OA round successfully (ID: ${round.id}).`);
      } else {
        console.error('  ❌ Round scheduling failed:', round);
      }
    } catch (err) {
      console.error('  ❌ Round CRUD request failed:', err.message);
    }
  }

  // 8. Notes CRUD
  console.log('\n[8/10] Testing Journal Notes Endpoints (/api/notes)...');
  let testNoteId = null;
  try {
    const noteRes = await fetch(`${BASE_URL}/api/notes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'cookie': sessionCookie
      },
      body: JSON.stringify({
        title: 'System Test Notes',
        content: '# Test Content\n- Item 1\n- Item 2',
        company_id: testCompanyId
      })
    });
    const note = await noteRes.json();
    if (noteRes.ok && note.id) {
      testNoteId = note.id;
      console.log(`  ✅ Note created successfully (ID: ${testNoteId}).`);
    } else {
      console.error('  ❌ Note creation failed:', note);
    }
  } catch (err) {
    console.error('  ❌ Note CRUD request failed:', err.message);
  }

  // 8.5 Files Upload, Download & AI Context Integration
  console.log('\n[8b/10] Testing File Upload, Download & AI Review Integration...');
  let testFileId = null;
  try {
    // 1. Get signed put URL (local fallback URL in this setup)
    const uploadUrlRes = await fetch(`${BASE_URL}/api/files/upload-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'cookie': sessionCookie
      },
      body: JSON.stringify({
        filename: 'resume_test.txt',
        mime_type: 'text/plain',
        type: 'resume',
        company_id: testCompanyId,
        size_bytes: 100,
        folder: 'System Test Folder'
      })
    });
    const uploadUrlData = await uploadUrlRes.json();
    if (uploadUrlRes.ok && uploadUrlData.signed_put_url) {
      testFileId = uploadUrlData.file_id;
      console.log(`  ✅ Generated upload path successfully: ${uploadUrlData.signed_put_url}`);
      
      // 2. Perform direct upload to that URL (will go to local upload route or R2 depending on config)
      const uploadUrl = uploadUrlData.signed_put_url.startsWith('http') 
        ? uploadUrlData.signed_put_url 
        : `${BASE_URL}${uploadUrlData.signed_put_url}`;
        
      const uploadHeaders = { 'Content-Type': 'text/plain' };
      if (!uploadUrl.startsWith('http') || uploadUrl.includes('localhost')) {
        uploadHeaders['cookie'] = sessionCookie;
      }
      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: uploadHeaders,
        body: 'Vimal Raj - Software Engineer Candidate Resume. Skills: Node.js, Fastify, Postgres, Javascript.'
      });
      
      if (uploadRes.ok) {
        console.log('  ✅ File content successfully uploaded.');
        
        // 3. Get download URL
        const downloadRes = await fetch(`${BASE_URL}/api/files/${testFileId}/download-url`, {
          headers: { 'cookie': sessionCookie }
        });
        const downloadData = await downloadRes.json();
        if (downloadRes.ok && downloadData.signed_get_url) {
          console.log(`  ✅ Generated download link successfully: ${downloadData.signed_get_url}`);
          if (downloadData.file.folder === 'System Test Folder') {
            console.log('  ✅ File folder metadata matches ("System Test Folder").');
          } else {
            console.error('  ❌ File folder metadata mismatch:', downloadData.file.folder);
          }
          
          // Download and verify content
          const fileDownloadUrl = downloadData.signed_get_url.startsWith('http')
            ? downloadData.signed_get_url
            : `${BASE_URL}${downloadData.signed_get_url}`;
            
          const downloadHeaders = {};
          if (!fileDownloadUrl.startsWith('http') || fileDownloadUrl.includes('localhost')) {
            downloadHeaders['cookie'] = sessionCookie;
          }
          const fileContentRes = await fetch(fileDownloadUrl, {
            headers: downloadHeaders
          });
          const fileContent = await fileContentRes.text();
          if (fileContent.includes('Vimal Raj')) {
            console.log('  ✅ Uploaded file content matches and is verified.');
          } else {
            console.error('  ❌ Uploaded file verification content mismatch:', fileContent);
          }
        } else {
          console.error('  ❌ Failed to get download URL:', downloadData);
        }
      } else {
        console.error(`  ❌ Direct file upload failed with status: ${uploadRes.status}`);
      }
    } else {
      console.error('  ❌ Failed to generate upload URL:', uploadUrlData);
    }
  } catch (err) {
    console.error('  ❌ File integration test failed with error:', err.message);
  }

  // 9. AI Agent Integration
  console.log('\n[9/10] Testing AI Agent Chat Completion Endpoint (/api/agent/chat)...');
  try {
    const agentRes = await fetch(`${BASE_URL}/api/agent/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'cookie': sessionCookie
      },
      body: JSON.stringify({
        message: 'Give me a brief one-sentence tip for a coding test.'
      })
    });
    const data = await agentRes.json();
    if (agentRes.ok && data.response) {
      console.log('  ✅ AI Agent responded successfully!');
      console.log(`     🤖 Agent: "${data.response.trim()}"`);
    } else {
      console.error('  ❌ AI Agent response verification failed:', data);
    }
  } catch (err) {
    console.error('  ❌ AI Agent request failed:', err.message);
  }

  // 9.5 Test resume review
  if (testFileId) {
    console.log('\n[9b/10] Testing Resume Review Agent API with uploaded file context...');
    try {
      const reviewRes = await fetch(`${BASE_URL}/api/agent/resume-review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cookie': sessionCookie
        },
        body: JSON.stringify({
          file_id: testFileId,
          job_description: 'Looking for a Software Engineer with expertise in Node.js, Fastify, Postgres.'
        })
      });
      const reviewData = await reviewRes.json();
      if (reviewRes.ok && reviewData.review) {
        console.log('  ✅ AI Resume Review succeeded!');
        console.log(`     🤖 Match analysis preview: "${reviewData.review.substring(0, 150).replace(/\n/g, ' ')}..."`);
      } else {
        console.error('  ❌ Resume Review failed:', reviewData);
      }
    } catch (err) {
      console.error('  ❌ Resume Review endpoint error:', err.message);
    }
  }

  // 9d. Aptitude & Coding Prep Tutor Agent Integration
  console.log('\n[9d/10] Testing Aptitude & Coding Prep Agent Endpoint (/api/agent/prep)...');
  try {
    const prepRes = await fetch(`${BASE_URL}/api/agent/prep`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'cookie': sessionCookie
      },
      body: JSON.stringify({
        message: 'Explain how to calculate percentages and percentage change step-by-step.',
        focus: 'aptitude',
        file_id: testFileId || null
      })
    });
    const prepData = await prepRes.json();
    if (prepRes.ok && prepData.response) {
      console.log('  ✅ Aptitude & Coding Prep Tutor responded successfully!');
      console.log(`     🤖 Tutor: "${prepData.response.trim().substring(0, 200).replace(/\n/g, ' ')}..."`);
    } else {
      console.error('  ❌ Aptitude & Coding Prep Tutor verification failed:', prepData);
    }
  } catch (err) {
    console.error('  ❌ Aptitude & Coding Prep Tutor request failed:', err.message);
  }

  // 9c. Global Smart Search Integration
  console.log('\n[9c/10] Testing Global Smart Search Endpoint (/api/search)...');
  try {
    const searchRes = await fetch(`${BASE_URL}/api/search?q=SystemTestCorp`, {
      headers: { 'cookie': sessionCookie }
    });
    const searchData = await searchRes.json();
    if (searchRes.ok && searchData.companies && searchData.companies.length > 0) {
      console.log('  ✅ Smart Search returned matching company results successfully!');
      console.log(`     🔍 Query "SystemTestCorp" matches: "${searchData.companies[0].name}"`);
    } else {
      console.error('  ❌ Smart Search verification failed:', searchData);
    }
  } catch (err) {
    console.error('  ❌ Smart Search endpoint error:', err.message);
  }

  // 10. Manual Gmail Sync Route
  console.log('\n[10/10] Testing Manual Gmail Sync Endpoint (/api/emails/sync)...');
  try {
    const syncRes = await fetch(`${BASE_URL}/api/emails/sync`, {
      method: 'POST',
      headers: { 'cookie': sessionCookie }
    });
    const data = await syncRes.json();
    if (syncRes.ok && data.success) {
      console.log(`  ✅ Manual Gmail Sync succeeded via Server API!`);
      console.log(`     📬 Sync result: ${data.count} new job emails synchronized.`);
    } else {
      console.error('  ❌ Manual Gmail Sync via API failed:', data);
    }
  } catch (err) {
    console.error('  ❌ Manual Gmail Sync request failed:', err.message);
  }

  // CLEANUP
  console.log('\n==================================================');
  console.log('              CLEANUP TEST ENTITIES               ');
  console.log('==================================================');
  
  if (testNoteId) {
    try {
      await fetch(`${BASE_URL}/api/notes/${testNoteId}`, {
        method: 'DELETE',
        headers: { 'cookie': sessionCookie }
      });
      console.log('  🧹 Deleted test note.');
    } catch (e) {}
  }

  if (testFileId) {
    try {
      await fetch(`${BASE_URL}/api/files/${testFileId}`, {
        method: 'DELETE',
        headers: { 'cookie': sessionCookie }
      });
      console.log('  🧹 Deleted test file.');
    } catch (e) {}
  }

  if (testCompanyId) {
    try {
      await fetch(`${BASE_URL}/api/companies/${testCompanyId}`, {
        method: 'DELETE',
        headers: { 'cookie': sessionCookie }
      });
      console.log('  🧹 Deleted test company (cascades to delete test rounds).');
    } catch (e) {}
  }

  console.log('\n  ✅ Cleanup completed successfully!');
}

async function runAllTests() {
  const dbOk = await testDirectDatabase();
  const mistralOk = await testDirectMistral();
  const gmailOk = await testDirectGmailIMAP();

  if (dbOk && mistralOk && gmailOk) {
    console.log('🎉 Direct external connection checks passed!\n');
    await runRestTests();
  } else {
    console.error('\n❌ Direct connection checks failed. Skipping REST API verification.');
  }

  console.log('\n==================================================');
  console.log('             SYSTEM TESTS COMPLETED               ');
  console.log('==================================================');
}

runAllTests();
