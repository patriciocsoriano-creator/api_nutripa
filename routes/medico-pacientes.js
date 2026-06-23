// routes/medico-pacientes.js
const express = require('express');
const router = express.Router();
const { getConnection } = require('../conexion');
const { verificarToken, verificarRol } = require('../middleware/auth');

console.log(' [ROUTER] Cargando medico-pacientes.js');

//  Middleware de debug para todas las peticiones
router.use((req, res, next) => {
  console.log(' [MEDICO-PACIENTES DEBUG]', {
    method: req.method,
    path: req.path,
    usuario_id: req.usuario?.id,
    rol: req.usuario?.rol
  });
  next();
});

// GET /nutricionapp-api/medico/pacientes
//  Lista pacientes asignados al médico/nutricionista
router.get('/', verificarToken, verificarRol('doctor', 'nutricionista'), async (req, res) => {
  console.log(' [PACIENTES] Solicitando listado para usuario:', req.usuario.id);
  
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
    
    console.log(' [PACIENTES] Ejecutando consulta con usuario_id:', usuario_id);
    
    const [pacientes] = await connection.execute(query, [usuario_id]);
    
    console.log(' [PACIENTES] Consulta exitosa. Registros encontrados:', pacientes.length);
    
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
    console.error(' [PACIENTES] Error en consulta:', {
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

//  Opcional: Endpoint para búsqueda de pacientes por cédula/nombre
// ==========================================
// BUSCAR PACIENTES (MEJORADO)
// ==========================================
router.get('/buscar', verificarToken, verificarRol('doctor', 'nutricionista'), async (req, res) => {
  const { q, tipo } = req.query;
  const usuario_id = req.usuario.id;
  
  console.log('[BUSCAR] Iniciando busqueda', { termino: q, tipo: tipo || 'todos' });
  
  if (!q || q.length < 2) {
    return res.status(400).json({ 
      error: true, 
      mensaje: 'Ingrese al menos 2 caracteres para buscar' 
    });
  }
  
  let connection;
  try {
    connection = await getConnection();
    
    // Construir consulta según el tipo de filtro
    let query;
    let params;
    
    if (tipo === 'cedula') {
      // Busqueda exacta o parcial por cedula
      query = `
        SELECT 
          p.id, 
          p.nombres, 
          p.apellidos, 
          p.numero_identificacion,
          p.fecha_nacimiento,
          p.sexo,
          p.telefono,
          p.direccion,
          p.actividad_fisica,
          p.ocupacion,
          TIMESTAMPDIFF(YEAR, p.fecha_nacimiento, CURDATE()) as edad,
          (SELECT COUNT(*) FROM registro r WHERE r.paciente_id = p.id AND r.estado = 'finalizado') as total_registros
        FROM pacientes p
        WHERE p.eliminado_en IS NULL
          AND p.numero_identificacion LIKE ?
        ORDER BY p.apellidos, p.nombres
        LIMIT 20
      `;
      params = [`%${q}%`];
    } 
    else if (tipo === 'telefono') {
      // Busqueda por telefono
      query = `
        SELECT 
          p.id, 
          p.nombres, 
          p.apellidos, 
          p.numero_identificacion,
          p.fecha_nacimiento,
          p.sexo,
          p.telefono,
          p.direccion,
          p.actividad_fisica,
          p.ocupacion,
          TIMESTAMPDIFF(YEAR, p.fecha_nacimiento, CURDATE()) as edad,
          (SELECT COUNT(*) FROM registro r WHERE r.paciente_id = p.id AND r.estado = 'finalizado') as total_registros
        FROM pacientes p
        WHERE p.eliminado_en IS NULL
          AND p.telefono LIKE ?
        ORDER BY p.apellidos, p.nombres
        LIMIT 20
      `;
      params = [`%${q}%`];
    } 
    else if (tipo === 'nombre') {
      // Busqueda solo por nombre/apellido
      query = `
        SELECT 
          p.id, 
          p.nombres, 
          p.apellidos, 
          p.numero_identificacion,
          p.fecha_nacimiento,
          p.sexo,
          p.telefono,
          p.direccion,
          p.actividad_fisica,
          p.ocupacion,
          TIMESTAMPDIFF(YEAR, p.fecha_nacimiento, CURDATE()) as edad,
          (SELECT COUNT(*) FROM registro r WHERE r.paciente_id = p.id AND r.estado = 'finalizado') as total_registros
        FROM pacientes p
        WHERE p.eliminado_en IS NULL
          AND (p.nombres LIKE ? OR p.apellidos LIKE ?)
        ORDER BY p.apellidos, p.nombres
        LIMIT 20
      `;
      params = [`%${q}%`, `%${q}%`];
    } 
    else {
      // Busqueda general (todos los campos)
      query = `
        SELECT 
          p.id, 
          p.nombres, 
          p.apellidos, 
          p.numero_identificacion,
          p.fecha_nacimiento,
          p.sexo,
          p.telefono,
          p.direccion,
          p.actividad_fisica,
          p.ocupacion,
          TIMESTAMPDIFF(YEAR, p.fecha_nacimiento, CURDATE()) as edad,
          (SELECT COUNT(*) FROM registro r WHERE r.paciente_id = p.id AND r.estado = 'finalizado') as total_registros
        FROM pacientes p
        WHERE p.eliminado_en IS NULL
          AND (
            p.nombres LIKE ? OR 
            p.apellidos LIKE ? OR 
            p.numero_identificacion LIKE ? OR
            p.telefono LIKE ?
          )
        ORDER BY p.apellidos, p.nombres
        LIMIT 20
      `;
      params = [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`];
    }
    
    const [resultados] = await connection.execute(query, params);
    
    console.log(`[BUSCAR] Busqueda completada: ${resultados.length} resultados encontrados`);
    
    // Formatear respuesta con todos los campos necesarios
    const resultadosFormateados = resultados.map(r => ({
      id: r.id,
      nombres: r.nombres,
      apellidos: r.apellidos,
      nombre_completo: `${r.nombres} ${r.apellidos}`.trim(),
      numero_identificacion: r.numero_identificacion,
      cedula: r.numero_identificacion,
      fecha_nacimiento: r.fecha_nacimiento,
      sexo: r.sexo,
      telefono: r.telefono,
      direccion: r.direccion,
      actividad_fisica: r.actividad_fisica,
      ocupacion: r.ocupacion,
      edad: r.edad,
      total_registros: parseInt(r.total_registros) || 0
    }));
    
    return res.json({
      error: false,
      mensaje: `Busqueda completada: ${resultadosFormateados.length} resultados`,
      total: resultadosFormateados.length,
      resultados: resultadosFormateados,
      pacientes: resultadosFormateados,
      criterio: tipo || 'todos',
      termino: q
    });
    
  } catch (err) {
    console.error('[BUSCAR] Error en busqueda:', {
      message: err.message,
      code: err.code
    });
    return res.status(500).json({ 
      error: true, 
      mensaje: 'Error en busqueda: ' + err.message 
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// ==========================================
// CREAR NUEVO PACIENTE
// ==========================================
router.post('/', verificarToken, verificarRol('doctor', 'nutricionista'), async (req, res) => {
  const medico_id = req.usuario.id;
  const {
    nombres,
    apellidos,
    numero_identificacion,
    fecha_nacimiento,
    sexo,
    direccion,
    telefono,
    ocupacion,
    actividad_fisica
  } = req.body;

  console.log('[MEDICO-PACIENTES] Creando paciente', { cedula: numero_identificacion });

  // Validaciones
  if (!nombres || !apellidos || !numero_identificacion) {
    return res.status(400).json({ 
      error: true, 
      mensaje: 'Nombres, apellidos y cedula son obligatorios' 
    });
  }

  if (!/^\d{10}$/.test(numero_identificacion)) {
    return res.status(400).json({ 
      error: true, 
      mensaje: 'La cedula debe tener 10 digitos' 
    });
  }

  if (telefono && !/^\d{10}$/.test(telefono)) {
    return res.status(400).json({ 
      error: true, 
      mensaje: 'El telefono debe tener 10 digitos' 
    });
  }

  let connection;
  try {
    connection = await getConnection();

    // Verificar si ya existe paciente con esa cedula
    const [existentes] = await connection.execute(
      `SELECT id, eliminado_en FROM pacientes WHERE numero_identificacion = ?`,
      [numero_identificacion]
    );

    let paciente_id;

    if (existentes.length > 0) {
      // Si existe pero estaba eliminado, reactivar
      if (existentes[0].eliminado_en) {
        paciente_id = existentes[0].id;
        console.log('[MEDICO-PACIENTES] Reactivando paciente eliminado:', numero_identificacion);
        
        await connection.execute(
          `UPDATE pacientes 
           SET eliminado_en = NULL,
               nombres = ?,
               apellidos = ?,
               fecha_nacimiento = ?,
               sexo = ?,
               direccion = ?,
               telefono = ?,
               ocupacion = ?,
               actividad_fisica = ?,
               actualizado_en = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [
            nombres.trim(), apellidos.trim(), fecha_nacimiento || null,
            sexo || null, direccion || null, telefono || null,
            ocupacion || null, actividad_fisica || null,
            paciente_id
          ]
        );
      } else {
        // Si existe y esta activo, error
        return res.status(409).json({
          error: true,
          mensaje: 'Ya existe un paciente con esa cedula',
          paciente_id: existentes[0].id
        });
      }
    } else {
      // Crear nuevo paciente
      const { v4: uuidv4 } = require('uuid');
      paciente_id = uuidv4();
      console.log('[MEDICO-PACIENTES] Creando nuevo paciente:', numero_identificacion);

      await connection.execute(
        `INSERT INTO pacientes (
          id, nombres, apellidos, numero_identificacion, 
          fecha_nacimiento, sexo, direccion, telefono, 
          ocupacion, actividad_fisica,
          activo, creado_en
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)`,
        [
          paciente_id, nombres.trim(), apellidos.trim(), numero_identificacion,
          fecha_nacimiento || null, sexo || null, direccion || null,
          telefono || null, ocupacion || null, actividad_fisica || null
        ]
      );
    }

    console.log('[MEDICO-PACIENTES] Paciente registrado:', paciente_id);

    return res.status(201).json({
      error: false,
      mensaje: 'Paciente registrado correctamente',
      paciente_id,
      nombres: `${nombres} ${apellidos}`,
      cedula: numero_identificacion
    });

  } catch (err) {
    console.error('[MEDICO-PACIENTES] Error registrando paciente:', err.message);
    
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        error: true,
        mensaje: 'Ya existe un paciente con esa cedula'
      });
    }
    
    return res.status(500).json({ 
      error: true, 
      mensaje: 'Error al registrar paciente: ' + err.message 
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

console.log(' [ROUTER] medico-pacientes.js cargado correctamente');
module.exports = router;