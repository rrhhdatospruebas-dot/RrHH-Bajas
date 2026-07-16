const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3, // Vercel es serverless: pocas conexiones por instancia
});

let inicializado = null;

// Crea las tablas y el admin inicial una sola vez por instancia
function listo() {
  if (!inicializado) inicializado = init();
  return inicializado;
}

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id            SERIAL PRIMARY KEY,
      usuario       TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      es_admin      BOOLEAN NOT NULL DEFAULT false,
      creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS config (
      clave TEXT PRIMARY KEY,
      valor TEXT NOT NULL
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS datasets (
      clave          TEXT PRIMARY KEY,
      valor          JSONB NOT NULL,
      actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM usuarios');
  if (rows[0].n === 0) {
    const usuario = process.env.ADMIN_USER || 'admin';
    const pass = process.env.ADMIN_PASSWORD || 'admin1234';
    await pool.query(
      'INSERT INTO usuarios (usuario, password_hash, es_admin) VALUES ($1, $2, true)',
      [usuario, bcrypt.hashSync(pass, 10)]
    );
  }

  if (process.env.SHEET_ID) {
    await pool.query(
      `INSERT INTO config (clave, valor) VALUES ('sheet_id', $1) ON CONFLICT (clave) DO NOTHING`,
      [process.env.SHEET_ID]
    );
  }
}

async function getConfig(clave, porDefecto = '') {
  const { rows } = await pool.query('SELECT valor FROM config WHERE clave = $1', [clave]);
  return rows.length ? rows[0].valor : porDefecto;
}

async function setConfig(clave, valor) {
  await pool.query(
    `INSERT INTO config (clave, valor) VALUES ($1, $2)
     ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor`,
    [clave, valor]
  );
}

async function getDataset(clave) {
  const { rows } = await pool.query(
    'SELECT valor, actualizado_en FROM datasets WHERE clave = $1',
    [clave]
  );
  return rows[0] || null;
}

async function setDataset(clave, valor) {
  await pool.query(
    `INSERT INTO datasets (clave, valor, actualizado_en) VALUES ($1, $2, now())
     ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = now()`,
    [clave, valor]
  );
}

async function buscarUsuario(usuario) {
  const { rows } = await pool.query('SELECT * FROM usuarios WHERE usuario = $1', [usuario]);
  return rows[0] || null;
}

async function listarUsuarios() {
  const { rows } = await pool.query(
    'SELECT id, usuario, es_admin, creado_en FROM usuarios ORDER BY usuario'
  );
  return rows;
}

async function crearUsuario(usuario, password, esAdmin) {
  await pool.query(
    'INSERT INTO usuarios (usuario, password_hash, es_admin) VALUES ($1, $2, $3)',
    [usuario, bcrypt.hashSync(password, 10), esAdmin]
  );
}

async function eliminarUsuario(id) {
  await pool.query('DELETE FROM usuarios WHERE id = $1', [id]);
}

async function cambiarPassword(id, password) {
  await pool.query('UPDATE usuarios SET password_hash = $1 WHERE id = $2', [
    bcrypt.hashSync(password, 10),
    id,
  ]);
}

module.exports = {
  pool,
  listo,
  getConfig,
  setConfig,
  getDataset,
  setDataset,
  buscarUsuario,
  listarUsuarios,
  crearUsuario,
  eliminarUsuario,
  cambiarPassword,
};
