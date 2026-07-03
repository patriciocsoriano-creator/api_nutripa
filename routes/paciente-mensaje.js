// routes/paciente-mensaje.js
const express = require('express');
const router = express.Router();
const pool = require('../conexion').pool;
const { getConnection } = require('../conexion');
const { verificarToken } = require('../middleware/auth');

// ========================================
// HELPER: Obtener paciente_id real del usuario
// ========================================
async function obtenerPacienteId(usuarioId, connection) {
  const [paciente] = await connection.execute(
    'SELECT id FROM pacientes WHERE usuario_id = ? AND eliminado_en IS NULL AND activo = 1',
    [usuarioId]
  );
  
  if (paciente.length === 0) {
    // Si no tiene paciente vinculado, buscar por cédula
    const [usuario] = await connection.execute(
      'SELECT cedula FROM usuarios WHERE id = ?',
      [usuarioId]
    );
    
    if (usuario.length > 0 && usuario[0].cedula) {
      const [pacienteByCedula] = await connection.execute(
        'SELECT id FROM pacientes WHERE numero_identificacion = ? AND eliminado_en IS NULL',
        [usuario[0].cedula]
      );
      
      if (pacienteByCedula.length > 0) {
        return pacienteByCedula[0].id;
      }
    }
    return null;
  }
  
  return paciente[0].id;
}

// ========================================
// OBTENER CONVERSACION CON EL MEDICO ASIGNADO
// ========================================
router.get('/mensajes/conversacion', verificarToken, async (req, res) => {
  const usuarioId = req.usuario.id;
  let connection;
  
  try {
    connection = await getConnection();
    
    console.log('[MENSAJES] ========================================');
    console.log('[MENSAJES] Usuario ID del token:', usuarioId);
    
    // Obtener el paciente_id real del usuario
    const pacienteId = await obtenerPacienteId(usuarioId, connection);
    
    console.log('[MENSAJES] Paciente ID encontrado:', pacienteId);
    
    if (!pacienteId) {
      console.warn('[MENSAJES] No se encontro paciente para usuario:', usuarioId);
      
      // Debug: verificar si existe el paciente
      const [pacienteCheck] = await connection.execute(
        'SELECT id, nombres, apellidos, usuario_id FROM pacientes WHERE usuario_id = ?',
        [usuarioId]
      );
      console.log('[MENSAJES] Debug - Pacientes con este usuario_id:', pacienteCheck);
      
      return res.json({
        error: false,
        conversaciones: [],
        sinMedico: true,
        mensaje: 'No tienes un perfil de paciente asociado'
      });
    }
    
    console.log('[MENSAJES] Buscando medico para paciente:', pacienteId);

    const [medicoRows] = await connection.execute(`
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

    console.log('[MENSAJES] Medicos encontrados:', medicoRows.length);
    console.log('[MENSAJES] Resultado:', medicoRows);

    if (medicoRows.length === 0) {
      console.warn('[MENSAJES] No hay medico asignado para paciente:', pacienteId);
      
      // Debug: verificar asignaciones
      const [asignacionesCheck] = await connection.execute(
        'SELECT * FROM asignaciones WHERE paciente_id = ?',
        [pacienteId]
      );
      console.log('[MENSAJES] Debug - Asignaciones para este paciente:', asignacionesCheck);
      
      return res.json({
        error: false,
        conversaciones: [],
        sinMedico: true,
        mensaje: 'No tienes un medico asignado aun'
      });
    }

    const medico = medicoRows[0];
    console.log('[MENSAJES] Medico encontrado:', medico.nombre_medico);

    const [mensajeRows] = await connection.execute(`
      SELECT 
        contenido AS ultimo_mensaje,
        fecha AS ultimo_mensaje_fecha,
        es_medico
      FROM mensajes
      WHERE (medico_id = ? AND paciente_id = ?)
      ORDER BY fecha DESC
      LIMIT 1
    `, [medico.medico_id, pacienteId]);

    const [noLeidosRows] = await connection.execute(`
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

    console.log('[MENSAJES] Conversacion construida exitosamente');
    console.log('[MENSAJES] ========================================');

    res.json({
      error: false,
      conversaciones: [conversacion],
      sinMedico: false
    });

  } catch (error) {
    console.error('[ERROR CONVERSACION PACIENTE]', {
      message: error.message,
      code: error.code,
      sqlState: error.sqlState
    });
    res.status(500).json({
      error: true,
      mensaje: 'Error al obtener conversacion',
      detalle: error.message
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// ========================================
// OBTENER MENSAJES DE LA CONVERSACION
// ========================================
router.get('/mensajes/conversacion/:medicoId', verificarToken, async (req, res) => {
  const usuarioId = req.usuario.id;
  const medicoId = req.params.medicoId;
  let connection;
  
  try {
    connection = await getConnection();
    const pacienteId = await obtenerPacienteId(usuarioId, connection);
    
    if (!pacienteId) {
      return res.status(404).json({ error: true, mensaje: 'Paciente no encontrado' });
    }

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
    console.error('[ERROR MENSAJES PACIENTE]', error);
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
// ENVIAR MENSAJE AL MEDICO
// ========================================
router.post('/mensajes/enviar', verificarToken, async (req, res) => {
  const usuarioId = req.usuario.id;
  const { medico_id, contenido } = req.body;
  let connection;
  
  try {
    connection = await getConnection();
    const pacienteId = await obtenerPacienteId(usuarioId, connection);
    
    if (!pacienteId) {
      return res.status(404).json({ error: true, mensaje: 'Paciente no encontrado' });
    }

    if (!medico_id || !contenido || !contenido.trim()) {
      return res.status(400).json({
        error: true,
        mensaje: 'Datos incompletos'
      });
    }

    const [asignacionRows] = await connection.execute(`
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

    const [result] = await connection.execute(`
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
router.put('/mensajes/leidos/:medicoId', verificarToken, async (req, res) => {
  const usuarioId = req.usuario.id;
  const medicoId = req.params.medicoId;
  let connection;
  
  try {
    connection = await getConnection();
    const pacienteId = await obtenerPacienteId(usuarioId, connection);
    
    if (!pacienteId) {
      return res.status(404).json({ error: true, mensaje: 'Paciente no encontrado' });
    }

    await connection.execute(`
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
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// ========================================
// CONTADOR DE MENSAJES NO LEIDOS
// ========================================
router.get('/mensajes/no-leidos', verificarToken, async (req, res) => {
  const usuarioId = req.usuario.id;
  let connection;
  
  try {
    connection = await getConnection();
    const pacienteId = await obtenerPacienteId(usuarioId, connection);
    
    if (!pacienteId) {
      return res.json({ error: false, total: 0 });
    }

    const [rows] = await connection.execute(`
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
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

module.exports = router;