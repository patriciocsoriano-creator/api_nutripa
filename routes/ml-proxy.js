const express = require('express');
const router = express.Router();
const axios = require('axios');
const { verificarToken } = require('../middleware/auth');

// URL del microservicio
const ML_SERVICE_URL =
  process.env.ML_SERVICE_URL || 'http://app-nutricion-microservicionutri-8wzlez:8001';

console.log('🤖 ML_SERVICE_URL:', ML_SERVICE_URL);

// ======================================================
// 🔍 FUNCIÓN AUXILIAR: Validar payload antes de enviar
// ======================================================
function validarPayloadML(body) {
  const errores = [];
  
  // Campos requeridos
  if (body.imc === undefined || body.imc === null) errores.push('imc es requerido');
  if (body.edad === undefined || body.edad === null) errores.push('edad es requerido');
  if (!body.genero) errores.push('genero es requerido (M o F)');
  
  // Validar rangos
  if (body.imc !== undefined && (body.imc < 10 || body.imc > 60)) {
    errores.push('imc debe estar entre 10 y 60');
  }
  if (body.edad !== undefined && (body.edad < 0 || body.edad > 120)) {
    errores.push('edad debe estar entre 0 y 120');
  }
  if (body.genero && !['M', 'F'].includes(body.genero)) {
    errores.push('genero debe ser M o F');
  }
  
  // Validar opcionales si están presentes
  if (body.cintura !== undefined && (body.cintura < 30 || body.cintura > 200)) {
    errores.push('cintura debe estar entre 30 y 200 cm');
  }
  if (body.hba1c !== undefined && (body.hba1c < 3.0 || body.hba1c > 20.0)) {
    errores.push('hba1c debe estar entre 3.0 y 20.0 %');
  }
  
  return errores;
}

// ======================================================
// POST /nutricionapp-api/api/ml/prediccion-perfil
// ======================================================
router.post('/prediccion-perfil', verificarToken, async (req, res) => {
  const inicioTiempo = Date.now();
  
  try {
    console.log('\n📤 [ML-PROXY] Petición de predicción recibida');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(' Usuario:', req.usuario?.correo || req.usuario?.id);
    console.log(' Payload recibido:', JSON.stringify(req.body, null, 2));
    
    // 🔍 Validar payload ANTES de enviar al ML
    const errores = validarPayloadML(req.body);
    if (errores.length > 0) {
      console.warn(' [ML-PROXY] Payload inválido:', errores);
      return res.status(400).json({
        error: true,
        mensaje: 'Datos inválidos para predicción',
        errores: errores
      });
    }
    
    // 📊 Calcular riesgo hormonal en el proxy (para logging)
    const riesgoEstimado = calcularRiesgoHormonalEstimado(req.body);
    console.log(' Riesgo hormonal estimado:', riesgoEstimado);
    console.log(' URL destino:', `${ML_SERVICE_URL}/prediccion-perfil`);

    const response = await axios.post(
      `${ML_SERVICE_URL}/prediccion-perfil`,
      req.body,
      {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    const duracion = Date.now() - inicioTiempo;
    console.log(' [ML-PROXY] Respuesta recibida');
    console.log(' Perfil:', response.data.perfil_nombre);
    console.log(' Confianza:', (response.data.confianza * 100).toFixed(2) + '%');
    console.log(' Riesgo hormonal:', response.data.riesgo_hormonal);
    console.log(`  Duración: ${duracion}ms`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    return res.status(200).json(response.data);

  } catch (error) {
    const duracion = Date.now() - inicioTiempo;
    
    console.error('\n [ML-PROXY] ERROR');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('Mensaje:', error.message);
    console.error('Código:', error.code);
    console.error(`⏱️  Duración antes del error: ${duracion}ms`);

    if (error.response) {
      console.error('Status ML:', error.response.status);
      console.error('Detalle ML:', error.response.data);
    }

    console.error('Payload enviado:', JSON.stringify(req.body));
    console.error('URL usada:', `${ML_SERVICE_URL}/prediccion-perfil`);
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Errores específicos con mensajes claros
    if (error.code === 'ECONNREFUSED') {
      return res.status(503).json({
        error: true,
        mensaje: 'Servicio de IA no disponible. Contacte al administrador.',
        codigo: 'ECONNREFUSED'
      });
    }

    if (error.code === 'ENOTFOUND') {
      return res.status(503).json({
        error: true,
        mensaje: 'No se pudo resolver el dominio del microservicio ML',
        codigo: 'ENOTFOUND'
      });
    }

    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
      return res.status(504).json({
        error: true,
        mensaje: 'El servicio de IA tardó demasiado en responder',
        codigo: error.code
      });
    }

    // Error desde el ML (4xx o 5xx)
    if (error.response?.status === 422) {
      return res.status(400).json({
        error: true,
        mensaje: 'Datos de entrada inválidos para el modelo ML',
        detalle: error.response.data?.detail,
        codigo: 'VALIDATION_ERROR'
      });
    }

    return res.status(500).json({
      error: true,
      mensaje:
        error.response?.data?.detail ||
        error.message ||
        'Error interno comunicando con IA',
      codigo: error.code || 'UNKNOWN'
    });
  }
});

// ======================================================
// 🧪 POST /nutricionapp-api/api/ml/test
// Endpoint de prueba (sin autenticación) para debugging
// ======================================================
router.post('/test', async (req, res) => {
  try {
    console.log('🧪 [ML-TEST] Petición de prueba recibida');
    
    const response = await axios.post(
      `${ML_SERVICE_URL}/prediccion-perfil`,
      req.body,
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000
      }
    );
    
    return res.json({
      success: true,
      data: response.data,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
      detalle: error.response?.data
    });
  }
});

// ======================================================
// GET /nutricionapp-api/api/ml/health
// ======================================================
router.get('/health', async (req, res) => {
  try {
    const inicio = Date.now();
    
    const response = await axios.get(
      `${ML_SERVICE_URL}/health`,
      { timeout: 5000 }
    );
    
    const duracion = Date.now() - inicio;
    
    return res.json({
      ...response.data,
      proxy: {
        ml_service_url: ML_SERVICE_URL,
        response_time_ms: duracion,
        status: 'connected'
      }
    });

  } catch (error) {
    console.error(' [ML-HEALTH] Error:', error.message);

    return res.status(503).json({
      status: 'unavailable',
      message: 'ML service offline',
      error: error.message,
      code: error.code,
      ml_service_url: ML_SERVICE_URL
    });
  }
});

// ======================================================
// 🔧 FUNCIÓN AUXILIAR: Estimar riesgo hormonal (solo para logs)
// ======================================================
function calcularRiesgoHormonalEstimado(data) {
  if (data.genero === 'M') {
    if (data.edad > 45 && data.imc > 30 && data.hba1c > 8.0) {
      return 'ALTO (posible testosterona baja)';
    }
  } else if (data.genero === 'F') {
    if (data.edad > 35 && data.imc > 30 && data.cintura > 88) {
      return 'ALTO (posible SOP)';
    }
  }
  return 'BAJO';
}

module.exports = router;