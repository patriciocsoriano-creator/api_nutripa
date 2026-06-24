const express = require('express');
const router = express.Router();
const { getConnection } = require('../conexion');
const { verificarToken, verificarRol } = require('../middleware/auth');

console.log('[ROUTER] Cargando enfermeriareportes.js');

// ============================================================================
// GET /nutricionapp-api/enfermeria/reportes/estadisticas
// Obtener estadisticas y registros para informes
// ============================================================================
router.get('/estadisticas', verificarToken, verificarRol('enfermera', 'nutricionista', 'admin'), async (req, res) => {
  const { fecha_inicio, fecha_fin, estado } = req.query;

  let connection;
  try {
    connection = await getConnection();

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (fecha_inicio) {
      whereClause += ' AND r.creado_en >= ?';
      params.push(fecha_inicio);
    }

    if (fecha_fin) {
      whereClause += ' AND r.creado_en <= ?';
      params.push(fecha_fin + ' 23:59:59');
    }

    if (estado && estado !== 'todos') {
      whereClause += ' AND r.estado = ?';
      params.push(estado);
    }

    // Query de estadisticas
    const statsQuery = `
      SELECT 
        COUNT(*) as total_registros,
        SUM(CASE WHEN r.estado = 'finalizado' THEN 1 ELSE 0 END) as registros_completados,
        SUM(CASE WHEN r.estado = 'en_proceso' THEN 1 ELSE 0 END) as registros_en_proceso,
        SUM(CASE WHEN r.estado = 'iniciado' THEN 1 ELSE 0 END) as registros_iniciados
      FROM registro r
      ${whereClause}
    `;

    const [statsResult] = await connection.execute(statsQuery, params);
    const stats = statsResult[0];

    const total = stats.total_registros || 0;
    const completados = stats.registros_completados || 0;
    const enProceso = stats.registros_en_proceso || 0;
    const iniciados = stats.registros_iniciados || 0;

    const estadisticas = {
      totalRegistros: total,
      registrosCompletados: completados,
      registrosEnProceso: enProceso,
      registrosIniciados: iniciados,
      porcentajeCompletados: total > 0 ? Math.round((completados / total) * 100) : 0,
      porcentajeEnProceso: total > 0 ? Math.round((enProceso / total) * 100) : 0,
      porcentajeIniciados: total > 0 ? Math.round((iniciados / total) * 100) : 0
    };

    // Query de registros recientes
    const registrosQuery = `
      SELECT 
        r.id,
        r.estado,
        r.progreso,
        r.creado_en as fecha_registro,
        p.nombres,
        p.apellidos,
        CONCAT(p.nombres, ' ', p.apellidos) as nombre_paciente,
        p.numero_identificacion as cedula_paciente
      FROM registro r
      INNER JOIN pacientes p ON p.id = r.paciente_id
      ${whereClause}
      ORDER BY r.creado_en DESC
      LIMIT 20
    `;

    const [registrosResult] = await connection.execute(registrosQuery, params);

    console.log(`[INFORMES] Estadisticas cargadas: ${total} registros en el periodo`);

    return res.status(200).json({
      error: false,
      mensaje: 'Informes cargados exitosamente',
      estadisticas: estadisticas,
      registros: registrosResult
    });

  } catch (error) {
    console.error('[INFORMES] Error:', error);
    return res.status(500).json({
      error: true,
      mensaje: 'Error al cargar informes'
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// ============================================================================
// GET /nutricionapp-api/enfermeria/reportes/exportar
// Exportar informe en PDF o Excel
// ============================================================================
router.get('/exportar', verificarToken, verificarRol('enfermera', 'nutricionista', 'admin'), async (req, res) => {
  const { fecha_inicio, fecha_fin, formato = 'pdf' } = req.query;

  let connection;
  try {
    connection = await getConnection();

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (fecha_inicio) {
      whereClause += ' AND r.creado_en >= ?';
      params.push(fecha_inicio);
    }

    if (fecha_fin) {
      whereClause += ' AND r.creado_en <= ?';
      params.push(fecha_fin + ' 23:59:59');
    }

    const query = `
      SELECT 
        r.id,
        r.estado,
        r.progreso,
        r.creado_en as fecha_registro,
        p.nombres,
        p.apellidos,
        CONCAT(p.nombres, ' ', p.apellidos) as nombre_paciente,
        p.numero_identificacion as cedula_paciente,
        p.telefono
      FROM registro r
      INNER JOIN pacientes p ON p.id = r.paciente_id
      ${whereClause}
      ORDER BY r.creado_en DESC
    `;

    const [rows] = await connection.execute(query, params);

    let content;
    let contentType;
    let extension;

    if (formato === 'excel') {
      // Generar CSV (compatible con Excel)
      const headers = ['ID', 'Paciente', 'Cedula', 'Telefono', 'Estado', 'Progreso', 'Fecha Registro'];
      const csvRows = [headers.join(',')];

      rows.forEach(row => {
        const rowData = [
          row.id,
          `"${row.nombre_paciente}"`,
          row.cedula_paciente,
          row.telefono || '',
          row.estado,
          row.progreso || 0,
          row.fecha_registro
        ];
        csvRows.push(rowData.join(','));
      });

      content = csvRows.join('\n');
      contentType = 'text/csv; charset=utf-8';
      extension = 'csv';
    } else {
      // Generar informe en texto
      let report = `INFORME DE ENFERMERIA\n`;
      report += `====================\n\n`;
      report += `Periodo: ${fecha_inicio || 'Inicio'} a ${fecha_fin || 'Fin'}\n`;
      report += `Total de registros: ${rows.length}\n\n`;
      report += `DETALLE DE REGISTROS:\n`;
      report += `--------------------\n\n`;

      rows.forEach((row, index) => {
        report += `${index + 1}. ${row.nombre_paciente}\n`;
        report += `   Cedula: ${row.cedula_paciente}\n`;
        report += `   Estado: ${row.estado}\n`;
        report += `   Progreso: ${row.progreso || 0}%\n`;
        report += `   Fecha: ${row.fecha_registro}\n\n`;
      });

      content = report;
      contentType = 'text/plain; charset=utf-8';
      extension = 'txt';
    }

    console.log(`[EXPORTAR] Informe generado en formato ${formato}: ${rows.length} registros`);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename=informe_enfermeria_${Date.now()}.${extension}`);
    res.send(content);

  } catch (error) {
    console.error('[EXPORTAR] Error:', error);
    return res.status(500).json({
      error: true,
      mensaje: 'Error al exportar informe'
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

console.log('[ROUTER] enfermeriareportes.js cargado correctamente');
module.exports = router;