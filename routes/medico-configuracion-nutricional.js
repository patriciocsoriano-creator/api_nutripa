const express = require('express');
const router = express.Router();
const { getConnection } = require('../conexion'); // Ajusta la ruta si tu archivo de conexion está en otro lugar
const { verificarToken, verificarRol } = require('../middleware/auth'); // Ajusta la ruta si tu middleware está en otro lugar

// ============================================================================
// 1. OBTENER LISTA DE INTERCAMBIOS
// GET /nutricionapp-api/medico/configuracion/intercambios
// ============================================================================
router.get('/intercambios', verificarToken, verificarRol('doctor', 'nutricionista', 'admin'), async (req, res) => {
    let connection;
    try {
        connection = await getConnection();
        const [rows] = await connection.execute(
            'SELECT * FROM configuracion_intercambios ORDER BY id ASC'
        );
        res.json({ error: false, data: rows });
    } catch (err) {
        console.error('[CONFIG NUTRICIONAL] Error obteniendo intercambios:', err);
        res.status(500).json({ error: true, mensaje: 'Error al obtener la configuracion de intercambios' });
    } finally {
        if (connection) {
            try { connection.release(); } catch (e) {}
        }
    }
});

// ============================================================================
// 2. ACTUALIZAR LISTA DE INTERCAMBIOS (Bulk Update)
// PUT /nutricionapp-api/medico/configuracion/intercambios
// ============================================================================
router.put('/intercambios', verificarToken, verificarRol('doctor', 'nutricionista', 'admin'), async (req, res) => {
    const { datos } = req.body; // Se espera un array de objetos con { id, cho, proteina, grasa, kcal }
    let connection;
    try {
        connection = await getConnection();
        await connection.beginTransaction();

        for (const item of datos) {
            await connection.execute(
                `UPDATE configuracion_intercambios 
                 SET cho = ?, proteina = ?, grasa = ?, kcal = ? 
                 WHERE id = ?`,
                [item.cho, item.proteina, item.grasa, item.kcal, item.id]
            );
        }

        await connection.commit();
        res.json({ error: false, mensaje: 'Configuracion de intercambios actualizada correctamente' });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error('[CONFIG NUTRICIONAL] Error actualizando intercambios:', err);
        res.status(500).json({ error: true, mensaje: 'Error al actualizar la configuracion de intercambios' });
    } finally {
        if (connection) {
            try { connection.release(); } catch (e) {}
        }
    }
});

// ============================================================================
// 3. OBTENER DISTRIBUCION DE COMIDAS
// GET /nutricionapp-api/medico/configuracion/distribucion
// ============================================================================
router.get('/distribucion', verificarToken, verificarRol('doctor', 'nutricionista', 'admin'), async (req, res) => {
    let connection;
    try {
        connection = await getConnection();
        const [rows] = await connection.execute(
            'SELECT * FROM configuracion_distribucion ORDER BY id ASC'
        );
        res.json({ error: false, data: rows });
    } catch (err) {
        console.error('[CONFIG NUTRICIONAL] Error obteniendo distribucion:', err);
        res.status(500).json({ error: true, mensaje: 'Error al obtener la configuracion de distribucion' });
    } finally {
        if (connection) {
            try { connection.release(); } catch (e) {}
        }
    }
});

// ============================================================================
// 4. ACTUALIZAR DISTRIBUCION DE COMIDAS (Bulk Update)
// PUT /nutricionapp-api/medico/configuracion/distribucion
// ============================================================================
router.put('/distribucion', verificarToken, verificarRol('doctor', 'nutricionista', 'admin'), async (req, res) => {
    const { datos } = req.body; // Se espera un array de objetos con { id, desayuno, media_manana, almuerzo, media_tarde, cena }
    let connection;
    try {
        connection = await getConnection();
        await connection.beginTransaction();

        for (const item of datos) {
            await connection.execute(
                `UPDATE configuracion_distribucion 
                 SET desayuno = ?, media_manana = ?, almuerzo = ?, media_tarde = ?, cena = ? 
                 WHERE id = ?`,
                [item.desayuno, item.media_manana, item.almuerzo, item.media_tarde, item.cena, item.id]
            );
        }

        await connection.commit();
        res.json({ error: false, mensaje: 'Distribucion de comidas actualizada correctamente' });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error('[CONFIG NUTRICIONAL] Error actualizando distribucion:', err);
        res.status(500).json({ error: true, mensaje: 'Error al actualizar la distribucion de comidas' });
    } finally {
        if (connection) {
            try { connection.release(); } catch (e) {}
        }
    }
});

module.exports = router;