// routes/paciente/vincular.js
const express = require('express');
const router = express.Router();
const { getConnection } = require('../conexion'); 
const { verificarToken } = require('../middleware/auth');

// ==========================================
//  BUSCAR PACIENTE POR CÉDULA (para vincular)
// ==========================================
router.get('/buscar-cedula/:cedula', verificarToken, async (req, res) => {
  const { cedula } = req.params;
  const usuario_id = req.usuario.id;

  let connection;
  try {
    connection = await getConnection();

    const [resultados] = await connection.execute(
      `SELECT 
         p.id as paciente_id,
         p.nombres,
         p.apellidos,
         p.numero_identificacion,
         p.usuario_id as ya_vinculado_a,
         r.id as registro_id,
         r.estado as estado_registro,
         r.fecha_finalizacion,
         r.datos_personales,
         r.signos_vitales,
         r.datos_antropometricos,
         r.condiciones_metabolicas
       FROM pacientes p
       LEFT JOIN registro r ON r.paciente_id = p.id AND r.estado = 'finalizado'
       WHERE p.numero_identificacion = ? 
         AND p.eliminado_en IS NULL
       ORDER BY r.fecha_finalizacion DESC
       LIMIT 1`,
      [cedula]
    );

    if (resultados.length === 0) {
      return res.status(404).json({ 
        error: true, 
        mensaje: 'No se encontró un paciente registrado con esta cédula' 
      });
    }

    const paciente = resultados[0];

    if (paciente.ya_vinculado_a && paciente.ya_vinculado_a !== usuario_id) {
      return res.status(409).json({ 
        error: true, 
        mensaje: 'Este paciente ya está vinculado a otra cuenta' 
      });
    }

    return res.json({
      error: false,
      mensaje: 'Paciente encontrado',
      puede_vincular: !paciente.ya_vinculado_a,
      paciente: {
        id: paciente.paciente_id,
        nombres: paciente.nombres,
        apellidos: paciente.apellidos,
        cedula: paciente.numero_identificacion,
        registro_completo: !!paciente.registro_id && paciente.estado_registro === 'finalizado'
      },
      resumen_clinico: paciente.registro_id ? {
        imc: paciente.datos_antropometricos?.imc || null,
        condiciones: {
          hipertension: paciente.condiciones_metabolicas?.hipertension || false,
          obesidad: paciente.condiciones_metabolicas?.obesidad || false,
          dislipidemia: paciente.condiciones_metabolicas?.dislipidemia || false
        },
        ultima_actualizacion: paciente.fecha_finalizacion
      } : null
    });

  } catch (err) {
    console.error(' Error buscando paciente:', err);
    return res.status(500).json({ error: true, mensaje: 'Error al buscar paciente' });
  } finally {
    // CORREGIDO: Usar release() NO end()
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// ==========================================
//  VINCULAR PACIENTE CON USUARIO ACTUAL
// ==========================================
router.post('/vincular', verificarToken, async (req, res) => {
  const { paciente_id } = req.body;
  const usuario_id = req.usuario.id;

  if (!paciente_id) {
    return res.status(400).json({ error: true, mensaje: 'ID de paciente requerido' });
  }

  let connection;
  try {
    connection = await getConnection();

    const [pacientes] = await connection.execute(
      `SELECT id, usuario_id, nombres, apellidos 
       FROM pacientes 
       WHERE id = ? AND eliminado_en IS NULL`,
      [paciente_id]
    );

    if (pacientes.length === 0) {
      return res.status(404).json({ error: true, mensaje: 'Paciente no encontrado' });
    }

    const paciente = pacientes[0];

    if (paciente.usuario_id === usuario_id) {
      return res.json({
        error: false,
        mensaje: 'Paciente ya vinculado a tu cuenta',
        paciente: {
          id: paciente.id,
          nombre_completo: `${paciente.nombres} ${paciente.apellidos}`
        }
      });
    }

    if (paciente.usuario_id) {
      return res.status(409).json({ 
        error: true, 
        mensaje: 'Este paciente ya está vinculado a otra cuenta' 
      });
    }

    await connection.execute(
      `UPDATE pacientes 
       SET usuario_id = ?, actualizado_en = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [usuario_id, paciente_id]
    );

    return res.json({
      error: false,
      mensaje: 'Paciente vinculado exitosamente',
      paciente: {
        id: paciente.id,
        nombre_completo: `${paciente.nombres} ${paciente.apellidos}`
      }
    });

  } catch (err) {
    console.error(' Error vinculando paciente:', err);
    return res.status(500).json({ error: true, mensaje: 'Error al vincular paciente' });
  } finally {
    //  CORREGIDO
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

module.exports = router;