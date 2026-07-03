// routes/paciente-notificaciones.js
const express = require('express');
const router = express.Router();
const { getConnection } = require('../conexion');
const { verificarToken } = require('../middleware/auth');

// ========================================
// CONFIRMAR CITA (PACIENTE)
// ========================================
router.put('/plan/confirmar-cita/:citaId', verificarToken, async (req, res) => {
  const connection = await getConnection();
  
  try {
    const pacienteId = req.usuario.id;
    const citaId = req.params.citaId;
    
    // Verificar que la cita pertenece al paciente
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
      return res.status(404).json({
        error: true,
        mensaje: 'Cita no encontrada'
      });
    }
    
    const cita = citas[0];
    
    if (cita.estado === 'confirmada') {
      return res.status(400).json({
        error: true,
        mensaje: 'La cita ya fue confirmada previamente'
      });
    }
    
    // Actualizar estado de la cita
    await connection.execute(
      `UPDATE seguimiento_citas 
       SET estado = 'confirmada', 
           fecha_confirmacion = NOW()
       WHERE id = ?`,
      [citaId]
    );
    
    // Crear notificacion para el medico
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
        `Un paciente ha confirmado su cita para el ${fechaCita}`,
        citaId
      ]
    );
    
    await connection.commit();
    
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
    await connection.rollback();
    console.error('[ERROR CONFIRMAR CITA]', error);
    res.status(500).json({
      error: true,
      mensaje: 'Error al confirmar la cita'
    });
  } finally {
    if (connection) await connection.release();
  }
});

// ========================================
// CANCELAR CITA (PACIENTE)
// ========================================
router.put('/plan/cancelar-cita/:citaId', verificarToken, async (req, res) => {
  const connection = await getConnection();
  
  try {
    const pacienteId = req.usuario.id;
    const citaId = req.params.citaId;
    
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
        `Un paciente ha cancelado su cita programada para el ${fechaCita}`,
        citaId
      ]
    );
    
    await connection.commit();
    
    res.json({
      error: false,
      mensaje: 'Cita cancelada exitosamente'
    });
    
  } catch (error) {
    await connection.rollback();
    console.error('[ERROR CANCELAR CITA]', error);
    res.status(500).json({
      error: true,
      mensaje: 'Error al cancelar la cita'
    });
  } finally {
    if (connection) await connection.release();
  }
});

module.exports = router;