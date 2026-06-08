// routes/medico-pacientes.js
const express = require('express');
const router = express.Router();
const { getConnection } = require('../conexion');
const { verificarToken, verificarRol } = require('../middleware/auth');

console.log('✅ [ROUTER] Cargando medico-pacientes.js');

// 👇 Middleware de debug para todas las peticiones
router.use((req, res, next) => {
  console.log('🔍 [MEDICO-PACIENTES DEBUG]', {
    method: req.method,
    path: req.path,
    usuario_id: req.usuario?.id,
    rol: req.usuario?.rol
  });
  next();
});

// GET /nutricionapp-api/medico/pacientes
// 👉 Lista pacientes asignados al médico/nutricionista
router.get('/', verificarToken, verificarRol('doctor', 'nutricionista'), async (req, res) => {
  console.log('📋 [PACIENTES] Solicitando listado para usuario:', req.usuario.id);
  
  const usuario_id = req.usuario.id;
  let connection;
  
  try {
    connection = await getConnection();
    
    // Consulta: Pacientes con al menos un registro asociado a este profesional
    const query = `
      SELECT DISTINCT
        p.id,
        p.nombres,
        p.apellidos,
        p.numero_identificacion as cedula,
        p.fecha_nacimiento,
        p.sexo,
        p.actividad_fisica,
        
        -- Calcular edad
        TIMESTAMPDIFF(YEAR, p.fecha_nacimiento, CURDATE()) as edad,
        
        -- Último IMC registrado
        (SELECT r.datos_antropometricos->>'$.imc' 
         FROM registro r 
         WHERE r.paciente_id = p.id 
           AND r.estado = 'finalizado' 
           AND r.datos_antropometricos IS NOT NULL
         ORDER BY r.fecha_finalizacion DESC LIMIT 1) as ultimo_imc,
        
        -- Último estado de registro
        (SELECT r.estado 
         FROM registro r 
         WHERE r.paciente_id = p.id 
         ORDER BY r.fecha_finalizacion DESC LIMIT 1) as ultimo_estado,
        
        -- Fecha del último registro
        (SELECT r.fecha_finalizacion 
         FROM registro r 
         WHERE r.paciente_id = p.id 
         ORDER BY r.fecha_finalizacion DESC LIMIT 1) as ultima_consulta,
        
        -- Contar registros finalizados
        (SELECT COUNT(*) 
         FROM registro r 
         WHERE r.paciente_id = p.id AND r.estado = 'finalizado') as total_registros
        
      FROM pacientes p
      INNER JOIN registro r ON r.paciente_id = p.id
      WHERE 
        p.eliminado_en IS NULL
        AND (
          r.registrado_por = ?  -- Pacientes registrados por este profesional
          OR EXISTS (
            SELECT 1 FROM registro r2 
            WHERE r2.paciente_id = p.id 
            AND r2.estado = 'finalizado'
          )
        )
      ORDER BY p.apellidos, p.nombres
    `;
    
    console.log('🔍 [PACIENTES] Ejecutando consulta con usuario_id:', usuario_id);
    
    const [pacientes] = await connection.execute(query, [usuario_id]);
    
    console.log('✅ [PACIENTES] Consulta exitosa. Registros encontrados:', pacientes.length);
    
    // Formatear respuesta
    const listaPacientes = pacientes.map(p => ({
      id: p.id,
      nombre_completo: `${p.nombres} ${p.apellidos}`.trim(),
      cedula: p.cedula,
      edad: p.edad,
      sexo: p.sexo,
      actividad_fisica: p.actividad_fisica,
      imc: p.ultimo_imc ? parseFloat(p.ultimo_imc) : null,
      ultimo_estado: p.ultimo_estado,
      ultima_consulta: p.ultima_consulta,
      total_registros: parseInt(p.total_registros) || 0,
      // Campo para frontend: determinar si tiene plan activo
      tiene_plan_activo: p.ultimo_estado === 'finalizado'
    }));
    
    return res.json({
      error: false,
      mensaje: 'Listado obtenido',
      total: listaPacientes.length,
      pacientes: listaPacientes
    });
    
  } catch (err) {
    console.error('❌ [PACIENTES] Error en consulta:', {
      message: err.message,
      code: err.code,
      sql: err.sql
    });
    
    return res.status(500).json({
      error: true,
      mensaje: 'Error al cargar pacientes: ' + err.message,
      detalles: process.env.NODE_ENV === 'development' ? err : undefined
    });
    
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// 👉 Opcional: Endpoint para búsqueda de pacientes por cédula/nombre
router.get('/buscar', verificarToken, verificarRol('doctor', 'nutricionista'), async (req, res) => {
  const { q } = req.query;  // Término de búsqueda
  const usuario_id = req.usuario.id;
  
  if (!q || q.length < 2) {
    return res.status(400).json({ error: true, mensaje: 'Ingrese al menos 2 caracteres para buscar' });
  }
  
  let connection;
  try {
    connection = await getConnection();
    
    const query = `
      SELECT 
        p.id, p.nombres, p.apellidos, p.numero_identificacion as cedula,
        CONCAT(p.nombres, ' ', p.apellidos) as nombre_completo
      FROM pacientes p
      WHERE p.eliminado_en IS NULL
        AND (
          p.nombres LIKE ? OR 
          p.apellidos LIKE ? OR 
          p.numero_identificacion LIKE ?
        )
      LIMIT 20
    `;
    
    const searchTerm = `%${q}%`;
    const [resultados] = await connection.execute(query, [searchTerm, searchTerm, searchTerm]);
    
    return res.json({
      error: false,
      resultados: resultados.map(r => ({
        id: r.id,
        nombre_completo: r.nombre_completo,
        cedula: r.cedula
      }))
    });
    
  } catch (err) {
    console.error('❌ [BUSCAR] Error:', err.message);
    return res.status(500).json({ error: true, mensaje: 'Error en búsqueda' });
  } finally {
    if (connection) await connection.release();
  }
});

console.log('✅ [ROUTER] medico-pacientes.js cargado correctamente');
module.exports = router;