// cron-jobs.js
const cron = require('node-cron');
const { getConnection } = require('./conexion');

console.log(' [CRON JOBS] Inicializando tareas programadas...');

// ============================================================================
// CRON JOB 1: Marcar citas no asistidas automáticamente
// Se ejecuta cada hora
// ============================================================================
cron.schedule('0 * * * *', async () => {
  console.log(' [CRON] Ejecutando verificación de citas no asistidas...');
  
  let connection;
  try {
    connection = await getConnection();
    
    const [citasNoAsistidas] = await connection.execute(
      `UPDATE seguimiento_citas 
       SET estado = 'no_asistida'
       WHERE estado IN ('agendada', 'confirmada')
         AND fecha_hora < NOW() - INTERVAL 1 HOUR`
    );

    if (citasNoAsistidas.affectedRows > 0) {
      console.log(` [CRON] ${citasNoAsistidas.affectedRows} citas marcadas como no asistidas`);
    } else {
      console.log(' [CRON] No hay citas para marcar como no asistidas');
    }

  } catch (err) {
    console.error(' [CRON] Error en verificación de citas:', err);
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// ============================================================================
// CRON JOB 2: Recordatorio de citas (opcional)
// Se ejecuta todos los días a las 8:00 AM
// ============================================================================
cron.schedule('0 8 * * *', async () => {
  console.log(' [CRON] Enviando recordatorios de citas del día...');
  
  let connection;
  try {
    connection = await getConnection();
    
    // Buscar citas de HOY que están confirmadas
    const [citasHoy] = await connection.execute(
      `SELECT 
        sc.id,
        sc.fecha_hora,
        sc.tipo,
        CONCAT(p.nombres, ' ', p.apellidos) as paciente_nombre,
        p.numero_identificacion,
        u.telefono as paciente_telefono,
        CONCAT(u2.nombre, ' ', u2.apellido) as medico_nombre
       FROM seguimiento_citas sc
       INNER JOIN pacientes p ON p.id = sc.paciente_id
       INNER JOIN usuarios u ON u.id = p.usuario_id
       INNER JOIN usuarios u2 ON u2.id = sc.medico_id
       WHERE sc.estado = 'confirmada'
         AND DATE(sc.fecha_hora) = CURDATE()
       ORDER BY sc.fecha_hora ASC`
    );

    if (citasHoy.length > 0) {
      console.log(` [CRON] ${citasHoy.length} citas programadas para hoy`);
      // Aquí puedes implementar envío de emails o notificaciones
    }

  } catch (err) {
    console.error(' [CRON] Error enviando recordatorios:', err);
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

console.log(' [CRON JOBS] Tareas programadas configuradas correctamente');

module.exports = {
  // Puedes exportar funciones si necesitas controlar los cron jobs manualmente
};
