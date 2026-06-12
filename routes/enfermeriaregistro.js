// routes/enfermeriaregistro.js - VERSIÓN FINAL CON SMART NAVIGATION
console.log('✅ [ROUTER] Cargando enfermeriaregistro.js');

const express = require('express');
const router = express.Router();
const { getConnection } = require('../conexion'); 
const { verificarToken, verificarRol } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// 👇 Middleware de debug para ver todas las peticiones
router.use((req, res, next) => {
  let bodyInfo = undefined;
  
  // ✅ Solo procesar body si existe (POST/PUT)
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
    bodyInfo = { ...req.body };
    // Ocultar contraseña si existe
    if (bodyInfo.password) bodyInfo.password = '***';
  }
  
  console.log('🔍 [ROUTER DEBUG]', {
    method: req.method,
    path: req.path,
    params: req.params,
    body: bodyInfo
  });
  next();
});

// ==========================================
// 🆕 OBTENER ESTADO COMPLETO DEL REGISTRO (SMART NAVIGATION)
// ==========================================
router.get('/:registro_id/estado', verificarToken, verificarRol('enfermera', 'nutricionista', 'doctor', 'admin'), async (req, res) => {
  const { registro_id } = req.params;
  let connection;

  try {
    connection = await getConnection();

    // 1️⃣ Obtener datos del registro con info del paciente
    const [registros] = await connection.execute(
      `SELECT 
        r.id,
        r.paciente_id,
        r.estado,
        r.datos_personales,
        r.signos_vitales,
        r.datos_antropometricos,
        r.condiciones_metabolicas,
        r.fecha_inicio,
        r.fecha_finalizacion,
        p.nombres as paciente_nombres,
        p.apellidos as paciente_apellidos,
        p.numero_identificacion,
        p.fecha_nacimiento,
        p.sexo,
        p.direccion,
        p.telefono,
        p.ocupacion,
        p.actividad_fisica
       FROM registro r
       INNER JOIN pacientes p ON p.id = r.paciente_id
       WHERE r.id = ?`,
      [registro_id]
    );

    if (registros.length === 0) {
      return res.status(404).json({ error: true, mensaje: 'Registro no encontrado' });
    }

    const registro = registros[0];

    // 2️⃣ Determinar qué pasos están completos
    const pasosCompletos = {
      datos_personales: !!registro.datos_personales,
      signos_vitales: !!registro.signos_vitales,
      datos_antropometricos: !!registro.datos_antropometricos,
      condiciones_metabolicas: !!registro.condiciones_metabolicas
    };

    // 3️⃣ Determinar el siguiente paso a navegar
    let siguientePaso = 'registroinfopaciente'; // Por defecto
    if (registro.estado === 'finalizado') {
      siguientePaso = 'registrofinalizado';
    } else if (pasosCompletos.datos_personales && pasosCompletos.signos_vitales && pasosCompletos.datos_antropometricos) {
      siguientePaso = 'registroinfometabolicas';
    } else if (pasosCompletos.datos_personales && pasosCompletos.signos_vitales) {
      siguientePaso = 'registroinfoantropometricos';
    } else if (pasosCompletos.datos_personales) {
      siguientePaso = 'registroinfosignosvitales';
    } else {
      siguientePaso = 'registroinfopaciente';
    }

    // 4️⃣ Parsear JSONs de cada paso
    let datosPersonales = null;
    let signosVitales = null;
    let datosAntropometricos = null;
    let condicionesMetabolicas = null;

    try {
      if (registro.datos_personales) datosPersonales = JSON.parse(registro.datos_personales);
      if (registro.signos_vitales) signosVitales = JSON.parse(registro.signos_vitales);
      if (registro.datos_antropometricos) datosAntropometricos = JSON.parse(registro.datos_antropometricos);
      if (registro.condiciones_metabolicas) condicionesMetabolicas = JSON.parse(registro.condiciones_metabolicas);
    } catch (e) {
      console.warn('⚠️ Error parseando JSONs:', e.message);
    }

    console.log(`🔍 [ESTADO] Registro ${registro_id}: estado=${registro.estado}, siguiente=${siguientePaso}`);

    return res.status(200).json({
      error: false,
      registro: {
        id: registro.id,
        paciente_id: registro.paciente_id,
        estado: registro.estado,
        fecha_inicio: registro.fecha_inicio,
        fecha_finalizacion: registro.fecha_finalizacion
      },
      paciente: {
        id: registro.paciente_id,
        nombres: registro.paciente_nombres,
        apellidos: registro.paciente_apellidos,
        numero_identificacion: registro.numero_identificacion,
        fecha_nacimiento: registro.fecha_nacimiento,
        sexo: registro.sexo,
        direccion: registro.direccion,
        telefono: registro.telefono,
        ocupacion: registro.ocupacion,
        actividad_fisica: registro.actividad_fisica
      },
      datos: {
        datos_personales: datosPersonales,
        signos_vitales: signosVitales,
        datos_antropometricos: datosAntropometricos,
        condiciones_metabolicas: condicionesMetabolicas
      },
      pasosCompletos,
      siguientePaso
    });

  } catch (err) {
    console.error('❌ [ESTADO] Error:', err);
    return res.status(500).json({ 
      error: true, 
      mensaje: 'Error al obtener estado del registro: ' + err.message 
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// ==========================================
//  INICIAR NUEVO REGISTRO CLÍNICO
//  CORREGIDO: Reactiva pacientes eliminados en lugar de fallar
// ==========================================
router.post('/iniciar', verificarToken, verificarRol('enfermera', 'nutricionista', 'doctor'), async (req, res) => {
  console.log('🆕 [REGISTRO] Iniciando nuevo registro', { cedula: req.body?.cedula });

  const { cedula, nombres, apellidos } = req.body;
  const registrado_por = req.usuario.id;

  if (!cedula || !nombres || !apellidos) {
    return res.status(400).json({ error: true, mensaje: 'Cédula, nombres y apellidos son obligatorios' });
  }

  let connection;
  try {
    connection = await getConnection();

    // 1️⃣ Buscar paciente SIN filtro de eliminado_en
    const [pacientesExistentes] = await connection.execute(
      `SELECT id, eliminado_en FROM pacientes WHERE numero_identificacion = ?`,
      [cedula]
    );

    let paciente_id;

    if (pacientesExistentes.length > 0) {
      paciente_id = pacientesExistentes[0].id;
      
      // 2️⃣ Si existe pero estaba eliminado → REACTIVAR
      if (pacientesExistentes[0].eliminado_en) {
        console.log(`[REGISTRO] Reactivando paciente eliminado: ${cedula}`);
        await connection.execute(
          `UPDATE pacientes 
           SET eliminado_en = NULL, 
               eliminado_por = NULL,
               nombres = ?, 
               apellidos = ?,
               actualizado_en = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [nombres.trim(), apellidos.trim(), paciente_id]
        );
      } else {
        // 3️⃣ Si existe y está activo → verificar si tiene registro en progreso
        const [registrosActivos] = await connection.execute(
          `SELECT id FROM registro 
           WHERE paciente_id = ? AND estado NOT IN ('finalizado', 'cancelado')`,
          [paciente_id]
        );

        if (registrosActivos.length > 0) {
          return res.status(409).json({
            error: true,
            mensaje: 'El paciente ya tiene un registro en progreso',
            registro_id: registrosActivos[0].id
          });
        }
      }
    } else {
      // 4️⃣ Si NO existe → crear nuevo paciente
      console.log(`[REGISTRO] Creando nuevo paciente: ${cedula}`);
      paciente_id = uuidv4();
      
      await connection.execute(
        `INSERT INTO pacientes (id, nombres, apellidos, numero_identificacion, activo, creado_en)
         VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)`,
        [paciente_id, nombres.trim(), apellidos.trim(), cedula]
      );
    }

    // 5️⃣ Crear el nuevo registro clínico
    const registro_id = uuidv4();
    await connection.execute(
      `INSERT INTO registro (id, paciente_id, registrado_por, estado, creado_en) 
       VALUES (?, ?, ?, 'iniciado', CURRENT_TIMESTAMP)`,
      [registro_id, paciente_id, registrado_por]
    );

    console.log('✅ [REGISTRO] Registro iniciado', { registro_id, paciente_id, estado: 'iniciado' });

    return res.status(201).json({
      error: false,
      mensaje: 'Registro iniciado correctamente',
      registro_id,
      paciente_id,
      estado: 'iniciado',
      siguiente_paso: 'registroinfopaciente'
    });

  } catch (err) {
    console.error('❌ [REGISTRO] Error:', {
      message: err.message,
      code: err.code,
      sql: err.sql,
      sqlMessage: err.sqlMessage
    });
    
    // Manejo específico de errores
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        error: true,
        mensaje: 'Ya existe un registro con esta cédula',
        codigo: 'DUPLICATE_ENTRY'
      });
    }
    
    return res.status(500).json({ 
      error: true, 
      mensaje: 'Error al iniciar registro: ' + err.message 
    });
  } finally {
    if (connection) { 
      try { connection.release(); } catch (e) {} 
    }
  }
});

// ==========================================
// 📝 DATOS PERSONALES (ACTUALIZA TABLA PACIENTES)
// ==========================================
router.post('/:registro_id/datos-personales', verificarToken, verificarRol('enfermera', 'nutricionista', 'doctor'), async (req, res) => {
  const { registro_id } = req.params;
  const { fechaNacimiento, sexo, direccion, telefono, ocupacion, actividadFisica } = req.body;
  const usuario_id = req.usuario.id;

  console.log('📝 [REGISTRO] Guardando datos personales', { registro_id });

  let connection;
  try {
    connection = await getConnection();

    // 1️⃣ Verificar registro y obtener paciente_id
    const [registros] = await connection.execute(
      `SELECT r.id, r.paciente_id, r.estado 
       FROM registro r
       WHERE r.id = ? AND r.registrado_por = ? AND r.estado IN ('iniciado', 'datos_personales')`,
      [registro_id, usuario_id]
    );

    if (registros.length === 0) {
      return res.status(404).json({ error: true, mensaje: 'Registro no encontrado o paso anterior incompleto' });
    }

    const paciente_id = registros[0].paciente_id;

    // 2️⃣ ✅ ACTUALIZAR TABLA PACIENTES (Para que no queden en NULL)
    await connection.execute(
      `UPDATE pacientes SET 
         fecha_nacimiento = ?, 
         sexo = ?, 
         direccion = ?, 
         telefono = ?, 
         ocupacion = ?, 
         actividad_fisica = ?, 
         actualizado_en = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [
        fechaNacimiento || null, 
        sexo || null, 
        direccion || null, 
        telefono || null, 
        ocupacion || null, 
        actividadFisica || null, 
        paciente_id
      ]
    );
    console.log('✅ [REGISTRO] Tabla pacientes actualizada');

    // 3️⃣ Mantener historial en tabla registro (JSON)
    await connection.execute(
      `UPDATE registro 
       SET datos_personales = JSON_SET(
         COALESCE(datos_personales, JSON_OBJECT()),
         '$.fechaNacimiento', ?,
         '$.sexo', ?,
         '$.direccion', ?,
         '$.telefono', ?,
         '$.ocupacion', ?,
         '$.actividadFisica', ?
       ),
       estado = 'datos_personales',
       actualizado_en = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        fechaNacimiento || null, sexo || null, direccion || null, telefono || null, ocupacion || null, actividadFisica || null, 
        registro_id
      ]
    );

    console.log('✅ [REGISTRO] Datos guardados en BD');

    return res.json({
      error: false,
      mensaje: 'Datos personales guardados',
      estado: 'datos_personales',
      siguiente_paso: 'signos_vitales'
    });

  } catch (err) {
    console.error('❌ [REGISTRO] Error guardando datos personales:', err);
    return res.status(500).json({ error: true, mensaje: 'Error al guardar datos: ' + err.message });
  } finally {
    if (connection) { try { connection.release(); } catch (e) {} }
  }
});

// ==========================================
// ❤️ SIGNOS VITALES
// ==========================================
router.post('/:registro_id/signos-vitales', verificarToken, verificarRol('enfermera', 'nutricionista', 'doctor'), async (req, res) => {
  const { registro_id } = req.params;
  const { frecuenciaCardiaca, presionArterial, frecuenciaRespiratoria, temperatura, spo2, glucosaAyunas, glucosaPostprandial, hemoglobinaGlicosilada } = req.body;
  const usuario_id = req.usuario.id;

  console.log('❤️ [REGISTRO] Guardando signos vitales', { registro_id });

  let connection;
  try {
    connection = await getConnection();

    const [registros] = await connection.execute(
      `SELECT id, estado FROM registro WHERE id = ? AND registrado_por = ?`,
      [registro_id, usuario_id]
    );

    if (!registros.length || registros[0].estado !== 'datos_personales') {
      return res.status(404).json({ error: true, mensaje: 'Complete primero datos personales' });
    }

    await connection.execute(
      `UPDATE registro SET signos_vitales = JSON_SET(COALESCE(signos_vitales, JSON_OBJECT()),
        '$.frecuenciaCardiaca', ?, '$.presionArterial', ?, '$.frecuenciaRespiratoria', ?, '$.temperatura', ?,
        '$.spo2', ?, '$.glucosaAyunas', ?, '$.glucosaPostprandial', ?, '$.hemoglobinaGlicosilada', ?),
        estado = 'signos_vitales', actualizado_en = CURRENT_TIMESTAMP WHERE id = ?`,
      [frecuenciaCardiaca || null, presionArterial || null, frecuenciaRespiratoria || null, temperatura || null,
       spo2 || null, glucosaAyunas || null, glucosaPostprandial || null, hemoglobinaGlicosilada || null, registro_id]
    );

    console.log('✅ [REGISTRO] Signos vitales guardados', { registro_id, nuevo_estado: 'signos_vitales' });
    return res.json({ error: false, mensaje: 'Guardados', estado: 'signos_vitales', siguiente_paso: 'antropometricos' });

  } catch (err) {
    console.error('❌ [REGISTRO] Error:', err.message);
    return res.status(500).json({ error: true, mensaje: 'Error: ' + err.message });
  } finally {
    if (connection) { try { connection.release(); } catch (e) {} }
  }
});

// ==========================================
// 📏 ANTROPOMÉTRICOS
// ==========================================
router.post('/:registro_id/antropometricos', verificarToken, verificarRol('enfermera', 'nutricionista', 'doctor'), async (req, res) => {
  const { registro_id } = req.params;
  const { peso, talla, circunferenciaCintura } = req.body;
  const usuario_id = req.usuario.id;

  if (!peso || !talla || peso <= 0 || talla <= 0) {
    return res.status(400).json({ error: true, mensaje: 'Peso y talla son obligatorios y mayores a 0' });
  }

  console.log('📏 [REGISTRO] Guardando antropométricos', { registro_id });
  const imc = peso / (talla * talla);

  let connection;
  try {
    connection = await getConnection();

    const [registros] = await connection.execute(
      `SELECT id, estado FROM registro WHERE id = ? AND registrado_por = ?`,
      [registro_id, usuario_id]
    );

    if (!registros.length || registros[0].estado !== 'signos_vitales') {
      return res.status(404).json({ error: true, mensaje: 'Complete primero signos vitales' });
    }

    await connection.execute(
      `UPDATE registro SET datos_antropometricos = JSON_SET(COALESCE(datos_antropometricos, JSON_OBJECT()),
        '$.peso', ?, '$.talla', ?, '$.imc', ?, '$.circunferenciaCintura', ?),
        estado = 'antropometricos', actualizado_en = CURRENT_TIMESTAMP WHERE id = ?`,
      [peso, talla, parseFloat(imc.toFixed(2)), circunferenciaCintura || null, registro_id]
    );

    console.log('✅ [REGISTRO] Antropométricos guardados', { registro_id, nuevo_estado: 'antropometricos', imc: parseFloat(imc.toFixed(2)) });
    return res.json({ error: false, mensaje: 'Guardados', estado: 'antropometricos', imc_calculado: parseFloat(imc.toFixed(2)), siguiente_paso: 'metabolicas' });

  } catch (err) {
    console.error('❌ [REGISTRO] Error:', err.message);
    return res.status(500).json({ error: true, mensaje: 'Error: ' + err.message });
  } finally {
    if (connection) { try { connection.release(); } catch (e) {} }
  }
});

// ==========================================
// 🧬 METABÓLICAS + FINALIZAR
// ==========================================
router.post('/:registro_id/metabolicas', verificarToken, verificarRol('enfermera', 'nutricionista', 'doctor'), async (req, res) => {
  const { registro_id } = req.params;
  const { hipertension, obesidad, dislipidemia, higadoGraso, resistenciaInsulina } = req.body;
  const usuario_id = req.usuario.id;

  console.log('🧬 [REGISTRO] === INICIANDO FINALIZACIÓN ===', { registro_id, usuario_id });

  let connection;
  try {
    connection = await getConnection();

    const [registros] = await connection.execute(
      `SELECT r.id, r.estado, r.paciente_id, r.registrado_por, p.nombres, p.apellidos, p.numero_identificacion
       FROM registro r JOIN pacientes p ON p.id = r.paciente_id WHERE r.id = ?`,
      [registro_id]
    );

    if (!registros.length) {
      return res.status(404).json({ error: true, mensaje: 'Registro no encontrado' });
    }

    const registro = registros[0];
    
    if (registro.registrado_por !== usuario_id || registro.estado !== 'antropometricos') {
      return res.status(404).json({ 
        error: true, 
        mensaje: 'Registro no autorizado o complete primero datos antropométricos' 
      });
    }

    await connection.execute(
      `UPDATE registro SET 
        condiciones_metabolicas = JSON_SET(
          COALESCE(condiciones_metabolicas, JSON_OBJECT()),
          '$.hipertension', ?, '$.obesidad', ?, '$.dislipidemia', ?, '$.higadoGraso', ?, '$.resistenciaInsulina', ?
        ),
        estado = 'finalizado',
        fecha_finalizacion = CURRENT_TIMESTAMP,
        actualizado_en = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        hipertension ? 1 : 0, obesidad ? 1 : 0, dislipidemia ? 1 : 0, 
        higadoGraso ? 1 : 0, resistenciaInsulina ? 1 : 0,
        registro_id
      ]
    );

    console.log('✅ [REGISTRO] === FINALIZADO EXITOSAMENTE ===', { registro_id });

    if (connection) { try { connection.release(); } catch (e) {} }
    connection = null;

    return res.json({
      error: false,
      mensaje: 'Registro clínico finalizado exitosamente',
      paciente: {
        id: registro.paciente_id,
        nombre_completo: `${registro.nombres} ${registro.apellidos}`,
        cedula: registro.numero_identificacion
      },
      registro_id,
      estado: 'finalizado',
      listo_para_vincular: true
    });

  } catch (err) {
    console.error('❌ [REGISTRO] Error:', { message: err.message, code: err.code });
    
    if (connection) { try { connection.release(); } catch (e) {} }
    
    return res.status(500).json({ 
      error: true, 
      mensaje: 'Error al finalizar registro: ' + err.message 
    });
  }
});

// ==========================================
// ❌ CANCELAR REGISTRO
// ==========================================
router.post('/:registro_id/cancelar', verificarToken, verificarRol('enfermera', 'nutricionista'), async (req, res) => {
  const { registro_id } = req.params;
  const usuario_id = req.usuario.id;

  console.log('❌ [REGISTRO] Cancelando', { registro_id });
  
  let connection;
  try {
    connection = await getConnection();
    
    const [registros] = await connection.execute(
      `SELECT id, estado, paciente_id FROM registro WHERE id = ? AND registrado_por = ? AND estado NOT IN ('finalizado', 'cancelado')`,
      [registro_id, usuario_id]
    );
    
    if (!registros.length) {
      return res.status(404).json({ error: true, mensaje: 'Registro no encontrado, finalizado o cancelado' });
    }
    
    await connection.execute(`UPDATE registro SET estado = 'cancelado', actualizado_en = CURRENT_TIMESTAMP WHERE id = ?`, [registro_id]);
    
    console.log('✅ [REGISTRO] Cancelado', { registro_id });
    return res.json({ error: false, mensaje: 'Cancelado', registro_id });
    
  } catch (err) {
    console.error('❌ [REGISTRO] Error:', err.message);
    return res.status(500).json({ error: true, mensaje: 'Error: ' + err.message });
  } finally {
    if (connection) { try { connection.release(); } catch (e) {} }
  }
});

console.log('✅ [ROUTER] enfermeriaregistro.js cargado correctamente');
module.exports = router;