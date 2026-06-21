const pdfParse = require('pdf-parse');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const db = require('../db');

const fs = require('fs');
const path = require('path');

const r2Endpoint = process.env.R2_ENDPOINT || 'https://0062c9f9a7ea658980e06d881142fd14.r2.cloudflarestorage.com';
const r2Bucket = process.env.R2_BUCKET || 'placements';

const s3 = new S3Client({
  region: 'auto',
  endpoint: r2Endpoint,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || 'dummy_id',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || 'dummy_secret',
  },
});

// Helper: convert stream to buffer
function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

// Helper: get text content from file key in R2
async function getFileTextContent(r2_key, mime_type) {
  try {
    let buffer;
    const command = new GetObjectCommand({
      Bucket: r2Bucket,
      Key: r2_key,
    });
    const s3Response = await s3.send(command);
    buffer = await streamToBuffer(s3Response.Body);

    if (mime_type === 'application/pdf' || r2_key.toLowerCase().endsWith('.pdf')) {
      const parsed = await pdfParse(buffer);
      return parsed.text;
    } else {
      return buffer.toString('utf-8');
    }
  } catch (err) {
    console.error('Error fetching file text content:', err);
    throw new Error(`Could not fetch or parse file from storage: ${err.message}`);
  }
}

// Helper: Call Mistral API
async function callMistral(messages, temperature = 0.7) {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new Error('Mistral API Key is missing.');
  }

  const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'mistral-large-latest',
      messages,
      temperature
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Mistral API returned status ${response.status}: ${errorBody}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

async function agentRoutes(fastify, options) {
  // POST /api/agent/resume-review
  fastify.post('/agent/resume-review', async (request, reply) => {
    const { file_id, job_description } = request.body || {};

    if (!file_id || !job_description) {
      return reply.code(400).send({ error: 'File ID and Job Description are required' });
    }

    try {
      // 1. Get R2 key and mime_type from database
      const dbRes = await db.query('SELECT r2_key, mime_type, label FROM files WHERE id = $1', [file_id]);
      if (dbRes.rows.length === 0) {
        return reply.code(404).send({ error: 'Resume file record not found' });
      }

      const file = dbRes.rows[0];

      // 2. Fetch text content of resume from R2
      let resumeText = '';
      try {
        resumeText = await getFileTextContent(file.r2_key, file.mime_type);
      } catch (parseErr) {
        fastify.log.error(parseErr);
        return reply.code(500).send({ error: `Failed to extract text from resume: ${parseErr.message}` });
      }

      // 3. Send to Mistral
      const systemPrompt = `You are an expert ATS (Applicant Tracking System) optimizer and professional resume writer.
Analyze the user's resume text against the provided job description.
Provide a professional, detailed review:
1. Overall Match Score (0% to 100%) and brief explanation.
2. Strengths (what aligns well).
3. Gaps/Weaknesses (skills or experience missing or not highlighted).
4. Specific, actionable fixes (bullet points detailing exactly what text to modify, add, or delete).
Output in Markdown format.`;

      const userPrompt = `
### JOB DESCRIPTION:
${job_description}

### RESUME TEXT:
${resumeText}
`;

      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ];

      const reviewOutput = await callMistral(messages);

      // 4. Log to agent_logs
      await db.query(
        'INSERT INTO agent_logs (type, input, output) VALUES ($1, $2, $3)',
        ['resume_review', `File: ${file.label} (ID: ${file_id})\nJob Desc: ${job_description.substring(0, 500)}...`, reviewOutput]
      );

      return { review: reviewOutput };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: `Mistral API resume review failed: ${err.message}` });
    }
  });

  // POST /api/agent/mock-interview
  fastify.post('/agent/mock-interview', async (request, reply) => {
    const { topic, previous_answer, history = [] } = request.body || {};

    if (!topic) {
      return reply.code(400).send({ error: 'Topic/Role is required' });
    }

    try {
      const messages = [
        {
          role: 'system',
          content: `You are an experienced technical interviewer.
Conduct a mock interview for the topic/role: "${topic}".
Your goals are:
- Ask exactly ONE clear, concise interview question at a time.
- If the user provides a previous answer, evaluate it concisely: give constructive feedback, point out correctness, and suggest how to improve it, then immediately transition to the next interview question.
- Keep the tone professional, realistic, and highly supportive.
- Do not write the answers for the user. Ask standard, core questions suitable for placement prep.`
        }
      ];

      // Add conversation history
      for (const h of history) {
        messages.push({ role: h.role, content: h.content });
      }

      // If there's a new answer, add it
      if (previous_answer) {
        messages.push({ role: 'user', content: previous_answer });
      } else if (history.length === 0) {
        // If start of conversation
        messages.push({ role: 'user', content: `Hi, I am ready to start my mock interview on "${topic}". Please ask the first question.` });
      }

      const agentResponse = await callMistral(messages);

      // Format output nicely
      let feedback = '';
      let nextQuestion = agentResponse;

      // Attempt to split feedback from the next question if previous answer was evaluated
      if (previous_answer && agentResponse.toLowerCase().includes('question')) {
        // Just send the text as is, the frontend will show it.
      }

      // Log to agent_logs
      await db.query(
        'INSERT INTO agent_logs (type, input, output) VALUES ($1, $2, $3)',
        ['mock_interview', `Topic: ${topic}\nAnswer: ${previous_answer || 'N/A'}`, agentResponse]
      );

      return { response: agentResponse };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: `Mock interview API failed: ${err.message}` });
    }
  });

  // POST /api/agent/chat
  fastify.post('/agent/chat', async (request, reply) => {
    const { message, file_id, history = [] } = request.body || {};

    if (!message) {
      return reply.code(400).send({ error: 'Message is required' });
    }

    try {
      let fileContext = '';

      if (file_id) {
        // Fetch file details
        const dbRes = await db.query('SELECT r2_key, mime_type, label FROM files WHERE id = $1', [file_id]);
        if (dbRes.rows.length > 0) {
          const file = dbRes.rows[0];
          try {
            const fileText = await getFileTextContent(file.r2_key, file.mime_type);
            fileContext = `[Context File: "${file.label}"]\n${fileText}\n\n`;
          } catch (fileErr) {
            fastify.log.warn(`Could not extract context from file ID ${file_id}: ${fileErr.message}`);
          }
        }
      }

      const systemPrompt = `You are a supportive, knowledgeable AI Career Coach and Placement Prep Assistant.
You help the user prepare for placement exams, mock interviews, and organize their portfolio.
${fileContext ? 'You are given the contents of one of the user\'s uploaded files below to help answer their question.' : ''}
Be concise, clear, and professional. Provide code snippets or markdown tables where helpful.`;

      const messages = [
        { role: 'system', content: systemPrompt }
      ];

      // Add history
      for (const h of history) {
        messages.push({ role: h.role, content: h.content });
      }

      // Add user message
      let finalUserMsg = message;
      if (fileContext) {
        finalUserMsg = `${fileContext}User query: ${message}`;
      }
      messages.push({ role: 'user', content: finalUserMsg });

      const aiResponse = await callMistral(messages);

      // Log to agent logs
      await db.query(
        'INSERT INTO agent_logs (type, input, output) VALUES ($1, $2, $3)',
        ['chat', `Msg: ${message} (FileContext: ${file_id ? 'Yes' : 'No'})`, aiResponse]
      );

      return { response: aiResponse };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: `General agent chat failed: ${err.message}` });
    }
  });

  // POST /api/agent/prep
  fastify.post('/agent/prep', async (request, reply) => {
    const { message, file_id, focus, history = [] } = request.body || {};

    if (!message) {
      return reply.code(400).send({ error: 'Message is required' });
    }

    try {
      let fileContext = '';

      if (file_id) {
        // Fetch file details
        const dbRes = await db.query('SELECT r2_key, mime_type, label FROM files WHERE id = $1', [file_id]);
        if (dbRes.rows.length > 0) {
          const file = dbRes.rows[0];
          try {
            const fileText = await getFileTextContent(file.r2_key, file.mime_type);
            fileContext = `[Context File: "${file.label}"]\n${fileText}\n\n`;
          } catch (fileErr) {
            fastify.log.warn(`Could not extract context from file ID ${file_id}: ${fileErr.message}`);
          }
        }
      }

      const focusLabel = focus === 'coding' ? 'Coding & Algorithms' : 'Quantitative & Logical Aptitude';

      const systemPrompt = `You are an expert Aptitude and Coding Tutor.
Your goal is to help the user master placement test topics (like quantitative aptitude, logical reasoning, and coding/algorithms) focusing on ${focusLabel} based on their uploaded document.
Explain mathematical concepts, percentage calculations, formulas, or coding logic step-by-step with clear explanations.
If the user asks for coding help, provide clean code with explanations of time and space complexity.
${fileContext ? 'Use the following uploaded reference material as context: \n' + fileContext : ''}`;

      const messages = [
        { role: 'system', content: systemPrompt }
      ];

      // Add history
      for (const h of history) {
        messages.push({ role: h.role, content: h.content });
      }

      // Add user message
      let finalUserMsg = message;
      if (fileContext) {
        finalUserMsg = `${fileContext}User query: ${message}`;
      }
      messages.push({ role: 'user', content: finalUserMsg });

      const aiResponse = await callMistral(messages);

      // Log to agent logs
      await db.query(
        'INSERT INTO agent_logs (type, input, output) VALUES ($1, $2, $3)',
        ['prep', `Msg: ${message} (Focus: ${focus}, FileContext: ${file_id ? 'Yes' : 'No'})`, aiResponse]
      );

      return { response: aiResponse };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: `Aptitude & Coding Prep failed: ${err.message}` });
    }
  });


  // GET logs
  fastify.get('/agent/logs', async (request, reply) => {
    try {
      const res = await db.query('SELECT * FROM agent_logs ORDER BY created_at DESC LIMIT 50');
      return res.rows;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Failed to retrieve agent logs' });
    }
  });
}

module.exports = agentRoutes;
