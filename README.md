# Dashboard de Bajas de Personal

Dashboard de desvinculaciones (RRHH · Argentina) que lee los datos en vivo de una hoja de Google Sheets, ahora servido con **Express + EJS**, con **inicio de sesión real** (usuarios guardados en **Neon Postgres**) y un **panel de administración** para gestionar usuarios y la hoja de datos. Listo para deployar en **Vercel**.

---

## Qué se hizo

1. **`.gitignore`** — excluye `node_modules/`, `.env` (los secretos nunca se suben al repo) y archivos de Vercel.
2. **Servidor Express + EJS** (`server.js`) — renderiza el dashboard en `views/dashboard.ejs`. Se levanta local con `npm start`.
3. **`.env`** — toda la configuración sale de variables de entorno (`DATABASE_URL`, `SESSION_SECRET`, etc.). Hay un `.env.example` de plantilla.
4. **Conexión a Neon Postgres** (`db.js`) — al arrancar crea solas las tablas `usuarios` y `config`, y si no hay ningún usuario crea el admin inicial con `ADMIN_USER` / `ADMIN_PASSWORD` del `.env`.
5. **Inicio de sesión real** — se eliminó el login falso que estaba en el HTML (era un hash en el navegador, se podía saltar). Ahora el login es del lado del servidor: contraseñas hasheadas con bcrypt, sesión en cookie firmada que dura 8 horas, y **nadie ve el dashboard sin loguearse**.
6. **Panel de administración** (`/admin`) — para cambiar la hoja de datos y gestionar usuarios (ver la sección de abajo).
7. **Configuración de Vercel** (`vercel.json` + `api/index.js`) — la app corre como función serverless.

### Estructura

```
├── server.js            # rutas: login, dashboard, admin
├── db.js                # conexión a Neon + tablas + consultas
├── api/index.js         # entrada para Vercel (serverless)
├── vercel.json          # rewrite: todo va a la función
├── views/
│   ├── login.ejs        # pantalla de ingreso
│   ├── dashboard.ejs    # el dashboard (protegido por login)
│   └── admin.ejs        # panel de administración
├── .env                 # secretos (NO se sube al repo)
├── .env.example         # plantilla del .env
└── .gitignore
```

---

## Correr local

```bash
npm install
npm start
# → http://localhost:3000
```

Usuario inicial: el que está en `.env` (`ADMIN_USER` / `ADMIN_PASSWORD`, por defecto `admin` / `admin1234`). **Cambiale la contraseña desde `/admin` después del primer ingreso.**

---

## Deploy en Vercel

1. Subir el repo a GitHub:
   ```bash
   git remote add origin https://github.com/TU-USUARIO/TU-REPO.git
   git push -u origin main
   ```
2. En [vercel.com](https://vercel.com) → **Add New → Project** → importar el repo. No hace falta tocar nada del build (detecta `vercel.json` solo).
3. En **Settings → Environment Variables** cargar las mismas variables del `.env`:
   - `DATABASE_URL` — el string de conexión de Neon
   - `SESSION_SECRET` — un string largo aleatorio
   - `ADMIN_USER` y `ADMIN_PASSWORD` — el admin inicial
   - `SHEET_ID` — la hoja por defecto
4. **Deploy**. Vercel te da la URL pública (ej. `https://tu-proyecto.vercel.app`).

---

## Gestión del dashboard (lo importante del día a día)

### 🔗 Link público
La URL que da Vercel **se puede compartir con cualquiera**: al abrirla pide usuario y contraseña, así que aunque el link sea público, los datos solo los ve quien tenga una cuenta. El link exacto también aparece arriba de todo en `/admin`.

### 📄 Hoja de datos
El dashboard lee un Google Sheet. Para apuntar a otra hoja (o a la misma si cambia):

1. Entrar como admin → botón **Administración** (arriba a la derecha) o directo a `/admin`.
2. En **Hoja de datos**, pegar la **URL completa** del Sheet o solo su ID → **Guardar hoja**.
3. Listo, el cambio es inmediato para todos (queda guardado en la base, no hace falta re-deployar).

> Requisito: la hoja tiene que estar compartida como **"Cualquier persona con el enlace: Lector"** para que se pueda leer el CSV. Si el Sheet no responde, el dashboard muestra la copia de respaldo embebida.

### 👤 Usuarios
Todo desde `/admin` (solo administradores):

- **Crear usuario**: nombre + contraseña (mínimo 6 caracteres). Si marcás *"Es administrador"* también puede entrar a `/admin`; si no, solo ve el dashboard.
- **Cambiar contraseña**: escribir la nueva al lado del usuario → **Cambiar**.
- **Eliminar usuario**: botón **Eliminar** (no podés eliminarte a vos mismo). La sesión que tuviera abierta expira sola a las 8 horas como máximo.

Roles, en resumen:

| Rol | Ve el dashboard | Entra a /admin |
|---|---|---|
| Visor | ✅ | ❌ |
| Admin | ✅ | ✅ |

---

## Seguridad

- Las contraseñas se guardan **hasheadas con bcrypt** (nunca en texto plano).
- Los secretos viven en `.env` / variables de Vercel, **fuera del repo**.
- ⚠️ El string de conexión de la base se pasó por chat: es buena idea **rotar la contraseña en Neon** (Dashboard de Neon → Roles → Reset password) y actualizar `DATABASE_URL` en `.env` y en Vercel.
