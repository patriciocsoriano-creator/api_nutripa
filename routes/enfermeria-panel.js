// routes/enfermeria-panel.js
const express = require('express');
const router = express.Router();
const { getConnection } = require('../conexion');
const { verificarToken, verificarRol } = require('../middleware/auth');

console.log('[ROUTER] Cargando enfermeria-panel.js');

// Middleware: solo enfermeras, nutricionistas y admin
router.use(verificarToken);
router.use(verificarRol('enfermera', 'nutricionista', 'admin'));

// ============================================================================
// GET /nutricionapp-api/enfermeria/estadisticas
// Estadisticas del dashboard de enfermeria
// CORRECCION: Ahora muestra datos de TODO el equipo medico, no solo del usuario
// ============================================================================
router.get('/estadisticas', async (req, res) => {
  const usuarioId = req.usuario?.id;
  
  let connection;
  try {
    connection = await getConnection();

    console.log('[ESTADISTICAS] Calculando para usuario:', usuarioId);

    // 1. TOTAL DE PACIENTES ACTIVOS (todos los pacientes no eliminados)
    const [totalPacientes] = await connection.execute(
      `SELECT COUNT(DISTINCT p.id) as total 
       FROM pacientes p
       INNER JOIN registro r ON r.paciente_id = p.id 
       WHERE p.eliminado_en IS NULL 
         AND r.estado != 'cancelado'`
    );

    // 2. REGISTROS DE HOY (todos los registros del dia actual)
    const [registrosHoy] = await connection.execute(
      `SELECT COUNT(*) as total
       FROM registro 
       WHERE DATE(creado_en) = CURRENT_DATE 
         AND estado != 'cancelado'`
    );

    // 3. REGISTROS TOTALES DEL MES ACTUAL
    const [registrosMes] = await connection.execute(
      `SELECT COUNT(*) as total
       FROM registro 
       WHERE MONTH(creado_en) = MONTH(CURDATE())
         AND YEAR(creado_en) = YEAR(CURDATE())
         AND estado != 'cancelado'`
    );

    // 4. REGISTROS PENDIENTES (en progreso)
    const [pendientes] = await connection.execute(
      `SELECT COUNT(*) as pendientes 
       FROM registro 
       WHERE estado NOT IN ('finalizado', 'cancelado')`
    );

    // 5. ALERTAS ACTIVAS (global, sin filtro de usuario)
    const [detalleAlertas] = await connection.execute(
      `SELECT 
        r.paciente_id,
        p.nombres,
        p.apellidos,
        p.numero_identificacion as cedula,
        r.signos_vitales,
        r.fecha_inicio as fecha_registro
       FROM registro r
       INNER JOIN pacientes p ON p.id = r.paciente_id
       INNER JOIN (
         SELECT paciente_id, MAX(fecha_inicio) as ultima_fecha
         FROM registro
         WHERE estado IN ('finalizado', 'signos_vitales', 'antropometricos', 'metabolicas')
         GROUP BY paciente_id
       ) ultimo ON r.paciente_id = ultimo.paciente_id 
                 AND r.fecha_inicio = ultimo.ultima_fecha
       WHERE r.signos_vitales IS NOT NULL
       ORDER BY r.fecha_inicio DESC
       LIMIT 10`
    );

    // Procesar alertas para identificar cuales son criticas
    const alertasActivas = [];
    for (const alerta of detalleAlertas) {
      try {
        const signos = typeof alerta.signos_vitales === 'string' 
          ? JSON.parse(alerta.signos_vitales) 
          : alerta.signos_vitales;
        
        let tipoAlerta = [];
        let nivel = 'medio';
        
        // Verificar presion arterial
        if (signos?.presionArterial) {
          const [sist, dia] = String(signos.presionArterial).split('/').map(n => parseInt(n.trim()));
          if (sist >= 180 || dia >= 120) {
            tipoAlerta.push(`PA: ${signos.presionArterial} (CRITICA)`);
            nivel = 'critico';
          } else if (sist >= 140 || dia >= 90) {
            tipoAlerta.push(`PA: ${signos.presionArterial}`);
            if (nivel !== 'critico') nivel = 'alto';
          }
        }
        
        // Verificar glucosa
        if (signos?.glucosaAyunas) {
          if (signos.glucosaAyunas >= 200) {
            tipoAlerta.push(`Glucosa: ${signos.glucosaAyunas} mg/dL (CRITICA)`);
            nivel = 'critico';
          } else if (signos.glucosaAyunas >= 126) {
            tipoAlerta.push(`Glucosa: ${signos.glucosaAyunas} mg/dL`);
            if (nivel !== 'critico') nivel = 'alto';
          }
        }
        
        // Verificar SpO2
        if (signos?.spo2 && signos.spo2 < 90) {
          tipoAlerta.push(`SpO2: ${signos.spo2}% (CRITICA)`);
          nivel = 'critico';
        }
        
        if (tipoAlerta.length > 0) {
          alertasActivas.push({
            paciente_id: alerta.paciente_id,
            nombre_completo: `${alerta.nombres} ${alerta.apellidos}`,
            cedula: alerta.cedula,
            tipo_alerta: tipoAlerta.join(' | '),
            nivel: nivel,
            fecha: alerta.fecha_registro
          });
        }
      } catch (e) {
        console.warn('[ESTADISTICAS] Error procesando alerta:', e.message);
      }
    }

    // Logs de debug
    console.log('[ESTADISTICAS] Resultados:', {
      total_pacientes: totalPacientes[0]?.total || 0,
      registros_hoy: registrosHoy[0]?.total || 0,
      registros_mes: registrosMes[0]?.total || 0,
      pendientes: pendientes[0]?.pendientes || 0,
      alertas_activas: alertasActivas.length
    });

    return res.status(200).json({
      error: false,
      datos: {
        total_pacientes: totalPacientes[0]?.total || 0,
        registros_hoy: registrosHoy[0]?.total || 0,
        registros_mes: registrosMes[0]?.total || 0,
        registros_pendientes: pendientes[0]?.pendientes || 0,
        alertas_activas: alertasActivas.length,
        detalle_alertas: alertasActivas
      }
    });

  } catch (err) {
    console.error('[ESTADISTICAS] Error:', {
      message: err.message,
      code: err.code,
      sql: err.sql
    });
    return res.status(500).json({ 
      error: true, 
      mensaje: 'Error al cargar estadisticas: ' + err.message 
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// ============================================================================
// GET /nutricionapp-api/enfermeria/pacientes/recientes
// CORRECCION: LIMIT interpolado + muestra pacientes de todo el equipo
// ============================================================================
router.get('/pacientes/recientes', async (req, res) => {
  const { limit = 6 } = req.query;
  
  // Validar que limit sea un numero entero positivo
  const limitNum = parseInt(limit) || 6;
  if (limitNum < 1 || limitNum > 100) {
    return res.status(400).json({ 
      error: true, 
      mensaje: 'El parametro limit debe estar entre 1 y 100' 
    });
  }
  
  let connection;
  try {
    connection = await getConnection();
    console.log('[PACIENTES] Cargando recientes, limit:', limitNum);

    // CONSULTA CON LIMIT INTERPOLADO - Muestra pacientes de todo el equipo
    const [pacientes] = await connection.execute(
      `SELECT 
         p.id, 
         CONCAT(p.nombres, ' ', p.apellidos) as nombre_completo,
         p.numero_identificacion as cedula,
         p.telefono,
         r.id as registro_id,
         r.estado as estado_registro,
         r.creado_en as registro_creado_en,
         r.fecha_finalizacion,
         r.datos_personales,
         r.signos_vitales,
         r.datos_antropometricos,
         r.condiciones_metabolicas
       FROM pacientes p
       INNER JOIN registro r ON r.paciente_id = p.id
       WHERE r.estado != 'cancelado'
         AND p.eliminado_en IS NULL
       ORDER BY COALESCE(r.fecha_finalizacion, r.creado_en) DESC
       LIMIT ${limitNum}`
    );

    console.log('[PACIENTES] Consulta ejecutada, encontrados:', pacientes.length);

    // Procesar cada paciente
    const pacientesProcesados = pacientes.map(p => {
      let progreso = 0;
      let estado_real = 'iniciado';

      if (p.estado_registro === 'finalizado') {
        progreso = 100;
        estado_real = 'finalizado';
      } else {
        let camposLlenos = 0;
        if (p.datos_personales) camposLlenos++;
        if (p.signos_vitales) camposLlenos++;
        if (p.datos_antropometricos) camposLlenos++;
        if (p.condiciones_metabolicas) camposLlenos++;
        
        progreso = Math.round((camposLlenos / 4) * 100);
        estado_real = progreso > 0 ? 'en_proceso' : 'iniciado';
      }

      const alertas = [];
      let tiene_alerta = false;
      
      if (p.signos_vitales) {
        try {
          const signos = typeof p.signos_vitales === 'string' 
            ? JSON.parse(p.signos_vitales) 
            : p.signos_vitales;
          
          if (signos?.presionArterial) {
            const [sist, dia] = String(signos.presionArterial).split('/').map(n => parseInt(n.trim()));
            if (sist >= 180 || dia >= 120) {
              alertas.push({ tipo: 'PA Critica', nivel: 'critico' });
              tiene_alerta = true;
            } else if (sist >= 140 || dia >= 90) {
              alertas.push({ tipo: 'PA Alta', nivel: 'alto' });
              tiene_alerta = true;
            }
          }
          
          if (signos?.glucosaAyunas) {
            if (signos.glucosaAyunas >= 200) {
              alertas.push({ tipo: 'Glucosa Critica', nivel: 'critico' });
              tiene_alerta = true;
            } else if (signos.glucosaAyunas >= 126) {
              alertas.push({ tipo: 'Glucosa Alta', nivel: 'alto' });
              tiene_alerta = true;
            }
          }
          
          if (signos?.spo2 && signos.spo2 < 90) {
            alertas.push({ tipo: 'SpO2 Baja', nivel: 'critico' });
            tiene_alerta = true;
          }
        } catch (e) {
          console.warn('[PACIENTES] Error procesando signos:', e.message);
        }
      }

      const ultima_fecha = p.fecha_finalizacion || p.registro_creado_en;

      return {
        id: p.id,
        nombre_completo: p.nombre_completo,
        cedula: p.cedula,
        telefono: p.telefono,
        registro_id: p.registro_id,
        estado_real: estado_real,
        progreso: progreso,
        alertas: alertas,
        tiene_alerta: tiene_alerta,
        ultima_fecha: ultima_fecha
      };
    });

    console.log('[PACIENTES] Procesados:', pacientesProcesados.length);

    return res.status(200).json({
      error: false,
      pacientes: pacientesProcesados
    });

  } catch (err) {
    console.error('[PACIENTES] Error detallado:', {
      message: err.message,
      code: err.code,
      sql: err.sql,
      sqlMessage: err.sqlMessage
    });
    
    return res.status(500).json({ 
      error: true, 
      mensaje: 'Error al cargar pacientes: ' + err.message 
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// ============================================================================
// GET /nutricionapp-api/enfermeria/pacientes/buscar/:cedula
// ============================================================================
router.get('/pacientes/buscar/:cedula', async (req, res) => {
  const { cedula } = req.params;
  let connection;
  
  try {
    connection = await getConnection();
    
    const [resultados] = await connection.execute(
      `SELECT p.id, p.nombres, p.apellidos, 
              CONCAT(p.nombres, ' ', p.apellidos) as nombre_completo,
              p.numero_identificacion as cedula, 
              r.id as registro_id, 
              r.estado as registro_estado
       FROM pacientes p
       LEFT JOIN registro r ON r.paciente_id = p.id 
         AND r.estado NOT IN ('finalizado', 'cancelado')
       WHERE p.numero_identificacion = ? 
         AND p.activo = 1 
         AND p.eliminado_en IS NULL
       LIMIT 1`,
      [cedula]
    );

    if (resultados.length === 0) {
      return res.status(404).json({ error: true, mensaje: 'Paciente no encontrado' });
    }

    const paciente = resultados[0];
    
    return res.json({
      error: false,
      paciente: {
        id: paciente.id,
        nombre_completo: paciente.nombre_completo,
        cedula: paciente.cedula,
        registro_pendiente: paciente.registro_id ? { 
          id: paciente.registro_id, 
          estado: paciente.registro_estado 
        } : null
      }
    });
  } catch (err) {
    console.error('[BUSCAR] Error:', err);
    return res.status(500).json({ error: true, mensaje: 'Error al buscar paciente' });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// ============================================================================
// GET /nutricionapp-api/enfermeria/pacientes/todos
// Obtener TODOS los pacientes registrados (sin filtro de usuario)
// ============================================================================
router.get('/pacientes/todos', async (req, res) => {
  let connection;
  try {
    connection = await getConnection();
    console.log('[TODOS] Cargando todos los pacientes');

    const [pacientes] = await connection.execute(
      `SELECT 
         p.id, 
         CONCAT(p.nombres, ' ', p.apellidos) as nombre_completo,
         p.numero_identificacion as cedula,
         p.telefono,
         r.id as registro_id,
         r.estado as estado_registro,
         r.creado_en as registro_creado_en,
         r.fecha_finalizacion,
         r.datos_personales,
         r.signos_vitales,
         r.datos_antropometricos,
         r.condiciones_metabolicas
       FROM pacientes p
       INNER JOIN registro r ON r.paciente_id = p.id
       WHERE r.estado != 'cancelado'
         AND p.eliminado_en IS NULL
       ORDER BY COALESCE(r.fecha_finalizacion, r.creado_en) DESC`
    );

    // Procesar cada paciente
    const pacientesProcesados = pacientes.map(p => {
      let progreso = 0;
      let estado_real = 'iniciado';

      if (p.estado_registro === 'finalizado') {
        progreso = 100;
        estado_real = 'finalizado';
      } else {
        let camposLlenos = 0;
        if (p.datos_personales) camposLlenos++;
        if (p.signos_vitales) camposLlenos++;
        if (p.datos_antropometricos) camposLlenos++;
        if (p.condiciones_metabolicas) camposLlenos++;
        
        progreso = Math.round((camposLlenos / 4) * 100);
        estado_real = progreso > 0 ? 'en_proceso' : 'iniciado';
      }

      const alertas = [];
      let tiene_alerta = false;
      
      if (p.signos_vitales) {
        try {
          const signos = typeof p.signos_vitales === 'string' 
            ? JSON.parse(p.signos_vitales) 
            : p.signos_vitales;
          
          if (signos?.presionArterial) {
            const [sist, dia] = String(signos.presionArterial).split('/').map(n => parseInt(n.trim()));
            if (sist >= 180 || dia >= 120) {
              alertas.push({ tipo: 'PA Critica', nivel: 'critico' });
              tiene_alerta = true;
            } else if (sist >= 140 || dia >= 90) {
              alertas.push({ tipo: 'PA Alta', nivel: 'alto' });
              tiene_alerta = true;
            }
          }
          
          if (signos?.glucosaAyunas) {
            if (signos.glucosaAyunas >= 200) {
              alertas.push({ tipo: 'Glucosa Critica', nivel: 'critico' });
              tiene_alerta = true;
            } else if (signos.glucosaAyunas >= 126) {
              alertas.push({ tipo: 'Glucosa Alta', nivel: 'alto' });
              tiene_alerta = true;
            }
          }
        } catch (e) {
          console.warn('[TODOS] Error procesando signos:', e.message);
        }
      }

      return {
        id: p.id,
        nombre_completo: p.nombre_completo,
        cedula: p.cedula,
        telefono: p.telefono,
        registro_id: p.registro_id,
        estado_real: estado_real,
        progreso: progreso,
        alertas: alertas,
        tiene_alerta: tiene_alerta,
        ultima_fecha: p.fecha_finalizacion || p.registro_creado_en
      };
    });

    console.log('[TODOS] Pacientes encontrados:', pacientesProcesados.length);

    return res.status(200).json({
      error: false,
      total: pacientesProcesados.length,
      pacientes: pacientesProcesados
    });

  } catch (err) {
    console.error('[TODOS] Error:', err.message);
    return res.status(500).json({ 
      error: true, 
      mensaje: 'Error al cargar pacientes: ' + err.message 
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

// ============================================================================
// DELETE /nutricionapp-api/enfermeria/pacientes/:paciente_id
// Eliminar paciente (soft delete)
// ============================================================================
router.delete('/pacientes/:paciente_id', async (req, res) => {
  const { paciente_id } = req.params;
  const usuarioId = req.usuario?.id;
  
  let connection;
  try {
    connection = await getConnection();
    
    // Soft delete: marcar como eliminado
    await connection.execute(
      `UPDATE pacientes 
       SET eliminado_en = NOW(), eliminado_por = ? 
       WHERE id = ? AND eliminado_en IS NULL`,
      [usuarioId, paciente_id]
    );
    
    console.log(`[DELETE] Paciente ${paciente_id} eliminado por ${usuarioId}`);
    
    return res.json({
      error: false,
      mensaje: 'Paciente eliminado correctamente'
    });
    
  } catch (err) {
    console.error('[DELETE] Error:', err.message);
    return res.status(500).json({ 
      error: true, 
      mensaje: 'Error al eliminar paciente: ' + err.message 
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

console.log('[ROUTER] enfermeria-panel.js cargado correctamente');
module.exports = router;