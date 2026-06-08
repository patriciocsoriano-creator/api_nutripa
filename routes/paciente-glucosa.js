// routes/paciente-glucosa.js
const express = require('express');
const router = express.Router();
const { getConnection } = require('../conexion');
const { verificarToken, verificarRol } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

console.log('✅ [ROUTER] Cargando paciente-glucosa.js');

// Middleware: solo pacientes autenticados
router.use(verificarToken);
router.use(verificarRol('paciente'));

// ============================================================================
// 🩸 POST /nutricionapp-api/paciente/glucosa/registrar
// 👉 Registrar nueva medición de glucosa
// ============================================================================
router.post('/registrar', async (req, res) => {
  const usuarioId = req.usuario?.id;
  const { fecha_hora, tipo_momento, valor_glucosa, notas } = req.body;

  // Validaciones
  if (!valor_glucosa || valor_glucosa <= 0) {
    return res.status(400).json({ error: true, mensaje: 'El valor de glucosa es obligatorio y debe ser mayor a 0' });
  }

  if (valor_glucosa > 600) {
    return res.status(400).json({ error: true, mensaje: 'El valor de glucosa parece incorrecto (máximo 600 mg/dL)' });
  }

  const tiposValidos = ['ayunas', 'postprandial', 'antes_comida', 'despues_comida', 'antes_dormir', 'otro'];
  if (!tiposValidos.includes(tipo_momento)) {
    return res.status(400).json({ error: true, mensaje: 'Tipo de momento no válido' });
  }

  let connection;
  try {
    connection = await getConnection();

    // Obtener paciente_id del usuario
    const [paciente] = await connection.execute(
      `SELECT id FROM pacientes WHERE usuario_id = ? AND activo = 1 AND eliminado_en IS NULL`,
      [usuarioId]
    );

    if (paciente.length === 0) {
      return res.status(404).json({ error: true, mensaje: 'No tienes un perfil de paciente asociado' });
    }

    const pacienteId = paciente[0].id;
    const medicionId = uuidv4();
    const fechaMedicion = fecha_hora || new Date();

    await connection.execute(
      `INSERT INTO mediciones_glucosa 
        (id, paciente_id, fecha_hora, tipo_momento, valor_glucosa, notas) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [medicionId, pacienteId, fechaMedicion, tipo_momento, valor_glucosa, notas || null]
    );

    console.log(`🩸 [GLUCOSA] Medición registrada: ${valor_glucosa} mg/dL (${tipo_momento}) para paciente ${pacienteId}`);

    // Determinar clasificación de la glucosa
    let clasificacion = 'normal';
    let mensaje_clasificacion = 'Normal';
    
    if (tipo_momento === 'ayunas') {
      if (valor_glucosa >= 126) {
        clasificacion = 'alto';
        mensaje_clasificacion = 'Elevada - Consulta con tu médico';
      } else if (valor_glucosa >= 100) {
        clasificacion = 'pre-diabetes';
        mensaje_clasificacion = 'Pre-diabetes - Monitorea regularmente';
      }
    } else if (tipo_momento === 'postprandial' || tipo_momento === 'despues_comida') {
      if (valor_glucosa >= 200) {
        clasificacion = 'alto';
        mensaje_clasificacion = 'Elevada - Consulta con tu médico';
      } else if (valor_glucosa >= 140) {
        clasificacion = 'pre-diabetes';
        mensaje_clasificacion = 'Pre-diabetes - Monitorea regularmente';
      }
    }

    return res.status(201).json({
      error: false,
      mensaje: 'Medición registrada exitosamente',
      medicion_id: medicionId,
      clasificacion,
      mensaje_clasificacion
    });

  } catch (err) {
    console.error('❌ [GLUCOSA] Error:', err);
    return res.status(500).json({ 
      error: true, 
      mensaje: 'Error al registrar la medición: ' + err.message 
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// ============================================================================
// 📊 GET /nutricionapp-api/paciente/glucosa/historial
// 👉 Obtener historial de mediciones de glucosa
// ============================================================================
router.get('/historial', async (req, res) => {
  const usuarioId = req.usuario?.id;
  const { dias = 30, limit = 50 } = req.query;

  let connection;
  try {
    connection = await getConnection();

    // Obtener paciente_id
    const [paciente] = await connection.execute(
      `SELECT id FROM pacientes WHERE usuario_id = ? AND activo = 1 AND eliminado_en IS NULL`,
      [usuarioId]
    );

    if (paciente.length === 0) {
      return res.status(200).json({ error: false, mediciones: [], total: 0 });
    }

    const pacienteId = paciente[0].id;

    // Obtener mediciones de los últimos X días
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
       ORDER BY fecha_hora DESC
       LIMIT ?`,
      [pacienteId, parseInt(dias), parseInt(limit)]
    );

    // Calcular estadísticas
    let promedio = 0;
    let minimo = 0;
    let maximo = 0;
    let totalMediciones = mediciones.length;

    if (totalMediciones > 0) {
      const valores = mediciones.map(m => parseFloat(m.valor_glucosa));
      promedio = valores.reduce((a, b) => a + b, 0) / valores.length;
      minimo = Math.min(...valores);
      maximo = Math.max(...valores);
    }

    console.log(`📊 [GLUCOSA] Historial cargado: ${totalMediciones} mediciones para paciente ${pacienteId}`);

    return res.status(200).json({
      error: false,
      mediciones,
      estadisticas: {
        total: totalMediciones,
        promedio: parseFloat(promedio.toFixed(1)),
        minimo,
        maximo,
        dias_consultados: parseInt(dias)
      }
    });

  } catch (err) {
    console.error('❌ [GLUCOSA] Error:', err);
    return res.status(500).json({ 
      error: true, 
      mensaje: 'Error al obtener historial: ' + err.message 
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// ============================================================================
// 📈 GET /nutricionapp-api/paciente/glucosa/estadisticas
// 👉 Obtener estadísticas resumidas (últimos 7 días)
// ============================================================================
router.get('/estadisticas', async (req, res) => {
  const usuarioId = req.usuario?.id;

  let connection;
  try {
    connection = await getConnection();

    const [paciente] = await connection.execute(
      `SELECT id FROM pacientes WHERE usuario_id = ? AND activo = 1 AND eliminado_en IS NULL`,
      [usuarioId]
    );

    if (paciente.length === 0) {
      return res.status(200).json({ error: false, estadisticas: null });
    }

    const pacienteId = paciente[0].id;

    // Estadísticas de los últimos 7 días
    const [stats] = await connection.execute(
      `SELECT 
        COUNT(*) as total_mediciones,
        AVG(valor_glucosa) as promedio,
        MIN(valor_glucosa) as minimo,
        MAX(valor_glucosa) as maximo,
        (SELECT valor_glucosa FROM mediciones_glucosa 
         WHERE paciente_id = ? ORDER BY fecha_hora DESC LIMIT 1) as ultima_medicion,
        (SELECT fecha_hora FROM mediciones_glucosa 
         WHERE paciente_id = ? ORDER BY fecha_hora DESC LIMIT 1) as ultima_fecha
       FROM mediciones_glucosa
       WHERE paciente_id = ?
         AND fecha_hora >= DATE_SUB(NOW(), INTERVAL 7 DAY)`,
      [pacienteId, pacienteId, pacienteId]
    );

    // Mediciones por momento del día (últimos 7 días)
    const [porMomento] = await connection.execute(
      `SELECT 
        tipo_momento,
        COUNT(*) as cantidad,
        AVG(valor_glucosa) as promedio
       FROM mediciones_glucosa
       WHERE paciente_id = ?
         AND fecha_hora >= DATE_SUB(NOW(), INTERVAL 7 DAY)
       GROUP BY tipo_momento
       ORDER BY FIELD(tipo_momento, 'ayunas', 'antes_comida', 'despues_comida', 'postprandial', 'antes_dormir', 'otro')`,
      [pacienteId]
    );

    return res.status(200).json({
      error: false,
      estadisticas: stats[0] || null,
      porMomento
    });

  } catch (err) {
    console.error('❌ [GLUCOSA] Error:', err);
    return res.status(500).json({ 
      error: true, 
      mensaje: 'Error al obtener estadísticas' 
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// ============================================================================
// 🗑️ DELETE /nutricionapp-api/paciente/glucosa/:id
// 👉 Eliminar una medición
// ============================================================================
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const usuarioId = req.usuario?.id;

  let connection;
  try {
    connection = await getConnection();

    // Verificar que la medición pertenece al paciente
    const [paciente] = await connection.execute(
      `SELECT p.id FROM pacientes p 
       INNER JOIN mediciones_glucosa mg ON mg.paciente_id = p.id
       WHERE p.usuario_id = ? AND mg.id = ?`,
      [usuarioId, id]
    );

    if (paciente.length === 0) {
      return res.status(404).json({ error: true, mensaje: 'Medición no encontrada' });
    }

    await connection.execute(`DELETE FROM mediciones_glucosa WHERE id = ?`, [id]);

    console.log(`🗑️ [GLUCOSA] Medición eliminada: ${id}`);

    return res.status(200).json({
      error: false,
      mensaje: 'Medición eliminada correctamente'
    });

  } catch (err) {
    console.error('❌ [GLUCOSA] Error:', err);
    return res.status(500).json({ 
      error: true, 
      mensaje: 'Error al eliminar la medición' 
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});


// ============================================================================
//  PRESION
// ============================================================================



// ============================================================================
// 🫀 POST /nutricionapp-api/paciente/presion/registrar
// 👉 Registrar nueva medición de presión arterial
// ============================================================================
router.post('/presion/registrar', async (req, res) => {
  const usuarioId = req.usuario?.id;
  const { sistolica, diastolica, pulso, posicion, brazo, notas } = req.body;

  // Validaciones
  if (!sistolica || !diastolica) {
    return res.status(400).json({ 
      error: true, 
      mensaje: 'Los valores sistólico y diastólico son obligatorios' 
    });
  }

  if (sistolica < 60 || sistolica > 250) {
    return res.status(400).json({ 
      error: true, 
      mensaje: 'El valor sistólico parece incorrecto (rango válido: 60-250)' 
    });
  }

  if (diastolica < 30 || diastolica > 150) {
    return res.status(400).json({ 
      error: true, 
      mensaje: 'El valor diastólico parece incorrecto (rango válido: 30-150)' 
    });
  }

  if (parseInt(sistolica) <= parseInt(diastolica)) {
    return res.status(400).json({ 
      error: true, 
      mensaje: 'La presión sistólica debe ser mayor que la diastólica' 
    });
  }

  let connection;
  try {
    connection = await getConnection();

    // Obtener paciente_id del usuario
    const [paciente] = await connection.execute(
      `SELECT id FROM pacientes WHERE usuario_id = ? AND activo = 1 AND eliminado_en IS NULL`,
      [usuarioId]
    );

    if (paciente.length === 0) {
      return res.status(404).json({ error: true, mensaje: 'No tienes un perfil de paciente asociado' });
    }

    const pacienteId = paciente[0].id;
    const medicionId = uuidv4();
    const fechaMedicion = req.body.fecha_hora || new Date();

    await connection.execute(
      `INSERT INTO mediciones_presion 
        (id, paciente_id, fecha_hora, sistolica, diastolica, pulso, posicion, brazo, notas) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        medicionId, 
        pacienteId, 
        fechaMedicion, 
        sistolica, 
        diastolica, 
        pulso || null, 
        posicion || 'sentado', 
        brazo || 'izquierdo', 
        notas || null
      ]
    );

    console.log(`🫀 [PRESION] Medición registrada: ${sistolica}/${diastolica} para paciente ${pacienteId}`);

    // Clasificación según AHA
    let clasificacion = 'normal';
    let mensaje_clasificacion = 'Normal';
    const sis = parseInt(sistolica);
    const dia = parseInt(diastolica);

    if (sis > 180 || dia > 120) {
      clasificacion = 'crisis';
      mensaje_clasificacion = '⚠️ CRISIS HIPERTENSIVA - Busca atención médica inmediata';
    } else if (sis >= 140 || dia >= 90) {
      clasificacion = 'alta_etapa2';
      mensaje_clasificacion = 'Hipertensión Etapa 2 - Consulta con tu médico';
    } else if (sis >= 130 || dia >= 80) {
      clasificacion = 'alta_etapa1';
      mensaje_clasificacion = 'Hipertensión Etapa 1 - Monitorea regularmente';
    } else if (sis >= 120 && dia < 80) {
      clasificacion = 'elevada';
      mensaje_clasificacion = 'Presión elevada - Cambios en el estilo de vida';
    } else {
      clasificacion = 'normal';
      mensaje_clasificacion = '✅ Presión normal - Mantén tus hábitos saludables';
    }

    return res.status(201).json({
      error: false,
      mensaje: 'Medición registrada exitosamente',
      medicion_id: medicionId,
      clasificacion,
      mensaje_clasificacion
    });

  } catch (err) {
    console.error('❌ [PRESION] Error:', err);
    return res.status(500).json({ 
      error: true, 
      mensaje: 'Error al registrar la medición: ' + err.message 
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// ============================================================================
// 🫀 GET /nutricionapp-api/paciente/presion/historial
// 👉 Obtener historial de mediciones de presión arterial
// ============================================================================
router.get('/presion/historial', async (req, res) => {
  const usuarioId = req.usuario?.id;
  const { dias = 30, limit = 50 } = req.query;

  let connection;
  try {
    connection = await getConnection();

    const [paciente] = await connection.execute(
      `SELECT id FROM pacientes WHERE usuario_id = ? AND activo = 1 AND eliminado_en IS NULL`,
      [usuarioId]
    );

    if (paciente.length === 0) {
      return res.status(200).json({ error: false, mediciones: [], total: 0 });
    }

    const pacienteId = paciente[0].id;

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
       ORDER BY fecha_hora DESC
       LIMIT ?`,
      [pacienteId, parseInt(dias), parseInt(limit)]
    );

    // Calcular estadísticas
    let promedioSistolica = 0;
    let promedioDiastolica = 0;
    let minimoSistolica = 0;
    let maximoSistolica = 0;
    let minimoDiastolica = 0;
    let maximoDiastolica = 0;

    if (mediciones.length > 0) {
      const sistolicas = mediciones.map(m => parseFloat(m.sistolica));
      const diastolicas = mediciones.map(m => parseFloat(m.diastolica));
      
      promedioSistolica = sistolicas.reduce((a, b) => a + b, 0) / sistolicas.length;
      promedioDiastolica = diastolicas.reduce((a, b) => a + b, 0) / diastolicas.length;
      minimoSistolica = Math.min(...sistolicas);
      maximoSistolica = Math.max(...sistolicas);
      minimoDiastolica = Math.min(...diastolicas);
      maximoDiastolica = Math.max(...diastolicas);
    }

    console.log(`🫀 [PRESION] Historial cargado: ${mediciones.length} mediciones`);

    return res.status(200).json({
      error: false,
      mediciones,
      estadisticas: {
        total: mediciones.length,
        promedio_sistolica: parseFloat(promedioSistolica.toFixed(1)),
        promedio_diastolica: parseFloat(promedioDiastolica.toFixed(1)),
        minimo_sistolica: minimoSistolica,
        maximo_sistolica: maximoSistolica,
        minimo_diastolica: minimoDiastolica,
        maximo_diastolica: maximoDiastolica,
        dias_consultados: parseInt(dias)
      }
    });

  } catch (err) {
    console.error('❌ [PRESION] Error:', err);
    return res.status(500).json({ 
      error: true, 
      mensaje: 'Error al obtener historial: ' + err.message 
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// ============================================================================
// 🗑️ DELETE /nutricionapp-api/paciente/presion/:id
// 👉 Eliminar una medición de presión
// ============================================================================
router.delete('/presion/:id', async (req, res) => {
  const { id } = req.params;
  const usuarioId = req.usuario?.id;

  let connection;
  try {
    connection = await getConnection();

    const [paciente] = await connection.execute(
      `SELECT p.id FROM pacientes p 
       INNER JOIN mediciones_presion mp ON mp.paciente_id = p.id
       WHERE p.usuario_id = ? AND mp.id = ?`,
      [usuarioId, id]
    );

    if (paciente.length === 0) {
      return res.status(404).json({ error: true, mensaje: 'Medición no encontrada' });
    }

    await connection.execute(`DELETE FROM mediciones_presion WHERE id = ?`, [id]);

    console.log(`🗑️ [PRESION] Medición eliminada: ${id}`);

    return res.status(200).json({
      error: false,
      mensaje: 'Medición eliminada correctamente'
    });

  } catch (err) {
    console.error('❌ [PRESION] Error:', err);
    return res.status(500).json({ 
      error: true, 
      mensaje: 'Error al eliminar la medición' 
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

console.log('✅ [ROUTER] paciente-glucosa.js cargado correctamente');
module.exports = router;