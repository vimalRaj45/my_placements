const fastify = require('fastify')({ logger: true });
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

// Register plugins
fastify.register(require('@fastify/cookie'));
fastify.register(require('@fastify/secure-session'), {
  cookieName: 'placement_prep_session',
  secret: process.env.SESSION_SECRET || 'a_very_secure_session_secret_key_32_chars_long',
  cookie: {
    path: '/',
    httpOnly: true,
    secure: false, // Set to true if running behind HTTPS in production
    maxAge: 24 * 60 * 60 * 7 // 1 week
  }
});

// Serve frontend static files from the public directory
fastify.register(require('@fastify/static'), {
  root: path.join(__dirname, 'public'),
  prefix: '/', // serve static files at root
});

// Authentication check preHandler hook
fastify.addHook('preHandler', async (request, reply) => {
  const url = request.url;
  // Protect all routes under /api/ except login, logout, and session check
  if (url.startsWith('/api') && !['/api/login', '/api/logout', '/api/session'].includes(url.split('?')[0])) {
    const isAuthed = request.session.get('authenticated');
    if (!isAuthed) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  }
});

// Register modular API routes
fastify.register(require('./routes/auth'), { prefix: '/api' });
fastify.register(require('./routes/companies'), { prefix: '/api' });
fastify.register(require('./routes/notes'), { prefix: '/api' });
fastify.register(require('./routes/files'), { prefix: '/api' });
fastify.register(require('./routes/agent'), { prefix: '/api' });
const { emailRoutes } = require('./routes/emails');
fastify.register(emailRoutes, { prefix: '/api' });
fastify.register(require('./routes/search'), { prefix: '/api' });

// Fallback to index.html for frontend routing (Single Page App routing support)
fastify.setNotFoundHandler(async (request, reply) => {
  // If request is for an API route, return 404
  if (request.url.startsWith('/api')) {
    return reply.code(404).send({ error: 'Endpoint not found' });
  }
  // Otherwise serve index.html for SPA routing
  return reply.sendFile('index.html');
});

// Initialize scheduler
const { initScheduler } = require('./cron');
initScheduler();

// Start the server
const start = async () => {
  try {
    const port = parseInt(process.env.PORT, 10) || 3000;
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`[Server] Placement Prep Platform running at http://localhost:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
