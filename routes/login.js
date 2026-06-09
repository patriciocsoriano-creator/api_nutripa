// backend/routes/login.js - VERSIÓN CORREGIDA: rol_nombre → rol
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getConnection } = require('../conexion');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const SECRET = process.env.JWT_SECRET || 'dev_secret_change_in_prod_2026';

// 🔐 Función para hashear token (SHA-256)
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// 👇 Helper para registrar historial de acceso
async function registrarAcceso(connection, datos) {
  try {
    await connection.execute(
      `INSERT INTO historial_acceso 
       (id, usuario_id, correo_intentado, ip_address, user_agent, exito, motivo_fallo)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        datos.usuario_id || null,
        datos.correo_intentado || null,
        datos.ip_address,
        datos.user_agent,
        datos.exito ? 1 : 0,
        datos.motivo_fallo || null
      ]
    );
  } catch (err) {
    console.warn('⚠️ [HISTORIAL] Error registrando acceso:', err.message);
  }
}

// 👇 Helper para guardar sesión
async function guardarSesion(connection, datos) {
  try {
    await connection.execute(
      `INSERT INTO sesion 
       (id, usuario_id, token_hash, refresh_token_hash, ip_address, user_agent, fecha_expiracion)
       VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 8 HOUR))`,
      [
        uuidv4(),
        datos.usuario_id,
        datos.token_hash,
        datos.refresh_token_hash,
        datos.ip_address,
        datos.user_agent
      ]
    );
    return true;
  } catch (err) {
    console.warn('⚠️ [SESION] Error guardando sesión:', err.message);
    return false;
  }
}

// POST /nutricionapp-api/login
router.post('/', async (req, res) => {
  console.log('🔐 [LOGIN] Request:', { 
    email: req.body?.email, 
    ip: req.ip,
    userAgent: req.get('user-agent')?.substring(0, 50) 
  });

  const { email, password } = req.body;
  const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
  const userAgent = req.get('user-agent') || '';

  // 🔍 Validación básica
  if (!email || !password) {
    return res.status(400).json({ 
      error: true, 
      mensaje: 'Correo electrónico y contraseña son requeridos' 
    });
  }

  let connection;
  try {
    //  Obtener conexión del pool
    connection = await getConnection();
    console.log('🔗 [LOGIN] Conexión obtenida del pool');
    
    //  Buscar usuario por correo (case-insensitive)
    console.log('🔍 [LOGIN] Buscando usuario...');
    const [usuarios] = await connection.execute(
      `SELECT 
         u.id, u.correo, u.password_hash, u.nombre, u.apellido, 
         u.cedula, u.rol_id, u.activo, 
         r.nombre as rol_nombre  --  Alias importante
       FROM usuarios u
       INNER JOIN roles r ON u.rol_id = r.id
       WHERE u.correo = ? AND u.eliminado_en IS NULL`,
      [email.toLowerCase().trim()]
    );

    // ❌ Usuario no encontrado
    if (usuarios.length === 0) {
      console.warn('⚠️ [LOGIN] Usuario no encontrado:', email);
      await registrarAcceso(connection, {
        correo_intentado: email,
        ip_address: ipAddress,
        user_agent: userAgent,
        exito: false,
        motivo_fallo: 'credenciales_invalidas'
      });
      return res.status(401).json({ 
        error: true, 
        mensaje: 'Credenciales inválidas' 
      });
    }

    const usuario = usuarios[0];
    console.log('👤 [LOGIN] Usuario encontrado:', { 
      id: usuario.id, 
      rol_nombre: usuario.rol_nombre,  //  Verificar este valor
      activo: usuario.activo 
    });

    // 🔐 3️⃣ Validar contraseña
    console.log('🔐 [LOGIN] Validando contraseña...');
    const esValida = await bcrypt.compare(password, usuario.password_hash);
    
    if (!esValida) {
      console.warn('⚠️ [LOGIN] Contraseña incorrecta para:', email);
      await registrarAcceso(connection, {
        usuario_id: usuario.id,
        ip_address: ipAddress,
        user_agent: userAgent,
        exito: false,
        motivo_fallo: 'credenciales_invalidas'
      });
      return res.status(401).json({ 
        error: true, 
        mensaje: 'Credenciales inválidas' 
      });
    }

    //  Verificar que el usuario esté activo
    if (!usuario.activo) {
      console.warn('⚠️ [LOGIN] Usuario inactivo:', email);
      await registrarAcceso(connection, {
        usuario_id: usuario.id,
        ip_address: ipAddress,
        user_agent: userAgent,
        exito: false,
        motivo_fallo: 'usuario_inactivo'
      });
      return res.status(401).json({ 
        error: true, 
        mensaje: 'Usuario inactivo. Contacta al administrador.' 
      });
    }

    //  Registrar acceso exitoso en historial
    console.log('📝 [LOGIN] Registrando acceso exitoso...');
    await registrarAcceso(connection, {
      usuario_id: usuario.id,
      ip_address: ipAddress,
      user_agent: userAgent,
      exito: true
    });
    console.log('✅ [LOGIN] Historial actualizado');

    // Generar JWT Access Token
    console.log('🎫 [LOGIN] Generando tokens...');
    const token = jwt.sign(
      { 
        usuario_id: usuario.id, 
        rol: usuario.rol_nombre,  //  Usar rol_nombre del JOIN
        correo: usuario.correo 
      },
      SECRET,
      { 
        expiresIn: '8h',
        issuer: 'nutripa-api',
        audience: 'nutripa-client'
      }
    );

    // 🔁 Generar Refresh Token
    const refreshToken = jwt.sign(
      { usuario_id: usuario.id, type: 'refresh' },
      SECRET + '_refresh_secret',
      { 
        expiresIn: '7d',
        issuer: 'nutripa-api'
      }
    );

    // 🔐 Hashear tokens antes de guardar en BD
    const tokenHash = hashToken(token);
    const refreshTokenHash = hashToken(refreshToken);

    // 💾 7️⃣ Guardar sesión en base de datos
    console.log('💾 [LOGIN] Guardando sesión...');
    const sesionGuardada = await guardarSesion(connection, {
      usuario_id: usuario.id,
      token_hash: tokenHash,
      refresh_token_hash: refreshTokenHash,
      ip_address: ipAddress,
      user_agent: userAgent
    });
    
    if (sesionGuardada) {
      console.log('✅ [LOGIN] Sesión guardada en BD');
    } else {
      console.warn('⚠️ [LOGIN] Sesión NO guardada (login continúa)');
    }

    // 📤 8️⃣ Preparar respuesta exitosa - ✅ CORREGIDO: mapear rol_nombre → rol
    const { password_hash, ...usuarioSinPassword } = usuario;
    
    // 👇 IMPORTANTE: El frontend espera "rol", pero la BD devuelve "rol_nombre"
    const usuarioRespuesta = {
      ...usuarioSinPassword,
      rol: usuario.rol_nombre || usuario.rol || 'desconocido'  // ← Mapeo explícito
    };
    
    console.log('📤 [LOGIN] Enviando respuesta:', {
      mensaje: 'Login exitoso',
      usuario: {
        id: usuarioRespuesta.id,
        correo: usuarioRespuesta.correo,
        rol: usuarioRespuesta.rol  // ← Verificar que tenga valor
      }
    });

    return res.json({
      error: false,
      mensaje: 'Login exitoso',
      token,
      refreshToken,
      expiresIn: 8 * 60 * 60,
      usuario: usuarioRespuesta  // ← Usar objeto con rol mapeado
    });

  } catch (err) {
    // ❌ Manejo de errores
    console.error('💥 [LOGIN] ERROR CRÍTICO:', {
      message: err.message,
      code: err.code,
      errno: err.errno,
      sql: err.sql
    });
    
    // Intentar registrar el error en historial (sin bloquear)
    if (connection && email) {
      await registrarAcceso(connection, {
        correo_intentado: email,
        ip_address: ipAddress,
        user_agent: userAgent,
        exito: false,
        motivo_fallo: 'error_servidor'
      }).catch(() => {});
    }
    
    // Respuesta de error genérica
    const esErrorConexion = ['ECONNREFUSED', 'ECONNRESET', 'PROTOCOL_CONNECTION_LOST'].includes(err.code);
    
    return res.status(500).json({ 
      error: true, 
      mensaje: esErrorConexion 
        ? 'Error de conexión con la base de datos. Intenta nuevamente.' 
        : 'Error interno del servidor. Por favor, contacta al administrador.'
    });
    
  } finally {
    // 🔓 9️⃣ Liberar conexión al pool
    if (connection) {
      try {
        await connection.release();
        console.log('🔓 [LOGIN] Conexión liberada al pool');
      } catch (releaseErr) {
        console.error('❌ [LOGIN] Error liberando conexión:', releaseErr.message);
      }
    }
  }
});

// Endpoint opcional: Refresh token
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  
  if (!refreshToken) {
    return res.status(400).json({ error: true, mensaje: 'Refresh token requerido' });
  }
  
  let connection;
  try {
    connection = await getConnection();
    
    // Verificar refresh token
    const decoded = jwt.verify(refreshToken, SECRET + '_refresh_secret');
    
    // Verificar que la sesión aún exista y esté activa
    const [sesiones] = await connection.execute(
      `SELECT id FROM sesion 
       WHERE usuario_id = ? AND refresh_token_hash = ? AND activa = 1 
       AND fecha_expiracion > NOW()`,
      [decoded.usuario_id, hashToken(refreshToken)]
    );
    
    if (sesiones.length === 0) {
      return res.status(401).json({ error: true, mensaje: 'Refresh token inválido o expirado' });
    }
    
    // Generar nuevo access token
    const [usuario] = await connection.execute(
      `SELECT u.id, u.correo, r.nombre as rol_nombre 
       FROM usuarios u 
       INNER JOIN roles r ON u.rol_id = r.id 
       WHERE u.id = ? AND u.activo = 1`,
      [decoded.usuario_id]
    );
    
    if (usuario.length === 0) {
      return res.status(401).json({ error: true, mensaje: 'Usuario no encontrado o inactivo' });
    }
    
    const newToken = jwt.sign(
      { 
        usuario_id: usuario[0].id, 
        rol: usuario[0].rol_nombre,  //  Usar rol_nombre
        correo: usuario[0].correo 
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
    console.error('❌ [REFRESH] Error:', err.message);
    
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: true, mensaje: 'Refresh token expirado' });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: true, mensaje: 'Refresh token inválido' });
    }
    
    return res.status(500).json({ error: true, mensaje: 'Error al renovar token' });
    
  } finally {
    if (connection) await connection.release();
  }
});

module.exports = router;