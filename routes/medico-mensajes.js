const express = require('express');
const router = express.Router();
const pool = require('../conexion').pool;
const { verificarToken } = require('../middleware/auth');

// ========================================
// OBTENER CONVERSACIONES (LISTA DE PACIENTES)
// ========================================
router.get('/mensajes/conversaciones', verificarToken, async (req, res) => {
  try {
    const medicoId = req.usuario.id;

    const [rows] = await pool.query(`
      SELECT 
        u.id AS paciente_id,
        CONCAT(u.nombre, ' ', u.apellido) AS nombre_paciente,
        m.ultimo_mensaje,
        m.ultimo_mensaje_fecha,
        m.mensajes_no_leidos
      FROM usuarios u
      INNER JOIN roles r ON u.rol_id = r.id
      INNER JOIN (
        SELECT 
          paciente_id,
          SUBSTRING_INDEX(GROUP_CONCAT(contenido ORDER BY fecha DESC), ',', 1) AS ultimo_mensaje,
          MAX(fecha) AS ultimo_mensaje_fecha,
          SUM(CASE WHEN es_medico = 0 AND leido = 0 THEN 1 ELSE 0 END) AS mensajes_no_leidos
        FROM mensajes
        WHERE medico_id = ?
        GROUP BY paciente_id
      ) m ON u.id = m.paciente_id
      WHERE r.nombre = 'paciente'
      ORDER BY m.ultimo_mensaje_fecha DESC
    `, [medicoId]);

    res.json({
      error: false,
      conversaciones: rows
    });

  } catch (error) {
    console.error('[ERROR CONVERSACIONES]', error);
    res.status(500).json({
      error: true,
      mensaje: 'Error al obtener conversaciones',
      detalle: error.message
    });
  }
});

// ========================================
// OBTENER MENSAJES DE UN PACIENTE ESPECIFICO
// ========================================
router.get('/mensajes/conversacion/:pacienteId', verificarToken, async (req, res) => {
  try {
    const medicoId = req.usuario.id;
    const pacienteId = req.params.pacienteId;

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
    console.error('[ERROR MENSAJES]', error);
    res.status(500).json({
      error: true,
      mensaje: 'Error al obtener mensajes'
    });
  }
});

// ========================================
// ENVIAR MENSAJE
// ========================================
router.post('/mensajes/enviar', verificarToken, async (req, res) => {
  try {
    const medicoId = req.usuario.id;
    const { paciente_id, contenido } = req.body;

    if (!paciente_id || !contenido || !contenido.trim()) {
      return res.status(400).json({
        error: true,
        mensaje: 'Datos incompletos'
      });
    }

    const [result] = await pool.query(`
      INSERT INTO mensajes (medico_id, paciente_id, contenido, es_medico, leido)
      VALUES (?, ?, ?, 1, 0)
    `, [medicoId, paciente_id, contenido.trim()]);

    res.json({
      error: false,
      mensaje: 'Mensaje enviado',
      id: result.insertId
    });

  } catch (error) {
    console.error('[ERROR ENVIAR]', error);
    res.status(500).json({
      error: true,
      mensaje: 'Error al enviar mensaje'
    });
  }
});

// ========================================
// MARCAR MENSAJES COMO LEIDOS
// ========================================
router.put('/mensajes/leidos/:pacienteId', verificarToken, async (req, res) => {
  try {
    const medicoId = req.usuario.id;
    const pacienteId = req.params.pacienteId;

    await pool.query(`
      UPDATE mensajes
      SET leido = 1
      WHERE medico_id = ? AND paciente_id = ? AND es_medico = 0 AND leido = 0
    `, [medicoId, pacienteId]);

    res.json({
      error: false,
      mensaje: 'Mensajes marcados como leidos'
    });

  } catch (error) {
    console.error('[ERROR LEIDOS]', error);
    res.status(500).json({
      error: true,
      mensaje: 'Error al marcar como leidos'
    });
  }
});

// ========================================
// NOTIFICACIONES NO LEIDAS
// ========================================
router.get('/notificaciones/no-leidas', verificarToken, async (req, res) => {
  try {
    const medicoId = req.usuario.id;

    const [rows] = await pool.query(`
      SELECT COUNT(*) AS total
      FROM mensajes
      WHERE medico_id = ? AND es_medico = 0 AND leido = 0
    `, [medicoId]);

    res.json({
      error: false,
      total: rows[0].total,
      mensajesNoLeidos: rows[0].total
    });

  } catch (error) {
    console.error('[ERROR NOTIFICACIONES]', error);
    res.status(500).json({
      error: true,
      mensaje: 'Error al obtener notificaciones'
    });
  }
});

module.exports = router;