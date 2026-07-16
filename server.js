require('dotenv').config();
const path = require('path');
const express = require('express');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const db = require('./db');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1); // Vercel corre detrás de un proxy
app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: '10mb' })); // datasets del Excel parseados en el navegador

app.use(
  cookieSession({
    name: 'bajas_sesion',
    secret: process.env.SESSION_SECRET || 'secreto-de-desarrollo',
    maxAge: 8 * 60 * 60 * 1000, // 8 horas
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  })
);

// Garantiza tablas + admin inicial antes de atender cualquier ruta
app.use(async (req, res, next) => {
  try {
    await db.listo();
    next();
  } catch (err) {
    next(err);
  }
});

function requiereLogin(req, res, next) {
  if (req.session && req.session.usuario) return next();
  res.redirect('/login');
}

function requiereAdmin(req, res, next) {
  if (req.session && req.session.usuario && req.session.esAdmin) return next();
  res.status(403).send('Acceso solo para administradores. <a href="/">Volver</a>');
}

/* ---------- login / logout ---------- */

app.get('/login', (req, res) => {
  if (req.session && req.session.usuario) return res.redirect('/');
  res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
  const usuario = (req.body.usuario || '').trim();
  const password = req.body.password || '';
  const u = usuario ? await db.buscarUsuario(usuario) : null;
  if (!u || !bcrypt.compareSync(password, u.password_hash)) {
    return res.status(401).render('login', { error: 'Usuario o contraseña incorrectos.' });
  }
  req.session.usuario = u.usuario;
  req.session.esAdmin = u.es_admin;
  res.redirect('/');
});

app.post('/logout', (req, res) => {
  req.session = null;
  res.redirect('/login');
});

/* ---------- panel (bajas / headcount vs MTP / altas) ---------- */

app.get('/', requiereLogin, (req, res) => {
  res.render('panel', {
    usuario: req.session.usuario,
    esAdmin: req.session.esAdmin,
  });
});

/* ---------- datos de los Excel (persistidos en la base) ---------- */

// El panel parsea el Excel en el navegador y guarda/lee el JSON acá
const DATASETS_VALIDOS = ['bajas-dataset', 'mtp-dataset', 'altas-dataset'];

function claveValida(req, res, next) {
  if (DATASETS_VALIDOS.includes(req.params.clave)) return next();
  res.status(404).json({ error: 'Dataset desconocido' });
}

// Cualquier usuario logueado puede leer los datos
app.get('/api/datos/:clave', requiereLogin, claveValida, async (req, res) => {
  const fila = await db.getDataset(req.params.clave);
  res.json({ value: fila ? JSON.stringify(fila.valor) : null });
});

// Solo administradores pueden reemplazar los datos
app.put('/api/datos/:clave', requiereAdmin, claveValida, async (req, res) => {
  let parsed;
  try {
    parsed = JSON.parse(req.body.value);
  } catch (_) {
    return res.status(400).json({ error: 'El cuerpo debe traer "value" con JSON válido.' });
  }
  if (!parsed || !Array.isArray(parsed.records) || !parsed.records.length) {
    return res.status(400).json({ error: 'El dataset debe tener registros.' });
  }
  await db.setDataset(req.params.clave, parsed);
  res.json({ ok: true });
});

/* ---------- administración ---------- */

// Link público a mostrar en /admin: primero PUBLIC_URL del .env, después el
// dominio de producción que expone Vercel, y si no, el host de la request.
function urlPublica(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return `${req.protocol}://${req.get('host')}`;
}

const DATASET_LABELS = {
  'bajas-dataset': 'Bajas de personal',
  'mtp-dataset': 'Headcount vs MTP',
  'altas-dataset': 'Altas de personal',
};

app.get('/admin', requiereAdmin, async (req, res) => {
  const [usuarios, ...filas] = await Promise.all([
    db.listarUsuarios(),
    ...DATASETS_VALIDOS.map((c) => db.getDataset(c)),
  ]);
  const datasets = DATASETS_VALIDOS.map((clave, i) => ({
    clave,
    label: DATASET_LABELS[clave],
    fila: filas[i], // null si nunca se subió un Excel (se usan los datos embebidos)
  }));
  res.render('admin', {
    usuarios,
    datasets,
    usuario: req.session.usuario,
    mensaje: req.query.ok || null,
    error: req.query.error || null,
    urlPublica: urlPublica(req),
  });
});

app.post('/admin/usuarios', requiereAdmin, async (req, res) => {
  const usuario = (req.body.usuario || '').trim();
  const password = req.body.password || '';
  if (!usuario || password.length < 6) {
    return res.redirect('/admin?error=' + encodeURIComponent('Usuario requerido y contraseña de al menos 6 caracteres.'));
  }
  try {
    await db.crearUsuario(usuario, password, req.body.es_admin === 'on');
    res.redirect('/admin?ok=' + encodeURIComponent(`Usuario "${usuario}" creado.`));
  } catch (err) {
    const msg = err.code === '23505' ? 'Ese usuario ya existe.' : 'No se pudo crear el usuario.';
    res.redirect('/admin?error=' + encodeURIComponent(msg));
  }
});

app.post('/admin/usuarios/:id/password', requiereAdmin, async (req, res) => {
  const password = req.body.password || '';
  if (password.length < 6) {
    return res.redirect('/admin?error=' + encodeURIComponent('La contraseña debe tener al menos 6 caracteres.'));
  }
  await db.cambiarPassword(req.params.id, password);
  res.redirect('/admin?ok=' + encodeURIComponent('Contraseña actualizada.'));
});

app.post('/admin/usuarios/:id/eliminar', requiereAdmin, async (req, res) => {
  const usuarios = await db.listarUsuarios();
  const objetivo = usuarios.find((u) => String(u.id) === req.params.id);
  if (objetivo && objetivo.usuario === req.session.usuario) {
    return res.redirect('/admin?error=' + encodeURIComponent('No podés eliminar tu propio usuario.'));
  }
  await db.eliminarUsuario(req.params.id);
  res.redirect('/admin?ok=' + encodeURIComponent('Usuario eliminado.'));
});

/* ---------- errores ---------- */

app.use((err, req, res, next) => {
  console.error(err);
  // Pista de diagnóstico: indica si la variable existe, sin revelar su valor
  const pista = process.env.DATABASE_URL
    ? `DATABASE_URL está definida — error real: ${err.code || err.message}`
    : 'DATABASE_URL NO está definida en este entorno: cargala en Vercel (Production y Preview) y hacé Redeploy.';
  res.status(500).send(`Error del servidor. Revisá la conexión a la base de datos.<br><small>${pista}</small>`);
});

// En Vercel se exporta la app; en local se levanta el servidor
if (require.main === module) {
  const puerto = process.env.PORT || 3000;
  app.listen(puerto, () => console.log(`Dashboard corriendo en http://localhost:${puerto}`));
}

module.exports = app;
