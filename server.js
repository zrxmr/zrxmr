const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// ── BASE DE DATOS ──
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// ── INIT TABLA ──
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS posts (
      id        SERIAL PRIMARY KEY,
      target    TEXT NOT NULL,
      category  TEXT,
      content   TEXT NOT NULL,
      author    TEXT DEFAULT 'Anonimo',
      image_url TEXT,
      likes     INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('✅ Base de datos lista');
}

// ── STORAGE DE IMÁGENES ──
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename:    (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
    cb(null, unique + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB máximo
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const ok = allowed.test(path.extname(file.originalname).toLowerCase())
             && allowed.test(file.mimetype);
    ok ? cb(null, true) : cb(new Error('Solo se permiten imágenes (jpg, png, gif, webp)'));
  },
});

// ── MIDDLEWARES ──
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());
app.use('/uploads', express.static(uploadsDir));

// ── RUTAS ──

// GET /posts — listar todos
app.get('/posts', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM posts ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener posts' });
  }
});

// POST /posts — crear post (con imagen opcional)
app.post('/posts', upload.single('image'), async (req, res) => {
  try {
    const { target, category, content, author } = req.body;
    if (!target || !content) {
      return res.status(400).json({ error: 'target y content son requeridos' });
    }

    let image_url = null;
    if (req.file) {
      // URL pública de la imagen
      const base = process.env.BASE_URL || `http://localhost:${PORT}`;
      image_url = `${base}/uploads/${req.file.filename}`;
    }

    const { rows } = await pool.query(
      `INSERT INTO posts (target, category, content, author, image_url)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [target, category || null, content, author || 'Anonimo', image_url]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear post' });
  }
});

// POST /posts/:id/like — dar like
app.post('/posts/:id/like', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'UPDATE posts SET likes = likes + 1 WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Post no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al dar like' });
  }
});

// DELETE /posts/:id — eliminar post (también borra imagen)
app.delete('/posts/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM posts WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Post no encontrado' });

    // Borrar imagen del disco si existe
    if (rows[0].image_url) {
      const filename = path.basename(rows[0].image_url);
      const filepath = path.join(uploadsDir, filename);
      if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar post' });
  }
});

// ── HEALTH CHECK ──
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ── START ──
initDB()
  .then(() => {
    app.listen(PORT, () => console.log(`🔥 Quemaduras corriendo en puerto ${PORT}`));
  })
  .catch((err) => {
    console.error('❌ ERROR al inicializar la base de datos:', err.message);
    process.exit(1);
  });
