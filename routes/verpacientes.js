const express = require('express');
const router = express.Router();
const { getConnection } = require('../conexion');
const { verificarToken, verificarRol } = require('../middleware/auth');

// GET /nutricionapp-api/medico/pacientes
router.get('/', verificarToken, verificarRol('doctor', 'nutricionista', 'admin'), async (req, res) => {
  let connection;
  try {
    connection = await getConnection();
    
    // Extraemos todos los pacientes activos (no eliminados)
    const [pacientes] = await connection.execute(`
      SELECT 
        p.id, p.nombres, p.apellidos, p.numero_identificacion as cedula, 
        p.fecha_nacimiento, p.sexo, p.telefono, p.direccion, p.ocupacion, 
        p.actividad_fisica, p.activo, p.creado_en,
        TIMESTAMPDIFF(YEAR, p.fecha_nacimiento, CURDATE()) as edad
      FROM pacientes p
      WHERE p.eliminado_en IS NULL
      ORDER BY p.creado_en DESC
    `);

    return res.json({
      error: false,
      total: pacientes.length,
      pacientes: pacientes.map(p => ({
        ...p,
        nombre_completo: `${p.nombres} ${p.apellidos}`.trim()
      }))
    });
  } catch (err) {
    console.error(' Error obteniendo pacientes:', err.message);
    return res.status(500).json({ error: true, mensaje: 'Error al cargar pacientes desde la BD' });
  } finally {
    if (connection) await connection.release();
  }
});


// routes/verpacientes.js - Agregar esta ruta
router.delete('/:paciente_id', verificarToken, verificarRol('doctor', 'nutricionista'), async (req, res) => {
  const { paciente_id } = req.params;
  const connection = await getConnection();
  
  try {
    // Soft delete: marcar como eliminado en lugar de borrar físicamente
    const [result] = await connection.execute(
      'UPDATE pacientes SET eliminado_en = CURRENT_TIMESTAMP, activo = 0 WHERE id = ?',
      [paciente_id]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: true, mensaje: 'Paciente no encontrado' });
    }
    
    console.log(' [PACIENTE] Eliminado (soft delete):', paciente_id);
    return res.json({ error: false, mensaje: 'Paciente eliminado correctamente' });
    
  } catch (err) {
    console.error(' [PACIENTE] Error eliminando:', err.message);
    return res.status(500).json({ error: true, mensaje: 'Error al eliminar paciente' });
  } finally {
    connection.release();
  }
});

module.exports = router;