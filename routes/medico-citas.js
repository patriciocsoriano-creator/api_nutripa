// routes/medico-citas.js
const express = require('express');
const router = express.Router();
const { getConnection } = require('../conexion');
const { verificarToken, verificarRol } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// Middleware: solo médicos/nutricionistas
router.use(verificarToken);
router.use(verificarRol('medico', 'nutricionista'));

// ========================================
// AGENDAR NUEVA CITA
// ========================================
router.post('/citas/agendar', async (req, res) => {
  const medicoId = req.usuario.id;
  const { paciente_id, fecha_hora, tipo, motivo } = req.body;
  
  let connection;
  try {
    connection = await getConnection();
    
    // Validaciones
    if (!paciente_id || !fecha_hora || !tipo) {
      return res.status(400).json({
        error: true,
        mensaje: 'Los campos paciente_id, fecha_hora y tipo son obligatorios'
      });
    }
    
    const tiposValidos = ['control', 'seguimiento', 'evaluacion', 'urgencia', 'teleconsulta'];
    if (!tiposValidos.includes(tipo)) {
      return res.status(400).json({
        error: true,
        mensaje: 'Tipo de cita no válido. Valores permitidos: ' + tiposValidos.join(', ')
      });
    }
    
    // Verificar que el paciente existe y está asignado al médico
    const [pacientes] = await connection.execute(
      `SELECT p.id, CONCAT(u.nombre, ' ', u.apellido) AS nombre_paciente
       FROM pacientes p
       INNER JOIN usuarios u ON u.id = p.usuario_id
       INNER JOIN asignaciones a ON a.paciente_id = p.id
       WHERE p.id = ? AND a.medico_id = ? AND a.estado = 'activo'
       LIMIT 1`,
      [paciente_id, medicoId]
    );
    
    if (pacientes.length === 0) {
      return res.status(404).json({
        error: true,
        mensaje: 'Paciente no encontrado o no está asignado a usted'
      });
    }
    
    // Verificar que no haya cita en ese horario
    const [citasExistentes] = await connection.execute(
      `SELECT id FROM seguimiento_citas 
       WHERE medico_id = ? AND fecha_hora = ? AND estado != 'cancelada'`,
      [medicoId, fecha_hora]
    );
    
    if (citasExistentes.length > 0) {
      return res.status(400).json({
        error: true,
        mensaje: 'Ya tiene una cita agendada en ese horario'
      });
    }
    
    // Crear la cita
    const citaId = uuidv4();
    await connection.execute(
      `INSERT INTO seguimiento_citas 
        (id, paciente_id, medico_id, fecha_hora, tipo, motivo, estado) 
       VALUES (?, ?, ?, ?, ?, ?, 'agendada')`,
      [citaId, paciente_id, medicoId, fecha_hora, tipo, motivo || null]
    );
    
    // Crear notificación para el paciente
    const fechaCita = new Date(fecha_hora).toLocaleDateString('es-EC', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    await connection.execute(
      `INSERT INTO notificaciones (medico_id, paciente_id, tipo, titulo, mensaje, cita_id)
       VALUES (?, ?, 'mensaje_nuevo', ?, ?, ?)`,
      [
        medicoId,
        paciente_id,
        'Nueva cita agendada',
        `Se ha agendado una cita de ${tipo} para el ${fechaCita}`,
        citaId
      ]
    );
    
    await connection.commit();
    
    console.log(`[CITAS] Cita agendada: ${citaId} para paciente ${paciente_id} el ${fecha_hora}`);
    
    res.status(201).json({
      error: false,
      mensaje: 'Cita agendada exitosamente',
      cita: {
        id: citaId,
        paciente: pacientes[0].nombre_paciente,
        fecha: fecha_hora,
        tipo: tipo,
        estado: 'agendada'
      }
    });
    
  } catch (error) {
    if (connection) await connection.rollback();
    console.error('[ERROR AGENDAR CITA]', error);
    res.status(500).json({
      error: true,
      mensaje: 'Error al agendar la cita',
      detalle: error.message
    });
  } finally {
    if (connection) await connection.release();
  }
});

// ========================================
// LISTAR CITAS DEL MEDICO
// ========================================
router.get('/citas', async (req, res) => {
  const medicoId = req.usuario.id;
  const { estado, dias = 30 } = req.query;
  
  let connection;
  try {
    connection = await getConnection();
    
    let query = `
      SELECT 
        sc.id,
        sc.fecha_hora,
        sc.tipo,
        sc.motivo,
        sc.estado,
        sc.fecha_confirmacion,
        sc.fecha_cancelacion,
        CONCAT(u.nombre, ' ', u.apellido) AS nombre_paciente,
        u.cedula AS cedula_paciente
      FROM seguimiento_citas sc
      INNER JOIN usuarios u ON u.id = sc.paciente_id
      WHERE sc.medico_id = ?
        AND sc.fecha_hora >= NOW()
        AND sc.fecha_hora <= DATE_ADD(NOW(), INTERVAL ? DAY)
    `;
    
    const params = [medicoId, parseInt(dias)];
    
    if (estado) {
      query += ` AND sc.estado = ?`;
      params.push(estado);
    }
    
    query += ` ORDER BY sc.fecha_hora ASC`;
    
    const [citas] = await connection.execute(query, params);
    
    res.json({
      error: false,
      citas: citas,
      total: citas.length
    });
    
  } catch (error) {
    console.error('[ERROR LISTAR CITAS]', error);
    res.status(500).json({
      error: true,
      mensaje: 'Error al listar citas'
    });
  } finally {
    if (connection) await connection.release();
  }
});

// ========================================
// CANCELAR CITA (MEDICO)
// ========================================
router.put('/citas/:citaId/cancelar', async (req, res) => {
  const medicoId = req.usuario.id;
  const citaId = req.params.citaId;
  
  let connection;
  try {
    connection = await getConnection();
    
    const [citas] = await connection.execute(
      `SELECT sc.id, sc.paciente_id, sc.fecha_hora, sc.estado
       FROM seguimiento_citas sc
       WHERE sc.id = ? AND sc.medico_id = ?
       LIMIT 1`,
      [citaId, medicoId]
    );
    
    if (citas.length === 0) {
      return res.status(404).json({
        error: true,
        mensaje: 'Cita no encontrada'
      });
    }
    
    const cita = citas[0];
    
    if (cita.estado === 'cancelada') {
      return res.status(400).json({
        error: true,
        mensaje: 'La cita ya fue cancelada'
      });
    }
    
    await connection.execute(
      `UPDATE seguimiento_citas 
       SET estado = 'cancelada',
           fecha_cancelacion = NOW()
       WHERE id = ?`,
      [citaId]
    );
    
    // Notificar al paciente
    const fechaCita = new Date(cita.fecha_hora).toLocaleDateString('es-EC', {
      weekday: 'long',
      day: 'numeric',
      month: 'long'
    });
    
    await connection.execute(
      `INSERT INTO notificaciones (medico_id, paciente_id, tipo, titulo, mensaje, cita_id)
       VALUES (?, ?, 'cancelacion_cita', ?, ?, ?)`,
      [
        medicoId,
        cita.paciente_id,
        'Cita cancelada por el médico',
        `Su cita programada para el ${fechaCita} ha sido cancelada por el médico`,
        citaId
      ]
    );
    
    await connection.commit();
    
    res.json({
      error: false,
      mensaje: 'Cita cancelada exitosamente'
    });
    
  } catch (error) {
    if (connection) await connection.rollback();
    console.error('[ERROR CANCELAR CITA MEDICO]', error);
    res.status(500).json({
      error: true,
      mensaje: 'Error al cancelar la cita'
    });
  } finally {
    if (connection) await connection.release();
  }
});

module.exports = router;