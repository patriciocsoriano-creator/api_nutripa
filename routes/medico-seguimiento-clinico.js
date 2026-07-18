// routes/medico-seguimiento-clinico.js
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getConnection } = require('../conexion');
const { verificarToken, verificarRol } = require('../middleware/auth');

console.log(' [ROUTER] Cargando medico-seguimiento-clinico.js');

// ============================================================================
//  Middleware: Verificar autenticación para todas las rutas
// ============================================================================
router.use(verificarToken);

// ============================================================================
//  EVOLUCIONES CLÍNICAS
// ============================================================================

// GET /nutricionapp-api/medico/seguimiento/evoluciones/:paciente_id
// Obtener todas las evoluciones de un paciente
router.get('/evoluciones/:paciente_id', verificarRol('doctor', 'nutricionista', 'enfermera'), async (req, res) => {
  const { paciente_id } = req.params;
  let connection;

  try {
    connection = await getConnection();

    const [evoluciones] = await connection.execute(
      `SELECT 
        e.*,
        CONCAT(u.nombre, ' ', u.apellido) AS medico_nombre
       FROM seguimiento_evolucion e
       INNER JOIN usuarios u ON u.id = e.medico_id
       WHERE e.paciente_id = ?
       ORDER BY e.fecha DESC, e.creado_en DESC`,
      [paciente_id]
    );

    return res.status(200).json({
      error: false,
      total: evoluciones.length,
      evoluciones: evoluciones
    });

  } catch (err) {
    console.error(' [SEGUIMIENTO] Error listando evoluciones:', err);
    return res.status(500).json({ 
      error: true, 
      mensaje: 'Error al obtener evoluciones' 
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// POST /nutricionapp-api/medico/seguimiento/evolucion
// Crear nueva evolución
router.post('/evolucion', verificarRol('doctor', 'nutricionista', 'enfermera'), async (req, res) => {
  const medico_id = req.usuario?.id;
  const { paciente_id, fecha, objetivos, observaciones, adherencia } = req.body;

  // Validaciones
  if (!paciente_id || !fecha || !objetivos || !adherencia) {
    return res.status(400).json({ 
      error: true, 
      mensaje: 'Faltan campos requeridos: paciente_id, fecha, objetivos, adherencia' 
    });
  }

  const adherenciasValidas = ['excelente', 'buena', 'regular', 'baja'];
  if (!adherenciasValidas.includes(adherencia)) {
    return res.status(400).json({ 
      error: true, 
      mensaje: 'Valor de adherencia inválido. Debe ser: excelente, buena, regular o baja' 
    });
  }

  let connection;
  try {
    connection = await getConnection();

    // Verificar que el paciente existe
    const [paciente] = await connection.execute(
      'SELECT id FROM pacientes WHERE id = ? AND eliminado_en IS NULL',
      [paciente_id]
    );

    if (!paciente.length) {
      return res.status(404).json({ error: true, mensaje: 'Paciente no encontrado' });
    }

    const id = uuidv4();
    await connection.execute(
      `INSERT INTO seguimiento_evolucion 
        (id, paciente_id, medico_id, fecha, objetivos, observaciones, adherencia) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, paciente_id, medico_id, fecha, objetivos, observaciones || null, adherencia]
    );

    console.log(` [SEGUIMIENTO] Evolución creada: ${id} para paciente ${paciente_id}`);

    return res.status(201).json({
      error: false,
      mensaje: 'Evolución registrada exitosamente',
      evolucion_id: id
    });

  } catch (err) {
    console.error(' [SEGUIMIENTO] Error creando evolución:', err);
    return res.status(500).json({ 
      error: true, 
      mensaje: 'Error al registrar evolución' 
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// DELETE /nutricionapp-api/medico/seguimiento/evolucion/:id
// Eliminar evolución
router.delete('/evolucion/:id', verificarRol('doctor', 'nutricionista'), async (req, res) => {
  const { id } = req.params;
  let connection;

  try {
    connection = await getConnection();

    const [result] = await connection.execute(
      'DELETE FROM seguimiento_evolucion WHERE id = ?',
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: true, mensaje: 'Evolución no encontrada' });
    }

    console.log(` [SEGUIMIENTO] Evolución eliminada: ${id}`);

    return res.status(200).json({
      error: false,
      mensaje: 'Evolución eliminada exitosamente'
    });

  } catch (err) {
    console.error(' [SEGUIMIENTO] Error eliminando evolución:', err);
    return res.status(500).json({ 
      error: true, 
      mensaje: 'Error al eliminar evolución' 
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// ============================================================================
//  CITAS
// ============================================================================

// GET /nutricionapp-api/medico/seguimiento/citas/:paciente_id
// Obtener todas las citas de un paciente
router.get('/citas/:paciente_id', verificarRol('doctor', 'nutricionista', 'enfermera'), async (req, res) => {
  const { paciente_id } = req.params;
  let connection;

  try {
    connection = await getConnection();

    const [citas] = await connection.execute(
      `SELECT 
        c.*,
        CONCAT(u.nombre, ' ', u.apellido) AS medico_nombre
       FROM seguimiento_citas c
       INNER JOIN usuarios u ON u.id = c.medico_id
       WHERE c.paciente_id = ?
       ORDER BY c.fecha_hora DESC`,
      [paciente_id]
    );

    return res.status(200).json({
      error: false,
      total: citas.length,
      citas: citas
    });

  } catch (err) {
    console.error(' [SEGUIMIENTO] Error listando citas:', err);
    return res.status(500).json({ 
      error: true, 
      mensaje: 'Error al obtener citas' 
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// POST /nutricionapp-api/medico/seguimiento/cita
// Agendar nueva cita
router.post('/cita', verificarRol('doctor', 'nutricionista', 'enfermera'), async (req, res) => {
  const medico_id = req.usuario?.id;
  const { paciente_id, fecha_hora, tipo, motivo } = req.body;

  // Validaciones
  if (!paciente_id || !fecha_hora || !tipo) {
    return res.status(400).json({ 
      error: true, 
      mensaje: 'Faltan campos requeridos: paciente_id, fecha_hora, tipo' 
    });
  }

  const tiposValidos = ['control', 'seguimiento', 'evaluacion', 'urgencia', 'teleconsulta'];
  if (!tiposValidos.includes(tipo)) {
    return res.status(400).json({ 
      error: true, 
      mensaje: 'Tipo de cita inválido' 
    });
  }

  // Validar que la fecha sea futura
  const fechaCita = new Date(fecha_hora);
  if (fechaCita < new Date()) {
    return res.status(400).json({ 
      error: true, 
      mensaje: 'La fecha de la cita debe ser futura' 
    });
  }

  let connection;
  try {
    connection = await getConnection();

    // Verificar paciente
    const [paciente] = await connection.execute(
      'SELECT id FROM pacientes WHERE id = ? AND eliminado_en IS NULL',
      [paciente_id]
    );

    if (!paciente.length) {
      return res.status(404).json({ error: true, mensaje: 'Paciente no encontrado' });
    }

    const id = uuidv4();
    await connection.execute(
      `INSERT INTO seguimiento_citas 
        (id, paciente_id, medico_id, fecha_hora, tipo, motivo) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, paciente_id, medico_id, fecha_hora, tipo, motivo || null]
    );

    console.log(` [SEGUIMIENTO] Cita agendada: ${id} para ${fecha_hora}`);

    return res.status(201).json({
      error: false,
      mensaje: 'Cita agendada exitosamente',
      cita_id: id
    });

  } catch (err) {
    console.error(' [SEGUIMIENTO] Error agendando cita:', err);
    return res.status(500).json({ 
      error: true, 
      mensaje: 'Error al agendar cita' 
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// PUT /nutricionapp-api/medico/seguimiento/cita/:id/estado
// Actualizar estado de cita
router.put('/cita/:id/estado', verificarRol('doctor', 'nutricionista', 'enfermera'), async (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;

  const estadosValidos = ['agendada', 'confirmada', 'cancelada', 'completada'];
  if (!estadosValidos.includes(estado)) {
    return res.status(400).json({ error: true, mensaje: 'Estado inválido' });
  }

  let connection;
  try {
    connection = await getConnection();

    const [result] = await connection.execute(
      'UPDATE seguimiento_citas SET estado = ? WHERE id = ?',
      [estado, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: true, mensaje: 'Cita no encontrada' });
    }

    return res.status(200).json({
      error: false,
      mensaje: 'Estado de cita actualizado'
    });

  } catch (err) {
    console.error(' [SEGUIMIENTO] Error actualizando cita:', err);
    return res.status(500).json({ error: true, mensaje: 'Error al actualizar cita' });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// DELETE /nutricionapp-api/medico/seguimiento/cita/:id
// Cancelar/Eliminar cita
router.delete('/cita/:id', verificarRol('doctor', 'nutricionista'), async (req, res) => {
  const { id } = req.params;
  let connection;

  try {
    connection = await getConnection();

    const [result] = await connection.execute(
      'DELETE FROM seguimiento_citas WHERE id = ?',
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: true, mensaje: 'Cita no encontrada' });
    }

    console.log(` [SEGUIMIENTO] Cita eliminada: ${id}`);

    return res.status(200).json({
      error: false,
      mensaje: 'Cita cancelada exitosamente'
    });

  } catch (err) {
    console.error(' [SEGUIMIENTO] Error eliminando cita:', err);
    return res.status(500).json({ error: true, mensaje: 'Error al eliminar cita' });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// ============================================================================
//  MEDICIONES DE GLUCOSA
// ============================================================================

// GET /nutricionapp-api/medico/seguimiento/glucosa/:paciente_id
// Obtener historial de glucosa
router.get('/glucosa/:paciente_id', verificarRol('doctor', 'nutricionista', 'enfermera'), async (req, res) => {
  const { paciente_id } = req.params;
  let connection;

  try {
    connection = await getConnection();

    const [historial] = await connection.execute(
      `SELECT 
        g.*,
        CONCAT(u.nombre, ' ', u.apellido) AS medico_nombre
       FROM seguimiento_glucosa g
       INNER JOIN usuarios u ON u.id = g.medico_id
       WHERE g.paciente_id = ?
       ORDER BY g.fecha DESC, g.creado_en DESC
       LIMIT 50`,
      [paciente_id]
    );

    return res.status(200).json({
      error: false,
      total: historial.length,
      historial: historial
    });

  } catch (err) {
    console.error(' [SEGUIMIENTO] Error listando glucosa:', err);
    return res.status(500).json({ 
      error: true, 
      mensaje: 'Error al obtener historial de glucosa' 
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// POST /nutricionapp-api/medico/seguimiento/glucosa
// Registrar nueva medición
router.post('/glucosa', verificarRol('doctor', 'nutricionista', 'enfermera'), async (req, res) => {
  const medico_id = req.usuario?.id;
  const { 
    paciente_id, 
    fecha, 
    glucosa_ayunas, 
    hba1c, 
    glucosa_postprandial, 
    observaciones 
  } = req.body;

  // Validaciones
  if (!paciente_id || !fecha) {
    return res.status(400).json({ 
      error: true, 
      mensaje: 'Faltan campos requeridos: paciente_id, fecha' 
    });
  }

  // Al menos un valor de glucosa debe estar presente
  if (!glucosa_ayunas && !hba1c && !glucosa_postprandial) {
    return res.status(400).json({ 
      error: true, 
      mensaje: 'Debe ingresar al menos un valor de glucosa' 
    });
  }

  // Validar rangos
  if (glucosa_ayunas && (glucosa_ayunas < 40 || glucosa_ayunas > 500)) {
    return res.status(400).json({ 
      error: true, 
      mensaje: 'Glucosa en ayunas fuera de rango válido (40-500)' 
    });
  }

  if (hba1c && (hba1c < 3 || hba1c > 20)) {
    return res.status(400).json({ 
      error: true, 
      mensaje: 'HbA1c fuera de rango válido (3-20)' 
    });
  }

  if (glucosa_postprandial && (glucosa_postprandial < 50 || glucosa_postprandial > 600)) {
    return res.status(400).json({ 
      error: true, 
      mensaje: 'Glucosa postprandial fuera de rango válido (50-600)' 
    });
  }

  let connection;
  try {
    connection = await getConnection();

    // Verificar paciente
    const [paciente] = await connection.execute(
      'SELECT id FROM pacientes WHERE id = ? AND eliminado_en IS NULL',
      [paciente_id]
    );

    if (!paciente.length) {
      return res.status(404).json({ error: true, mensaje: 'Paciente no encontrado' });
    }

    const id = uuidv4();
    await connection.execute(
      `INSERT INTO seguimiento_glucosa 
        (id, paciente_id, medico_id, fecha, glucosa_ayunas, hba1c, glucosa_postprandial, observaciones) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, 
        paciente_id, 
        medico_id, 
        fecha, 
        glucosa_ayunas || null, 
        hba1c || null, 
        glucosa_postprandial || null, 
        observaciones || null
      ]
    );

    console.log(` [SEGUIMIENTO] Medición glucosa registrada: ${id}`);

    return res.status(201).json({
      error: false,
      mensaje: 'Medición registrada exitosamente',
      medicion_id: id
    });

  } catch (err) {
    console.error(' [SEGUIMIENTO] Error registrando glucosa:', err);
    return res.status(500).json({ 
      error: true, 
      mensaje: 'Error al registrar medición' 
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// GET /nutricionapp-api/medico/seguimiento/glucosa/:paciente_id/actual
// Obtener la medición más reciente
router.get('/glucosa/:paciente_id/actual', verificarRol('doctor', 'nutricionista', 'enfermera'), async (req, res) => {
  const { paciente_id } = req.params;
  let connection;

  try {
    connection = await getConnection();

    const [registro] = await connection.execute(
      `SELECT * FROM seguimiento_glucosa 
       WHERE paciente_id = ? 
       ORDER BY fecha DESC, creado_en DESC 
       LIMIT 1`,
      [paciente_id]
    );

    if (!registro.length) {
      return res.status(200).json({
        error: false,
        registro: null,
        mensaje: 'No hay mediciones registradas'
      });
    }

    return res.status(200).json({
      error: false,
      registro: registro[0]
    });

  } catch (err) {
    console.error(' [SEGUIMIENTO] Error obteniendo medición actual:', err);
    return res.status(500).json({ 
      error: true, 
      mensaje: 'Error al obtener medición' 
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// ============================================================================
//  DASHBOARD DE SEGUIMIENTO
// ============================================================================

// GET /nutricionapp-api/medico/seguimiento/dashboard/:paciente_id
// Resumen completo del seguimiento de un paciente
router.get('/dashboard/:paciente_id', verificarRol('doctor', 'nutricionista'), async (req, res) => {
  const { paciente_id } = req.params;
  let connection;

  try {
    connection = await getConnection();

    // Total de evoluciones
    const [evoluciones] = await connection.execute(
      'SELECT COUNT(*) as total FROM seguimiento_evolucion WHERE paciente_id = ?',
      [paciente_id]
    );

    // Total de citas
    const [citas] = await connection.execute(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN estado = 'agendada' AND fecha_hora >= NOW() THEN 1 ELSE 0 END) as proximas,
        SUM(CASE WHEN estado = 'completada' THEN 1 ELSE 0 END) as completadas
       FROM seguimiento_citas 
       WHERE paciente_id = ?`,
      [paciente_id]
    );

    // Última medición de glucosa
    const [ultimaGlucosa] = await connection.execute(
      `SELECT * FROM seguimiento_glucosa 
       WHERE paciente_id = ? 
       ORDER BY fecha DESC LIMIT 1`,
      [paciente_id]
    );

    // Tendencia de glucosa (últimas 5 mediciones)
    const [tendencia] = await connection.execute(
      `SELECT fecha, glucosa_ayunas, hba1c 
       FROM seguimiento_glucosa 
       WHERE paciente_id = ? 
       ORDER BY fecha DESC 
       LIMIT 5`,
      [paciente_id]
    );

    // Próxima cita
    const [proximaCita] = await connection.execute(
      `SELECT * FROM seguimiento_citas 
       WHERE paciente_id = ? 
         AND estado IN ('agendada', 'confirmada')
         AND fecha_hora >= NOW()
       ORDER BY fecha_hora ASC 
       LIMIT 1`,
      [paciente_id]
    );

    return res.status(200).json({
      error: false,
      dashboard: {
        evoluciones_total: evoluciones[0].total,
        citas: citas[0],
        ultima_glucosa: ultimaGlucosa[0] || null,
        tendencia_glucosa: tendencia,
        proxima_cita: proximaCita[0] || null
      }
    });

  } catch (err) {
    console.error(' [SEGUIMIENTO] Error obteniendo dashboard:', err);
    return res.status(500).json({ 
      error: true, 
      mensaje: 'Error al obtener dashboard' 
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

console.log(' [ROUTER] medico-seguimiento-clinico.js cargado correctamente');
module.exports = router;