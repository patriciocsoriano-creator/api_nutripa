const express = require('express');
const router = express.Router();
const axios = require('axios');
const { verificarToken } = require('../middleware/auth');

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://microservicio.72.61.11.127.nip.io';

// POST /api/ml/prediccion-perfil
router.post('/prediccion-perfil', verificarToken, async (req, res) => {
  try {
    const response = await axios.post(
      `${ML_SERVICE_URL}/prediccion-perfil`,
      req.body,
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000 // 10 segundos máximo
      }
    );
    
    res.json(response.data);
  } catch (error) {
    console.error('❌ Error proxy ML:', error.message);
    
    if (error.code === 'ECONNREFUSED') {
      return res.status(503).json({ 
        error: true, 
        mensaje: 'Servicio de IA no disponible. Intente más tarde.' 
      });
    }
    
    res.status(500).json({ 
      error: true, 
      mensaje: error.response?.data?.detail || 'Error al procesar predicción' 
    });
  }
});

// GET /api/ml/health
router.get('/health', async (req, res) => {
  try {
    const response = await axios.get(`${ML_SERVICE_URL}/health`, { timeout: 5000 });
    res.json(response.data);
  } catch {
    res.status(503).json({ status: 'unavailable', message: 'ML service offline' });
  }
});

module.exports = router;