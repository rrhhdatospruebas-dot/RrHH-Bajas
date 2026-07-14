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

/* ---------- dashboard ---------- */

app.get('/', requiereLogin, async (req, res) => {
  const sheetId = await db.getConfig('sheet_id', process.env.SHEET_ID || '');
  res.render('dashboard', {
    sheetId,
    usuario: req.session.usuario,
    esAdmin: req.session.esAdmin,
  });
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

app.get('/admin', requiereAdmin, async (req, res) => {
  const [sheetId, usuarios] = await Promise.all([
    db.getConfig('sheet_id', process.env.SHEET_ID || ''),
    db.listarUsuarios(),
  ]);
  res.render('admin', {
    sheetId,
    usuarios,
    usuario: req.session.usuario,
    mensaje: req.query.ok || null,
    error: req.query.error || null,
    urlPublica: urlPublica(req),
  });
});

// Cambiar la hoja de datos: acepta el ID o la URL completa del Sheet
app.post('/admin/hoja', requiereAdmin, async (req, res) => {
  const entrada = (req.body.sheet || '').trim();
  const m = entrada.match(/\/d\/([a-zA-Z0-9_-]+)/);
  const id = m ? m[1] : entrada;
  if (!id) return res.redirect('/admin?error=' + encodeURIComponent('Ingresá el ID o la URL de la hoja.'));
  await db.setConfig('sheet_id', id);
  res.redirect('/admin?ok=' + encodeURIComponent('Hoja de datos actualizada.'));
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
