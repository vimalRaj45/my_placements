const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const db = require('../db');

// Helper to call Mistral for email classification fallback
async function classifyEmailWithMistral(subject, snippet) {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    return false; // Safe fallback
  }

  try {
    const messages = [
      {
        role: 'system',
        content: `You are an email classification assistant. Determine if the email is related to a job application process, coding assessment, interview scheduling, placement updates, selected/rejected status, or offer letters. Respond with exactly "yes" or "no" and nothing else.`
      },
      {
        role: 'user',
        content: `Subject: ${subject}\nSnippet: ${snippet}`
      }
    ];

    const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'mistral-large-latest',
        messages,
        temperature: 0.1
      })
    });

    if (response.ok) {
      const data = await response.json();
      const answer = data.choices[0].message.content.trim().toLowerCase();
      return answer.includes('yes');
    }
  } catch (err) {
    console.error('Mistral email classification failed:', err);
  }
  return false;
}

// Sync function accessible by both route and cron
async function syncEmails(log) {
  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;

  if (!gmailUser || !gmailPass || gmailUser.includes('placeholder') || gmailPass.includes('placeholder')) {
    throw new Error('Gmail username or App Password is not configured in .env');
  }

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: {
      user: gmailUser,
      pass: gmailPass,
    },
    logger: false,
  });

  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  const emailsSynced = [];

  try {
    // Fetch companies to get their names for keyword filtering
    const companiesRes = await db.query('SELECT name FROM companies');
    const companyNames = companiesRes.rows.map(c => c.name.toLowerCase());

    const mailboxStatus = client.mailbox;
    const totalMessages = mailboxStatus.exists;

    // Fetch the last 15 messages (Gmail IMAP order is ascending by default)
    const start = Math.max(1, totalMessages - 14);
    const end = totalMessages;

    if (totalMessages > 0) {
      const messagesGenerator = client.fetch(`${start}:${end}`, { envelope: true, source: { start: 0, length: 15000 } });
      
      for await (const message of messagesGenerator) {
        const gmail_message_id = message.envelope.messageId || `msg-${message.uid}-${message.envelope.date ? message.envelope.date.getTime() : Date.now()}`;
        
        // Skip if already in DB
        const existsCheck = await db.query('SELECT id FROM emails WHERE gmail_message_id = $1', [gmail_message_id]);
        if (existsCheck.rows.length > 0) {
          continue;
        }

        const parsed = await simpleParser(message.source);
        const subject = message.envelope.subject || '(No Subject)';
        const sender = message.envelope.from && message.envelope.from[0] 
          ? `${message.envelope.from[0].name || ''} <${message.envelope.from[0].address}>` 
          : 'Unknown';
        const received_at = message.envelope.date || new Date();
        const snippet = parsed.text ? parsed.text.substring(0, 300).replace(/\s+/g, ' ').trim() : '';

        // Classification Pipeline
        const subLower = subject.toLowerCase();
        const snipLower = snippet.toLowerCase();

        // 1. Check for company name mentions
        const hasCompanyMention = companyNames.some(name => {
          if (name.length < 3) return false; // avoid short names triggering false positives
          return subLower.includes(name) || snipLower.includes(name);
        });

        // 2. High-importance keywords
        const importantKeywords = [
          'interview', 'shortlisted', 'offer letter', 'assessment', 'online test', 
          'hiring', 'recruitment', 'job opportunity', 'placement details', 
          'selection list', 'rounds', 'written test', 'technical test', 'selected for', 
          'rejected', 'coding challenge', 'test link', 'resume review'
        ];
        
        const hasImportantKeyword = importantKeywords.some(kw => subLower.includes(kw) || snipLower.includes(kw));

        // 3. Low-importance spam/newsletters keywords
        const nonJobKeywords = [
          'newsletter', 'github digest', 'daily digest', 'weekly digest', 'promotion', 
          'advertisement', 'order placed', 'receipt', 'shopping', 'verify your email', 
          'welcome to', 'your account is', 'password reset', 'security alert', 'unsubscribed'
        ];
        const hasNonJobKeyword = nonJobKeywords.some(kw => subLower.includes(kw) || snipLower.includes(kw));

        let is_important = false;
        let classified_by = 'keyword';

        if (hasCompanyMention || hasImportantKeyword) {
          is_important = true;
          classified_by = 'keyword';
        } else if (hasNonJobKeyword) {
          is_important = false;
          classified_by = 'keyword';
        } else {
          // Ambiguous: use Mistral fallback
          is_important = await classifyEmailWithMistral(subject, snippet);
          classified_by = 'mistral';
        }

        // Insert into database
        const insertQuery = `
          INSERT INTO emails (gmail_message_id, sender, subject, snippet, received_at, is_important, classified_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (gmail_message_id) DO NOTHING
          RETURNING *
        `;
        const insertRes = await db.query(insertQuery, [
          gmail_message_id,
          sender,
          subject,
          snippet,
          received_at,
          is_important,
          classified_by
        ]);

        if (insertRes.rows.length > 0) {
          emailsSynced.push(insertRes.rows[0]);
        }
      }
    }
  } finally {
    lock.release();
  }

  await client.logout();
  return emailsSynced;
}

async function emailRoutes(fastify, options) {
  // GET /api/emails: list important emails
  fastify.get('/emails', async (request, reply) => {
    try {
      const res = await db.query('SELECT * FROM emails WHERE is_important = true ORDER BY received_at DESC');
      return res.rows;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Failed to retrieve emails' });
    }
  });

  // POST /api/emails/sync: manually trigger sync
  fastify.post('/emails/sync', async (request, reply) => {
    try {
      const synced = await syncEmails(fastify.log);
      return { success: true, count: synced.length, emails: synced };
    } catch (err) {
      fastify.log.error('Manual Gmail Sync failed: ', err);
      return reply.code(500).send({ error: `Gmail Sync failed: ${err.message}` });
    }
  });

  // DELETE /api/emails/:id: delete an email from inbox log
  fastify.delete('/emails/:id', async (request, reply) => {
    const { id } = request.params;
    try {
      const res = await db.query('DELETE FROM emails WHERE id = $1 RETURNING *', [id]);
      if (res.rows.length === 0) {
        return reply.code(404).send({ error: 'Email not found' });
      }
      return { success: true, message: 'Email deleted successfully' };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Failed to delete email' });
    }
  });
}

module.exports = {
  emailRoutes,
  syncEmails
};
