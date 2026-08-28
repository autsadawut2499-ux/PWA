require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { S3Client, PutObjectCommand, GetObjectCommand, HeadBucketCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY
  }
});
const bucketName = process.env.S3_BUCKET_NAME;
const publicUrlBase = process.env.S3_PUBLIC_URL;

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      position TEXT NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      project TEXT,
      is_admin BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS daily_reports (
      id SERIAL PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
      date TEXT,
      foreman TEXT,
      project TEXT,
      work TEXT,
      plan TEXT,
      weather TEXT,
      issue TEXT,
      mp JSONB DEFAULT '[]',
      materials JSONB DEFAULT '[]',
      images JSONB DEFAULT '[]',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS files (
      id SERIAL PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
      original_name TEXT,
      s3_key TEXT,
      content_type TEXT,
      category_id TEXT,
      url TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS user_data (
      user_id TEXT NOT NULL,
      data_key TEXT NOT NULL,
      data JSONB DEFAULT '{}',
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (user_id, data_key)
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id SERIAL PRIMARY KEY,
      user_id TEXT,
      action TEXT,
      entity TEXT,
      entity_id TEXT,
      details JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

async function checkS3() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucketName }));
    return true;
  } catch (err) {
    console.error('S3 bucket check failed:', err.message);
    return false;
  }
}

async function logAction({ userId, action, entity, entityId, details }) {
  try {
    await pool.query(
      'INSERT INTO activity_logs (user_id, action, entity, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
      [userId, action, entity, entityId, details ? JSON.stringify(details) : null]
    );
  } catch (err) {
    console.error('logAction error:', err.message);
  }
}

app.get('/api/health', async (req, res) => {
  try {
    const db = await pool.query('SELECT NOW() AS now');
    const s3ok = await checkS3();
    res.json({ status: 'ok', db: db.rows[0].now, s3: s3ok });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

app.post('/api/sync/:userId', async (req, res) => {
  try {
    const { key, data, action } = req.body;
    const userId = req.params.userId;
    await pool.query(
      'INSERT INTO user_data (user_id, data_key, data, updated_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT (user_id, data_key) DO UPDATE SET data = $3, updated_at = NOW()',
      [userId, key, JSON.stringify(data)]
    );
    await logAction({
      userId,
      action: action || 'sync',
      entity: key,
      entityId: userId + ':' + key,
      details: { size: JSON.stringify(data).length }
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sync/:userId', async (req, res) => {
  try {
    const { key } = req.query;
    const userId = req.params.userId;
    if (key) {
      const result = await pool.query('SELECT data FROM user_data WHERE user_id = $1 AND data_key = $2', [userId, key]);
      res.json({ data: result.rows.length ? result.rows[0].data : null });
    } else {
      const result = await pool.query('SELECT data_key, data FROM user_data WHERE user_id = $1', [userId]);
      const all = {};
      result.rows.forEach((row) => { all[row.data_key] = row.data; });
      res.json({ data: all });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/history/:userId', async (req, res) => {
  try {
    const { limit = 200 } = req.query;
    const result = await pool.query(
      'SELECT * FROM activity_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [req.params.userId, Number(limit)]
    );
    res.json({ logs: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/history', async (req, res) => {
  try {
    const { limit = 500 } = req.query;
    const result = await pool.query(
      'SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT $1',
      [Number(limit)]
    );
    res.json({ logs: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/register', async (req, res) => {
  try {
    const { firstName, lastName, position, phone, project, isAdmin } = req.body;
    const id = 'u_' + phone.replace(/\D/g, '') + '_' + Date.now().toString(36).slice(-4);
    const result = await pool.query(
      `INSERT INTO users (id, first_name, last_name, position, phone, project, is_admin)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [id, firstName, lastName, position, phone, project || '', isAdmin || false]
    );
    res.json({ user: result.rows[0] });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { phone } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json({ user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reports/:userId', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM daily_reports WHERE user_id = $1 ORDER BY id DESC',
      [req.params.userId]
    );
    res.json({ reports: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/reports/:userId', async (req, res) => {
  try {
    const { date, foreman, project, work, plan, weather, issue, mp, materials, images } = req.body;
    const result = await pool.query(
      `INSERT INTO daily_reports (user_id, date, foreman, project, work, plan, weather, issue, mp, materials, images)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [req.params.userId, date, foreman, project, work, plan, weather, issue, JSON.stringify(mp || []), JSON.stringify(materials || []), JSON.stringify(images || [])]
    );
    res.json({ report: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/upload/:userId', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const ext = path.extname(req.file.originalname);
    const key = `${req.params.userId}/${crypto.randomUUID()}${ext}`;
    await s3.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype
    }));
    const url = `${publicUrlBase}/${key}`;
    const result = await pool.query(
      'INSERT INTO files (user_id, original_name, s3_key, content_type, category_id, url) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [req.params.userId, req.file.originalname, key, req.file.mimetype, req.body.categoryId || null, url]
    );
    res.json({ file: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/files/:userId', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM files WHERE user_id = $1 ORDER BY id DESC', [req.params.userId]);
    res.json({ files: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 8081;

module.exports = app;

if (require.main === module) {
  initDb().then(() => {
    app.listen(PORT, () => {
      console.log(`WD Construction API running on http://localhost:${PORT}`);
    });
  }).catch((err) => {
    console.error('DB init failed:', err);
    process.exit(1);
  });
} else {
  initDb().catch((err) => {
    console.error('DB init failed (serverless):', err);
  });
}