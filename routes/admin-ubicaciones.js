// routes/admin-ubicaciones.js
const express = require('express');
const router = express.Router();
const { getConnection } = require('../conexion');
const { verificarToken, verificarRol } = require('../middleware/auth');

// POST /nutricionapp-api/admin/poblar-ubicaciones
// Solo accesible para administradores
router.post('/poblar-ubicaciones', verificarToken, verificarRol('admin'), async (req, res) => {
  const { provincias } = req.body; // Array desde el frontend con estructura de Ecuador
  
  if (!provincias || !Array.isArray(provincias)) {
    return res.status(400).json({ error: true, mensaje: 'Datos de provincias inválidos' });
  }

  let connection;
  try {
    connection = await getConnection();
    
    // Procesar cada provincia
    for (const prov of provincias) {
      // 1️⃣ Insertar/Actualizar provincia
      await connection.execute(
        `INSERT INTO provincias (codigo, nombre) VALUES (?, ?) 
         ON DUPLICATE KEY UPDATE nombre = VALUES(nombre)`,
        [prov.codigo, prov.nombre]
      );
      
      // 2️⃣ Insertar/Actualizar cantones de esta provincia
      if (prov.cantones && Array.isArray(prov.cantones)) {
        for (const canton of prov.cantones) {
          await connection.execute(
            `INSERT INTO cantones (codigo, nombre, provincia_codigo) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE nombre = VALUES(nombre), provincia_codigo = VALUES(provincia_codigo)`,
            [canton.codigo, canton.nombre, prov.codigo]
          );
          
          // 3️⃣ Insertar/Actualizar parroquias de este cantón
          if (canton.parroquias && Array.isArray(canton.parroquias)) {
            for (const parroquia of canton.parroquias) {
              await connection.execute(
                `INSERT INTO parroquias (codigo, nombre, canton_codigo) VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE nombre = VALUES(nombre), canton_codigo = VALUES(canton_codigo)`,
                [parroquia.codigo, parroquia.nombre, canton.codigo]
              );
            }
          }
        }
      }
    }
    
    console.log('✅ [ADMIN] Ubicaciones de Ecuador pobladas exitosamente');
    
    return res.json({
      error: false,
      mensaje: 'Ubicaciones pobladas exitosamente',
      total_provincias: provincias.length
    });
    
  } catch (err) {
    console.error('❌ [ADMIN] Error poblando ubicaciones:', err.message);
    return res.status(500).json({ 
      error: true, 
      mensaje: 'Error al poblar ubicaciones: ' + err.message 
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// GET /nutricionapp-api/admin/ubicaciones/stats
// Endpoint opcional para ver estadísticas de ubicaciones cargadas
router.get('/ubicaciones/stats', verificarToken, verificarRol('admin', 'doctor', 'nutricionista'), async (req, res) => {
  let connection;
  try {
    connection = await getConnection();
    
    const [provincias] = await connection.execute('SELECT COUNT(*) as total FROM provincias');
    const [cantones] = await connection.execute('SELECT COUNT(*) as total FROM cantones');
    const [parroquias] = await connection.execute('SELECT COUNT(*) as total FROM parroquias');
    
    return res.json({
      error: false,
      stats: {
        provincias: provincias[0].total,
        cantones: cantones[0].total,
        parroquias: parroquias[0].total
      }
    });
  } catch (err) {
    return res.status(500).json({ error: true, mensaje: err.message });
  } finally {
    if (connection) await connection.release();
  }
});

module.exports = router;