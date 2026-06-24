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

console.log(' [ROUTER] medico-paciente-detalle.js cargado correctamente');
module.exports = router;