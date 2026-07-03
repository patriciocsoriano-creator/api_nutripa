// routes/paciente-plan.js
const express = require('express');
const router = express.Router();
const { getConnection } = require('../conexion');
const { verificarToken, verificarRol } = require('../middleware/auth');

console.log(' [ROUTER] Cargando paciente-plan.js');

// Middleware: solo pacientes autenticados
router.use(verificarToken);
router.use(verificarRol('paciente'));

// ============================================================================
//  FUNCIÓN HELPER: Obtener paciente_id del usuario logueado
//  CORREGIDO: Buscar en tabla pacientes por usuario_id
// ============================================================================
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

// ============================================================================
//  GET /nutricionapp-api/paciente/plan/plan-activo
//  Obtener el plan nutricional activo del paciente
// ============================================================================
router.get('/plan-activo', async (req, res) => {
  const usuarioId = req.usuario?.id;
  
  if (!usuarioId) {
    return res.status(400).json({ error: true, mensaje: 'Usuario no autenticado' });
  }

  let connection;
  try {
    connection = await getConnection();
    
    //  Obtener el paciente_id correctamente
    const pacienteId = await obtenerPacienteId(usuarioId, connection);
    
    if (!pacienteId) {
      console.log(` [PACIENTE] No se encontró paciente vinculado al usuario ${usuarioId}`);
      return res.status(200).json({
        error: false,
        plan: null,
        mensaje: 'No tienes un perfil de paciente asociado'
      });
    }

    console.log(` [PACIENTE] Buscando plan para paciente_id: ${pacienteId}`);

    // Buscar el plan más reciente y activo
    const [planes] = await connection.execute(
      `SELECT 
        pn.id,
        pn.paciente_id,
        pn.medico_id,
        pn.perfil_recomendado,
        pn.confianza_ia,
        pn.recomendaciones,
        pn.duracion_semanas,
        pn.alergias,
        pn.preferencias,
        pn.plan_detallado,
        pn.estado,
        pn.fecha_creacion,
        pn.fecha_vigencia_desde,
        pn.fecha_vigencia_hasta,
        CONCAT(u.nombre, ' ', u.apellido) as medico_nombre,
        u.telefono as medico_telefono
       FROM planes_nutricionales pn
       INNER JOIN usuarios u ON u.id = pn.medico_id
       WHERE pn.paciente_id = ? 
         AND pn.estado = 'activo'
       ORDER BY pn.fecha_creacion DESC
       LIMIT 1`,
      [pacienteId]
    );

    if (planes.length === 0) {
      console.log(` [PACIENTE] No hay plan activo para paciente ${pacienteId}`);
      return res.status(200).json({
        error: false,
        plan: null,
        mensaje: 'No tienes un plan nutricional activo actualmente'
      });
    }

    const plan = planes[0];
    console.log(` [PACIENTE] Plan encontrado: ${plan.id}`);

    // Parsear campos JSON
    const planParseado = {
      id: plan.id,
      paciente_id: plan.paciente_id,
      medico_id: plan.medico_id,
      medico_nombre: plan.medico_nombre,
      medico_telefono: plan.medico_telefono,
      perfil_recomendado: plan.perfil_recomendado,
      confianza_ia: parseFloat(plan.confianza_ia) || 0,
      recomendaciones: plan.recomendaciones,
      duracion_semanas: plan.duracion_semanas,
      alergias: plan.alergias ? JSON.parse(plan.alergias) : [],
      preferencias: plan.preferencias ? JSON.parse(plan.preferencias) : null,
      plan_detallado: plan.plan_detallado ? JSON.parse(plan.plan_detallado) : null,
      estado: plan.estado,
      fecha_creacion: plan.fecha_creacion,
      fecha_vigencia_desde: plan.fecha_vigencia_desde,
      fecha_vigencia_hasta: plan.fecha_vigencia_hasta
    };

    return res.status(200).json({
      error: false,
      plan: planParseado
    });

  } catch (err) {
    console.error(' [PACIENTE] Error obteniendo plan:', err);
    return res.status(500).json({ 
      error: true, 
      mensaje: 'Error al obtener el plan nutricional: ' + err.message 
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// ============================================================================
//  GET /nutricionapp-api/paciente/plan/ultimo-registro
//  Obtener el último registro clínico del paciente
// ============================================================================
router.get('/ultimo-registro', async (req, res) => {
  const usuarioId = req.usuario?.id;
  
  let connection;
  try {
    connection = await getConnection();
    const pacienteId = await obtenerPacienteId(usuarioId, connection);
    
    if (!pacienteId) {
      return res.status(200).json({ error: false, registro: null });
    }

    // Buscar el registro más reciente finalizado
    const [registros] = await connection.execute(
      `SELECT 
        r.id,
        r.estado,
        r.fecha_finalizacion,
        r.signos_vitales,
        r.datos_antropometricos,
        r.condiciones_metabolicas,
        r.fecha_inicio
       FROM registro r
       WHERE r.paciente_id = ? 
         AND r.estado = 'finalizado'
       ORDER BY r.fecha_finalizacion DESC
       LIMIT 1`,
      [pacienteId]
    );

    if (registros.length === 0) {
      return res.status(200).json({ error: false, registro: null });
    }

    const registro = registros[0];
    
    // Parsear JSONs
    const registroParseado = {
      id: registro.id,
      fecha: registro.fecha_finalizacion || registro.fecha_inicio,
      signos_vitales: registro.signos_vitales ? JSON.parse(registro.signos_vitales) : null,
      datos_antropometricos: registro.datos_antropometricos ? JSON.parse(registro.datos_antropometricos) : null,
      condiciones_metabolicas: registro.condiciones_metabolicas ? JSON.parse(registro.condiciones_metabolicas) : null
    };

    return res.status(200).json({
      error: false,
      registro: registroParseado
    });

  } catch (err) {
    console.error(' [PACIENTE] Error obteniendo último registro:', err);
    return res.status(500).json({ 
      error: true, 
      mensaje: 'Error al obtener el registro' 
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// ============================================================================
//  GET /nutricionapp-api/paciente/plan/proxima-cita
//  Obtener la próxima cita del paciente
// ============================================================================
router.get('/proxima-cita', async (req, res) => {
  const usuarioId = req.usuario?.id;
  
  let connection;
  try {
    connection = await getConnection();
    const pacienteId = await obtenerPacienteId(usuarioId, connection);
    
    if (!pacienteId) {
      return res.status(200).json({ error: false, cita: null });
    }

    // Buscar la próxima cita agendada
    const [citas] = await connection.execute(
      `SELECT 
        sc.id,
        sc.fecha_hora,
        sc.tipo,
        sc.motivo,
        sc.estado,
        CONCAT(u.nombre, ' ', u.apellido) as medico_nombre,
        u.telefono as medico_telefono
       FROM seguimiento_citas sc
       INNER JOIN usuarios u ON u.id = sc.medico_id
       WHERE sc.paciente_id = ? 
         AND sc.estado IN ('agendada', 'confirmada')
         AND sc.fecha_hora >= NOW()
       ORDER BY sc.fecha_hora ASC
       LIMIT 1`,
      [pacienteId]
    );

    if (citas.length === 0) {
      return res.status(200).json({ error: false, cita: null });
    }

    return res.status(200).json({
      error: false,
      cita: citas[0]
    });

  } catch (err) {
    console.error(' [PACIENTE] Error obteniendo próxima cita:', err);
    // Si la tabla no existe, devolver null sin error
    return res.status(200).json({ error: false, cita: null });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// ============================================================================
// GET /nutricionapp-api/paciente/plan/historial
//  Obtener historial de planes del paciente
// ============================================================================
router.get('/historial', async (req, res) => {
  const usuarioId = req.usuario?.id;
  
  let connection;
  try {
    connection = await getConnection();
    const pacienteId = await obtenerPacienteId(usuarioId, connection);
    
    if (!pacienteId) {
      return res.status(200).json({ error: false, total: 0, planes: [] });
    }

    const [planes] = await connection.execute(
      `SELECT 
        pn.id,
        pn.perfil_recomendado,
        pn.estado,
        pn.duracion_semanas,
        pn.fecha_creacion,
        pn.fecha_vigencia_desde,
        pn.fecha_vigencia_hasta,
        CONCAT(u.nombre, ' ', u.apellido) as medico_nombre
       FROM planes_nutricionales pn
       INNER JOIN usuarios u ON u.id = pn.medico_id
       WHERE pn.paciente_id = ?
       ORDER BY pn.fecha_creacion DESC`,
      [pacienteId]
    );

    return res.status(200).json({
      error: false,
      total: planes.length,
      planes: planes
    });

  } catch (err) {
    console.error(' [PACIENTE] Error obteniendo historial:', err);
    return res.status(500).json({ 
      error: true, 
      mensaje: 'Error al obtener historial' 
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});


// ============================================================================
//  GET /nutricionapp-api/paciente/plan/historial
// Obtener historial de planes del paciente autenticado
// ============================================================================
router.get('/historial', async (req, res) => {
  const usuarioId = req.usuario?.id;
  
  if (!usuarioId) {
    return res.status(401).json({ error: true, mensaje: 'No autenticado' });
  }

  let connection;
  try {
    connection = await getConnection();

    // Primero obtener el paciente_id del usuario logueado
    const [paciente] = await connection.execute(
      `SELECT p.id, p.nombres, p.apellidos 
       FROM pacientes p 
       WHERE p.usuario_id = ? AND p.activo = 1 AND p.eliminado_en IS NULL`,
      [usuarioId]
    );

    if (paciente.length === 0) {
      return res.status(200).json({
        error: false,
        total: 0,
        planes: [],
        mensaje: 'No tienes un perfil de paciente asociado'
      });
    }

    const pacienteId = paciente[0].id;

    // Obtener todos los planes del paciente con datos del médico
    const [planes] = await connection.execute(
      `SELECT 
        pn.id,
        pn.perfil_recomendado,
        pn.confianza_ia,
        pn.duracion_semanas,
        pn.recomendaciones,
        pn.estado,
        pn.fecha_creacion,
        pn.fecha_vigencia_desde,
        pn.fecha_vigencia_hasta,
        pn.alergias,
        CONCAT(u.nombre, ' ', u.apellido) as medico_nombre,
        r.nombre as rol_medico
       FROM planes_nutricionales pn
       INNER JOIN usuarios u ON u.id = pn.medico_id
       LEFT JOIN roles r ON r.id = u.rol_id
       WHERE pn.paciente_id = ?
       ORDER BY pn.fecha_creacion DESC`,
      [pacienteId]
    );

    // Parsear alergias de cada plan
    const planesParseados = planes.map(plan => ({
      ...plan,
      alergias: plan.alergias ? JSON.parse(plan.alergias) : [],
      confianza_ia: plan.confianza_ia ? parseFloat(plan.confianza_ia) : null
    }));

    console.log(` [HISTORIAL] ${planesParseados.length} planes encontrados para paciente ${pacienteId}`);

    return res.status(200).json({
      error: false,
      total: planesParseados.length,
      paciente: {
        id: pacienteId,
        nombre: `${paciente[0].nombres} ${paciente[0].apellidos}`
      },
      planes: planesParseados
    });

  } catch (err) {
    console.error(' [HISTORIAL] Error obteniendo historial:', err);
    return res.status(500).json({ 
      error: true, 
      mensaje: 'Error al obtener el historial de planes' 
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// ============================================================================
//  GET /nutricionapp-api/paciente/datos-antropometricos
//  Obtener datos antropométricos y signos vitales del paciente
// ============================================================================
router.get('/datos-antropometricos', verificarToken, verificarRol('paciente'), async (req, res) => {
  const usuarioId = req.usuario?.id;
  
  let connection;
  try {
    connection = await getConnection();

    // Obtener paciente_id del usuario
    const [paciente] = await connection.execute(
      `SELECT p.id, p.nombres, p.apellidos 
       FROM pacientes p 
       WHERE p.usuario_id = ? AND p.activo = 1 AND p.eliminado_en IS NULL`,
      [usuarioId]
    );

    if (paciente.length === 0) {
      return res.status(200).json({
        error: false,
        datos: null,
        mensaje: 'No tienes un perfil de paciente asociado'
      });
    }

    const pacienteId = paciente[0].id;

    // Obtener el registro más reciente con datos antropométricos
    const [registros] = await connection.execute(
      `SELECT 
        r.id,
        r.fecha_inicio,
        r.fecha_finalizacion,
        r.datos_antropometricos,
        r.signos_vitales,
        r.datos_personales,
        CONCAT(u.nombre, ' ', u.apellido) as registrado_por
       FROM registro r
       INNER JOIN usuarios u ON u.id = r.registrado_por
       WHERE r.paciente_id = ? 
         AND r.estado = 'finalizado'
         AND r.datos_antropometricos IS NOT NULL
       ORDER BY r.fecha_finalizacion DESC
       LIMIT 1`,
      [pacienteId]
    );

    if (registros.length === 0) {
      return res.status(200).json({
        error: false,
        datos: null,
        mensaje: 'No hay datos antropométricos registrados'
      });
    }

    const registro = registros[0];

    // Parsear JSONs
    let datosAntropometricos = null;
    let signosVitales = null;
    let datosPersonales = null;

    try {
      if (registro.datos_antropometricos) {
        datosAntropometricos = JSON.parse(registro.datos_antropometricos);
      }
      if (registro.signos_vitales) {
        signosVitales = JSON.parse(registro.signos_vitales);
      }
      if (registro.datos_personales) {
        datosPersonales = JSON.parse(registro.datos_personales);
      }
    } catch (e) {
      console.warn(' Error parseando JSONs:', e.message);
    }

    // Obtener historial de mediciones (últimos 5 registros)
    const [historial] = await connection.execute(
      `SELECT 
        r.id,
        r.fecha_finalizacion,
        r.datos_antropometricos,
        r.signos_vitales
       FROM registro r
       WHERE r.paciente_id = ? 
         AND r.estado = 'finalizado'
         AND r.datos_antropometricos IS NOT NULL
       ORDER BY r.fecha_finalizacion DESC
       LIMIT 5`,
      [pacienteId]
    );

    // Procesar historial
    const historialProcesado = historial.map(h => {
      let antro = null;
      let signos = null;
      
      try {
        if (h.datos_antropometricos) antro = JSON.parse(h.datos_antropometricos);
        if (h.signos_vitales) signos = JSON.parse(h.signos_vitales);
      } catch (e) {}
      
      return {
        fecha: h.fecha_finalizacion,
        peso: antro?.peso || null,
        talla: antro?.talla || null,
        imc: antro?.imc || null,
        circunferenciaCintura: antro?.circunferenciaCintura || null,
        presionArterial: signos?.presionArterial || null,
        frecuenciaCardiaca: signos?.frecuenciaCardiaca || null,
        glucosaAyunas: signos?.glucosaAyunas || null
      };
    });

    console.log(` [DATOS] Datos antropométricos cargados para paciente ${pacienteId}`);

    return res.status(200).json({
      error: false,
      datos: {
        fecha_registro: registro.fecha_finalizacion,
        registrado_por: registro.registrado_por,
        antropometricos: datosAntropometricos,
        signos_vitales: signosVitales,
        datos_personales: datosPersonales,
        historial: historialProcesado
      }
    });

  } catch (err) {
    console.error(' [DATOS] Error:', err);
    return res.status(500).json({ 
      error: true, 
      mensaje: 'Error al obtener datos antropométricos' 
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});


// ============================================================================
//  PUT /nutricionapp-api/paciente/plan/confirmar-cita/:citaId
//  Confirmar asistencia a una cita
// ============================================================================
router.put('/confirmar-cita/:citaId', async (req, res) => {
  const usuarioId = req.usuario?.id;
  const citaId = req.params.citaId;
  
  let connection;
  try {
    connection = await getConnection();
    const pacienteId = await obtenerPacienteId(usuarioId, connection);
    
    if (!pacienteId) {
      return res.status(404).json({ error: true, mensaje: 'Paciente no encontrado' });
    }

    // Verificar que la cita pertenece al paciente Y obtener el medico_id
    const [citas] = await connection.execute(
      `SELECT sc.id, sc.estado, sc.fecha_hora, sc.medico_id,
              CONCAT(u.nombre, ' ', u.apellido) AS nombre_medico
       FROM seguimiento_citas sc
       INNER JOIN usuarios u ON u.id = sc.medico_id
       WHERE sc.id = ? AND sc.paciente_id = ?`,
      [citaId, pacienteId]
    );

    if (citas.length === 0) {
      return res.status(404).json({ error: true, mensaje: 'Cita no encontrada' });
    }

    const cita = citas[0];

    // Verificar que la cita esté en estado válido para confirmar
    if (!['agendada', 'confirmada'].includes(cita.estado)) {
      return res.status(400).json({ 
        error: true, 
        mensaje: 'Esta cita no se puede confirmar (estado: ' + cita.estado + ')' 
      });
    }

    // Actualizar estado a confirmada
    await connection.execute(
      `UPDATE seguimiento_citas 
       SET estado = 'confirmada', 
           fecha_confirmacion = NOW()
       WHERE id = ?`,
      [citaId]
    );

    console.log(`[CITA] Cita ${citaId} confirmada por paciente ${pacienteId}`);

    // ========================================
    // CREAR NOTIFICACION PARA EL MEDICO
    // ========================================
    try {
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
      
      console.log(`[CITA] Notificacion creada para medico ${cita.medico_id}`);
    } catch (notifError) {
      console.error('[CITA] Error creando notificacion (pero cita confirmada):', notifError.message);
      // No fallar si la notificacion falla, la cita ya fue confirmada
    }

    return res.status(200).json({
      error: false,
      mensaje: 'Cita confirmada exitosamente',
      cita: {
        id: citaId,
        estado: 'confirmada',
        fecha_confirmacion: new Date()
      }
    });

  } catch (err) {
    console.error('[CITA] Error confirmando cita:', err);
    return res.status(500).json({ 
      error: true, 
      mensaje: 'Error al confirmar la cita' 
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// ============================================================================
//  PUT /nutricionapp-api/paciente/plan/cancelar-cita/:citaId
//  Cancelar cita del paciente
// ============================================================================
router.put('/cancelar-cita/:citaId', async (req, res) => {
  const usuarioId = req.usuario?.id;
  const citaId = req.params.citaId;
  
  let connection;
  try {
    connection = await getConnection();
    const pacienteId = await obtenerPacienteId(usuarioId, connection);
    
    if (!pacienteId) {
      return res.status(404).json({ error: true, mensaje: 'Paciente no encontrado' });
    }

    // Verificar que la cita pertenece al paciente Y obtener el medico_id
    const [citas] = await connection.execute(
      `SELECT sc.id, sc.estado, sc.fecha_hora, sc.medico_id
       FROM seguimiento_citas sc
       WHERE sc.id = ? AND sc.paciente_id = ?`,
      [citaId, pacienteId]
    );

    if (citas.length === 0) {
      return res.status(404).json({ error: true, mensaje: 'Cita no encontrada' });
    }

    const cita = citas[0];

    // Verificar que la cita esté en estado válido para cancelar
    if (!['agendada', 'confirmada'].includes(cita.estado)) {
      return res.status(400).json({ 
        error: true, 
        mensaje: 'Esta cita no se puede cancelar (estado: ' + cita.estado + ')' 
      });
    }

    // Actualizar estado a cancelada
    await connection.execute(
      `UPDATE seguimiento_citas 
       SET estado = 'cancelada', 
           fecha_cancelacion = NOW()
       WHERE id = ?`,
      [citaId]
    );

    console.log(`[CITA] Cita ${citaId} cancelada por paciente ${pacienteId}`);

    // ========================================
    // CREAR NOTIFICACION PARA EL MEDICO
    // ========================================
    try {
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
      
      console.log(`[CITA] Notificacion de cancelacion creada para medico ${cita.medico_id}`);
    } catch (notifError) {
      console.error('[CITA] Error creando notificacion de cancelacion:', notifError.message);
    }

    return res.status(200).json({
      error: false,
      mensaje: 'Cita cancelada exitosamente'
    });

  } catch (err) {
    console.error('[CITA] Error cancelando cita:', err);
    return res.status(500).json({ 
      error: true, 
      mensaje: 'Error al cancelar la cita' 
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// ============================================================================
//  GET /nutricionapp-api/paciente/plan/historial-citas
//  Obtener historial de citas del paciente
// ============================================================================
router.get('/historial-citas', async (req, res) => {
  const usuarioId = req.usuario?.id;
  
  let connection;
  try {
    connection = await getConnection();
    const pacienteId = await obtenerPacienteId(usuarioId, connection);
    
    if (!pacienteId) {
      return res.status(200).json({ error: false, total: 0, citas: [] });
    }

    // Obtener todas las citas del paciente
    const [citas] = await connection.execute(
      `SELECT 
        sc.id,
        sc.fecha_hora,
        sc.tipo,
        sc.motivo,
        sc.estado,
        sc.fecha_confirmacion,
        sc.fecha_cancelacion,
        CONCAT(u.nombre, ' ', u.apellido) as medico_nombre
       FROM seguimiento_citas sc
       INNER JOIN usuarios u ON u.id = sc.medico_id
       WHERE sc.paciente_id = ?
       ORDER BY sc.fecha_hora DESC`,
      [pacienteId]
    );

    return res.status(200).json({
      error: false,
      total: citas.length,
      citas: citas
    });

  } catch (err) {
    console.error(' [CITA] Error obteniendo historial:', err);
    return res.status(500).json({ 
      error: true, 
      mensaje: 'Error al obtener historial de citas' 
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// ============================================================================
//  GET /nutricionapp-api/paciente/plan/historial-medico
//  Obtener historial médico completo del paciente
// ============================================================================
// ============================================================================
//  GET /nutricionapp-api/paciente/plan/historial-medico
//  Obtener historial médico completo del paciente
// ============================================================================
router.get('/historial-medico', async (req, res) => {
  const usuarioId = req.usuario?.id;

  let connection;
  try {
    connection = await getConnection();

    // Obtener paciente_id
    const [paciente] = await connection.execute(
      `SELECT id FROM pacientes WHERE usuario_id = ? AND activo = 1 AND eliminado_en IS NULL`,
      [usuarioId]
    );

    if (paciente.length === 0) {
      return res.status(200).json({ 
        error: false, 
        historial: null,
        mensaje: 'No tienes un perfil de paciente asociado'
      });
    }

    const pacienteId = paciente[0].id;

    // 1. Obtener evoluciones
    const [evoluciones] = await connection.execute(
      `SELECT 
        id,
        fecha,
        objetivos_alcanzados as objetivos,
        observaciones_clinicas as observaciones,
        adherencia,
        creado_en
       FROM evoluciones
       WHERE paciente_id = ?
       ORDER BY fecha DESC
       LIMIT 50`,
      [pacienteId]
    );

    // 2. Obtener citas
    const [citas] = await connection.execute(
      `SELECT 
        id,
        fecha_hora,
        tipo,
        motivo,
        estado,
        creado_en
       FROM citas
       WHERE paciente_id = ?
       ORDER BY fecha_hora DESC
       LIMIT 50`,
      [pacienteId]
    );

    // 3. Obtener mediciones de glucosa (estructura real)
    const [mediciones_glucosa] = await connection.execute(
      `SELECT 
        id,
        fecha_hora as fecha,
        tipo_momento,
        valor_glucosa,
        unidad,
        notas as observaciones,
        creado_en
       FROM mediciones_glucosa
       WHERE paciente_id = ?
       ORDER BY fecha_hora DESC
       LIMIT 50`,
      [pacienteId]
    );

    // 4. Obtener última medición de glucosa
    let ultima_medicion_glucosa = null;
    if (mediciones_glucosa.length > 0) {
      ultima_medicion_glucosa = mediciones_glucosa[0];
    }

    console.log(`[HISTORIAL] Historial cargado para paciente ${pacienteId}:`);
    console.log(`  - Evoluciones: ${evoluciones.length}`);
    console.log(`  - Citas: ${citas.length}`);
    console.log(`  - Mediciones glucosa: ${mediciones_glucosa.length}`);

    return res.status(200).json({
      error: false,
      historial: {
        evoluciones,
        citas,
        mediciones_glucosa,
        ultima_medicion_glucosa
      }
    });

  } catch (err) {
    console.error('[HISTORIAL] Error:', err);
    return res.status(500).json({ 
      error: true, 
      mensaje: 'Error al obtener historial médico: ' + err.message 
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});


// ============================================================================
//  GET /nutricionapp-api/paciente/plan/perfil
//  Obtener perfil completo del paciente
// ============================================================================
router.get('/perfil', async (req, res) => {
  const usuarioId = req.usuario?.id;

  let connection;
  try {
    connection = await getConnection();

    // Obtener datos del usuario
    const [usuarios] = await connection.execute(
      `SELECT 
        id,
        correo,
        nombre,
        apellido,
        cedula,
        fecha_nacimiento,
        edad,
        genero,
        telefono,
        direccionresidencial,
        ciudad,
        provincia,
        provincia_codigo,
        canton,
        canton_codigo,
        parroquia,
        parroquia_codigo,
        creado_en
       FROM usuarios
       WHERE id = ? AND activo = 1 AND eliminado_en IS NULL`,
      [usuarioId]
    );

    if (usuarios.length === 0) {
      return res.status(404).json({ 
        error: true, 
        mensaje: 'Usuario no encontrado' 
      });
    }

    const usuario = usuarios[0];

    const perfil = {
      id: usuario.id,
      correo: usuario.correo,
      nombre: usuario.nombre,
      apellido: usuario.apellido,
      cedula: usuario.cedula,
      fecha_nacimiento: usuario.fecha_nacimiento,
      edad: usuario.edad,
      genero: usuario.genero,
      telefono: usuario.telefono,
      direccion: usuario.direccionresidencial || '',
      ciudad: usuario.ciudad || '',
      provincia: usuario.provincia || '',
      provincia_codigo: usuario.provincia_codigo || '',
      canton: usuario.canton || '',
      canton_codigo: usuario.canton_codigo || '',
      parroquia: usuario.parroquia || '',
      parroquia_codigo: usuario.parroquia_codigo || ''
    };

    console.log(`[PERFIL] Perfil cargado para usuario ${usuarioId}`);

    return res.status(200).json({
      error: false,
      perfil
    });

  } catch (err) {
    console.error('[PERFIL] Error:', err);
    return res.status(500).json({ 
      error: true, 
      mensaje: 'Error al obtener perfil: ' + err.message 
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// ============================================================================
//  PUT /nutricionapp-api/paciente/plan/perfil
//  Actualizar perfil del paciente
// ============================================================================
router.put('/perfil', async (req, res) => {
  const usuarioId = req.usuario?.id;
  const {
    genero,
    telefono,
    correo,
    direccion,
    ciudad,
    provincia,
    provincia_codigo,
    canton,
    canton_codigo,
    parroquia,
    parroquia_codigo,
    passwordActual,
    nuevaPassword
  } = req.body;

  let connection;
  try {
    connection = await getConnection();

    // Verificar que el usuario existe
    const [usuarios] = await connection.execute(
      `SELECT id, password_hash FROM usuarios WHERE id = ? AND activo = 1 AND eliminado_en IS NULL`,
      [usuarioId]
    );

    if (usuarios.length === 0) {
      return res.status(404).json({ 
        error: true, 
        mensaje: 'Usuario no encontrado' 
      });
    }

    // Si se está cambiando la contraseña, verificar la actual
    if (nuevaPassword && passwordActual) {
      const bcrypt = require('bcrypt');
      const passwordValida = await bcrypt.compare(passwordActual, usuarios[0].password_hash);
      
      if (!passwordValida) {
        return res.status(400).json({ 
          error: true, 
          mensaje: 'La contraseña actual es incorrecta' 
        });
      }

      // Validar nueva contraseña
      if (nuevaPassword.length < 8) {
        return res.status(400).json({ 
          error: true, 
          mensaje: 'La nueva contraseña debe tener al menos 8 caracteres' 
        });
      }

      // Hashear la nueva contraseña
      const salt = await bcrypt.genSalt(10);
      const passwordHasheada = await bcrypt.hash(nuevaPassword, salt);

      await connection.execute(
        `UPDATE usuarios SET password_hash = ?, actualizado_en = NOW() WHERE id = ?`,
        [passwordHasheada, usuarioId]
      );

      console.log(`[PERFIL] Contraseña actualizada para usuario ${usuarioId}`);
    }

    // Actualizar datos del perfil
    await connection.execute(
      `UPDATE usuarios SET 
        genero = ?,
        telefono = ?,
        correo = ?,
        direccionresidencial = ?,
        ciudad = ?,
        provincia = ?,
        provincia_codigo = ?,
        canton = ?,
        canton_codigo = ?,
        parroquia = ?,
        parroquia_codigo = ?,
        actualizado_en = NOW()
       WHERE id = ?`,
      [
        genero || null,
        telefono || null,
        correo || null,
        direccion || null,
        ciudad || null,
        provincia || null,
        provincia_codigo || null,
        canton || null,
        canton_codigo || null,
        parroquia || null,
        parroquia_codigo || null,
        usuarioId
      ]
    );

    console.log(`[PERFIL] Perfil actualizado para usuario ${usuarioId}`);

    return res.status(200).json({
      error: false,
      mensaje: 'Perfil actualizado correctamente'
    });

  } catch (err) {
    console.error('[PERFIL] Error:', err);
    return res.status(500).json({ 
      error: true, 
      mensaje: 'Error al actualizar perfil: ' + err.message 
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

console.log(' [ROUTER] paciente-plan.js cargado correctamente');
module.exports = router;