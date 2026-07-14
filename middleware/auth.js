const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { getConnection } = require('../conexion');

const SECRET = process.env.JWT_SECRET;

// Función para hashear token (DEBE COINCIDIR con login.js)
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ========================================
// VERIFICAR TOKEN (acepta header O query string)
// ========================================
const verificarToken = async (req, res, next) => {
  let token = null;
  
  // 1. Intentar obtener el token del header Authorization
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
    console.log('[AUTH] Token obtenido del header Authorization');
  }
  
  // 2. Si no hay token en el header, buscar en query string (?token=xxx)
  if (!token && req.query && req.query.token) {
    token = req.query.token;
    console.log('[AUTH] Token obtenido desde query string');
  }
  
  // 3. Si no hay token en ningún lado
  if (!token) {
    console.warn('[AUTH] Token no proporcionado');
    return res.status(401).json({ 
      error: true, 
      mensaje: 'Token no proporcionado' 
    });
  }

  try {
    // 4. Verificar firma y expiración del JWT
    const decoded = jwt.verify(token, SECRET);
    console.log('[AUTH] Token decodificado:', {
      usuario_id: decoded.usuario_id,
      rol: decoded.rol,
      correo: decoded.correo
    });
    
    // 5. Obtener conexión del pool
    const connection = await getConnection();
    
    try {
      // 6. Hashear el token para comparar con la BD
      const tokenHash = hashToken(token);
      console.log('[AUTH] Token hash para comparación:', tokenHash.substring(0, 20) + '...');
      
      // 7. Verificar que la sesión esté activa en BD
      const [sesiones] = await connection.execute(
        `SELECT id, fecha_expiracion, activa, fecha_ultimo_uso
         FROM sesion 
         WHERE usuario_id = ? AND token_hash = ? AND activa = 1
         ORDER BY fecha_ultimo_uso DESC 
         LIMIT 1`,
        [decoded.usuario_id, tokenHash]
      );
      
      console.log('[AUTH] Sesiones encontradas en BD:', sesiones.length);

      if (sesiones.length === 0) {
        console.warn('[AUTH] No hay sesión activa para usuario:', decoded.usuario_id);
        return res.status(401).json({ 
          error: true, 
          mensaje: 'Sesión inválida o no encontrada' 
        });
      }

      const sesion = sesiones[0];
      
      // 8. Verificar expiración de la sesión
      if (new Date(sesion.fecha_expiracion) < new Date()) {
        console.warn('[AUTH] Sesión expirada');
        return res.status(401).json({ error: true, mensaje: 'Token expirado' });
      }

      // 9. Actualizar fecha_ultimo_uso
      await connection.execute(
        `UPDATE sesion SET fecha_ultimo_uso = NOW() WHERE id = ?`,
        [sesion.id]
      );

      // 10. Todo válido: adjuntar usuario a la request
      req.usuario = {
        id: decoded.usuario_id,
        rol: decoded.rol,
        correo: decoded.correo
      };
      
      console.log('[AUTH] Acceso autorizado para rol:', decoded.rol);
      next();
      
    } finally {
      if (connection && typeof connection.release === 'function') {
        await connection.release();
      }
    }

  } catch (error) {
    console.error('[AUTH] Error verificando token:', {
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

// ========================================
// VERIFICAR ROL
// ========================================
const verificarRol = (...rolesPermitidos) => {
  return (req, res, next) => {

    console.log("========== VERIFICAR ROL ==========");
    console.log("req.usuario =", req.usuario);
    console.log("rol =", req.usuario?.rol);
    console.log("permitidos =", rolesPermitidos);

    if (!req.usuario || !rolesPermitidos.includes(req.usuario.rol)) {
      console.log("DENEGADO");

      return res.status(403).json({
        error: true,
        mensaje: "Acceso denegado: rol no autorizado"
      });
    }

    console.log("PERMITIDO");
    next();
  };
};

// ========================================
// VERIFICAR PERMISO ESPECÍFICO
// ========================================
const verificarPermiso = (codigoPermiso) => {
  return async (req, res, next) => {
    try {
      const usuarioId = req.usuario?.id;
      
      if (!usuarioId) {
        return res.status(401).json({ error: true, mensaje: 'No autenticado' });
      }

      // Admin tiene todos los permisos
      if (req.usuario.rol === 'admin') {
        return next();
      }

      const connection = await getConnection();
      
      try {
        const [permisos] = await connection.execute(
          `SELECT p.codigo
           FROM permisos p
           INNER JOIN rol_permisos rp ON rp.permiso_id = p.id
           INNER JOIN usuarios u ON u.rol_id = rp.rol_id
           WHERE u.id = ? AND p.codigo = ? AND u.activo = 1 AND u.eliminado_en IS NULL`,
          [usuarioId, codigoPermiso]
        );

        if (permisos.length === 0) {
          return res.status(403).json({ 
            error: true, 
            mensaje: `No tienes permiso para: ${codigoPermiso}` 
          });
        }

        next();
      } finally {
        if (connection && typeof connection.release === 'function') {
          await connection.release();
        }
      }
    } catch (err) {
      console.error('[AUTH] Error verificando permiso:', err.message);
      return res.status(500).json({ error: true, mensaje: 'Error de autorización' });
    }
  };
};

//  IMPORTANTE: UN SOLO module.exports (estaba duplicado)
module.exports = { verificarToken, verificarRol, verificarPermiso };