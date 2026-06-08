// index.js - VERSIÓN ESTABLE Y CORREGIDA

// 👇 CONFIGURACIÓN DNS PARA NODE.JS (CRÍTICO PARA WINDOWS)
const dns = require('dns');
// Forzar IPv4 primero para evitar problemas de resolución ENOTFOUND
dns.setDefaultResultOrder('ipv4first');
// 👆 FIN CONFIGURACIÓN DNS

require('dotenv').config();

const express = require('express');
const cors = require('cors');

// ✅ Conexión a BD
const { app, closePool } = require('./conexion');

console.log('📦 [INDEX] Montando rutas...');

// 🔐 Autenticación y registro de usuarios
app.use('/nutricionapp-api/login', require('./routes/login'));
app.use('/nutricionapp-api/registro', require('./routes/registro'));

// 🔐 Recuperación de contraseña 
app.use('/nutricionapp-api/recuperar', require('./routes/recuperar'));

// 🏥 Enfermería: Flujo clínico + Dashboard
app.use('/nutricionapp-api/enfermeria/registro', require('./routes/enfermeriaregistro'));
app.use('/nutricionapp-api/enfermeria', require('./routes/enfermeria-panel'));

// 👨‍⚕️ MÉDICO - ORDEN IMPORTANTE: Específico antes que general
// 👨‍⚕️ Dashboard médico (estadísticas)
app.use('/nutricionapp-api/medico/dashboard', require('./routes/medico-dashboard'));

// ✅ DETALLE de un paciente (singular + :id) - VA PRIMERO
app.use('/nutricionapp-api/medico/paciente', require('./routes/medico-paciente-detalle'));

// ✅ LISTA de pacientes (plural) - VA DESPUÉS
app.use('/nutricionapp-api/medico/pacientes', require('./routes/verpacientes'));

// 🔍 Proxy para FatSecret API (OAuth 1.0a)
app.use('/nutricionapp-api/fatsecret', require('./routes/fatsecret'));

// 👨‍⚕️ Planes nutricionales
app.use('/nutricionapp-api/medico/plan-nutricional', require('./routes/medico-plan-nutricional'));

// 🔗 Paciente: Vinculación
app.use('/nutricionapp-api/paciente/vincular', require('./routes/pacientevincular'));

// 👨‍⚕️ Seguimiento Clínico
app.use('/nutricionapp-api/medico/seguimiento', require('./routes/medico-seguimiento-clinico'));

// 👨‍⚕️ Informes médicos
app.use('/nutricionapp-api/medico/informes', require('./routes/medicoinformes'));

// 🏢 Administrador: Ubicaciones
app.use('/nutricionapp-api/admin', require('./routes/admin-ubicaciones'));

// 👨‍⚕️ Plan del paciente
app.use('/nutricionapp-api/paciente/plan', require('./routes/paciente-plan'));

// 🩸 Glucosa del paciente
app.use('/nutricionapp-api/paciente/glucosa', require('./routes/paciente-glucosa'));

// 🤖 Proxy para servicio de IA (FastAPI)
app.use('/nutricionapp-api/api/ml', require('./routes/ml-proxy'));

// 🩺 Health check global
app.get('/nutricionapp-api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'nutricionapp-api',
    version: '1.0.0'
  });
});

// 🌍 404 Handler (AL FINAL - después de todas las rutas)
app.use((req, res) => {
  console.warn('⚠️ [404] Ruta no encontrada:', req.method, req.path);
  res.status(404).json({ 
    error: true, 
    mensaje: 'Ruta no encontrada', 
    path: req.path,
    method: req.method
  });
});

// 🚨 Error global (DEBE IR DESPUÉS DEL 404)
app.use((err, req, res, next) => {
  console.error('❌ [ERROR GLOBAL]', {
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

// 🛑 Cierre limpio del pool de conexiones
process.on('SIGINT', async () => { 
  console.log('🛑 Cerrando servidor (SIGINT)...');
  await closePool(); 
  process.exit(0); 
});
process.on('SIGTERM', async () => { 
  console.log('🛑 Cerrando servidor (SIGTERM)...');
  await closePool(); 
  process.exit(0); 
});

// 🚀 Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ API corriendo en http://localhost:${PORT}`);
  console.log(`🔗 BD: ${process.env.DB_NAME || 'nutripa_db'}@${process.env.DB_HOST || '127.0.0.1'}`);
  console.log(`📋 Rutas disponibles:`);
  console.log(`   • POST /nutricionapp-api/login`);
  console.log(`   • POST /nutricionapp-api/registro`);
  console.log(`   • POST /nutricionapp-api/recuperar`);
  console.log(`   • GET  /nutricionapp-api/enfermeria/...`);
  console.log(`   • GET  /nutricionapp-api/medico/pacientes`);
  console.log(`   • GET  /nutricionapp-api/medico/paciente/:id/detalle`);
  console.log(`   • POST /nutricionapp-api/fatsecret/search`);
  console.log(`   • POST /nutricionapp-api/medico/plan-nutricional`);
  console.log(`   • GET  /nutricionapp-api/health`);
  console.log(`\n💡 Tip: Usa dns.setDefaultResultOrder('ipv4first') para evitar ENOTFOUND en Windows`);
});