const bcrypt = require('bcrypt');
const db = require('../db');

async function authRoutes(fastify, options) {
  // Login route
  fastify.post('/login', async (request, reply) => {
    const { password } = request.body || {};
    if (!password) {
      return reply.code(400).send({ error: 'Password is required' });
    }

    try {
      // Get the hashed password from the database
      const res = await db.query('SELECT password_hash FROM auth LIMIT 1');
      if (res.rows.length === 0) {
        return reply.code(500).send({ error: 'System is not configured. Run migrations.' });
      }

      const passwordHash = res.rows[0].password_hash;
      const isMatch = await bcrypt.compare(password, passwordHash);

      if (isMatch) {
        request.session.set('authenticated', true);
        return { success: true, message: 'Logged in successfully' };
      } else {
        return reply.code(401).send({ error: 'Invalid password' });
      }
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Internal server error during login' });
    }
  });

  // Logout route
  fastify.post('/logout', async (request, reply) => {
    request.session.delete();
    return { success: true, message: 'Logged out successfully' };
  });

  // Session check route
  fastify.get('/session', async (request, reply) => {
    const isAuthenticated = request.session.get('authenticated') || false;
    return { authenticated: isAuthenticated };
  });
}

module.exports = authRoutes;
