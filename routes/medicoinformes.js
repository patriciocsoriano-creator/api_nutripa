// routes/medicoinformes.js
const express = require('express');
const router = express.Router();
const { getConnection } = require('../conexion');
const { verificarToken, verificarRol } = require('../middleware/auth');

console.log(' [ROUTER] Cargando medicoinformes.js');

// Middleware para todas las rutas
router.use(verificarToken);
router.use(verificarRol('doctor', 'nutricionista'));

// ============================================================================
//  INFORMES DE IA - Evolución de la red neuronal
// GET /nutricionapp-api/medico/informes/ia
// ============================================================================
router.get('/ia', async (req, res) => {
  const medicoId = req.usuario?.id;
  let connection;

  try {
    connection = await getConnection();

    //  Confianza promedio de la IA
    const [confianzaResult] = await connection.execute(
      `SELECT 
        AVG(confianza_ia) as promedio,
        COUNT(*) as total_planes
       FROM planes_nutricionales 
       WHERE medico_id = ? AND confianza_ia IS NOT NULL`,
      [medicoId]
    );

    const confianzaPromedio = parseFloat(confianzaResult[0]?.promedio || 0) * 100;

    //  Tendencia de confianza (comparar últimos 30 días vs anteriores)
    const [tendenciaResult] = await connection.execute(
      `SELECT 
        AVG(CASE WHEN fecha_creacion >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN confianza_ia END) as reciente,
        AVG(CASE WHEN fecha_creacion < DATE_SUB(NOW(), INTERVAL 30 DAY) THEN confianza_ia END) as anterior
       FROM planes_nutricionales 
       WHERE medico_id = ? AND confianza_ia IS NOT NULL`,
      [medicoId]
    );

    const confianzaReciente = parseFloat(tendenciaResult[0]?.reciente || 0) * 100;
    const confianzaAnterior = parseFloat(tendenciaResult[0]?.anterior || 0) * 100;
    const tendenciaConfianza = confianzaAnterior > 0 
      ? ((confianzaReciente - confianzaAnterior) / confianzaAnterior * 100).toFixed(1) 
      : 0;

    //  Tasa de aceptación (planes activos o completados / total)
    const [aceptacionResult] = await connection.execute(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN estado IN ('activo', 'completado') THEN 1 ELSE 0 END) as aceptados
       FROM planes_nutricionales 
       WHERE medico_id = ?`,
      [medicoId]
    );

    const tasaAceptacion = aceptacionResult[0]?.total > 0
      ? (aceptacionResult[0]?.aceptados / aceptacionResult[0]?.total * 100)
      : 0;

    //  Perfil más recomendado
    const [perfilResult] = await connection.execute(
      `SELECT 
        perfil_recomendado,
        COUNT(*) as cantidad
       FROM planes_nutricionales 
       WHERE medico_id = ? AND perfil_recomendado IS NOT NULL
       GROUP BY perfil_recomendado
       ORDER BY cantidad DESC
       LIMIT 1`,
      [medicoId]
    );

    //  Distribución de perfiles
    const [distribucionResult] = await connection.execute(
      `SELECT 
        perfil_recomendado,
        COUNT(*) as cantidad
       FROM planes_nutricionales 
       WHERE medico_id = ? AND perfil_recomendado IS NOT NULL
       GROUP BY perfil_recomendado
       ORDER BY cantidad DESC`,
      [medicoId]
    );

    const totalPlanes = distribucionResult.reduce((sum, p) => sum + p.cantidad, 0);
    const colores = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
    const distribucionPerfiles = distribucionResult.map((p, i) => ({
      nombre: p.perfil_recomendado,
      cantidad: p.cantidad,
      porcentaje: totalPlanes > 0 ? (p.cantidad / totalPlanes * 100) : 0,
      color: colores[i % colores.length]
    }));

    //  Evolución de confianza por mes (últimos 6 meses)
    const [evolucionResult] = await connection.execute(
      `SELECT 
        DATE_FORMAT(fecha_creacion, '%Y-%m') as mes,
        DATE_FORMAT(fecha_creacion, '%b') as mes_nombre,
        AVG(confianza_ia) * 100 as confianza
       FROM planes_nutricionales 
       WHERE medico_id = ? 
         AND confianza_ia IS NOT NULL
         AND fecha_creacion >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
       GROUP BY DATE_FORMAT(fecha_creacion, '%Y-%m'), DATE_FORMAT(fecha_creacion, '%b')
       ORDER BY mes`,
      [medicoId]
    );

    const evolucionConfianza = evolucionResult.map(e => ({
      mes: e.mes_nombre,
      confianza: parseFloat(e.confianza || 0)
    }));

    return res.status(200).json({
      error: false,
      informes: {
        confianzaPromedio: parseFloat(confianzaPromedio.toFixed(1)),
        tendenciaConfianza: parseFloat(tendenciaConfianza),
        tasaAceptacion: parseFloat(tasaAceptacion.toFixed(1)),
        perfilMasRecomendado: perfilResult[0]?.perfil_recomendado || 'Sin datos',
        cantidadPerfilTop: perfilResult[0]?.cantidad || 0,
        precisionPrediccion: parseFloat(confianzaPromedio.toFixed(1)), // Simplificación
        evolucionConfianza,
        distribucionPerfiles
      }
    });

  } catch (err) {
    console.error(' [INFORMES] Error en informes/ia:', err);
    return res.status(500).json({ error: true, mensaje: 'Error al obtener informes de IA' });
  } finally {
    if (connection) try { connection.release(); } catch (e) {}
  }
});

// ============================================================================
//  INFORMES DE PACIENTES
// GET /nutricionapp-api/medico/informes/pacientes
// ============================================================================
router.get('/pacientes', async (req, res) => {
  const medicoId = req.usuario?.id;
  let connection;

  try {
    connection = await getConnection();

    //  Total de pacientes
    const [totalResult] = await connection.execute(
      `SELECT COUNT(*) as total FROM pacientes WHERE eliminado_en IS NULL`
    );

    //  Pacientes activos (con plan activo)
    const [activosResult] = await connection.execute(
      `SELECT COUNT(DISTINCT p.id) as total
       FROM pacientes p
       INNER JOIN planes_nutricionales pn ON pn.paciente_id = p.id
       WHERE p.eliminado_en IS NULL AND pn.estado = 'activo'`
    );

    //  Pacientes en riesgo (presión alta, glucosa alta, etc.)
    const [riesgoResult] = await connection.execute(
      `SELECT COUNT(DISTINCT r.paciente_id) as total
       FROM registro r
       WHERE r.estado = 'finalizado'
         AND r.signos_vitales IS NOT NULL`
    );

    //  Nuevos pacientes este mes
    const [nuevosResult] = await connection.execute(
      `SELECT COUNT(*) as total 
       FROM pacientes 
       WHERE eliminado_en IS NULL 
         AND MONTH(creado_en) = MONTH(NOW())
         AND YEAR(creado_en) = YEAR(NOW())`
    );

    //  Distribución por sexo
    const [sexoResult] = await connection.execute(
      `SELECT 
        sexo,
        COUNT(*) as cantidad
       FROM pacientes 
       WHERE eliminado_en IS NULL
       GROUP BY sexo`
    );

    const distribucionSexo = { masculino: 0, femenino: 0 };
    sexoResult.forEach(s => {
      if (s.sexo === 'M') distribucionSexo.masculino = s.cantidad;
      else if (s.sexo === 'F') distribucionSexo.femenino = s.cantidad;
    });

    const totalPacientes = totalResult[0]?.total || 0;
    const porcentajeSexo = {
      masculino: totalPacientes > 0 ? (distribucionSexo.masculino / totalPacientes * 100) : 0,
      femenino: totalPacientes > 0 ? (distribucionSexo.femenino / totalPacientes * 100) : 0
    };

    //  Edad promedio, min y max
    const [edadResult] = await connection.execute(
      `SELECT 
        AVG(TIMESTAMPDIFF(YEAR, fecha_nacimiento, CURDATE())) as promedio,
        MIN(TIMESTAMPDIFF(YEAR, fecha_nacimiento, CURDATE())) as min_edad,
        MAX(TIMESTAMPDIFF(YEAR, fecha_nacimiento, CURDATE())) as max_edad
       FROM pacientes 
       WHERE eliminado_en IS NULL AND fecha_nacimiento IS NOT NULL`
    );

    return res.status(200).json({
      error: false,
      informes: {
        totalPacientes: totalResult[0]?.total || 0,
        nuevosEsteMes: nuevosResult[0]?.total || 0,
        pacientesActivos: activosResult[0]?.total || 0,
        pacientesRiesgo: riesgoResult[0]?.total || 0,
        promedioEdad: parseFloat(edadResult[0]?.promedio || 0),
        edadMin: edadResult[0]?.min_edad || 0,
        edadMax: edadResult[0]?.max_edad || 0,
        distribucionSexo,
        porcentajeSexo
      }
    });

  } catch (err) {
    console.error(' [INFORMES] Error en informes/pacientes:', err);
    return res.status(500).json({ error: true, mensaje: 'Error al obtener informes de pacientes' });
  } finally {
    if (connection) try { connection.release(); } catch (e) {}
  }
});

// ============================================================================
//  INFORMES DE PLANES NUTRICIONALES
// GET /nutricionapp-api/medico/informes/planes
// ============================================================================
router.get('/planes', async (req, res) => {
  const medicoId = req.usuario?.id;
  let connection;

  try {
    connection = await getConnection();

    //  Total de planes
    const [totalResult] = await connection.execute(
      `SELECT COUNT(*) as total FROM planes_nutricionales WHERE medico_id = ?`,
      [medicoId]
    );

    //  Planes este mes
    const [esteMesResult] = await connection.execute(
      `SELECT COUNT(*) as total 
       FROM planes_nutricionales 
       WHERE medico_id = ?
         AND MONTH(fecha_creacion) = MONTH(NOW())
         AND YEAR(fecha_creacion) = YEAR(NOW())`,
      [medicoId]
    );

    // Planes por estado
    const [estadoResult] = await connection.execute(
      `SELECT 
        estado,
        COUNT(*) as cantidad
       FROM planes_nutricionales 
       WHERE medico_id = ?
       GROUP BY estado`,
      [medicoId]
    );

    const estados = {
      activo: 0,
      completado: 0,
      borrador: 0,
      cancelado: 0
    };

    estadoResult.forEach(e => {
      if (estados.hasOwnProperty(e.estado)) {
        estados[e.estado] = e.cantidad;
      }
    });

    const totalPlanes = totalResult[0]?.total || 0;
    const porcentajeEstados = {
      activo: totalPlanes > 0 ? (estados.activo / totalPlanes * 100) : 0,
      completado: totalPlanes > 0 ? (estados.completado / totalPlanes * 100) : 0,
      borrador: totalPlanes > 0 ? (estados.borrador / totalPlanes * 100) : 0,
      cancelado: totalPlanes > 0 ? (estados.cancelado / totalPlanes * 100) : 0
    };

    //  Tasa de éxito (completados / (completados + cancelados))
    const finalizados = estados.completado + estados.cancelado;
    const tasaExito = finalizados > 0 ? (estados.completado / finalizados * 100) : 0;

    //  Duración promedio de planes completados
    const [duracionResult] = await connection.execute(
      `SELECT AVG(duracion_semanas) as promedio
       FROM planes_nutricionales 
       WHERE medico_id = ? AND estado = 'completado'`,
      [medicoId]
    );

    return res.status(200).json({
      error: false,
      informes: {
        totalPlanes,
        planesEsteMes: esteMesResult[0]?.total || 0,
        planesActivos: estados.activo,
        planesCompletados: estados.completado,
        planesBorrador: estados.borrador,
        planesCancelados: estados.cancelado,
        tasaExito: parseFloat(tasaExito.toFixed(1)),
        duracionPromedio: Math.round(duracionResult[0]?.promedio || 4),
        porcentajeEstados
      }
    });

  } catch (err) {
    console.error(' [INFORMES] Error en informes/planes:', err);
    return res.status(500).json({ error: true, mensaje: 'Error al obtener informes de planes' });
  } finally {
    if (connection) try { connection.release(); } catch (e) {}
  }
});

// ============================================================================
//  INFORMES DE ALERTAS CLÍNICAS
// GET /nutricionapp-api/medico/informes/alertas
// ============================================================================
router.get('/alertas', async (req, res) => {
  let connection;

  try {
    connection = await getConnection();

    // Obtener todos los registros finalizados con signos vitales
    const [registros] = await connection.execute(
      `SELECT 
        r.paciente_id,
        r.signos_vitales,
        r.datos_antropometricos,
        p.nombres,
        p.apellidos,
        p.telefono,
        r.fecha_finalizacion
       FROM registro r
       INNER JOIN pacientes p ON p.id = r.paciente_id
       WHERE r.estado = 'finalizado'
         AND r.signos_vitales IS NOT NULL
         AND p.eliminado_en IS NULL
       ORDER BY r.fecha_finalizacion DESC`
    );

    let presionAlta = 0;
    let glucosaAlta = 0;
    let imcFueraRango = 0;
    let hba1cAlta = 0;
    const pacientesRiesgo = [];
    const pacientesProcesados = new Set();

    for (const reg of registros) {
      if (pacientesProcesados.has(reg.paciente_id)) continue;
      pacientesProcesados.add(reg.paciente_id);

      let signos = {};
      let antropometricos = {};

      try {
        signos = typeof reg.signos_vitales === 'string' 
          ? JSON.parse(reg.signos_vitales) 
          : reg.signos_vitales || {};
      } catch (e) {}

      try {
        antropometricos = typeof reg.datos_antropometricos === 'string'
          ? JSON.parse(reg.datos_antropometricos)
          : reg.datos_antropometricos || {};
      } catch (e) {}

      const alertas = [];
      let nivelRiesgo = 'bajo';

      // Presión arterial
      if (signos.presionArterial) {
        const [sist, dia] = String(signos.presionArterial).split('/').map(n => parseInt(n.trim()));
        if (sist >= 140 || dia >= 90) {
          presionAlta++;
          alertas.push(`PA: ${signos.presionArterial}`);
          if (sist >= 180 || dia >= 120) nivelRiesgo = 'crítico';
          else if (nivelRiesgo !== 'crítico') nivelRiesgo = 'alto';
        }
      }

      // Glucosa en ayunas
      if (signos.glucosaAyunas && signos.glucosaAyunas >= 126) {
        glucosaAlta++;
        alertas.push(`Glucosa: ${signos.glucosaAyunas} mg/dL`);
        if (nivelRiesgo === 'bajo') nivelRiesgo = 'medio';
      }

      // HbA1c
      if (signos.hemoglobinaGlicosilada && signos.hemoglobinaGlicosilada >= 6.5) {
        hba1cAlta++;
        alertas.push(`HbA1c: ${signos.hemoglobinaGlicosilada}%`);
        if (nivelRiesgo === 'bajo') nivelRiesgo = 'medio';
      }

      // IMC
      if (antropometricos.imc) {
        if (antropometricos.imc < 18.5 || antropometricos.imc >= 25) {
          imcFueraRango++;
          alertas.push(`IMC: ${antropometricos.imc}`);
          if (nivelRiesgo === 'bajo') nivelRiesgo = 'medio';
        }
      }

      if (alertas.length > 0) {
        pacientesRiesgo.push({
          id: reg.paciente_id,
          nombre: `${reg.nombres} ${reg.apellidos}`,
          telefono: reg.telefono,
          presionArterial: signos.presionArterial || null,
          glucosa: signos.glucosaAyunas || null,
          imc: antropometricos.imc || null,
          motivo: alertas.join(' • '),
          nivelRiesgo,
          fechaRegistro: reg.fecha_finalizacion
        });
      }
    }

    return res.status(200).json({
      error: false,
      informes: {
        presionAlta,
        glucosaAlta,
        imcFueraRango,
        hba1cAlta,
        pacientesRiesgo
      }
    });

  } catch (err) {
    console.error(' [INFORMES] Error en informes/alertas:', err);
    return res.status(500).json({ error: true, mensaje: 'Error al obtener alertas' });
  } finally {
    if (connection) try { connection.release(); } catch (e) {}
  }
});

// ============================================================================
//  INFORMES DE REGISTROS CLÍNICOS
// GET /nutricionapp-api/medico/informes/registros
// ============================================================================
router.get('/registros', async (req, res) => {
  const medicoId = req.usuario?.id;
  let connection;

  try {
    connection = await getConnection();

    // Registros finalizados
    const [finalizadosResult] = await connection.execute(
      `SELECT COUNT(*) as total,
        AVG(TIMESTAMPDIFF(MINUTE, fecha_inicio, fecha_finalizacion)) as tiempo_promedio
       FROM registro 
       WHERE registrado_por = ? AND estado = 'finalizado'`,
      [medicoId]
    );

    //  Registros en proceso (no finalizados ni cancelados)
    const [enProcesoResult] = await connection.execute(
      `SELECT COUNT(*) as total 
       FROM registro 
       WHERE registrado_por = ? 
         AND estado NOT IN ('finalizado', 'cancelado')`,
      [medicoId]
    );

    //  Registros cancelados
    const [canceladosResult] = await connection.execute(
      `SELECT COUNT(*) as total 
       FROM registro 
       WHERE registrado_por = ? AND estado = 'cancelado'`,
      [medicoId]
    );

    const total = (finalizadosResult[0]?.total || 0) + 
                  (enProcesoResult[0]?.total || 0) + 
                  (canceladosResult[0]?.total || 0);

    const tasaCancelacion = total > 0 
      ? (canceladosResult[0]?.total / total * 100) 
      : 0;

    const eficiencia = total > 0 
      ? (finalizadosResult[0]?.total / total * 100) 
      : 0;

    return res.status(200).json({
      error: false,
      informes: {
        finalizados: finalizadosResult[0]?.total || 0,
        enProceso: enProcesoResult[0]?.total || 0,
        cancelados: canceladosResult[0]?.total || 0,
        tiempoPromedio: Math.round(finalizadosResult[0]?.tiempo_promedio || 0),
        tasaCancelacion: parseFloat(tasaCancelacion.toFixed(1)),
        eficiencia: parseFloat(eficiencia.toFixed(1))
      }
    });

  } catch (err) {
    console.error(' [INFORMES] Error en informes/registros:', err);
    return res.status(500).json({ error: true, mensaje: 'Error al obtener informes de registros' });
  } finally {
    if (connection) try { connection.release(); } catch (e) {}
  }
});

console.log('✅ [ROUTER] medicoinformes.js cargado correctamente');
module.exports = router;