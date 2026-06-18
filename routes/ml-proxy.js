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

  if (body.edad === undefined || body.edad === null)
    errores.push('edad es requerido');

  if (!body.genero)
    errores.push('genero es requerido');

  if (body.peso_kg === undefined || body.peso_kg === null)
    errores.push('peso_kg es requerido');

  if (body.talla_cm === undefined || body.talla_cm === null)
    errores.push('talla_cm es requerido');

  if (body.imc === undefined || body.imc === null)
    errores.push('imc es requerido');

  if (
    body.tiene_diabetes === undefined ||
    body.tiene_diabetes === null
  )
    errores.push('tiene_diabetes es requerido');

  if (body.edad < 18 || body.edad > 120)
    errores.push('edad debe estar entre 18 y 120');

  if (!['M', 'F'].includes(body.genero))
    errores.push('genero debe ser M o F');

  if (body.peso_kg < 20 || body.peso_kg > 300)
    errores.push('peso_kg debe estar entre 20 y 300');

  if (body.talla_cm < 100 || body.talla_cm > 250)
    errores.push('talla_cm debe estar entre 100 y 250');

  if (body.imc < 10 || body.imc > 80)
    errores.push('imc debe estar entre 10 y 80');

  if (![0, 1].includes(body.tiene_diabetes))
    errores.push('tiene_diabetes debe ser 0 o 1');

  return errores;
}

// ======================================================
// POST /nutricionapp-api/api/ml/prediccion-perfil
// ======================================================
router.post(
  '/prediccion-perfil',
  verificarToken,
  async (req, res) => {
    const inicioTiempo = Date.now();

    try {
      console.log('\n📤 [ML-PROXY] Predicción recibida');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(
        'Usuario:',
        req.usuario?.correo || req.usuario?.id
      );

      console.log(
        'Payload:',
        JSON.stringify(req.body, null, 2)
      );

      const errores = validarPayloadML(req.body);

      if (errores.length > 0) {
        return res.status(400).json({
          error: true,
          mensaje: 'Datos inválidos',
          errores
        });
      }

      const payloadML = {
        edad: req.body.edad,
        genero: req.body.genero,
        peso_kg: req.body.peso_kg,
        talla_cm: req.body.talla_cm,
        imc: req.body.imc,
        tiene_diabetes: req.body.tiene_diabetes
      };

      const response = await axios.post(
        `${ML_SERVICE_URL}/prediccion-perfil`,
        payloadML,
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 15000
        }
      );

      const duracion = Date.now() - inicioTiempo;

      console.log('✅ Respuesta ML');
      console.log(
        'Perfil:',
        response.data.perfil_nombre
      );

      console.log(
        'Confianza:',
        (response.data.confianza * 100).toFixed(2) + '%'
      );

      console.log(`⏱️ ${duracion}ms`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      return res.status(200).json(response.data);

    } catch (error) {

      const duracion = Date.now() - inicioTiempo;

      console.error('\n❌ ERROR ML');
      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.error('Mensaje:', error.message);
      console.error('Código:', error.code);
      console.error(`⏱️ ${duracion}ms`);

      if (error.response) {
        console.error(
          'Status:',
          error.response.status
        );

        console.error(
          'Detalle:',
          error.response.data
        );
      }

      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      if (error.code === 'ECONNREFUSED') {
        return res.status(503).json({
          error: true,
          mensaje: 'Servicio ML no disponible',
          codigo: 'ECONNREFUSED'
        });
      }

      if (error.code === 'ENOTFOUND') {
        return res.status(503).json({
          error: true,
          mensaje:
            'No se pudo resolver el host del servicio ML',
          codigo: 'ENOTFOUND'
        });
      }

      if (
        error.code === 'ETIMEDOUT' ||
        error.code === 'ECONNABORTED'
      ) {
        return res.status(504).json({
          error: true,
          mensaje:
            'Tiempo de espera agotado para el servicio ML',
          codigo: error.code
        });
      }

      if (error.response?.status === 422) {
        return res.status(400).json({
          error: true,
          mensaje:
            'Datos inválidos enviados al modelo',
          detalle: error.response.data,
          codigo: 'VALIDATION_ERROR'
        });
      }

      return res.status(500).json({
        error: true,
        mensaje:
          error.response?.data?.detail ||
          error.message ||
          'Error interno',
        codigo: error.code || 'UNKNOWN'
      });
    }
  }
);
// ======================================================
// 🧪 POST /nutricionapp-api/api/ml/test
// Endpoint de prueba (sin autenticación) para debugging
// ======================================================
router.post('/test', async (req, res) => {
  try {

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
      {
        timeout: 5000
      }
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

    return res.status(503).json({
      status: 'unavailable',
      message: 'ML service offline',
      error: error.message,
      code: error.code,
      ml_service_url: ML_SERVICE_URL
    });

  }
});

module.exports = router;