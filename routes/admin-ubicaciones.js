// routes/admin-ubicaciones.js - GESTIÓN DE UBICACIONES GEOGRÁFICAS
console.log(' [ROUTER] Cargando admin-ubicaciones.js');

const express = require('express');
const router = express.Router();
const { getConnection } = require('../conexion');
const { verificarToken, verificarRol } = require('../middleware/auth');

// ========================================
//  POBLAR UBICACIONES DE ECUADOR
// POST /nutricionapp-api/admin/ubicaciones/poblar
// ========================================
router.post('/poblar', verificarToken, verificarRol('admin'), async (req, res) => {
  const { provincias } = req.body;
  
  if (!provincias || !Array.isArray(provincias)) {
    return res.status(400).json({ error: true, mensaje: 'Datos de provincias inválidos' });
  }

  let connection;
  try {
    connection = await getConnection();
    
    for (const prov of provincias) {
      //  Insertar/Actualizar provincia
      await connection.execute(
        `INSERT INTO provincias (codigo, nombre) VALUES (?, ?) 
         ON DUPLICATE KEY UPDATE nombre = VALUES(nombre)`,
        [prov.codigo, prov.nombre]
      );
      
      //  Insertar/Actualizar cantones
      if (prov.cantones && Array.isArray(prov.cantones)) {
        for (const canton of prov.cantones) {
          await connection.execute(
            `INSERT INTO cantones (codigo, nombre, provincia_codigo) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE nombre = VALUES(nombre), provincia_codigo = VALUES(provincia_codigo)`,
            [canton.codigo, canton.nombre, prov.codigo]
          );
          
          //  Insertar/Actualizar parroquias
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
    
    console.log(' [ADMIN] Ubicaciones de Ecuador pobladas exitosamente');
    
    return res.json({
      error: false,
      mensaje: 'Ubicaciones pobladas exitosamente',
      total_provincias: provincias.length
    });
    
  } catch (err) {
    console.error(' [ADMIN] Error poblando ubicaciones:', err.message);
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

// ========================================
//  ESTADÍSTICAS DE UBICACIONES
// GET /nutricionapp-api/admin/ubicaciones/stats
// ========================================
router.get('/stats', verificarToken, verificarRol('admin', 'doctor', 'nutricionista'), async (req, res) => {
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
    console.error(' [ADMIN] Error en stats ubicaciones:', err.message);
    return res.status(500).json({ error: true, mensaje: err.message });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// ========================================
//  LISTAR PROVINCIAS (para frontend)
// GET /nutricionapp-api/admin/ubicaciones/provincias
// ========================================
router.get('/provincias', async (req, res) => {
  let connection;
  try {
    connection = await getConnection();
    
    const [provincias] = await connection.execute(
      `SELECT codigo, nombre FROM provincias ORDER BY nombre ASC`
    );
    
    return res.json({
      error: false,
      provincias: provincias
    });
  } catch (err) {
    return res.status(500).json({ error: true, mensaje: err.message });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// ========================================
//  LISTAR CANTONES POR PROVINCIA
// GET /nutricionapp-api/admin/ubicaciones/cantones/:provinciaCodigo
// ========================================
router.get('/cantones/:provinciaCodigo', async (req, res) => {
  const { provinciaCodigo } = req.params;
  let connection;
  try {
    connection = await getConnection();
    
    const [cantones] = await connection.execute(
      `SELECT codigo, nombre FROM cantones 
       WHERE provincia_codigo = ? 
       ORDER BY nombre ASC`,
      [provinciaCodigo]
    );
    
    return res.json({
      error: false,
      cantones: cantones
    });
  } catch (err) {
    return res.status(500).json({ error: true, mensaje: err.message });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// ========================================
//  LISTAR PARROQUIAS POR CANTÓN
// GET /nutricionapp-api/admin/ubicaciones/parroquias/:cantonCodigo
// ========================================
router.get('/parroquias/:cantonCodigo', async (req, res) => {
  const { cantonCodigo } = req.params;
  let connection;
  try {
    connection = await getConnection();
    
    const [parroquias] = await connection.execute(
      `SELECT codigo, nombre FROM parroquias 
       WHERE canton_codigo = ? 
       ORDER BY nombre ASC`,
      [cantonCodigo]
    );
    
    return res.json({
      error: false,
      parroquias: parroquias
    });
  } catch (err) {
    return res.status(500).json({ error: true, mensaje: err.message });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

console.log(' [ROUTER] admin-ubicaciones.js cargado correctamente');
module.exports = router;