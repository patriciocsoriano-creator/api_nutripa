// routes/admin.js - PANEL DE ADMINISTRACIÓN COMPLETO
console.log('✅ [ROUTER] Cargando admin.js');

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { getConnection } = require('../conexion');
const { verificarToken, verificarRol } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// Middleware: Solo administradores
router.use(verificarToken);
router.use(verificarRol('admin'));

// ========================================
// 📊 DASHBOARD - ESTADÍSTICAS GENERALES
// ========================================
router.get('/dashboard/stats', async (req, res) => {
  let connection;
  try {
    connection = await getConnection();

    const [totalUsuarios] = await connection.execute(
      `SELECT COUNT(*) as total FROM usuarios WHERE eliminado_en IS NULL`
    );

    const [totalMedicos] = await connection.execute(
      `SELECT COUNT(*) as total FROM usuarios u
       INNER JOIN roles r ON u.rol_id = r.id
       WHERE r.nombre IN ('doctor', 'nutricionista') 
         AND u.eliminado_en IS NULL AND u.activo = 1`
    );

    const [totalPacientes] = await connection.execute(
      `SELECT COUNT(*) as total FROM pacientes WHERE eliminado_en IS NULL`
    );

    const [totalPlanes] = await connection.execute(
      `SELECT COUNT(*) as total FROM planes_nutricionales WHERE estado != 'borrador'`
    );

    const [registrosHoy] = await connection.execute(
      `SELECT COUNT(*) as total FROM registro WHERE DATE(fecha_inicio) = CURDATE()`
    );

    return res.status(200).json({
      error: false,
      total_usuarios: totalUsuarios[0]?.total || 0,
      total_medicos: totalMedicos[0]?.total || 0,
      total_pacientes: totalPacientes[0]?.total || 0,
      total_planes: totalPlanes[0]?.total || 0,
      registros_hoy: registrosHoy[0]?.total || 0
    });

  } catch (err) {
    console.error('❌ [ADMIN] Error en dashboard/stats:', err.message);
    return res.status(500).json({ error: true, mensaje: 'Error al cargar estadísticas' });
  } finally {
    if (connection) try { connection.release(); } catch (e) {}
  }
});

// ========================================
// 👥 USUARIOS - LISTAR TODOS
// ========================================
router.get('/usuarios', async (req, res) => {
  let connection;
  try {
    connection = await getConnection();

    const [usuarios] = await connection.execute(
      `SELECT 
         u.id, 
         u.nombre, 
         u.apellido, 
         u.correo, 
         u.cedula, 
         u.telefono, 
         u.activo,
         u.fecha_registro,
         r.nombre as rol,
         r.id as rol_id
       FROM usuarios u
       INNER JOIN roles r ON u.rol_id = r.id
       WHERE u.eliminado_en IS NULL
       ORDER BY u.fecha_registro DESC`
    );

    return res.status(200).json({
      error: false,
      usuarios: usuarios,
      total: usuarios.length
    });

  } catch (err) {
    console.error('❌ [ADMIN] Error listando usuarios:', err.message);
    return res.status(500).json({ error: true, mensaje: 'Error al cargar usuarios' });
  } finally {
    if (connection) try { connection.release(); } catch (e) {}
  }
});

// ========================================
// 👤 USUARIOS - CREAR NUEVO
// ========================================
router.post('/usuarios', async (req, res) => {
  const { nombre, apellido, cedula, correo, telefono, password, rol, genero } = req.body;
  const adminId = req.usuario?.id;

  if (!nombre || !apellido || !correo || !password || !rol) {
    return res.status(400).json({ error: true, mensaje: 'Faltan campos obligatorios' });
  }

  let connection;
  try {
    connection = await getConnection();

    // Verificar si el correo ya existe
    const [existeCorreo] = await connection.execute(
      `SELECT id FROM usuarios WHERE correo = ? AND eliminado_en IS NULL`,
      [correo.toLowerCase()]
    );

    if (existeCorreo.length > 0) {
      return res.status(409).json({ error: true, mensaje: 'El correo ya está registrado' });
    }

    // Verificar cédula si se proporciona
    if (cedula) {
      const [existeCedula] = await connection.execute(
        `SELECT id FROM usuarios WHERE cedula = ? AND eliminado_en IS NULL`,
        [cedula]
      );
      if (existeCedula.length > 0) {
        return res.status(409).json({ error: true, mensaje: 'La cédula ya está registrada' });
      }
    }

    // Obtener rol_id
    const [roles] = await connection.execute(
      `SELECT id FROM roles WHERE nombre = ?`,
      [rol]
    );

    if (roles.length === 0) {
      return res.status(400).json({ error: true, mensaje: 'Rol no válido' });
    }

    const rol_id = roles[0].id;

    // Hashear contraseña
    const password_hash = await bcrypt.hash(password, 12);

    // Insertar usuario
    const usuarioId = uuidv4();
    await connection.execute(
      `INSERT INTO usuarios 
        (id, rol_id, nombre, apellido, correo, password_hash, cedula, telefono, genero, activo, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())`,
      [usuarioId, rol_id, nombre.trim(), apellido.trim(), correo.toLowerCase(), 
       password_hash, cedula || null, telefono || null, genero || null]
    );

    // Registrar en auditoría
    await connection.execute(
      `INSERT INTO historial_acceso (id, usuario_id, ip_address, exito, motivo_fallo, fecha)
       VALUES (?, ?, ?, 1, 'CREACION_USUARIO', NOW())`,
      [uuidv4(), usuarioId, req.ip]
    );

    console.log(`✅ [ADMIN] Usuario creado: ${correo} por admin ${adminId}`);

    return res.status(201).json({
      error: false,
      mensaje: 'Usuario creado exitosamente',
      usuario_id: usuarioId
    });

  } catch (err) {
    console.error('❌ [ADMIN] Error creando usuario:', err.message);
    return res.status(500).json({ error: true, mensaje: 'Error al crear usuario: ' + err.message });
  } finally {
    if (connection) try { connection.release(); } catch (e) {}
  }
});

// ========================================
// 🔄 USUARIOS - TOGGLE ACTIVO/INACTIVO
// ========================================
router.patch('/usuarios/:id/toggle-activo', async (req, res) => {
  const { id } = req.params;
  let connection;
  try {
    connection = await getConnection();

    await connection.execute(
      `UPDATE usuarios SET activo = NOT activo, actualizado_en = NOW() WHERE id = ?`,
      [id]
    );

    return res.status(200).json({
      error: false,
      mensaje: 'Estado del usuario actualizado'
    });

  } catch (err) {
    console.error('❌ [ADMIN] Error toggle activo:', err.message);
    return res.status(500).json({ error: true, mensaje: 'Error al actualizar estado' });
  } finally {
    if (connection) try { connection.release(); } catch (e) {}
  }
});

// ========================================
// 🗑️ USUARIOS - ELIMINAR (SOFT DELETE)
// ========================================
router.delete('/usuarios/:id', async (req, res) => {
  const { id } = req.params;
  const adminId = req.usuario?.id;
  let connection;
  try {
    connection = await getConnection();

    // No permitir eliminar al propio admin
    if (id === adminId) {
      return res.status(400).json({ error: true, mensaje: 'No puedes eliminar tu propia cuenta' });
    }

    await connection.execute(
      `UPDATE usuarios SET eliminado_en = NOW(), activo = 0 WHERE id = ? AND eliminado_en IS NULL`,
      [id]
    );

    return res.status(200).json({
      error: false,
      mensaje: 'Usuario eliminado correctamente'
    });

  } catch (err) {
    console.error('❌ [ADMIN] Error eliminando usuario:', err.message);
    return res.status(500).json({ error: true, mensaje: 'Error al eliminar usuario' });
  } finally {
    if (connection) try { connection.release(); } catch (e) {}
  }
});

// ========================================
// 👨‍⚕️ MÉDICOS - LISTAR
// ========================================
router.get('/medicos', async (req, res) => {
  let connection;
  try {
    connection = await getConnection();

    const [medicos] = await connection.execute(
      `SELECT 
         u.id, 
         u.nombre, 
         u.apellido, 
         u.correo, 
         u.cedula, 
         u.telefono, 
         u.activo,
         u.fecha_registro
       FROM usuarios u
       INNER JOIN roles r ON u.rol_id = r.id
       WHERE r.nombre IN ('doctor', 'nutricionista')
         AND u.eliminado_en IS NULL
       ORDER BY u.apellido ASC`
    );

    return res.status(200).json({
      error: false,
      medicos: medicos,
      total: medicos.length
    });

  } catch (err) {
    console.error('❌ [ADMIN] Error listando médicos:', err.message);
    return res.status(500).json({ error: true, mensaje: 'Error al cargar médicos' });
  } finally {
    if (connection) try { connection.release(); } catch (e) {}
  }
});

// ========================================
// 👨‍⚕️ MÉDICOS - CREAR
// ========================================
router.post('/medicos', async (req, res) => {
  const { nombre, apellido, cedula, correo, telefono, password, especialidad, genero } = req.body;

  if (!nombre || !apellido || !correo || !password) {
    return res.status(400).json({ error: true, mensaje: 'Faltan campos obligatorios' });
  }

  let connection;
  try {
    connection = await getConnection();

    // Verificar correo
    const [existeCorreo] = await connection.execute(
      `SELECT id FROM usuarios WHERE correo = ? AND eliminado_en IS NULL`,
      [correo.toLowerCase()]
    );
    if (existeCorreo.length > 0) {
      return res.status(409).json({ error: true, mensaje: 'El correo ya está registrado' });
    }

    // Obtener rol doctor
    const [roles] = await connection.execute(
      `SELECT id FROM roles WHERE nombre = 'doctor'`
    );
    if (roles.length === 0) {
      return res.status(500).json({ error: true, mensaje: 'Rol doctor no existe' });
    }

    const password_hash = await bcrypt.hash(password, 12);
    const medicoId = uuidv4();

    await connection.execute(
      `INSERT INTO usuarios 
        (id, rol_id, nombre, apellido, correo, password_hash, cedula, telefono, genero, activo, creado_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())`,
      [medicoId, roles[0].id, nombre.trim(), apellido.trim(), correo.toLowerCase(),
       password_hash, cedula || null, telefono || null, genero || null]
    );

    console.log(`✅ [ADMIN] Médico creado: ${correo}`);

    return res.status(201).json({
      error: false,
      mensaje: 'Médico registrado exitosamente',
      medico_id: medicoId
    });

  } catch (err) {
    console.error('❌ [ADMIN] Error creando médico:', err.message);
    return res.status(500).json({ error: true, mensaje: 'Error al crear médico' });
  } finally {
    if (connection) try { connection.release(); } catch (e) {}
  }
});

// ========================================
// 👥 PACIENTES - LISTAR
// ========================================
router.get('/pacientes', async (req, res) => {
  let connection;
  try {
    connection = await getConnection();

    const [pacientes] = await connection.execute(
      `SELECT 
         p.id,
         p.nombres,
         p.apellidos,
         p.numero_identificacion,
         p.telefono,
         p.sexo,
         p.fecha_nacimiento,
         p.activo,
         p.creado_en,
         COUNT(r.id) as total_registros
       FROM pacientes p
       LEFT JOIN registro r ON r.paciente_id = p.id
       WHERE p.eliminado_en IS NULL
       GROUP BY p.id
       ORDER BY p.creado_en DESC`
    );

    return res.status(200).json({
      error: false,
      pacientes: pacientes,
      total: pacientes.length
    });

  } catch (err) {
    console.error('❌ [ADMIN] Error listando pacientes:', err.message);
    return res.status(500).json({ error: true, mensaje: 'Error al cargar pacientes' });
  } finally {
    if (connection) try { connection.release(); } catch (e) {}
  }
});

// ========================================
// 🔗 ASIGNACIONES - LISTAR
// ========================================
router.get('/asignaciones', async (req, res) => {
  let connection;
  try {
    connection = await getConnection();

    // Verificar si existe la tabla asignaciones_medico_paciente
    const [tablas] = await connection.execute(
      `SHOW TABLES LIKE 'asignaciones_medico_paciente'`
    );

    if (tablas.length === 0) {
      // Crear tabla si no existe
      await connection.execute(`
        CREATE TABLE asignaciones_medico_paciente (
          id CHAR(36) PRIMARY KEY,
          medico_id CHAR(36) NOT NULL,
          paciente_id CHAR(36) NOT NULL,
          fecha_asignacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          activa TINYINT DEFAULT 1,
          FOREIGN KEY (medico_id) REFERENCES usuarios(id),
          FOREIGN KEY (paciente_id) REFERENCES pacientes(id),
          UNIQUE KEY unique_asignacion (medico_id, paciente_id)
        )
      `);
      console.log('✅ [ADMIN] Tabla asignaciones_medico_paciente creada');
    }

    const [asignaciones] = await connection.execute(
      `SELECT 
         a.id,
         a.medico_id,
         a.paciente_id,
         a.fecha_asignacion,
         CONCAT(u.nombre, ' ', u.apellido) as medico_nombre,
         CONCAT(p.nombres, ' ', p.apellidos) as paciente_nombre,
         p.numero_identificacion as paciente_cedula
       FROM asignaciones_medico_paciente a
       INNER JOIN usuarios u ON u.id = a.medico_id
       INNER JOIN pacientes p ON p.id = a.paciente_id
       WHERE a.activa = 1
       ORDER BY a.fecha_asignacion DESC`
    );

    return res.status(200).json({
      error: false,
      asignaciones: asignaciones,
      total: asignaciones.length
    });

  } catch (err) {
    console.error('❌ [ADMIN] Error listando asignaciones:', err.message);
    return res.status(500).json({ error: true, mensaje: 'Error al cargar asignaciones' });
  } finally {
    if (connection) try { connection.release(); } catch (e) {}
  }
});

// ========================================
// 🔗 ASIGNACIONES - CREAR
// ========================================
router.post('/asignaciones', async (req, res) => {
  const { medico_id, paciente_id } = req.body;

  if (!medico_id || !paciente_id) {
    return res.status(400).json({ error: true, mensaje: 'Faltan datos' });
  }

  let connection;
  try {
    connection = await getConnection();

    // Verificar si ya existe
    const [existe] = await connection.execute(
      `SELECT id FROM asignaciones_medico_paciente 
       WHERE medico_id = ? AND paciente_id = ? AND activa = 1`,
      [medico_id, paciente_id]
    );

    if (existe.length > 0) {
      return res.status(409).json({ error: true, mensaje: 'Esta asignación ya existe' });
    }

    const asignacionId = uuidv4();
    await connection.execute(
      `INSERT INTO asignaciones_medico_paciente (id, medico_id, paciente_id)
       VALUES (?, ?, ?)`,
      [asignacionId, medico_id, paciente_id]
    );

    return res.status(201).json({
      error: false,
      mensaje: 'Asignación creada exitosamente',
      asignacion_id: asignacionId
    });

  } catch (err) {
    console.error('❌ [ADMIN] Error creando asignación:', err.message);
    return res.status(500).json({ error: true, mensaje: 'Error al crear asignación' });
  } finally {
    if (connection) try { connection.release(); } catch (e) {}
  }
});

// ========================================
// 🔗 ASIGNACIONES - ELIMINAR
// ========================================
router.delete('/asignaciones/:id', async (req, res) => {
  const { id } = req.params;
  let connection;
  try {
    connection = await getConnection();

    await connection.execute(
      `UPDATE asignaciones_medico_paciente SET activa = 0 WHERE id = ?`,
      [id]
    );

    return res.status(200).json({
      error: false,
      mensaje: 'Asignación eliminada'
    });

  } catch (err) {
    console.error('❌ [ADMIN] Error eliminando asignación:', err.message);
    return res.status(500).json({ error: true, mensaje: 'Error al eliminar asignación' });
  } finally {
    if (connection) try { connection.release(); } catch (e) {}
  }
});

// ========================================
// 📋 AUDITORÍA - LOGS DEL SISTEMA
// ========================================
router.get('/auditoria', async (req, res) => {
  let connection;
  try {
    connection = await getConnection();

    // Combinar auditoria_registro + historial_acceso
    const [logsRegistro] = await connection.execute(
      `SELECT 
         a.id,
         'registro' as tipo,
         CONCAT('Registro ', a.evento, ': ', COALESCE(a.estado_anterior, ''), ' -> ', COALESCE(a.estado_nuevo, '')) as descripcion,
         u.nombre as usuario_nombre,
         a.ip_address,
         a.fecha_evento as fecha
       FROM auditoria_registro a
       LEFT JOIN usuarios u ON u.id = a.usuario_id
       ORDER BY a.fecha_evento DESC
       LIMIT 100`
    );

    const [logsAcceso] = await connection.execute(
      `SELECT 
         h.id,
         CASE 
           WHEN h.exito = 1 THEN 'login'
           ELSE 'error'
         END as tipo,
         CASE 
           WHEN h.exito = 1 THEN CONCAT('Inicio de sesión exitoso', COALESCE(CONCAT(' - ', h.correo_intentado), ''))
           ELSE CONCAT('Intento fallido: ', COALESCE(h.motivo_fallo, 'desconocido'), ' - ', COALESCE(h.correo_intentado, ''))
         END as descripcion,
         u.nombre as usuario_nombre,
         h.ip_address,
         h.fecha
       FROM historial_acceso h
       LEFT JOIN usuarios u ON u.id = h.usuario_id
       ORDER BY h.fecha DESC
       LIMIT 100`
    );

    // Combinar y ordenar por fecha
    const todosLosLogs = [...logsRegistro, ...logsAcceso]
      .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
      .slice(0, 200);

    return res.status(200).json({
      error: false,
      logs: todosLosLogs,
      total: todosLosLogs.length
    });

  } catch (err) {
    console.error('❌ [ADMIN] Error en auditoría:', err.message);
    return res.status(500).json({ error: true, mensaje: 'Error al cargar auditoría' });
  } finally {
    if (connection) try { connection.release(); } catch (e) {}
  }
});

// ========================================
// 📊 REPORTES GLOBALES
// ========================================
router.get('/reportes/globales', async (req, res) => {
  let connection;
  try {
    connection = await getConnection();

    // Pacientes por mes
    const [pacientesPorMes] = await connection.execute(
      `SELECT 
         DATE_FORMAT(creado_en, '%Y-%m') as mes,
         COUNT(*) as total
       FROM pacientes
       WHERE eliminado_en IS NULL
         AND creado_en >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
       GROUP BY mes
       ORDER BY mes ASC`
    );

    // Registros por estado
    const [registrosPorEstado] = await connection.execute(
      `SELECT 
         estado,
         COUNT(*) as total
       FROM registro
       GROUP BY estado`
    );

    // Planes por perfil
    const [planesPorPerfil] = await connection.execute(
      `SELECT 
         perfil_recomendado,
         COUNT(*) as total
       FROM planes_nutricionales
       WHERE perfil_recomendado IS NOT NULL
       GROUP BY perfil_recomendado`
    );

    // Top médicos con más pacientes
    const [topMedicos] = await connection.execute(
      `SELECT 
         CONCAT(u.nombre, ' ', u.apellido) as nombre,
         COUNT(DISTINCT r.paciente_id) as total_pacientes
       FROM usuarios u
       INNER JOIN registro r ON r.registrado_por = u.id
       INNER JOIN roles ro ON u.rol_id = ro.id
       WHERE ro.nombre IN ('doctor', 'nutricionista', 'enfermera')
       GROUP BY u.id
       ORDER BY total_pacientes DESC
       LIMIT 10`
    );

    return res.status(200).json({
      error: false,
      pacientes_por_mes: pacientesPorMes,
      registros_por_estado: registrosPorEstado,
      planes_por_perfil: planesPorPerfil,
      top_medicos: topMedicos
    });

  } catch (err) {
    console.error('❌ [ADMIN] Error en reportes:', err.message);
    return res.status(500).json({ error: true, mensaje: 'Error al generar reportes' });
  } finally {
    if (connection) try { connection.release(); } catch (e) {}
  }
});

// ========================================
// 👥 ACTIVIDAD DE USUARIOS
// ========================================
router.get('/actividad', async (req, res) => {
  let connection;
  try {
    connection = await getConnection();

    const [actividad] = await connection.execute(
      `SELECT 
         u.id as usuario_id,
         CONCAT(u.nombre, ' ', u.apellido) as nombre,
         r.nombre as rol,
         u.activo,
         u.fecha_registro,
         (SELECT COUNT(*) FROM registro r2 WHERE r2.registrado_por = u.id) as registros_realizados,
         (SELECT MAX(fecha_evento) FROM auditoria_registro a WHERE a.usuario_id = u.id) as ultima_actividad
       FROM usuarios u
       INNER JOIN roles r ON u.rol_id = r.id
       WHERE u.eliminado_en IS NULL
       ORDER BY ultima_actividad DESC NULLS LAST`
    );

    return res.status(200).json({
      error: false,
      actividad: actividad,
      total: actividad.length
    });

  } catch (err) {
    console.error('❌ [ADMIN] Error en actividad:', err.message);
    return res.status(500).json({ error: true, mensaje: 'Error al cargar actividad' });
  } finally {
    if (connection) try { connection.release(); } catch (e) {}
  }
});

// ========================================
// ⚙️ CONFIGURACIÓN - PARÁMETROS DEL SISTEMA
// ========================================
router.get('/configuracion/parametros', async (req, res) => {
  let connection;
  try {
    connection = await getConnection();

    // Crear tabla si no existe
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS configuracion_sistema (
        clave VARCHAR(100) PRIMARY KEY,
        valor TEXT,
        descripcion VARCHAR(255),
        actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    const [params] = await connection.execute(
      `SELECT clave, valor, descripcion, actualizado_en FROM configuracion_sistema ORDER BY clave`
    );

    return res.status(200).json({
      error: false,
      parametros: params
    });

  } catch (err) {
    console.error('❌ [ADMIN] Error en configuración:', err.message);
    return res.status(500).json({ error: true, mensaje: 'Error al cargar configuración' });
  } finally {
    if (connection) try { connection.release(); } catch (e) {}
  }
});

// ========================================
// ⚙️ CONFIGURACIÓN - ACTUALIZAR PARÁMETRO
// ========================================
router.put('/configuracion/parametros/:clave', async (req, res) => {
  const { clave } = req.params;
  const { valor, descripcion } = req.body;

  let connection;
  try {
    connection = await getConnection();

    await connection.execute(
      `INSERT INTO configuracion_sistema (clave, valor, descripcion)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE 
         valor = VALUES(valor),
         descripcion = COALESCE(VALUES(descripcion), descripcion)`,
      [clave, valor, descripcion || null]
    );

    return res.status(200).json({
      error: false,
      mensaje: 'Parámetro actualizado'
    });

  } catch (err) {
    console.error('❌ [ADMIN] Error actualizando parámetro:', err.message);
    return res.status(500).json({ error: true, mensaje: 'Error al actualizar parámetro' });
  } finally {
    if (connection) try { connection.release(); } catch (e) {}
  }
});

// ========================================
// 💾 RESPALDO DE BASE DE DATOS (solo metadata)
// ========================================
router.get('/configuracion/backup', async (req, res) => {
  let connection;
  try {
    connection = await getConnection();

    const [tablas] = await connection.execute(
      `SELECT 
         TABLE_NAME as tabla,
         TABLE_ROWS as filas_aprox,
         ROUND((DATA_LENGTH + INDEX_LENGTH) / 1024 / 1024, 2) as tamanio_mb,
         CREATE_TIME as creado_en,
         UPDATE_TIME as actualizado_en
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = 'nutripa_db'
       ORDER BY TABLE_NAME`
    );

    return res.status(200).json({
      error: false,
      tablas: tablas,
      total_tablas: tablas.length,
      fecha_backup: new Date().toISOString()
    });

  } catch (err) {
    console.error('❌ [ADMIN] Error en backup:', err.message);
    return res.status(500).json({ error: true, mensaje: 'Error al obtener información de backup' });
  } finally {
    if (connection) try { connection.release(); } catch (e) {}
  }
});

console.log('✅ [ROUTER] admin.js cargado correctamente');
module.exports = router;