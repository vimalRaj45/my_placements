const db = require('../db');

async function searchRoutes(fastify, options) {
  // GET /api/search
  fastify.get('/search', async (request, reply) => {
    const { q } = request.query || {};
    if (!q || !q.trim()) {
      return { companies: [], notes: [], files: [], emails: [] };
    }

    const queryToken = `%${q.trim()}%`;

    try {
      // 1. Search companies (applications)
      const companiesRes = await db.query(
        `SELECT id, name, role, status, location, package FROM companies 
         WHERE name ILIKE $1 OR role ILIKE $1 OR location ILIKE $1 OR package ILIKE $1
         ORDER BY updated_at DESC LIMIT 10`,
        [queryToken]
      );

      // 2. Search notes
      const notesRes = await db.query(
        `SELECT id, title, content, company_id FROM notes 
         WHERE title ILIKE $1 OR content ILIKE $1
         ORDER BY updated_at DESC LIMIT 10`,
        [queryToken]
      );

      // 3. Search files
      const filesRes = await db.query(
        `SELECT f.id, f.label, f.type, f.folder, f.is_shared, c.name as company_name 
         FROM files f
         LEFT JOIN companies c ON f.company_id = c.id
         WHERE f.label ILIKE $1 OR f.folder ILIKE $1 OR f.type ILIKE $1
         ORDER BY f.created_at DESC LIMIT 10`,
        [queryToken]
      );

      // 4. Search emails
      const emailsRes = await db.query(
        `SELECT id, sender, subject, snippet, received_at FROM emails 
         WHERE sender ILIKE $1 OR subject ILIKE $1 OR snippet ILIKE $1
         ORDER BY received_at DESC LIMIT 10`,
        [queryToken]
      );

      return {
        companies: companiesRes.rows,
        notes: notesRes.rows,
        files: filesRes.rows,
        emails: emailsRes.rows
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Search query failed' });
    }
  });
}

module.exports = searchRoutes;
