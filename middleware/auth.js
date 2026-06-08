// backend/middleware/auth.js - verificarToken() CORREGIDO
const jwt = require('jsonwebtoken');
const crypto = require('crypto'); // 👈 Para hashear igual que en login
const { getConnection } = require('../conexion');

const SECRET = process.env.JWT_SECRET;

// 🔐 Función para hashear token (DEBE COINCIDIR con login.js)
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const verificarToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  console.log('🔐 [AUTH] Authorization header:', authHeader ? authHeader.substring(0, 40) + '...' : '❌ NO PRESENTE');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.warn('⚠️ [AUTH] Token no proporcionado o formato inválido');
    return res.status(401).json({ error: true, mensaje: 'Token no proporcionado' });
  }

  const token = authHeader.substring(7); // Remover 'Bearer '

  try {
    // 1️⃣ Verificar firma y expiración del JWT
    const decoded = jwt.verify(token, SECRET);
    console.log('✅ [AUTH] Token decodificado:', {
      usuario_id: decoded.usuario_id,
      rol: decoded.rol,
      correo: decoded.correo
    });
    
    // 2️⃣ Obtener conexión del pool
    const connection = await getConnection();
    
    try {
      // 🔍 Hashear el token para comparar con la BD (igual que en login.js)
      const tokenHash = hashToken(token);
      console.log('🔐 [AUTH] Token hash para comparación:', tokenHash.substring(0, 20) + '...');
      
      // Verificar que la sesión esté activa en BD usando el hash calculado en Node.js
      const [sesiones] = await connection.execute(
        `SELECT id, fecha_expiracion, activa, fecha_ultimo_uso
         FROM sesion 
         WHERE usuario_id = ? AND token_hash = ? AND activa = 1
         ORDER BY fecha_ultimo_uso DESC 
         LIMIT 1`,
        [decoded.usuario_id, tokenHash]  // 👈 Usar tokenHash calculado en Node.js, NO SHA2(?,256)
      );
      
      console.log('🔍 [AUTH] Sesiones encontradas en BD:', sesiones.length);

      if (sesiones.length === 0) {
        console.warn('⚠️ [AUTH] No hay sesión activa para usuario:', decoded.usuario_id);
        console.log('🔍 [AUTH] Debug - usuario_id:', decoded.usuario_id, '| tokenHash:', tokenHash.substring(0, 30) + '...');
        return res.status(401).json({ 
          error: true, 
          mensaje: 'Sesión inválida o no encontrada' 
        });
      }

      const sesion = sesiones[0];
      
      // ⏰ Verificar expiración de la sesión
      if (new Date(sesion.fecha_expiracion) < new Date()) {
        console.warn('⚠️ [AUTH] Sesión expirada:', {
          fecha_expiracion: sesion.fecha_expiracion,
          ahora: new Date().toISOString()
        });
        return res.status(401).json({ error: true, mensaje: 'Token expirado' });
      }

      // ✅ Actualizar fecha_ultimo_uso para mantener sesión activa
      await connection.execute(
        `UPDATE sesion SET fecha_ultimo_uso = NOW() WHERE id = ?`,
        [sesion.id]
      );

      // ✅ Todo válido: adjuntar usuario a la request
      req.usuario = {
        id: decoded.usuario_id,
        rol: decoded.rol,
        correo: decoded.correo
      };
      
      console.log('✅ [AUTH] Acceso autorizado para rol:', decoded.rol);
      next();
      
    } finally {
      // 🔑 IMPORTANTE: Liberar conexión al pool
      if (connection && typeof connection.release === 'function') {
        await connection.release();
      }
    }

  } catch (error) {
    console.error('❌ [AUTH] Error verificando token:', {
      name: error.name,
      message: error.message
    });
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: true, mensaje: 'Token expirado' });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: true, mensaje: 'Token inválido' });
    }
    
    return res.status(401).json({ error: true, mensaje: 'Error validando token' });
  }
};

// ✅ Middleware para verificar roles (sin cambios)
const verificarRol = (...rolesPermitidos) => {
  return (req, res, next) => {
    console.log('🎭 [ROL] Verificando acceso. Rol del usuario:', req.usuario?.rol);
    
    if (!req.usuario || !rolesPermitidos.includes(req.usuario.rol)) {
      console.warn('🚫 [ROL] Acceso denegado. Usuario tiene rol:', req.usuario?.rol);
      return res.status(403).json({ 
        error: true, 
        mensaje: 'Acceso denegado: rol no autorizado' 
      });
    }
    
    console.log('✅ [ROL] Acceso concedido');
    next();
  };
};

module.exports = { verificarToken, verificarRol };