// routes/medico-dashboard.js
const express = require('express');
const router = express.Router();
const { getConnection } = require('../conexion');
const { verificarToken, verificarRol } = require('../middleware/auth');

console.log('✅ [ROUTER] Cargando medico-dashboard.js');

// ============================================================================
// 📊 GET /nutricionapp-api/medico/dashboard
// 👉 Dashboard completo con estadísticas reales
// ============================================================================
// ⚠️ IMPORTANTE: Como en index.js ya se monta con prefijo '/dashboard',
// aquí la ruta debe ser solo '/'
router.get('/', verificarToken, verificarRol('doctor', 'nutricionista'), async (req, res) => {
  const medicoId = req.usuario?.id;
  
  if (!medicoId) {
    return res.status(401).json({ error: true, mensaje: 'No autenticado' });
  }

  let connection;
  try {
    connection = await getConnection();

    // ==========================================
    // 1️⃣ TOTAL DE PACIENTES ACTIVOS
    // ==========================================
    const [pacientesResult] = await connection.execute(
      `SELECT COUNT(*) as total 
       FROM pacientes 
       WHERE activo = 1 AND eliminado_en IS NULL`
    );
    const totalPacientes = pacientesResult[0]?.total || 0;

    // ==========================================
    // 2️⃣ PLANES CREADOS POR EL MÉDICO/NUTRICIONISTA
    // ==========================================
    const [planesResult] = await connection.execute(
      `SELECT COUNT(*) as total 
       FROM planes_nutricionales 
       WHERE medico_id = ? 
       AND estado IN ('activo', 'completado')`,
      [medicoId]
    );
    const planesCreados = planesResult[0]?.total || 0;

    // ==========================================
    // 3️⃣ CONTROLES REALIZADOS (Registros finalizados)
    // ==========================================
    const [controlesResult] = await connection.execute(
      `SELECT COUNT(*) as total 
       FROM registro 
       WHERE registrado_por = ? AND estado = 'finalizado'`,
      [medicoId]
    );
    const controlesRealizados = controlesResult[0]?.total || 0;

    // ==========================================
    // 4️⃣ ALERTAS ACTIVAS (Presión arterial alta)
    // ==========================================
    const [registrosRecientes] = await connection.execute(
      `SELECT 
        r.paciente_id,
        r.signos_vitales,
        r.fecha_finalizacion,
        p.nombres,
        p.apellidos
       FROM registro r
       INNER JOIN pacientes p ON p.id = r.paciente_id
       WHERE r.estado = 'finalizado'
         AND r.signos_vitales IS NOT NULL
         AND p.eliminado_en IS NULL
       ORDER BY r.fecha_finalizacion DESC`
    );

    // Procesar alertas de presión arterial
    const alertasActivas = [];
    const pacientesConAlerta = new Set();

    for (const registro of registrosRecientes) {
      if (pacientesConAlerta.has(registro.paciente_id)) continue;
      
      try {
        const signos = typeof registro.signos_vitales === 'string' 
          ? JSON.parse(registro.signos_vitales) 
          : registro.signos_vitales;
        
        if (signos?.presionArterial) {
          const [sistolica, diastolica] = String(signos.presionArterial)
            .split('/')
            .map(n => parseInt(n.trim()));
          
          if (sistolica >= 140 || diastolica >= 90) {
            alertasActivas.push({
              paciente_id: registro.paciente_id,
              nombre_completo: `${registro.nombres} ${registro.apellidos}`,
              presion_arterial: signos.presionArterial,
              sistolica,
              diastolica,
              fecha_registro: registro.fecha_finalizacion,
              nivel_riesgo: sistolica >= 180 || diastolica >= 120 ? 'crítico' : 'alto'
            });
            pacientesConAlerta.add(registro.paciente_id);
          }
        }
      } catch (e) {
        console.warn('⚠️ Error parseando signos vitales:', e.message);
      }
    }

    // ==========================================
    // 5️⃣ PACIENTES RECIENTES (últimos 5)
    // ==========================================
    const [pacientesRecientes] = await connection.execute(
      `SELECT 
        p.id,
        p.nombres,
        p.apellidos,
        p.numero_identificacion,
        p.telefono,
        p.sexo,
        p.fecha_nacimiento,
        p.actividad_fisica,
        (SELECT COUNT(*) FROM planes_nutricionales pn 
         WHERE pn.paciente_id = p.id AND pn.estado IN ('activo', 'completado')) as total_planes,
        (SELECT MAX(r.fecha_finalizacion) FROM registro r 
         WHERE r.paciente_id = p.id AND r.estado = 'finalizado') as ultimo_control,
        (SELECT r.signos_vitales FROM registro r 
         WHERE r.paciente_id = p.id AND r.estado = 'finalizado' 
         ORDER BY r.fecha_finalizacion DESC LIMIT 1) as signos_recientes
       FROM pacientes p
       WHERE p.activo = 1 AND p.eliminado_en IS NULL
       ORDER BY p.creado_en DESC
       LIMIT 5`
    );

    // Procesar pacientes recientes
    const pacientesRecientesProcesados = pacientesRecientes.map(p => {
      let edad = null;
      if (p.fecha_nacimiento) {
        const hoy = new Date();
        const nacimiento = new Date(p.fecha_nacimiento);
        edad = hoy.getFullYear() - nacimiento.getFullYear();
      }

      let riesgo = 'bajo';
      let presionArterial = null;
      
      if (p.signos_recientes) {
        try {
          const signos = typeof p.signos_recientes === 'string' 
            ? JSON.parse(p.signos_recientes) 
            : p.signos_recientes;
          
          if (signos?.presionArterial) {
            presionArterial = signos.presionArterial;
            const [sist, dia] = String(signos.presionArterial).split('/').map(n => parseInt(n.trim()));
            
            if (sist >= 180 || dia >= 120) riesgo = 'critico';
            else if (sist >= 140 || dia >= 90) riesgo = 'alto';
            else if (sist >= 130 || dia >= 85) riesgo = 'medio';
            else riesgo = 'bajo';
          }
        } catch (e) {}
      }

      return {
        id: p.id,
        nombre: p.nombres,
        apellido: p.apellidos,
        nombre_completo: `${p.nombres} ${p.apellidos}`,
        cedula: p.numero_identificacion,
        telefono: p.telefono,
        sexo: p.sexo,
        edad: edad,
        actividad_fisica: p.actividad_fisica,
        total_planes: p.total_planes || 0,
        ultimo_control: p.ultimo_control,
        presion_arterial: presionArterial,
        riesgo: riesgo
      };
    });

    // ==========================================
    // 📤 RESPUESTA FINAL
    // ==========================================
    console.log(`✅ [DASHBOARD] Datos cargados para médico ${medicoId}`);
    
    return res.status(200).json({
      error: false,
      dashboard: {
        totalPacientes,
        planesCreados,
        controlesRealizados,
        alertasActivas: alertasActivas.length,
        listaAlertas: alertasActivas,
        pacientesRecientes: pacientesRecientesProcesados
      }
    });

  } catch (err) {
    console.error('❌ [DASHBOARD] Error:', err);
    return res.status(500).json({ 
      error: true, 
      mensaje: 'Error al cargar el dashboard' 
    });
  } finally {
    if (connection) {
      try { connection.release(); } catch (e) {}
    }
  }
});

console.log('✅ [ROUTER] medico-dashboard.js cargado correctamente');
module.exports = router;