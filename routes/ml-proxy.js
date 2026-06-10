const express = require('express');
const router = express.Router();
const axios = require('axios');
const { verificarToken } = require('../middleware/auth');

// URL del microservicio
const ML_SERVICE_URL =
  process.env.ML_SERVICE_URL || 'http://app-nutricion-microservicionutri-8wzlez:8001';

console.log('🤖 ML_SERVICE_URL:', ML_SERVICE_URL);

// ======================================================
// POST /nutricionapp-api/api/ml/prediccion-perfil
// ======================================================
router.post('/prediccion-perfil', verificarToken, async (req, res) => {
  try {
    console.log('📤 Enviando petición al microservicio...');
    console.log('📍 URL:', `${ML_SERVICE_URL}/prediccion-perfil`);
    console.log('📦 Payload:', req.body);

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

    console.log('✅ Respuesta recibida del microservicio');

    return res.status(200).json(response.data);

  } catch (error) {

    console.error('\n❌ ERROR PROXY ML');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('Mensaje:', error.message);
    console.error('Código:', error.code);

    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    }

    console.error('URL usada:', `${ML_SERVICE_URL}/prediccion-perfil`);
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    if (error.code === 'ECONNREFUSED') {
      return res.status(503).json({
        error: true,
        mensaje: 'Servicio de IA no disponible',
        codigo: error.code
      });
    }

    if (error.code === 'ENOTFOUND') {
      return res.status(503).json({
        error: true,
        mensaje: 'No se pudo resolver el dominio del microservicio',
        codigo: error.code
      });
    }

    if (error.code === 'ETIMEDOUT') {
      return res.status(504).json({
        error: true,
        mensaje: 'Tiempo de espera agotado al conectar con IA',
        codigo: error.code
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
// GET /nutricionapp-api/api/ml/health
// ======================================================
router.get('/health', async (req, res) => {
  try {

    console.log('🔥 ML HEALTH usando:', ML_SERVICE_URL);

    const response = await axios.get(
      `${ML_SERVICE_URL}/health`,
      { timeout: 5000 }
    );

    return res.json(response.data);

  } catch (error) {

    console.error('🔥 ML HEALTH usando:', ML_SERVICE_URL);
    console.error(error.message);

    return res.status(503).json({
      status: 'unavailable',
      message: 'ML service offline',
      error: error.message,
      code: error.code
    });
  }
});
module.exports = router;