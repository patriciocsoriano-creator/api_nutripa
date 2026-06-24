// index.js - VERSION FINAL CON PANEL DE ADMINISTRACION

// CONFIGURACION DNS PARA NODE.JS (CRITICO PARA WINDOWS)
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
// FIN CONFIGURACION DNS

require('dotenv').config();

const express = require('express');
const cors = require('cors');

// Conexion a BD
const { app, closePool } = require('./conexion');

console.log('[INDEX] Montando rutas...');

// ========================================
// AUTENTICACION Y REGISTRO
// ========================================
app.use('/nutricionapp-api/login', require('./routes/login'));
app.use('/nutricionapp-api/registro', require('./routes/registro'));
app.use('/nutricionapp-api/recuperar', require('./routes/recuperar'));

// ========================================
// ENFERMERIA
// ========================================
app.use('/nutricionapp-api/enfermeria/registro', require('./routes/enfermeriaregistro'));
app.use('/nutricionapp-api/enfermeria', require('./routes/enfermeria-panel'));
app.use('/nutricionapp-api/enfermeria/pacientes', require('./routes/enfermeriabuscarpaciente'));
app.use('/nutricionapp-api/enfermeria/reportes', require('./routes/enfermeriareportes'));
// ========================================
// MEDICO (ORDEN IMPORTANTE: Especifico antes que general)
// ========================================
app.use('/nutricionapp-api/medico/dashboard', require('./routes/medico-dashboard'));
app.use('/nutricionapp-api/medico/paciente', require('./routes/medico-paciente-detalle'));
app.use('/nutricionapp-api/medico/pacientes', require('./routes/verpacientes'));
app.use('/nutricionapp-api/medico/plan-nutricional', require('./routes/medico-plan-nutricional'));
app.use('/nutricionapp-api/medico/seguimiento', require('./routes/medico-seguimiento-clinico'));
app.use('/nutricionapp-api/medico/informes', require('./routes/medicoinformes'));
app.use('/nutricionapp-api/medico/perfil', require('./routes/medico-perfil'));

// ========================================
// APIs EXTERNAS
// ========================================
app.use('/nutricionapp-api/fatsecret', require('./routes/fatsecret'));

// ========================================
// PACIENTE
// ========================================
app.use('/nutricionapp-api/paciente/vincular', require('./routes/pacientevincular'));
app.use('/nutricionapp-api/paciente/plan', require('./routes/paciente-plan'));
app.use('/nutricionapp-api/paciente/glucosa', require('./routes/paciente-glucosa'));

// ========================================
// ADMINISTRADOR (ORDEN CRITICO)
// ========================================
// Ubicaciones geograficas (DEBE IR PRIMERO por ser mas especifica)
app.use('/nutricionapp-api/admin/ubicaciones', require('./routes/admin-ubicaciones'));

// Panel de administracion completo
app.use('/nutricionapp-api/admin', require('./routes/admin'));

// ========================================
// INTELIGENCIA ARTIFICIAL
// ========================================
app.use('/nutricionapp-api/api/ml', require('./routes/ml-proxy'));

// ========================================
// HEALTH CHECK
// ========================================
app.get('/nutricionapp-api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'nutricionapp-api',
    version: '1.0.0'
  });
});

// ========================================
// 404 HANDLER
// ========================================
app.use((req, res) => {
  console.warn('[404] Ruta no encontrada:', req.method, req.path);
  res.status(404).json({ 
    error: true, 
    mensaje: 'Ruta no encontrada', 
    path: req.path,
    method: req.method
  });
});

// ========================================
// ERROR GLOBAL
// ========================================
app.use((err, req, res, next) => {
  console.error('[ERROR GLOBAL]', {
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    path: req.path,
    method: req.method
  });
  res.status(500).json({ 
    error: true, 
    mensaje: 'Error interno del servidor',
    detalle: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// ========================================
// CIERRE LIMPIO
// ========================================
process.on('SIGINT', async () => { 
  console.log('[SERVER] Cerrando servidor (SIGINT)...');
  await closePool(); 
  process.exit(0); 
});
process.on('SIGTERM', async () => { 
  console.log('[SERVER] Cerrando servidor (SIGTERM)...');
  await closePool(); 
  process.exit(0); 
});

// ========================================
// INICIAR SERVIDOR
// ========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[SERVER] API corriendo en http://localhost:${PORT}`);
  console.log(`[SERVER] BD: ${process.env.DB_NAME || 'nutripa_db'}@${process.env.DB_HOST || '127.0.0.1'}`);
  console.log(`\n[SERVER] RUTAS DISPONIBLES:`);
  console.log(`  Autenticacion:`);
  console.log(`    - POST /nutricionapp-api/login`);
  console.log(`    - POST /nutricionapp-api/registro`);
  console.log(`    - POST /nutricionapp-api/recuperar/...`);
  console.log(`  Enfermeria:`);
  console.log(`    - GET  /nutricionapp-api/enfermeria/...`);
  console.log(`  Medico:`);
  console.log(`    - GET  /nutricionapp-api/medico/dashboard`);
  console.log(`    - GET  /nutricionapp-api/medico/pacientes`);
  console.log(`    - GET  /nutricionapp-api/medico/paciente/:id/detalle`);
  console.log(`    - POST /nutricionapp-api/medico/plan-nutricional`);
  console.log(`    - GET  /nutricionapp-api/medico/perfil`);
  console.log(`    - PUT  /nutricionapp-api/medico/perfil`);
  console.log(`    - PUT  /nutricionapp-api/medico/ubicacion`);
  console.log(`    - PUT  /nutricionapp-api/medico/correo`);
  console.log(`    - PUT  /nutricionapp-api/medico/password`);
  console.log(`  Administrador:`);
  console.log(`    - GET  /nutricionapp-api/admin/dashboard/stats`);
  console.log(`    - GET  /nutricionapp-api/admin/usuarios`);
  console.log(`    - GET  /nutricionapp-api/admin/medicos`);
  console.log(`    - GET  /nutricionapp-api/admin/pacientes`);
  console.log(`    - GET  /nutricionapp-api/admin/asignaciones`);
  console.log(`    - GET  /nutricionapp-api/admin/auditoria`);
  console.log(`    - GET  /nutricionapp-api/admin/reportes/globales`);
  console.log(`  Ubicaciones:`);
  console.log(`    - POST /nutricionapp-api/admin/ubicaciones/poblar`);
  console.log(`    - GET  /nutricionapp-api/admin/ubicaciones/stats`);
  console.log(`    - GET  /nutricionapp-api/admin/ubicaciones/provincias`);
  console.log(`    - GET  /nutricionapp-api/admin/ubicaciones/cantones/:codigo`);
  console.log(`    - GET  /nutricionapp-api/admin/ubicaciones/parroquias/:codigo`);
  console.log(`  IA:`);
  console.log(`    - POST /nutricionapp-api/api/ml/prediccion-perfil`);
  console.log(`  Externas:`);
  console.log(`    - POST /nutricionapp-api/fatsecret/search`);
  console.log(`  Salud:`);
  console.log(`    - GET  /nutricionapp-api/health`);
  console.log(`\n[SERVER] Tip: Usa dns.setDefaultResultOrder('ipv4first') para evitar ENOTFOUND en Windows`);
});