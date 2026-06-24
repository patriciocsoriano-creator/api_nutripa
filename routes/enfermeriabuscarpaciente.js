const express = require('express');
const router = express.Router();
const { getConnection } = require('../conexion');
const { verificarToken, verificarRol } = require('../middleware/auth');

console.log('[ROUTER] Cargando enfermeriabuscarpaciente.js');

// ============================================================================
// GET /nutricionapp-api/enfermeria/pacientes/buscar
// Buscar pacientes por cedula, nombre o telefono
// ============================================================================
router.get('/buscar', verificarToken, verificarRol('enfermera', 'nutricionista', 'admin'), async (req, res) => {
  const { q, tipo = 'todos', estado = 'todos', orden = 'recientes' } = req.query;

  if (!q || !q.trim()) {
    return res.status(400).json({
      error: true,
      mensaje: 'El termino de busqueda es requerido'
    });
  }

  let connection;
  try {
    connection = await getConnection();
    const termino = q.trim();

    // Construir WHERE segun tipo de busqueda
    let whereClause = '';
    const params = [];

    if (tipo === 'cedula') {
      whereClause = 'WHERE p.numero_identificacion LIKE ?';
      params.push(`%${termino}%`);
    } else if (tipo === 'nombre') {
      whereClause = 'WHERE CONCAT(p.nombres, " ", p.apellidos) LIKE ? OR p.nombres LIKE ? OR p.apellidos LIKE ?';
      params.push(`%${termino}%`, `%${termino}%`, `%${termino}%`);
    } else if (tipo === 'telefono') {
      whereClause = 'WHERE p.telefono LIKE ?';
      params.push(`%${termino}%`);
    } else {
      // Busqueda en todos los campos
      whereClause = 'WHERE p.numero_identificacion LIKE ? OR CONCAT(p.nombres, " ", p.apellidos) LIKE ? OR p.nombres LIKE ? OR p.apellidos LIKE ? OR p.telefono LIKE ?';
      params.push(`%${termino}%`, `%${termino}%`, `%${termino}%`, `%${termino}%`, `%${termino}%`);
    }

    // Filtro por estado
    if (estado !== 'todos') {
      whereClause += ` AND COALESCE(r.estado, 'iniciado') = ?`;
      params.push(estado);
    }

    // Ordenamiento
    let orderBy = '';
    if (orden === 'recientes') {
      orderBy = 'ORDER BY COALESCE(r.creado_en, p.creado_en) DESC';
    } else if (orden === 'antiguos') {
      orderBy = 'ORDER BY COALESCE(r.creado_en, p.creado_en) ASC';
    } else if (orden === 'nombre_asc') {
      orderBy = 'ORDER BY p.nombres ASC, p.apellidos ASC';
    } else if (orden === 'nombre_desc') {
      orderBy = 'ORDER BY p.nombres DESC, p.apellidos DESC';
    } else {
      orderBy = 'ORDER BY COALESCE(r.creado_en, p.creado_en) DESC';
    }

    // Query principal
    const query = `
      SELECT 
        p.id,
        p.nombres,
        p.apellidos,
        CONCAT(p.nombres, ' ', p.apellidos) as nombre_completo,
        p.numero_identificacion as cedula,
        p.telefono,
        p.sexo,
        p.fecha_nacimiento,
        p.creado_en,
        r.id as registro_id,
        r.estado as estado_real,
        r.progreso,
        r.creado_en as registro_creado_en,
        r.actualizado_en as ultima_fecha,
        (
          SELECT COUNT(*) > 0 
          FROM alertas_paciente ap 
          WHERE ap.paciente_id = p.id AND ap.activa = 1
        ) as tiene_alerta
      FROM pacientes p
      LEFT JOIN (
        SELECT r1.*
        FROM registro r1
        INNER JOIN (
          SELECT paciente_id, MAX(creado_en) as max_fecha
          FROM registro
          GROUP BY paciente_id
        ) r2 ON r1.paciente_id = r2.paciente_id AND r1.creado_en = r2.max_fecha
      ) r ON r.paciente_id = p.id
      ${whereClause}
      ${orderBy}
      LIMIT 50
    `;

    const [rows] = await connection.execute(query, params);

    // Procesar resultados
    const pacientes = rows.map(p => {
      let edad = null;
      if (p.fecha_nacimiento) {
        const hoy = new Date();
        const nacimiento = new Date(p.fecha_nacimiento);
        edad = hoy.getFullYear() - nacimiento.getFullYear();
        const mesDiff = hoy.getMonth() - nacimiento.getMonth();
        if (mesDiff < 0 || (mesDiff === 0 && hoy.getDate() < nacimiento.getDate())) {
          edad--;
        }
      }

      // Calcular progreso si no existe
      let progreso = p.progreso || 0;
      if (p.estado_real === 'finalizado') {
        progreso = 100;
      } else if (p.estado_real === 'en_proceso' && !progreso) {
        progreso = 50;
      } else if (p.estado_real === 'iniciado' && !progreso) {
        progreso = 10;
      }

      return {
        id: p.id,
        nombre_completo: p.nombre_completo || 'Paciente',
        cedula: p.cedula,
        telefono: p.telefono,
        sexo: p.sexo,
        edad: edad,
        estado_real: p.estado_real || 'iniciado',
        progreso: progreso,
        registro_id: p.registro_id,
        ultima_fecha: p.ultima_fecha || p.registro_creado_en || p.creado_en,
        tiene_alerta: p.tiene_alerta === 1
      };
    });

    console.log(`[BUSCAR] Encontrados ${pacientes.length} pacientes para "${termino}"`);

    return res.status(200).json({
      error: false,
      mensaje: 'Busqueda exitosa',
      total: pacientes.length,
      pacientes: pacientes
    });

  } catch (error) {
    console.error('[BUSCAR] Error:', error);
    return res.status(500).json({
      error: true,
      mensaje: 'Error al buscar pacientes'
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

console.log('[ROUTER] enfermeriabuscarpaciente.js cargado correctamente');
module.exports = router;