const pdfParse = require('pdf-parse');
const officeParser = require('officeparser');
const { createWorker } = require('tesseract.js');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const db = require('../db');
const os = require('os');
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

// Helper: extract text from Office documents via officeparser
async function extractOfficeText(buffer, ext) {
  return new Promise((resolve, reject) => {
    officeParser.parseOffice(buffer, (text, err) => {
      if (err) return reject(err);
      resolve(text || '');
    }, { outputErrorToConsole: false });
  });
}

// Helper: OCR an image buffer via Tesseract.js
async function extractImageOCR(buffer, ext) {
  // Write buffer to a temp file because Tesseract.js needs a file path or URL
  const tmpFile = path.join(os.tmpdir(), `ocr_tmp_${Date.now()}${ext}`);
  fs.writeFileSync(tmpFile, buffer);
  try {
    const worker = await createWorker('eng');
    const { data: { text } } = await worker.recognize(tmpFile);
    await worker.terminate();
    return text || '[No text detected in image]';
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
  }
}

// Helper: Extract relevant chunks from massive documents using keyword scoring to prevent context limit errors
function getRelevantChunks(text, query = '', maxChars = 120000) {
  if (!text) return '';
  if (text.length <= maxChars) return text;

  // Split query into keywords (lowercase, alphanumeric, longer than 2 chars)
  const keywords = (query || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2);

  // If no keywords found, default to first maxChars characters
  if (keywords.length === 0) {
    return text.substring(0, maxChars) + '\n\n... [Remaining content truncated to fit context limits]';
  }

  const chunkSize = 8000;
  const overlap = 1000;
  const chunks = [];
  
  for (let i = 0; i < text.length; i += (chunkSize - overlap)) {
    chunks.push(text.substring(i, i + chunkSize));
  }

  // Score each chunk
  const scoredChunks = chunks.map((chunk, index) => {
    const lowerChunk = chunk.toLowerCase();
    let score = 0;
    for (const word of keywords) {
      try {
        const regex = new RegExp(word.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g');
        const matches = lowerChunk.match(regex);
        if (matches) {
          score += matches.length;
        }
      } catch (_) {}
    }
    return { chunk, score, index };
  });

  // Sort by score descending, then by original index ascending
  scoredChunks.sort((a, b) => b.score - a.score || a.index - b.index);

  // Take top chunks until we hit maxChars limit
  let assembledLength = 0;
  const selectedChunks = [];
  
  for (const item of scoredChunks) {
    if ((assembledLength + item.chunk.length) > maxChars) {
      if (selectedChunks.length === 0) {
        selectedChunks.push({ chunk: item.chunk.substring(0, maxChars), index: item.index });
      }
      break;
    }
    selectedChunks.push(item);
    assembledLength += item.chunk.length;
  }

  // Sort selected chunks back to chronological order to keep text readable
  selectedChunks.sort((a, b) => a.index - b.index);
  
  return selectedChunks.map(c => `[Excerpt (from section ${c.index + 1})]:\n${c.chunk}`).join('\n\n---\n\n') + '\n\n... [Some sections omitted to fit context limits]';
}

// Universal helper: get text content from any file stored in R2
async function getFileTextContent(r2_key, mime_type) {
  try {
    const command = new GetObjectCommand({
      Bucket: r2Bucket,
      Key: r2_key,
    });
    const s3Response = await s3.send(command);
    const buffer = await streamToBuffer(s3Response.Body);

    // Derive extension from the R2 key
    const ext = path.extname(r2_key).toLowerCase();

    // --- PDF ---
    if (ext === '.pdf' || mime_type === 'application/pdf') {
      const parsed = await pdfParse(buffer);
      return parsed.text || '[PDF extracted but no text found]';
    }

    // --- Office documents ---
    if (['.docx', '.pptx', '.xlsx', '.odt', '.odp', '.ods'].includes(ext)) {
      try {
        return await extractOfficeText(buffer, ext);
      } catch (officeErr) {
        console.warn('officeparser failed, falling back to plain text:', officeErr.message);
        return buffer.toString('utf-8');
      }
    }

    // --- Plain text / code / data ---
    if (['.txt', '.md', '.csv', '.json', '.xml', '.html', '.js', '.py', '.java', '.ts'].includes(ext)) {
      return buffer.toString('utf-8');
    }

    // --- Images → OCR ---
    if (['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff'].includes(ext)
        || (mime_type && mime_type.startsWith('image/'))) {
      return await extractImageOCR(buffer, ext || '.png');
    }

    // --- Fallback: try UTF-8, give up gracefully ---
    const textAttempt = buffer.toString('utf-8');
    // Heuristic: if more than 20% non-printable chars it's binary
    const nonPrintable = (textAttempt.match(/[\x00-\x08\x0E-\x1F\x7F-\x9F]/g) || []).length;
    if (nonPrintable / textAttempt.length > 0.2) {
      return `[Binary file (${ext || mime_type || 'unknown type'}) — text extraction not supported for this format]`;
    }
    return textAttempt;

  } catch (err) {
    console.error('Error fetching file text content:', err);
    throw new Error(`Could not fetch or parse file from storage: ${err.message}`);
  }
}

// Helper: Sleep utility
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper: Call Mistral API with retry logic for 429 Rate Limits
async function callMistral(messages, temperature = 0.7) {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new Error('Mistral API Key is missing.');
  }

  const maxRetries = 4;
  let delay = 1000; // start with 1 second delay

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
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

      if (response.status === 429) {
        if (attempt === maxRetries) {
          throw new Error(`Mistral API returned status 429 (Rate Limit Exceeded) after ${maxRetries} attempts.`);
        }
        console.warn(`[Mistral API] Rate limited (429). Retrying attempt ${attempt}/${maxRetries} in ${delay}ms...`);
        await sleep(delay);
        delay *= 2.5; // exponential backoff with factor 2.5
        continue;
      }

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Mistral API returned status ${response.status}: ${errorBody}`);
      }

      const data = await response.json();
      return data.choices[0].message.content;
    } catch (err) {
      if (attempt === maxRetries || !err.message.includes('429')) {
        throw err;
      }
      console.warn(`[Mistral API] Error on attempt ${attempt}/${maxRetries}: ${err.message}. Retrying in ${delay}ms...`);
      await sleep(delay);
      delay *= 2.5;
    }
  }
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
            const chunkedText = getRelevantChunks(fileText, message);
            fileContext = `[Context File: "${file.label}"]\n${chunkedText}\n\n`;
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
            const chunkedText = getRelevantChunks(fileText, message);
            fileContext = `[Context File: "${file.label}"]\n${chunkedText}\n\n`;
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
