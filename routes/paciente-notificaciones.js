// routes/paciente-notificaciones.js
const express = require('express');
const router = express.Router();
const { getConnection } = require('../conexion');
const { verificarToken } = require('../middleware/auth');

// ========================================
// CONFIRMAR CITA (PACIENTE)
// ========================================
router.put('/plan/confirmar-cita/:citaId', verificarToken, async (req, res) => {
  const usuarioId = req.usuario.id;
  const citaId = req.params.citaId;
  let connection;
  
  try {
    connection = await getConnection();
    
    console.log('[CONFIRMAR CITA] Usuario:', usuarioId, 'Cita:', citaId);
    
    // 1. Obtener el paciente_id real del usuario
    const [pacienteRows] = await connection.execute(
      `SELECT id FROM pacientes WHERE usuario_id = ? AND activo = 1 AND eliminado_en IS NULL`,
      [usuarioId]
    );
    
    if (pacienteRows.length === 0) {
      return res.status(404).json({
        error: true,
        mensaje: 'No tienes un perfil de paciente asociado'
      });
    }
    
    const pacienteId = pacienteRows[0].id;
    console.log('[CONFIRMAR CITA] Paciente ID encontrado:', pacienteId);
    
    // 2. Verificar que la cita pertenece al paciente
    const [citas] = await connection.execute(
      `SELECT sc.id, sc.medico_id, sc.fecha_hora, sc.estado,
              CONCAT(u.nombre, ' ', u.apellido) AS nombre_medico
       FROM seguimiento_citas sc
       INNER JOIN usuarios u ON u.id = sc.medico_id
       WHERE sc.id = ? AND sc.paciente_id = ?
       LIMIT 1`,
      [citaId, pacienteId]
    );
    
    if (citas.length === 0) {
      console.warn('[CONFIRMAR CITA] Cita no encontrada para paciente:', pacienteId);
      return res.status(404).json({
        error: true,
        mensaje: 'Cita no encontrada'
      });
    }
    
    const cita = citas[0];
    console.log('[CONFIRMAR CITA] Cita encontrada:', cita.id, 'Estado:', cita.estado);
    
    if (cita.estado === 'confirmada') {
      return res.status(400).json({
        error: true,
        mensaje: 'La cita ya fue confirmada previamente'
      });
    }
    
    // 3. Actualizar estado de la cita
    await connection.execute(
      `UPDATE seguimiento_citas 
       SET estado = 'confirmada', 
           fecha_confirmacion = NOW()
       WHERE id = ?`,
      [citaId]
    );
    
    console.log('[CONFIRMAR CITA] Cita actualizada a confirmada');
    
    // 4. Crear notificacion para el medico
    const fechaCita = new Date(cita.fecha_hora).toLocaleDateString('es-EC', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    await connection.execute(
      `INSERT INTO notificaciones (medico_id, paciente_id, tipo, titulo, mensaje, cita_id)
       VALUES (?, ?, 'confirmacion_cita', ?, ?, ?)`,
      [
        cita.medico_id,
        pacienteId,
        'Paciente confirmo su cita',
        'Un paciente ha confirmado su cita para el ' + fechaCita,
        citaId
      ]
    );
    
    console.log('[CONFIRMAR CITA] Notificacion creada para medico:', cita.medico_id);
    
    res.json({
      error: false,
      mensaje: 'Cita confirmada exitosamente',
      cita: {
        id: citaId,
        estado: 'confirmada',
        fecha: cita.fecha_hora
      }
    });
    
  } catch (error) {
    console.error('[ERROR CONFIRMAR CITA]', {
      message: error.message,
      code: error.code,
      sqlState: error.sqlState
    });
    res.status(500).json({
      error: true,
      mensaje: 'Error al confirmar la cita',
      detalle: error.message
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// ========================================
// CANCELAR CITA (PACIENTE)
// ========================================
router.put('/plan/cancelar-cita/:citaId', verificarToken, async (req, res) => {
  const usuarioId = req.usuario.id;
  const citaId = req.params.citaId;
  let connection;
  
  try {
    connection = await getConnection();
    
    // 1. Obtener el paciente_id real del usuario
    const [pacienteRows] = await connection.execute(
      `SELECT id FROM pacientes WHERE usuario_id = ? AND activo = 1 AND eliminado_en IS NULL`,
      [usuarioId]
    );
    
    if (pacienteRows.length === 0) {
      return res.status(404).json({
        error: true,
        mensaje: 'No tienes un perfil de paciente asociado'
      });
    }
    
    const pacienteId = pacienteRows[0].id;
    
    const [citas] = await connection.execute(
      `SELECT sc.id, sc.medico_id, sc.fecha_hora, sc.estado
       FROM seguimiento_citas sc
       WHERE sc.id = ? AND sc.paciente_id = ?
       LIMIT 1`,
      [citaId, pacienteId]
    );
    
    if (citas.length === 0) {
      return res.status(404).json({
        error: true,
        mensaje: 'Cita no encontrada'
      });
    }
    
    const cita = citas[0];
    
    await connection.execute(
      `UPDATE seguimiento_citas 
       SET estado = 'cancelada',
           fecha_cancelacion = NOW()
       WHERE id = ?`,
      [citaId]
    );
    
    // Crear notificacion para el medico
    const fechaCita = new Date(cita.fecha_hora).toLocaleDateString('es-EC', {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    });
    
    await connection.execute(
      `INSERT INTO notificaciones (medico_id, paciente_id, tipo, titulo, mensaje, cita_id)
       VALUES (?, ?, 'cancelacion_cita', ?, ?, ?)`,
      [
        cita.medico_id,
        pacienteId,
        'Paciente cancelo su cita',
        'Un paciente ha cancelado su cita programada para el ' + fechaCita,
        citaId
      ]
    );
    
    res.json({
      error: false,
      mensaje: 'Cita cancelada exitosamente'
    });
    
  } catch (error) {
    console.error('[ERROR CANCELAR CITA]', error);
    res.status(500).json({
      error: true,
      mensaje: 'Error al cancelar la cita'
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

module.exports = router;