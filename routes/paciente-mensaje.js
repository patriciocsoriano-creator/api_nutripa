const express = require('express');
const router = express.Router();
const pool = require('../conexion').pool;
const { verificarToken } = require('../middleware/auth');

// ========================================
// OBTENER CONVERSACION CON EL MEDICO ASIGNADO
// ========================================
router.get('/mensajes/conversacion', verificarToken, async (req, res) => {
  try {
    const pacienteId = req.usuario.id;

    const [medicoRows] = await pool.query(`
      SELECT 
        m.id AS medico_id,
        CONCAT(m.nombre, ' ', m.apellido) AS nombre_medico,
        m.telefono AS telefono_medico
      FROM usuarios m
      INNER JOIN asignaciones a ON m.id = a.medico_id
      WHERE a.paciente_id = ? AND a.estado = 'activo'
      ORDER BY a.fecha_asignacion DESC
      LIMIT 1
    `, [pacienteId]);

    if (medicoRows.length === 0) {
      return res.json({
        error: false,
        conversaciones: [],
        sinMedico: true,
        mensaje: 'No tienes un medico asignado aun'
      });
    }

    const medico = medicoRows[0];

    const [mensajeRows] = await pool.query(`
      SELECT 
        contenido AS ultimo_mensaje,
        fecha AS ultimo_mensaje_fecha,
        es_medico
      FROM mensajes
      WHERE (medico_id = ? AND paciente_id = ?)
      ORDER BY fecha DESC
      LIMIT 1
    `, [medico.medico_id, pacienteId]);

    const [noLeidosRows] = await pool.query(`
      SELECT COUNT(*) AS total
      FROM mensajes
      WHERE medico_id = ? AND paciente_id = ? AND es_medico = 1 AND leido = 0
    `, [medico.medico_id, pacienteId]);

    const conversacion = {
      medico_id: medico.medico_id,
      nombre_paciente: medico.nombre_medico,
      telefono_medico: medico.telefono_medico,
      ultimo_mensaje: mensajeRows.length > 0 ? mensajeRows[0].ultimo_mensaje : 'Inicia una conversacion con tu medico',
      ultimo_mensaje_fecha: mensajeRows.length > 0 ? mensajeRows[0].ultimo_mensaje_fecha : null,
      mensajes_no_leidos: noLeidosRows[0].total,
      en_linea: false
    };

    res.json({
      error: false,
      conversaciones: [conversacion],
      sinMedico: false
    });

  } catch (error) {
    console.error('[ERROR CONVERSACION PACIENTE]', error);
    res.status(500).json({
      error: true,
      mensaje: 'Error al obtener conversacion'
    });
  }
});

// ========================================
// OBTENER MENSAJES DE LA CONVERSACION
// ========================================
router.get('/mensajes/conversacion/:medicoId', verificarToken, async (req, res) => {
  try {
    const pacienteId = req.usuario.id;
    const medicoId = req.params.medicoId;

    const [rows] = await pool.query(`
      SELECT 
        id,
        contenido,
        fecha,
        es_medico,
        leido
      FROM mensajes
      WHERE medico_id = ? AND paciente_id = ?
      ORDER BY fecha ASC
    `, [medicoId, pacienteId]);

    res.json({
      error: false,
      mensajes: rows
    });

  } catch (error) {
    console.error('[ERROR MENSAJES PACIENTE]', error);
    res.status(500).json({
      error: true,
      mensaje: 'Error al obtener mensajes'
    });
  }
});

// ========================================
// ENVIAR MENSAJE AL MEDICO
// ========================================
router.post('/mensajes/enviar', verificarToken, async (req, res) => {
  try {
    const pacienteId = req.usuario.id;
    const { medico_id, contenido } = req.body;

    if (!medico_id || !contenido || !contenido.trim()) {
      return res.status(400).json({
        error: true,
        mensaje: 'Datos incompletos'
      });
    }

    const [asignacionRows] = await pool.query(`
      SELECT id FROM asignaciones
      WHERE medico_id = ? AND paciente_id = ? AND estado = 'activo'
      LIMIT 1
    `, [medico_id, pacienteId]);

    if (asignacionRows.length === 0) {
      return res.status(403).json({
        error: true,
        mensaje: 'No tienes permiso para enviar mensajes a este medico'
      });
    }

    const [result] = await pool.query(`
      INSERT INTO mensajes (medico_id, paciente_id, contenido, es_medico, leido)
      VALUES (?, ?, ?, 0, 0)
    `, [medico_id, pacienteId, contenido.trim()]);

    res.json({
      error: false,
      mensaje: 'Mensaje enviado',
      id: result.insertId
    });

  } catch (error) {
    console.error('[ERROR ENVIAR PACIENTE]', error);
    res.status(500).json({
      error: true,
      mensaje: 'Error al enviar mensaje'
    });
  }
});

// ========================================
// MARCAR MENSAJES COMO LEIDOS
// ========================================
router.put('/mensajes/leidos/:medicoId', verificarToken, async (req, res) => {
  try {
    const pacienteId = req.usuario.id;
    const medicoId = req.params.medicoId;

    await pool.query(`
      UPDATE mensajes
      SET leido = 1
      WHERE medico_id = ? AND paciente_id = ? AND es_medico = 1 AND leido = 0
    `, [medicoId, pacienteId]);

    res.json({
      error: false,
      mensaje: 'Mensajes marcados como leidos'
    });

  } catch (error) {
    console.error('[ERROR LEIDOS PACIENTE]', error);
    res.status(500).json({
      error: true,
      mensaje: 'Error al marcar como leidos'
    });
  }
});

// ========================================
// CONTADOR DE MENSAJES NO LEIDOS
// ========================================
router.get('/mensajes/no-leidos', verificarToken, async (req, res) => {
  try {
    const pacienteId = req.usuario.id;

    const [rows] = await pool.query(`
      SELECT COUNT(*) AS total
      FROM mensajes m
      INNER JOIN asignaciones a ON m.medico_id = a.medico_id AND m.paciente_id = a.paciente_id
      WHERE m.paciente_id = ? AND m.es_medico = 1 AND m.leido = 0 AND a.estado = 'activo'
    `, [pacienteId]);

    res.json({
      error: false,
      total: rows[0].total
    });

  } catch (error) {
    console.error('[ERROR NO LEIDOS PACIENTE]', error);
    res.status(500).json({
      error: true,
      mensaje: 'Error al obtener mensajes no leidos'
    });
  }
});

module.exports = router;