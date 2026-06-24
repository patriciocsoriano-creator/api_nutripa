const express = require('express');
const router = express.Router();
const axios = require('axios');
const { verificarToken } = require('../middleware/auth');

const ML_SERVICE_URL =
  process.env.ML_SERVICE_URL || 'http://app-nutricion-microservicionutri-8wzlez:8001';

console.log(' ML_SERVICE_URL:', ML_SERVICE_URL);

// ======================================================
//  FUNCIÓN: Normalizar datos del frontend
// ======================================================
function normalizarPayload(body) {
  const datos = { ...body };
  
  // Normalizar género (acepta M, F, m, f, Masculino, Femenino, etc.)
  if (datos.genero) {
    const generoUpper = String(datos.genero).toUpperCase().trim();
    if (['M', 'MASCULINO', 'MALE', 'HOMBRE'].includes(generoUpper)) {
      datos.genero = 'M';
    } else if (['F', 'FEMENINO', 'FEMALE', 'MUJER'].includes(generoUpper)) {
      datos.genero = 'F';
    }
  }
  
  // Normalizar tiene_diabetes (acepta boolean, string "si/no", número)
  if (datos.tiene_diabetes === undefined && datos.diabetes !== undefined) {
    datos.tiene_diabetes = datos.diabetes;
  }
  if (datos.tieneDiabetes !== undefined && datos.tiene_diabetes === undefined) {
    datos.tiene_diabetes = datos.tieneDiabetes;
  }
  
  // Convertir boolean a número
  if (typeof datos.tiene_diabetes === 'boolean') {
    datos.tiene_diabetes = datos.tiene_diabetes ? 1 : 0;
  } else if (typeof datos.tiene_diabetes === 'string') {
    const val = datos.tiene_diabetes.toLowerCase().trim();
    if (['si', 'sí', 'true', '1', 'yes'].includes(val)) {
      datos.tiene_diabetes = 1;
    } else {
      datos.tiene_diabetes = 0;
    }
  }
  
  // Normalizar nombres de campos (acepta peso, peso_kg, pesoKg, etc.)
  if (datos.peso_kg === undefined) {
    if (datos.peso !== undefined) datos.peso_kg = datos.peso;
    else if (datos.pesoKg !== undefined) datos.peso_kg = datos.pesoKg;
    else if (datos.pesokg !== undefined) datos.peso_kg = datos.pesokg;
  }
  
  if (datos.talla_cm === undefined) {
    if (datos.talla !== undefined) datos.talla_cm = datos.talla;
    else if (datos.tallaCm !== undefined) datos.talla_cm = datos.tallaCm;
    else if (datos.tallacm !== undefined) datos.talla_cm = datos.tallacm;
    else if (datos.estatura !== undefined) datos.talla_cm = datos.estatura;
  }
  
  // Convertir strings a números
  if (typeof datos.edad === 'string') datos.edad = parseInt(datos.edad);
  if (typeof datos.peso_kg === 'string') datos.peso_kg = parseFloat(datos.peso_kg);
  if (typeof datos.talla_cm === 'string') datos.talla_cm = parseFloat(datos.talla_cm);
  if (typeof datos.imc === 'string') datos.imc = parseFloat(datos.imc);
  if (typeof datos.tiene_diabetes === 'string') datos.tiene_diabetes = parseInt(datos.tiene_diabetes);
  
  // Calcular IMC si no viene pero sí peso y talla
  if (!datos.imc && datos.peso_kg && datos.talla_cm) {
    const tallaM = datos.talla_cm / 100;
    datos.imc = parseFloat((datos.peso_kg / (tallaM * tallaM)).toFixed(2));
  }
  
  return datos;
}

// ======================================================
//  FUNCIÓN: Validar payload normalizado
// ======================================================
function validarPayloadML(body) {
  const errores = [];

  if (body.edad === undefined || body.edad === null || isNaN(body.edad))
    errores.push('edad es requerido y debe ser número');
  else if (body.edad < 18 || body.edad > 120)
    errores.push('edad debe estar entre 18 y 120');

  if (!body.genero || !['M', 'F'].includes(body.genero))
    errores.push('genero debe ser M o F');

  if (body.peso_kg === undefined || body.peso_kg === null || isNaN(body.peso_kg))
    errores.push('peso_kg es requerido y debe ser número');
  else if (body.peso_kg < 20 || body.peso_kg > 300)
    errores.push('peso_kg debe estar entre 20 y 300');

  if (body.talla_cm === undefined || body.talla_cm === null || isNaN(body.talla_cm))
    errores.push('talla_cm es requerido y debe ser número');
  else if (body.talla_cm < 100 || body.talla_cm > 250)
    errores.push('talla_cm debe estar entre 100 y 250');

  if (body.imc === undefined || body.imc === null || isNaN(body.imc))
    errores.push('imc es requerido y debe ser número');
  else if (body.imc < 10 || body.imc > 80)
    errores.push('imc debe estar entre 10 y 80');

  if (body.tiene_diabetes === undefined || body.tiene_diabetes === null)
    errores.push('tiene_diabetes es requerido');
  else if (![0, 1].includes(body.tiene_diabetes))
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
      console.log('\n [ML-PROXY] Predicción recibida');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('Usuario:', req.usuario?.correo || req.usuario?.id);
      console.log(' Payload ORIGINAL del frontend:');
      console.log(JSON.stringify(req.body, null, 2));

      //  NORMALIZAR DATOS
      const datosNormalizados = normalizarPayload(req.body);
      
      console.log('\n Payload NORMALIZADO:');
      console.log(JSON.stringify(datosNormalizados, null, 2));

      //  VALIDAR
      const errores = validarPayloadML(datosNormalizados);

      if (errores.length > 0) {
        console.error(' Errores de validación:', errores);
        return res.status(400).json({
          error: true,
          mensaje: 'Datos inválidos',
          errores,
          payload_recibido: req.body,
          payload_normalizado: datosNormalizados
        });
      }

      //  ENVIAR AL MICROSERVICIO ML
      const payloadML = {
        edad: datosNormalizados.edad,
        genero: datosNormalizados.genero,
        peso_kg: datosNormalizados.peso_kg,
        talla_cm: datosNormalizados.talla_cm,
        imc: datosNormalizados.imc,
        tiene_diabetes: datosNormalizados.tiene_diabetes
      };

      console.log('\n Enviando a ML Service:', JSON.stringify(payloadML));

      const response = await axios.post(
        `${ML_SERVICE_URL}/prediccion-perfil`,
        payloadML,
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 15000
        }
      );

      const duracion = Date.now() - inicioTiempo;

      console.log('\n Respuesta ML exitosa');
      console.log('Perfil:', response.data.perfil_nombre);
      console.log('Confianza:', (response.data.confianza * 100).toFixed(2) + '%');
      console.log(` ${duracion}ms`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      return res.status(200).json(response.data);

    } catch (error) {
      const duracion = Date.now() - inicioTiempo;

      console.error('\n ERROR ML');
      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.error('Mensaje:', error.message);
      console.error('Código:', error.code);
      console.error(` ${duracion}ms`);

      if (error.response) {
        console.error('Status:', error.response.status);
        console.error('Detalle:', JSON.stringify(error.response.data, null, 2));
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
          mensaje: 'No se pudo resolver el host del servicio ML',
          codigo: 'ENOTFOUND'
        });
      }

      if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
        return res.status(504).json({
          error: true,
          mensaje: 'Tiempo de espera agotado para el servicio ML',
          codigo: error.code
        });
      }

      if (error.response?.status === 422 || error.response?.status === 400) {
        return res.status(400).json({
          error: true,
          mensaje: 'Datos inválidos enviados al modelo',
          detalle: error.response.data,
          codigo: 'VALIDATION_ERROR',
          payload_enviado: req.body
        });
      }

      return res.status(500).json({
        error: true,
        mensaje: error.response?.data?.detail || error.message || 'Error interno',
        codigo: error.code || 'UNKNOWN'
      });
    }
  }
);

// ======================================================
//  POST /nutricionapp-api/api/ml/test
// ======================================================
router.post('/test', async (req, res) => {
  try {
    console.log('\n [TEST] Payload recibido:');
    console.log(JSON.stringify(req.body, null, 2));
    
    const datosNormalizados = normalizarPayload(req.body);
    console.log('\n Payload normalizado:');
    console.log(JSON.stringify(datosNormalizados, null, 2));

    const payloadML = {
      edad: datosNormalizados.edad,
      genero: datosNormalizados.genero,
      peso_kg: datosNormalizados.peso_kg,
      talla_cm: datosNormalizados.talla_cm,
      imc: datosNormalizados.imc,
      tiene_diabetes: datosNormalizados.tiene_diabetes
    };

    const response = await axios.post(
      `${ML_SERVICE_URL}/prediccion-perfil`,
      payloadML,
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
    console.error(' Error en test:', error.response?.data || error.message);
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
    const response = await axios.get(`${ML_SERVICE_URL}/health`, { timeout: 5000 });
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