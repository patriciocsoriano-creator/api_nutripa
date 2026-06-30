// backend/routes/login.js - OPTIMIZADO PARA ALTA CONCURRENCIA (HOSPITAL)
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { getPool } = require('../conexion');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const SECRET = process.env.JWT_SECRET || 'dev_secret_change_in_prod_2026';

//  Hash token
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// 📌 Registro de acceso (NO bloqueante)
async function registrarAcceso(pool, data) {
  try {
    await pool.query(
      `INSERT INTO historial_acceso 
       (id, usuario_id, correo_intentado, ip_address, user_agent, exito, motivo_fallo)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        data.usuario_id || null,
        data.correo_intentado || null,
        data.ip_address,
        data.user_agent,
        data.exito ? 1 : 0,
        data.motivo_fallo || null
      ]
    );
  } catch (_) {
    // silencioso para no afectar login
  }
}

//  Guardar sesión (NO bloqueante)
async function guardarSesion(pool, data) {
  try {
    await pool.query(
      `INSERT INTO sesion 
       (id, usuario_id, token_hash, refresh_token_hash, ip_address, user_agent, fecha_expiracion)
       VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 8 HOUR))`,
      [
        uuidv4(),
        data.usuario_id,
        data.token_hash,
        data.refresh_token_hash,
        data.ip_address,
        data.user_agent
      ]
    );
  } catch (_) {}
}

// ==========================
//  LOGIN PRINCIPAL
// ==========================
router.post('/', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      error: true,
      mensaje: 'Email y contraseña son requeridos'
    });
  }

  const pool = getPool();
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const userAgent = req.get('user-agent') || '';

  try {
    // ⚡ QUERY OPTIMIZADA (sin JOIN)
    const [rows] = await pool.query(
      `SELECT id, correo, password_hash, nombre, apellido, rol_id, activo
       FROM usuarios
       WHERE correo = ?
         AND eliminado_en IS NULL
       LIMIT 1`,
      [email.toLowerCase().trim()]
    );

    if (rows.length === 0) {
      await registrarAcceso(pool, {
        correo_intentado: email,
        ip_address: ip,
        user_agent: userAgent,
        exito: false,
        motivo_fallo: 'credenciales_invalidas'
      });

      return res.status(401).json({
        error: true,
        mensaje: 'Credenciales inválidas'
      });
    }

    const usuario = rows[0];

    //  bcrypt (CPU costoso, pero necesario)
    const passwordOk = await bcrypt.compare(password, usuario.password_hash);

    if (!passwordOk) {
      await registrarAcceso(pool, {
        usuario_id: usuario.id,
        ip_address: ip,
        user_agent: userAgent,
        exito: false,
        motivo_fallo: 'credenciales_invalidas'
      });

      return res.status(401).json({
        error: true,
        mensaje: 'Credenciales inválidas'
      });
    }

    if (!usuario.activo) {
      return res.status(403).json({
        error: true,
        mensaje: 'Usuario inactivo'
      });
    }

    //  traer rol SOLO cuando ya autenticó (reduce carga DB)
    const [rolRow] = await pool.query(
      `SELECT nombre FROM roles WHERE id = ? LIMIT 1`,
      [usuario.rol_id]
    );

    const rol = rolRow[0]?.nombre || 'desconocido';

    //  log éxito (fire and forget)
    registrarAcceso(pool, {
      usuario_id: usuario.id,
      ip_address: ip,
      user_agent: userAgent,
      exito: true
    });

    //  JWT Access Token
    const token = jwt.sign(
      {
        usuario_id: usuario.id,
        rol,
        correo: usuario.correo
      },
      SECRET,
      { expiresIn: '8h' }
    );

    //  Refresh Token
    const refreshToken = jwt.sign(
      {
        usuario_id: usuario.id,
        type: 'refresh'
      },
      SECRET + '_refresh_secret',
      { expiresIn: '7d' }
    );

    //  guardar sesión async (no bloquea respuesta)
    guardarSesion(pool, {
      usuario_id: usuario.id,
      token_hash: hashToken(token),
      refresh_token_hash: hashToken(refreshToken),
      ip_address: ip,
      user_agent: userAgent
    });

    //  RESPUESTA FINAL
    return res.json({
      error: false,
      mensaje: 'Login exitoso',
      token,
      refreshToken,
      expiresIn: 8 * 60 * 60,
      usuario: {
        id: usuario.id,
        correo: usuario.correo,
        nombre: usuario.nombre,
        apellido: usuario.apellido,
        rol
      }
    });

  } catch (err) {
    console.error('[LOGIN ERROR]', err.message);

    return res.status(500).json({
      error: true,
      mensaje: 'Error interno del servidor'
    });
  }
});

// ==========================
//  REFRESH TOKEN OPTIMIZADO
// ==========================
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({
      error: true,
      mensaje: 'Refresh token requerido'
    });
  }

  const pool = getPool();

  try {
    const decoded = jwt.verify(refreshToken, SECRET + '_refresh_secret');

    const [sesiones] = await pool.query(
      `SELECT id FROM sesion
       WHERE usuario_id = ?
         AND refresh_token_hash = ?
         AND activa = 1
         AND fecha_expiracion > NOW()
       LIMIT 1`,
      [decoded.usuario_id, hashToken(refreshToken)]
    );

    if (sesiones.length === 0) {
      return res.status(401).json({
        error: true,
        mensaje: 'Refresh token inválido o expirado'
      });
    }

    const [user] = await pool.query(
      `SELECT u.id, u.correo, r.nombre as rol_nombre
       FROM usuarios u
       INNER JOIN roles r ON u.rol_id = r.id
       WHERE u.id = ?
         AND u.activo = 1
       LIMIT 1`,
      [decoded.usuario_id]
    );

    if (user.length === 0) {
      return res.status(401).json({
        error: true,
        mensaje: 'Usuario no encontrado'
      });
    }

    const newToken = jwt.sign(
      {
        usuario_id: user[0].id,
        rol: user[0].rol_nombre,
        correo: user[0].correo
      },
      SECRET,
      { expiresIn: '8h' }
    );

    return res.json({
      error: false,
      token: newToken,
      expiresIn: 8 * 60 * 60
    });

  } catch (err) {
    return res.status(401).json({
      error: true,
      mensaje: 'Refresh token inválido'
    });
  }
});

module.exports = router;