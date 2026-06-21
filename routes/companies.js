const db = require('../db');

async function companyRoutes(fastify, options) {
  // GET all companies, optionally filtered by status
  fastify.get('/companies', async (request, reply) => {
    const { status } = request.query;
    try {
      let queryText = 'SELECT * FROM companies';
      const params = [];
      
      if (status) {
        queryText += ' WHERE status = $1';
        params.push(status);
      }
      
      queryText += ' ORDER BY updated_at DESC';
      const res = await db.query(queryText, params);
      return res.rows;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Failed to retrieve companies' });
    }
  });

  // POST create a new company
  fastify.post('/companies', async (request, reply) => {
    const { name, role, status, applied_date, package, location } = request.body || {};
    if (!name) {
      return reply.code(400).send({ error: 'Company name is required' });
    }

    try {
      const queryText = `
        INSERT INTO companies (name, role, status, applied_date, package, location)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `;
      const params = [
        name,
        role || null,
        status || 'applied',
        applied_date || null,
        package || null,
        location || null
      ];

      const res = await db.query(queryText, params);
      return res.rows[0];
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Failed to create company' });
    }
  });

  // PATCH update an existing company (useful for Kanban drag updates and normal edits)
  fastify.patch('/companies/:id', async (request, reply) => {
    const { id } = request.params;
    const updates = request.body || {};

    if (Object.keys(updates).length === 0) {
      return reply.code(400).send({ error: 'No update data provided' });
    }

    try {
      // Build update query dynamically
      const fields = [];
      const params = [];
      let paramIndex = 1;

      for (const [key, value] of Object.entries(updates)) {
        // Only allow updating valid columns
        if (['name', 'role', 'status', 'applied_date', 'package', 'location'].includes(key)) {
          fields.push(`${key} = $${paramIndex}`);
          params.push(value);
          paramIndex++;
        }
      }

      if (fields.length === 0) {
        return reply.code(400).send({ error: 'No valid update columns provided' });
      }

      // Add updated_at
      fields.push(`updated_at = now()`);

      params.push(id);
      const queryText = `
        UPDATE companies
        SET ${fields.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING *
      `;

      const res = await db.query(queryText, params);
      if (res.rows.length === 0) {
        return reply.code(404).send({ error: 'Company not found' });
      }

      return res.rows[0];
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Failed to update company' });
    }
  });

  // DELETE a company (cascades to rounds)
  fastify.delete('/companies/:id', async (request, reply) => {
    const { id } = request.params;
    try {
      const res = await db.query('DELETE FROM companies WHERE id = $1 RETURNING *', [id]);
      if (res.rows.length === 0) {
        return reply.code(404).send({ error: 'Company not found' });
      }
      return { success: true, message: 'Company deleted successfully' };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Failed to delete company' });
    }
  });

  // GET rounds for a specific company
  fastify.get('/companies/:id/rounds', async (request, reply) => {
    const { id } = request.params;
    try {
      const res = await db.query(
        'SELECT * FROM rounds WHERE company_id = $1 ORDER BY scheduled_date ASC, created_at ASC',
        [id]
      );
      return res.rows;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Failed to retrieve rounds' });
    }
  });

  // POST create a new round for a company
  fastify.post('/companies/:id/rounds', async (request, reply) => {
    const { id } = request.params;
    const { round_name, scheduled_date, result, feedback } = request.body || {};

    if (!round_name) {
      return reply.code(400).send({ error: 'Round name is required' });
    }

    try {
      const queryText = `
        INSERT INTO rounds (company_id, round_name, scheduled_date, result, feedback)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `;
      const params = [
        id,
        round_name,
        scheduled_date || null,
        result || 'pending',
        feedback || null
      ];

      const res = await db.query(queryText, params);
      return res.rows[0];
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Failed to create round' });
    }
  });

  // PATCH update an existing round
  fastify.patch('/rounds/:id', async (request, reply) => {
    const { id } = request.params;
    const updates = request.body || {};

    if (Object.keys(updates).length === 0) {
      return reply.code(400).send({ error: 'No update data provided' });
    }

    try {
      const fields = [];
      const params = [];
      let paramIndex = 1;

      for (const [key, value] of Object.entries(updates)) {
        if (['round_name', 'scheduled_date', 'result', 'feedback', 'reminder_sent'].includes(key)) {
          fields.push(`${key} = $${paramIndex}`);
          params.push(value);
          paramIndex++;
        }
      }

      if (fields.length === 0) {
        return reply.code(400).send({ error: 'No valid update columns provided' });
      }

      params.push(id);
      const queryText = `
        UPDATE rounds
        SET ${fields.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING *
      `;

      const res = await db.query(queryText, params);
      if (res.rows.length === 0) {
        return reply.code(404).send({ error: 'Round not found' });
      }

      return res.rows[0];
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Failed to update round' });
    }
  });

  // DELETE an individual round
  fastify.delete('/rounds/:id', async (request, reply) => {
    const { id } = request.params;
    try {
      const res = await db.query('DELETE FROM rounds WHERE id = $1 RETURNING *', [id]);
      if (res.rows.length === 0) {
        return reply.code(404).send({ error: 'Round not found' });
      }
      return { success: true, message: 'Round deleted successfully' };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Failed to delete round' });
    }
  });
}

module.exports = companyRoutes;
