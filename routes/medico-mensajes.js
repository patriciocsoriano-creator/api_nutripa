const express = require('express');
const router = express.Router();
const { getConnection } = require('../conexion');
const { verificarToken } = require('../middleware/auth');

// ========================================
// HELPER: Convertir usuario_id a paciente_id si es necesario
// ========================================
async function obtenerPacienteIdReal(pacienteIdInput, connection) {
  // Primero intentar buscar como usuario_id
  const [pacienteByUsuario] = await connection.execute(
    'SELECT id FROM pacientes WHERE usuario_id = ? AND activo = 1 AND eliminado_en IS NULL',
    [pacienteIdInput]
  );
  
  if (pacienteByUsuario.length > 0) {
    return pacienteByUsuario[0].id;
  }
  
  // Si no se encuentra, verificar si es un paciente_id válido
  const [pacienteDirecto] = await connection.execute(
    'SELECT id FROM pacientes WHERE id = ? AND activo = 1 AND eliminado_en IS NULL',
    [pacienteIdInput]
  );
  
  if (pacienteDirecto.length > 0) {
    return pacienteDirecto[0].id;
  }
  
  return null;
}

// ========================================
// OBTENER CONVERSACIONES (LISTA DE PACIENTES)
// ========================================
router.get('/mensajes/conversaciones', verificarToken, async (req, res) => {
  const medicoId = req.usuario.id;
  let connection;
  
  try {
    connection = await getConnection();
    
    console.log('[CONVERSACIONES MEDICO] Buscando para medico:', medicoId);

    const [rows] = await connection.execute(`
      SELECT 
        p.id AS paciente_id,
        p.usuario_id,
        CONCAT(p.nombres, ' ', p.apellidos) AS nombre_paciente,
        m.ultimo_mensaje,
        m.ultimo_mensaje_fecha,
        m.mensajes_no_leidos
      FROM pacientes p
      INNER JOIN (
        SELECT 
          paciente_id,
          SUBSTRING_INDEX(GROUP_CONCAT(contenido ORDER BY fecha DESC), ',', 1) AS ultimo_mensaje,
          MAX(fecha) AS ultimo_mensaje_fecha,
          SUM(CASE WHEN es_medico = 0 AND leido = 0 THEN 1 ELSE 0 END) AS mensajes_no_leidos
        FROM mensajes
        WHERE medico_id = ?
        GROUP BY paciente_id
      ) m ON p.id = m.paciente_id
      ORDER BY m.ultimo_mensaje_fecha DESC
    `, [medicoId]);

    console.log('[CONVERSACIONES MEDICO] Encontradas:', rows.length);

    res.json({
      error: false,
      conversaciones: rows
    });

  } catch (error) {
    console.error('[ERROR CONVERSACIONES]', {
      message: error.message,
      code: error.code,
      sqlState: error.sqlState
    });
    res.status(500).json({
      error: true,
      mensaje: 'Error al obtener conversaciones',
      detalle: error.message
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// ========================================
// OBTENER MENSAJES DE UN PACIENTE ESPECIFICO
// ========================================
router.get('/mensajes/conversacion/:pacienteId', verificarToken, async (req, res) => {
  const medicoId = req.usuario.id;
  const pacienteIdInput = req.params.pacienteId;
  let connection;
  
  try {
    connection = await getConnection();
    
    // Convertir a paciente_id real si es necesario
    const pacienteId = await obtenerPacienteIdReal(pacienteIdInput, connection);
    
    if (!pacienteId) {
      return res.status(404).json({
        error: true,
        mensaje: 'Paciente no encontrado'
      });
    }
    
    console.log('[MENSAJES MEDICO] Cargando mensajes para paciente:', pacienteId);

    const [rows] = await connection.execute(`
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
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// ========================================
// ENVIAR MENSAJE
// ========================================
router.post('/mensajes/enviar', verificarToken, async (req, res) => {
  const medicoId = req.usuario.id;
  const { paciente_id, contenido } = req.body;
  let connection;
  
  try {
    connection = await getConnection();
    
    console.log('[ENVIAR MEDICO] ========================================');
    console.log('[ENVIAR MEDICO] Medico ID:', medicoId);
    console.log('[ENVIAR MEDICO] Paciente ID recibido:', paciente_id);
    console.log('[ENVIAR MEDICO] Contenido:', contenido);
    
    // Convertir a paciente_id real si es necesario
    const pacienteIdReal = await obtenerPacienteIdReal(paciente_id, connection);
    
    console.log('[ENVIAR MEDICO] Paciente ID real:', pacienteIdReal);
    
    if (!pacienteIdReal) {
      return res.status(404).json({
        error: true,
        mensaje: 'Paciente no encontrado'
      });
    }

    if (!contenido || !contenido.trim()) {
      return res.status(400).json({
        error: true,
        mensaje: 'Contenido del mensaje es obligatorio'
      });
    }

    // Verificar asignación
    const [asignacionRows] = await connection.execute(`
      SELECT id FROM asignaciones
      WHERE medico_id = ? AND paciente_id = ? AND estado = 'activo'
      LIMIT 1
    `, [medicoId, pacienteIdReal]);

    if (asignacionRows.length === 0) {
      return res.status(403).json({
        error: true,
        mensaje: 'No tienes permiso para enviar mensajes a este paciente'
      });
    }

    const [result] = await connection.execute(`
      INSERT INTO mensajes (medico_id, paciente_id, contenido, es_medico, leido)
      VALUES (?, ?, ?, 1, 0)
    `, [medicoId, pacienteIdReal, contenido.trim()]);

    console.log('[ENVIAR MEDICO] Mensaje insertado con ID:', result.insertId);
    console.log('[ENVIAR MEDICO] ========================================');

    res.json({
      error: false,
      mensaje: 'Mensaje enviado',
      id: result.insertId
    });

  } catch (error) {
    console.error('[ERROR ENVIAR MEDICO]', {
      message: error.message,
      code: error.code,
      sqlState: error.sqlState
    });
    res.status(500).json({
      error: true,
      mensaje: 'Error al enviar mensaje',
      detalle: error.message
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// ========================================
// MARCAR MENSAJES COMO LEIDOS
// ========================================
router.put('/mensajes/leidos/:pacienteId', verificarToken, async (req, res) => {
  const medicoId = req.usuario.id;
  const pacienteIdInput = req.params.pacienteId;
  let connection;
  
  try {
    connection = await getConnection();
    
    // Convertir a paciente_id real si es necesario
    const pacienteId = await obtenerPacienteIdReal(pacienteIdInput, connection);
    
    if (!pacienteId) {
      return res.status(404).json({
        error: true,
        mensaje: 'Paciente no encontrado'
      });
    }

    await connection.execute(`
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
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// ========================================
// NOTIFICACIONES NO LEIDAS
// ========================================
router.get('/notificaciones/no-leidas', verificarToken, async (req, res) => {
  const medicoId = req.usuario.id;
  let connection;
  
  try {
    connection = await getConnection();

    const [rows] = await connection.execute(`
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
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

module.exports = router;