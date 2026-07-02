// routes/medico-paciente-detalle.js
const express = require('express');
const router = express.Router();
const { getConnection } = require('../conexion');
const { verificarToken, verificarRol } = require('../middleware/auth');

console.log(' [ROUTER] Cargando medico-paciente-detalle.js');

//  Helper para parsear JSON de forma segura
function parsearCampoJSON(valor) {
  if (!valor) return null;
  if (typeof valor === 'object') return valor;
  try {
    return JSON.parse(valor);
  } catch (e) {
    console.warn(' Error parseando JSON:', e.message);
    return null;
  }
}

//  Helper para formatear fecha MySQL → 'YYYY-MM-DD'
function formatearFechaMySQL(fecha) {
  if (!fecha) return null;
  if (typeof fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return fecha;
  }
  if (fecha instanceof Date) {
    return fecha.toISOString().split('T')[0];
  }
  if (typeof fecha === 'string') {
    return fecha.split(' ')[0];
  }
  return null;
}

//  Middleware de debug
router.use((req, res, next) => {
  console.log(' [DETALLE PACIENTE DEBUG]', {
    method: req.method,
    path: req.path,
    params: req.params,
    usuario_id: req.usuario?.id,
    rol: req.usuario?.rol
  });
  next();
});

// GET /nutricionapp-api/medico/paciente/:paciente_id/detalle
router.get('/:paciente_id/detalle', verificarToken, verificarRol('doctor', 'nutricionista'), async (req, res) => {
  const { paciente_id } = req.params;
  const usuario_id = req.usuario?.id;

  console.log(' [DETALLE PACIENTE] Solicitando datos para:', { paciente_id, usuario_id });

  if (!paciente_id) {
    return res.status(400).json({ error: true, mensaje: 'ID de paciente requerido' });
  }

  let connection;
  try {
    connection = await getConnection();

    //  Datos básicos del paciente
    const [paciente] = await connection.execute(
      `SELECT 
        p.id, 
        p.nombres, 
        p.apellidos, 
        p.numero_identificacion as cedula,
        DATE(p.fecha_nacimiento) as fecha_nacimiento,
        p.sexo, 
        p.direccion, 
        p.telefono, 
        p.ocupacion, 
        p.actividad_fisica,
        TIMESTAMPDIFF(YEAR, p.fecha_nacimiento, CURDATE()) as edad,
        (SELECT COUNT(*) FROM registro r WHERE r.paciente_id = p.id AND r.estado = 'finalizado') as registros_completados
       FROM pacientes p
       WHERE p.id = ? AND p.eliminado_en IS NULL`,
      [paciente_id]
    );

    if (!paciente.length) {
      console.warn(' [DETALLE PACIENTE] Paciente no encontrado:', paciente_id);
      return res.status(404).json({ error: true, mensaje: 'Paciente no encontrado' });
    }

    // Formatear respuesta del paciente
    const pacienteFormateado = {
      ...paciente[0],
      fecha_nacimiento: formatearFechaMySQL(paciente[0].fecha_nacimiento),
      sexo: paciente[0].sexo ? String(paciente[0].sexo).trim() : null
    };

    console.log(' [DETALLE PACIENTE] Datos del paciente:', {
      id: pacienteFormateado.id,
      fecha_nacimiento: pacienteFormateado.fecha_nacimiento,
      sexo: pacienteFormateado.sexo,
      edad: pacienteFormateado.edad
    });

    //  Historial de registros clínicos finalizados
    const [registros] = await connection.execute(
      `SELECT 
        r.id, r.estado, r.fecha_inicio, r.fecha_finalizacion,
        r.datos_personales, r.signos_vitales, r.datos_antropometricos, r.condiciones_metabolicas,
        u.nombre as registrado_por_nombre, u.apellido as registrado_por_apellido
       FROM registro r
       JOIN usuarios u ON u.id = r.registrado_por
       WHERE r.paciente_id = ? AND r.estado = 'finalizado'
       ORDER BY r.fecha_finalizacion DESC`,
      [paciente_id]
    );

    const historialParseado = registros.map(reg => ({
      ...reg,
      datos_personales: parsearCampoJSON(reg.datos_personales),
      signos_vitales: parsearCampoJSON(reg.signos_vitales),
      datos_antropometricos: parsearCampoJSON(reg.datos_antropometricos),
      condiciones_metabolicas: parsearCampoJSON(reg.condiciones_metabolicas)
    }));

    //  Últimos datos clínicos
    const [ultimosSignos] = await connection.execute(
      `SELECT signos_vitales, datos_antropometricos, condiciones_metabolicas, fecha_finalizacion
       FROM registro
       WHERE paciente_id = ? AND estado = 'finalizado'
       ORDER BY fecha_finalizacion DESC LIMIT 1`,
      [paciente_id]
    );

    let ultimosDatosParseados = null;
    if (ultimosSignos[0]) {
      ultimosDatosParseados = {
        fecha: ultimosSignos[0].fecha_finalizacion,
        signos_vitales: parsearCampoJSON(ultimosSignos[0].signos_vitales),
        datos_antropometricos: parsearCampoJSON(ultimosSignos[0].datos_antropometricos),
        condiciones_metabolicas: parsearCampoJSON(ultimosSignos[0].condiciones_metabolicas)
      };
    }

    console.log(' [DETALLE PACIENTE] Respuesta enviada exitosamente');

    return res.json({
      error: false,
      paciente: pacienteFormateado,
      historial: historialParseado,
      ultimos_datos: ultimosDatosParseados
    });

  } catch (err) {
    console.error(' [DETALLE PACIENTE] Error:', err.message);
    return res.status(500).json({ 
      error: true, 
      mensaje: 'Error al cargar datos del paciente: ' + err.message 
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});


// ============================================================================
//  GET /nutricionapp-api/medico/paciente/:pacienteId/registro/:registroId
//  Obtener detalle de un registro clínico específico
// ============================================================================
// ============================================================================
//  GET /nutricionapp-api/medico/paciente/:pacienteId/registro/:registroId
//  Obtener detalle de un registro clínico específico
// ============================================================================
router.get('/:pacienteId/registro/:registroId', verificarToken, verificarRol('medico', 'nutricionista'), async (req, res) => {
  const { pacienteId, registroId } = req.params;
  
  console.log('[MEDICO] Consultando registro:', { pacienteId, registroId });

  let connection;
  try {
    connection = await getConnection();

    // 1. Verificar que el paciente existe
    const [pacientes] = await connection.execute(
      `SELECT id FROM pacientes WHERE id = ? AND eliminado_en IS NULL`,
      [pacienteId]
    );

    if (pacientes.length === 0) {
      return res.status(404).json({ error: true, mensaje: 'Paciente no encontrado' });
    }

    // 2. Obtener el registro (usando 'registrado_por' en lugar de 'medico_id')
    const [registros] = await connection.execute(
      `SELECT 
        r.id,
        r.paciente_id,
        r.registrado_por,
        r.estado,
        r.datos_personales,
        r.signos_vitales,
        r.datos_antropometricos,
        r.condiciones_metabolicas,
        r.fecha_inicio,
        r.fecha_finalizacion,
        r.observaciones,
        r.creado_en,
        u.nombre as registrado_por_nombre,
        u.apellido as registrado_por_apellido
       FROM registro r
       LEFT JOIN usuarios u ON u.id = r.registrado_por
       WHERE r.id = ? AND r.paciente_id = ?`,
      [registroId, pacienteId]
    );

    if (registros.length === 0) {
      return res.status(404).json({ error: true, mensaje: 'Registro no encontrado' });
    }

    const registro = registros[0];

    // 3. Parsear TODOS los campos JSON
    const camposJson = ['datos_personales', 'signos_vitales', 'datos_antropometricos', 'condiciones_metabolicas'];
    
    for (const campo of camposJson) {
      if (registro[campo] && typeof registro[campo] === 'string') {
        try {
          registro[campo] = JSON.parse(registro[campo]);
        } catch (e) {
          console.warn(`[MEDICO] Error parseando ${campo}:`, e.message);
          registro[campo] = null;
        }
      }
    }

    // 4. Obtener info del paciente
    const [pacienteInfo] = await connection.execute(
      `SELECT 
        id,
        nombres,
        apellidos,
        cedula,
        numero_identificacion,
        edad,
        sexo,
        telefono,
        direccion
       FROM pacientes
       WHERE id = ?`,
      [pacienteId]
    );

    const paciente = pacienteInfo[0] || null;

    console.log(`[MEDICO] Registro ${registroId} consultado exitosamente`);

    return res.status(200).json({
      error: false,
      registro,
      paciente
    });

  } catch (err) {
    console.error('[MEDICO] Error:', err);
    return res.status(500).json({ 
      error: true, 
      mensaje: 'Error al obtener registro: ' + err.message,
      detalle: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// ============================================================================
//  GET /nutricionapp-api/medico/paciente/:pacienteId/glucosa
//  Obtener mediciones de glucosa del paciente
// ============================================================================
router.get('/:pacienteId/glucosa', verificarToken, verificarRol('medico', 'nutricionista'), async (req, res) => {
  const { pacienteId } = req.params;
  const { dias = 30 } = req.query;

  let connection;
  try {
    connection = await getConnection();

    const [mediciones] = await connection.execute(
      `SELECT 
        id,
        fecha_hora,
        tipo_momento,
        valor_glucosa,
        unidad,
        notas,
        creado_en
       FROM mediciones_glucosa
       WHERE paciente_id = ?
         AND fecha_hora >= DATE_SUB(NOW(), INTERVAL ? DAY)
       ORDER BY fecha_hora DESC`,
      [pacienteId, parseInt(dias)]
    );

    // Calcular estadísticas
    let estadisticas = null;
    if (mediciones.length > 0) {
      const valores = mediciones.map(m => parseFloat(m.valor_glucosa));
      estadisticas = {
        total: mediciones.length,
        promedio: valores.reduce((a, b) => a + b, 0) / valores.length,
        minimo: Math.min(...valores),
        maximo: Math.max(...valores)
      };
    }

    return res.status(200).json({
      error: false,
      mediciones,
      estadisticas
    });

  } catch (err) {
    console.error('[MEDICO] Error:', err);
    return res.status(500).json({ 
      error: true, 
      mensaje: 'Error al obtener mediciones: ' + err.message 
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// ============================================================================
//  GET /nutricionapp-api/medico/paciente/:pacienteId/presion
//  Obtener mediciones de presión arterial del paciente
// ============================================================================
router.get('/:pacienteId/presion', verificarToken, verificarRol('medico', 'nutricionista'), async (req, res) => {
  const { pacienteId } = req.params;
  const { dias = 30 } = req.query;

  let connection;
  try {
    connection = await getConnection();

    const [mediciones] = await connection.execute(
      `SELECT 
        id,
        fecha_hora,
        sistolica,
        diastolica,
        pulso,
        posicion,
        brazo,
        notas,
        creado_en
       FROM mediciones_presion
       WHERE paciente_id = ?
         AND fecha_hora >= DATE_SUB(NOW(), INTERVAL ? DAY)
       ORDER BY fecha_hora DESC`,
      [pacienteId, parseInt(dias)]
    );

    // Calcular estadísticas
    let estadisticas = null;
    if (mediciones.length > 0) {
      const sistolicas = mediciones.map(m => parseFloat(m.sistolica));
      const diastolicas = mediciones.map(m => parseFloat(m.diastolica));
      
      estadisticas = {
        total: mediciones.length,
        promedio_sistolica: sistolicas.reduce((a, b) => a + b, 0) / sistolicas.length,
        promedio_diastolica: diastolicas.reduce((a, b) => a + b, 0) / diastolicas.length,
        minimo_sistolica: Math.min(...sistolicas),
        maximo_sistolica: Math.max(...sistolicas),
        minimo_diastolica: Math.min(...diastolicas),
        maximo_diastolica: Math.max(...diastolicas)
      };
    }

    return res.status(200).json({
      error: false,
      mediciones,
      estadisticas
    });

  } catch (err) {
    console.error('[MEDICO] Error:', err);
    return res.status(500).json({ 
      error: true, 
      mensaje: 'Error al obtener mediciones: ' + err.message 
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

console.log(' [ROUTER] medico-paciente-detalle.js cargado correctamente');
module.exports = router;