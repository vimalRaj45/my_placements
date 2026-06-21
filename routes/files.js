const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const db = require('../db');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream');
const { promisify } = require('util');
const streamPipeline = promisify(pipeline);


// Initialize S3 client for R2
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

async function fileRoutes(fastify, options) {
  // POST upload-url: create database metadata row and generate signed PUT URL
  fastify.post('/files/upload-url', async (request, reply) => {
    const { filename, mime_type, type, company_id, size_bytes, is_shared, folder } = request.body || {};
    
    if (!filename || !type) {
      return reply.code(400).send({ error: 'Filename and file type are required' });
    }

    const validTypes = ['certificate', 'resume', 'offer_letter', 'resource', 'other'];
    if (!validTypes.includes(type)) {
      return reply.code(400).send({ error: `Invalid file type. Must be one of ${validTypes.join(', ')}` });
    }

    try {
      // Generate a unique key for the file
      const timestamp = Date.now();
      const cleanFilename = filename.replace(/[^a-zA-Z0-9.\-_]/g, '_');
      const r2_key = `uploads/${timestamp}-${cleanFilename}`;

      // Insert record into Neon database with defaults
      const queryText = `
        INSERT INTO files (label, type, company_id, r2_key, mime_type, size_bytes, is_shared, folder)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `;
      const params = [
        filename, // use filename as default label
        type,
        company_id || null,
        r2_key,
        mime_type || null,
        size_bytes || null,
        is_shared || false,
        folder || null
      ];

      const dbRes = await db.query(queryText, params);
      const fileRecord = dbRes.rows[0];

      // Generate signed PUT URL
      let signed_put_url = '';
      try {
        const command = new PutObjectCommand({
          Bucket: r2Bucket,
          Key: r2_key,
          ContentType: mime_type || 'application/octet-stream',
        });
        signed_put_url = await getSignedUrl(s3, command, { expiresIn: 3600 }); // valid for 1 hour
      } catch (s3Err) {
        fastify.log.error('S3/R2 presign error: ', s3Err);
        // Clean up db record on failure to generate url
        await db.query('DELETE FROM files WHERE id = $1', [fileRecord.id]);
        return reply.code(500).send({ error: 'Failed to generate signed upload URL from R2' });
      }

      return {
        signed_put_url,
        file_id: fileRecord.id,
        file: fileRecord
      };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Internal server error while creating file upload' });
    }
  });

  // GET download-url: generate signed GET URL for downloading/viewing a file
  fastify.get('/files/:id/download-url', async (request, reply) => {
    const { id } = request.params;
    try {
      const res = await db.query('SELECT * FROM files WHERE id = $1', [id]);
      if (res.rows.length === 0) {
        return reply.code(404).send({ error: 'File metadata not found' });
      }

      const file = res.rows[0];

      // Generate pre-signed GET URL
      const command = new GetObjectCommand({
        Bucket: r2Bucket,
        Key: file.r2_key,
      });
      const signed_get_url = await getSignedUrl(s3, command, { expiresIn: 900 }); // valid for 15 minutes

      return { signed_get_url, file };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Failed to generate download URL' });
    }
  });

  // GET files list, with optional filtering
  fastify.get('/files', async (request, reply) => {
    const { type, company_id, is_shared } = request.query;
    try {
      let queryText = `
        SELECT f.*, c.name as company_name 
        FROM files f
        LEFT JOIN companies c ON f.company_id = c.id
      `;
      const conditions = [];
      const params = [];
      let paramIndex = 1;

      if (type) {
        conditions.push(`f.type = $${paramIndex}`);
        params.push(type);
        paramIndex++;
      }

      if (company_id !== undefined) {
        if (company_id === 'null' || company_id === '') {
          conditions.push(`f.company_id IS NULL`);
        } else {
          conditions.push(`f.company_id = $${paramIndex}`);
          params.push(company_id);
          paramIndex++;
        }
      }

      if (is_shared !== undefined) {
        conditions.push(`f.is_shared = $${paramIndex}`);
        params.push(is_shared === 'true');
        paramIndex++;
      }

      if (conditions.length > 0) {
        queryText += ' WHERE ' + conditions.join(' AND ');
      }

      queryText += ' ORDER BY f.created_at DESC';

      const res = await db.query(queryText, params);
      return res.rows;
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Failed to retrieve files' });
    }
  });

  // PATCH /api/files/:id: update file metadata (label, type, company_id, is_shared)
  fastify.patch('/files/:id', async (request, reply) => {
    const { id } = request.params;
    const { label, type, company_id, is_shared, folder } = request.body || {};
    try {
      const fields = [];
      const params = [];
      let paramIndex = 1;

      if (label !== undefined) {
        fields.push(`label = $${paramIndex}`);
        params.push(label);
        paramIndex++;
      }
      if (type !== undefined) {
        fields.push(`type = $${paramIndex}`);
        params.push(type);
        paramIndex++;
      }
      if (company_id !== undefined) {
        fields.push(`company_id = $${paramIndex}`);
        params.push(company_id || null);
        paramIndex++;
      }
      if (is_shared !== undefined) {
        fields.push(`is_shared = $${paramIndex}`);
        params.push(is_shared);
        paramIndex++;
      }
      if (folder !== undefined) {
        fields.push(`folder = $${paramIndex}`);
        params.push(folder || null);
        paramIndex++;
      }

      if (fields.length === 0) {
        return reply.code(400).send({ error: 'No update columns provided' });
      }

      params.push(id);
      const queryText = `
        UPDATE files
        SET ${fields.join(', ')}
        WHERE id = $${paramIndex}
        RETURNING *
      `;

      const res = await db.query(queryText, params);
      if (res.rows.length === 0) {
        return reply.code(404).send({ error: 'File not found' });
      }
      return res.rows[0];
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Failed to update file metadata' });
    }
  });

  // DELETE file metadata and delete actual file
  fastify.delete('/files/:id', async (request, reply) => {
    const { id } = request.params;
    try {
      // Get R2 key first
      const res = await db.query('SELECT r2_key FROM files WHERE id = $1', [id]);
      if (res.rows.length === 0) {
        return reply.code(404).send({ error: 'File not found' });
      }

      const r2_key = res.rows[0].r2_key;

      // Delete from R2
      try {
        const command = new DeleteObjectCommand({
          Bucket: r2Bucket,
          Key: r2_key,
        });
        await s3.send(command);
      } catch (s3Err) {
        // Log S3 error but proceed to delete db entry in case it was already deleted manually
        fastify.log.error(`Failed to delete object ${r2_key} from R2:`, s3Err);
      }

      // Delete from database
      await db.query('DELETE FROM files WHERE id = $1', [id]);

      return { success: true, message: 'File deleted successfully' };
    } catch (err) {
      fastify.log.error(err);
      return reply.code(500).send({ error: 'Failed to delete file' });
    }
  });

  // Wildcard content-type parser to allow custom streams
  fastify.addContentTypeParser('*', (req, payload, done) => {
    done(null, payload);
  });
}

module.exports = fileRoutes;
