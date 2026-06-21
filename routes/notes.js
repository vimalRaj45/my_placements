const db = require('../db');

async function noteRoutes(fastify, options) {
  // GET all notes, optionally filtered by company_id and/or round_id
  fastify.get('/notes', async (request, reply) => {
    const { company_id, round_id } = request.query;
    try {
      let queryText = `
        SELECT n.*, c.name as company_name, r.round_name 
        FROM notes n
        LEFT JOIN companies c ON n.company_id = c.id
        LEFT JOIN rounds r ON n.round_id = r.id
      `;
      const conditions = [];
      const params = [];
      let paramIndex = 1;

      if (company_id !== undefined) {
        if (company_id === 'null' || company_id === '') {
          conditions.push(`n.company_id IS NULL`);
        } else {
          conditions.push(`n.company_id = $${paramIndex}`);
          params.push(company_id);
          paramIndex++;
        }
      }

      if (round_id !== undefined) {
        if (round_id === 'null' || round_id === '') {
          conditions.push(`n.round_id IS NULL`);
        } else {
          conditions.push(`n.round_id = $${paramIndex}`);
          params.push(round_id);
          paramIndex++;
        }
      }

      if (conditions.length > 0) {
        queryText += ' WHERE ' + conditions.join(' AND ');
      }

      queryText += ' ORDER BY n.updated_at DESC';

      const res = await db.query(queryText, params);
      return res.rows;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Failed to retrieve notes' });
    }
  });

  // POST create a new note
  fastify.post('/notes', async (request, reply) => {
    const { title, content, company_id, round_id } = request.body || {};
    if (!content) {
      return reply.code(400).send({ error: 'Note content is required' });
    }

    try {
      const queryText = `
        INSERT INTO notes (title, content, company_id, round_id)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `;
      const params = [
        title || null,
        content,
        company_id || null,
        round_id || null
      ];

      const res = await db.query(queryText, params);
      return res.rows[0];
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Failed to create note' });
    }
  });

  // PATCH update an existing note
  fastify.patch('/notes/:id', async (request, reply) => {
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
        if (['title', 'content', 'company_id', 'round_id'].includes(key)) {
          fields.push(`${key} = $${paramIndex}`);
          params.push(value);
          paramIndex++;
        }
      }

      if (fields.length === 0) {
        return reply.code(400).send({ error: 'No valid update columns provided' });
      }

      fields.push(`updated_at = now()`);

      params.push(id);
      const queryText = `
        UPDATE notes
        SET ${fields.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING *
      `;

      const res = await db.query(queryText, params);
      if (res.rows.length === 0) {
        return reply.code(404).send({ error: 'Note not found' });
      }

      return res.rows[0];
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Failed to update note' });
    }
  });

  // DELETE a note
  fastify.delete('/notes/:id', async (request, reply) => {
    const { id } = request.params;
    try {
      const res = await db.query('DELETE FROM notes WHERE id = $1 RETURNING *', [id]);
      if (res.rows.length === 0) {
        return reply.code(404).send({ error: 'Note not found' });
      }
      return { success: true, message: 'Note deleted successfully' };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Failed to delete note' });
    }
  });
}

module.exports = noteRoutes;
