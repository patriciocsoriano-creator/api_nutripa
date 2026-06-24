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

console.log(' [ROUTER] paciente-plan.js cargado correctamente');
module.exports = router;