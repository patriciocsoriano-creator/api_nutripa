const express = require('express');
const router = express.Router();
const { getConnection } = require('../conexion');
const { verificarToken, verificarRol } = require('../middleware/auth');
const bcrypt = require('bcrypt');

console.log('[ROUTER] Cargando medico-perfil.js');

// ============================================================================
// GET /nutricionapp-api/medico/perfil
// Obtener perfil completo del médico/nutricionista logueado
// ============================================================================
router.get('/', verificarToken, verificarRol('doctor', 'nutricionista'), async (req, res) => {
  const usuarioId = req.usuario?.id;

  if (!usuarioId) {
    return res.status(401).json({ error: true, mensaje: 'No autenticado' });
  }

  let connection;
  try {
    connection = await getConnection();

    const [rows] = await connection.execute(
      `SELECT 
        id, correo, nombre, apellido, cedula,
        genero, telefono, fecha_nacimiento, edad,
        direccionresidencial, ciudad,
        provincia, provincia_codigo,
        canton, canton_codigo,
        parroquia, parroquia_codigo,
        activo, acepta_terminos, creado_en
       FROM usuarios
       WHERE id = ?`,
      [usuarioId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: true, mensaje: 'Usuario no encontrado' });
    }

    const usuario = rows[0];

    console.log(`[PERFIL] Datos cargados para usuario ${usuarioId}`);

    return res.status(200).json({
      error: false,
      usuario: {
        id: usuario.id,
        correo: usuario.correo,
        nombre: usuario.nombre,
        apellido: usuario.apellido,
        cedula: usuario.cedula,
        genero: usuario.genero,
        telefono: usuario.telefono,
        fecha_nacimiento: usuario.fecha_nacimiento,
        edad: usuario.edad,
        direccionresidencial: usuario.direccionresidencial,
        ciudad: usuario.ciudad,
        provincia: usuario.provincia,
        provincia_codigo: usuario.provincia_codigo,
        canton: usuario.canton,
        canton_codigo: usuario.canton_codigo,
        parroquia: usuario.parroquia,
        parroquia_codigo: usuario.parroquia_codigo,
        activo: usuario.activo,
        acepta_terminos: usuario.acepta_terminos,
        creado_en: usuario.creado_en
      }
    });

  } catch (err) {
    console.error('[PERFIL] Error:', err);
    return res.status(500).json({
      error: true,
      mensaje: 'Error al cargar el perfil'
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// ============================================================================
// PUT /nutricionapp-api/medico/perfil
// Actualizar datos personales (nombre, apellido, cedula, genero, telefono, fecha_nacimiento)
// ============================================================================
router.put('/', verificarToken, verificarRol('doctor', 'nutricionista'), async (req, res) => {
  const usuarioId = req.usuario?.id;

  if (!usuarioId) {
    return res.status(401).json({ error: true, mensaje: 'No autenticado' });
  }

  const {
    nombre,
    apellido,
    cedula,
    genero,
    telefono,
    fecha_nacimiento
  } = req.body;

  // Validaciones básicas
  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: true, mensaje: 'El nombre es obligatorio' });
  }
  if (!apellido || !apellido.trim()) {
    return res.status(400).json({ error: true, mensaje: 'El apellido es obligatorio' });
  }
  if (!cedula || !/^\d{10}$/.test(cedula)) {
    return res.status(400).json({ error: true, mensaje: 'La cédula debe tener 10 dígitos' });
  }

  // Calcular edad si se envió fecha de nacimiento
  let edad = null;
  if (fecha_nacimiento) {
    const hoy = new Date();
    const nacimiento = new Date(fecha_nacimiento);
    edad = hoy.getFullYear() - nacimiento.getFullYear();
    const mesDiff = hoy.getMonth() - nacimiento.getMonth();
    if (mesDiff < 0 || (mesDiff === 0 && hoy.getDate() < nacimiento.getDate())) {
      edad--;
    }
  }

  let connection;
  try {
    connection = await getConnection();

    // Verificar que la cédula no esté duplicada (excepto el propio usuario)
    const [cedulaExistente] = await connection.execute(
      `SELECT id FROM usuarios WHERE cedula = ? AND id != ?`,
      [cedula, usuarioId]
    );

    if (cedulaExistente.length > 0) {
      return res.status(400).json({ error: true, mensaje: 'La cédula ya está registrada' });
    }

    await connection.execute(
      `UPDATE usuarios 
       SET nombre = ?, 
           apellido = ?, 
           cedula = ?, 
           genero = ?, 
           telefono = ?, 
           fecha_nacimiento = ?, 
           edad = ?
       WHERE id = ?`,
      [
        nombre.trim(),
        apellido.trim(),
        cedula,
        genero || null,
        telefono || null,
        fecha_nacimiento || null,
        edad,
        usuarioId
      ]
    );

    console.log(`[PERFIL] Datos personales actualizados para usuario ${usuarioId}`);

    return res.status(200).json({
      error: false,
      mensaje: 'Perfil actualizado correctamente'
    });

  } catch (err) {
    console.error('[PERFIL] Error al actualizar:', err);
    return res.status(500).json({
      error: true,
      mensaje: 'Error al actualizar el perfil'
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// ============================================================================
// PUT /nutricionapp-api/medico/ubicacion
// Actualizar datos de ubicación
// ============================================================================
router.put('/ubicacion', verificarToken, verificarRol('doctor', 'nutricionista'), async (req, res) => {
  const usuarioId = req.usuario?.id;

  if (!usuarioId) {
    return res.status(401).json({ error: true, mensaje: 'No autenticado' });
  }

  const {
    direccionresidencial,
    ciudad,
    provincia,
    provincia_codigo,
    canton,
    canton_codigo,
    parroquia,
    parroquia_codigo
  } = req.body;

  let connection;
  try {
    connection = await getConnection();

    await connection.execute(
      `UPDATE usuarios 
       SET direccionresidencial = ?,
           ciudad = ?,
           provincia = ?,
           provincia_codigo = ?,
           canton = ?,
           canton_codigo = ?,
           parroquia = ?,
           parroquia_codigo = ?
       WHERE id = ?`,
      [
        direccionresidencial || null,
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

    console.log(`[PERFIL] Ubicación actualizada para usuario ${usuarioId}`);

    return res.status(200).json({
      error: false,
      mensaje: 'Ubicación actualizada correctamente'
    });

  } catch (err) {
    console.error('[PERFIL] Error al actualizar ubicación:', err);
    return res.status(500).json({
      error: true,
      mensaje: 'Error al actualizar la ubicación'
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// ============================================================================
// PUT /nutricionapp-api/medico/correo
// Actualizar correo electrónico
// ============================================================================
router.put('/correo', verificarToken, verificarRol('doctor', 'nutricionista'), async (req, res) => {
  const usuarioId = req.usuario?.id;

  if (!usuarioId) {
    return res.status(401).json({ error: true, mensaje: 'No autenticado' });
  }

  const { correo } = req.body;

  if (!correo || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
    return res.status(400).json({ error: true, mensaje: 'Correo electrónico inválido' });
  }

  let connection;
  try {
    connection = await getConnection();

    // Verificar que el correo no esté duplicado
    const [correoExistente] = await connection.execute(
      `SELECT id FROM usuarios WHERE correo = ? AND id != ?`,
      [correo.toLowerCase().trim(), usuarioId]
    );

    if (correoExistente.length > 0) {
      return res.status(400).json({ error: true, mensaje: 'El correo ya está registrado' });
    }

    await connection.execute(
      `UPDATE usuarios SET correo = ? WHERE id = ?`,
      [correo.toLowerCase().trim(), usuarioId]
    );

    console.log(`[PERFIL] Correo actualizado para usuario ${usuarioId}`);

    return res.status(200).json({
      error: false,
      mensaje: 'Correo actualizado correctamente'
    });

  } catch (err) {
    console.error('[PERFIL] Error al actualizar correo:', err);
    return res.status(500).json({
      error: true,
      mensaje: 'Error al actualizar el correo'
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// ============================================================================
// PUT /nutricionapp-api/medico/password
// Cambiar contraseña
// ============================================================================
router.put('/password', verificarToken, verificarRol('doctor', 'nutricionista'), async (req, res) => {
  const usuarioId = req.usuario?.id;

  if (!usuarioId) {
    return res.status(401).json({ error: true, mensaje: 'No autenticado' });
  }

  const { password_actual, password_nueva } = req.body;

  if (!password_actual || !password_nueva) {
    return res.status(400).json({ error: true, mensaje: 'Debe ingresar la contraseña actual y la nueva' });
  }

  if (password_nueva.length < 8) {
    return res.status(400).json({ error: true, mensaje: 'La nueva contraseña debe tener al menos 8 caracteres' });
  }

  let connection;
  try {
    connection = await getConnection();

    // Obtener contraseña actual hasheada
    const [rows] = await connection.execute(
      `SELECT password_hash FROM usuarios WHERE id = ?`,
      [usuarioId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: true, mensaje: 'Usuario no encontrado' });
    }

    const passwordHashActual = rows[0].password_hash;

    // Verificar que la contraseña actual sea correcta
    const coincide = await bcrypt.compare(password_actual, passwordHashActual);
    if (!coincide) {
      return res.status(400).json({ error: true, mensaje: 'La contraseña actual es incorrecta' });
    }

    // Hashear nueva contraseña
    const saltRounds = 10;
    const passwordHashNueva = await bcrypt.hash(password_nueva, saltRounds);

    await connection.execute(
      `UPDATE usuarios SET password_hash = ? WHERE id = ?`,
      [passwordHashNueva, usuarioId]
    );

    console.log(`[PERFIL] Contraseña cambiada para usuario ${usuarioId}`);

    return res.status(200).json({
      error: false,
      mensaje: 'Contraseña cambiada correctamente'
    });

  } catch (err) {
    console.error('[PERFIL] Error al cambiar contraseña:', err);
    return res.status(500).json({
      error: true,
      mensaje: 'Error al cambiar la contraseña'
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

console.log('[ROUTER] medico-perfil.js cargado correctamente');
module.exports = router;