// routes/medico-notificaciones.js
const express = require('express');
const router = express.Router();
const { getConnection } = require('../conexion');
const { verificarToken } = require('../middleware/auth');

// ========================================
// OBTENER NOTIFICACIONES DEL MEDICO
// ========================================
router.get('/notificaciones', verificarToken, async (req, res) => {
  const medicoId = req.usuario.id;
  let connection;
  
  try {
    connection = await getConnection();
    
    const [notificaciones] = await connection.execute(
      `SELECT 
         n.id,
         n.tipo,
         n.titulo,
         n.mensaje,
         n.leida,
         n.fecha,
         n.cita_id,
         CONCAT(u.nombre, ' ', u.apellido) AS nombre_paciente,
         u.cedula AS cedula_paciente
       FROM notificaciones n
       INNER JOIN usuarios u ON u.id = n.paciente_id
       WHERE n.medico_id = ?
       ORDER BY n.fecha DESC
       LIMIT 50`,
      [medicoId]
    );
    
    const [noLeidas] = await connection.execute(
      `SELECT COUNT(*) AS total 
       FROM notificaciones 
       WHERE medico_id = ? AND leida = 0`,
      [medicoId]
    );
    
    res.json({
      error: false,
      notificaciones: notificaciones,
      totalNoLeidas: noLeidas[0].total
    });
    
  } catch (error) {
    console.error('[ERROR NOTIFICACIONES]', {
      message: error.message,
      code: error.code,
      sqlState: error.sqlState
    });
    res.status(500).json({
      error: true,
      mensaje: 'Error al obtener notificaciones',
      detalle: error.message
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// ========================================
// MARCAR NOTIFICACION COMO LEIDA
// ========================================
router.put('/notificaciones/:id/leida', verificarToken, async (req, res) => {
  const medicoId = req.usuario.id;
  const notificacionId = req.params.id;
  let connection;
  
  try {
    connection = await getConnection();
    
    const [result] = await connection.execute(
      `UPDATE notificaciones 
       SET leida = 1 
       WHERE id = ? AND medico_id = ?`,
      [notificacionId, medicoId]
    );
    
    res.json({
      error: false,
      mensaje: 'Notificacion marcada como leida',
      filas_afectadas: result.affectedRows
    });
    
  } catch (error) {
    console.error('[ERROR MARCAR LEIDA]', error);
    res.status(500).json({
      error: true,
      mensaje: 'Error al marcar notificacion'
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// ========================================
// MARCAR TODAS COMO LEIDAS
// ========================================
router.put('/notificaciones/leer-todas', verificarToken, async (req, res) => {
  const medicoId = req.usuario.id;
  let connection;
  
  try {
    connection = await getConnection();
    
    const [result] = await connection.execute(
      `UPDATE notificaciones 
       SET leida = 1 
       WHERE medico_id = ? AND leida = 0`,
      [medicoId]
    );
    
    res.json({
      error: false,
      mensaje: 'Todas las notificaciones marcadas como leidas',
      filas_afectadas: result.affectedRows
    });
    
  } catch (error) {
    console.error('[ERROR LEER TODAS]', error);
    res.status(500).json({
      error: true,
      mensaje: 'Error al marcar notificaciones'
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

module.exports = router;