// routes/fatsecret.js - VERSIÓN CON SQLITE USDA
const express = require('express');
const router = express.Router();
const oauth = require('oauth-1.0a');
const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

console.log('✅ [ROUTER] Cargando fatsecret.js (con SQLite USDA)');

// ============================================================================
// CONFIGURACIÓN
// ============================================================================
const FATSECRET_CONFIG = {
  consumer_key: process.env.FATSECRET_CONSUMER_KEY || '',
  consumer_secret: process.env.FATSECRET_CONSUMER_SECRET || '',
  api_base: 'https://platform.fatsecret.com/rest/server.api'
};

// Cargar base de datos USDA SQLite
let usdaDb = null;
try {
  const dbPath = path.join(__dirname, '../data/usda_foods.db');
  if (fs.existsSync(dbPath)) {
    usdaDb = new Database(dbPath, { readonly: true });
    usdaDb.pragma('journal_mode = WAL');
    usdaDb.pragma('cache_size = -64000');
    const totalFoods = usdaDb.prepare('SELECT COUNT(*) as count FROM foods').get().count;
    console.log(`✅ [USDA-SQLite] Base de datos cargada: ${totalFoods.toLocaleString()} alimentos`);
  } else {
    console.warn(`⚠️ [USDA-SQLite] DB no encontrada en: ${dbPath}`);
  }
} catch (e) {
  console.error('❌ [USDA-SQLite] Error cargando:', e.message);
}

if (!FATSECRET_CONFIG.consumer_key || !FATSECRET_CONFIG.consumer_secret) {
  console.warn('⚠️ [FATSECRET] Credenciales NO configuradas. Usando fallback USDA.');
}

// Cliente OAuth
const oauthClient = oauth({
  consumer: {
    key: FATSECRET_CONFIG.consumer_key,
    secret: FATSECRET_CONFIG.consumer_secret
  },
  signature_method: 'HMAC-SHA1',
  hash_function: function(baseString, key) {
    return crypto.createHmac('sha1', key).update(baseString).digest('base64');
  }
});

// ============================================================================
// DICCIONARIO DE TRADUCCIÓN ESPAÑOL → INGLÉS
// ============================================================================
const SPANISH_TO_ENGLISH = {
  'pollo': 'chicken', 'pechuga': 'chicken breast', 'pavo': 'turkey',
  'carne': 'beef', 'res': 'beef', 'cerdo': 'pork', 'pescado': 'fish',
  'atún': 'tuna', 'salmón': 'salmon', 'merluza': 'cod',
  'pescado blanco': 'white fish', 'camarones': 'shrimp',
  'huevo': 'egg', 'huevos': 'eggs', 'leche': 'milk',
  'yogur': 'yogurt', 'yogurt': 'yogurt', 'yogur natural': 'plain yogurt',
  'queso': 'cheese', 'requesón': 'cottage cheese',
  'arroz': 'rice', 'arroz blanco': 'white rice', 'arroz integral': 'brown rice',
  'avena': 'oatmeal', 'avena en hojuelas': 'rolled oats',
  'pan': 'bread', 'pan integral': 'whole wheat bread', 'pan blanco': 'white bread',
  'pasta': 'pasta', 'quinoa': 'quinoa', 'frijoles': 'beans',
  'lentejas': 'lentils', 'garbanzos': 'chickpeas',
  'verduras': 'vegetables', 'ensalada': 'salad', 'lechuga': 'lettuce',
  'espinaca': 'spinach', 'espinacas': 'spinach', 'brócoli': 'broccoli',
  'zanahoria': 'carrot', 'tomate': 'tomato', 'pepino': 'cucumber',
  'pimiento': 'bell pepper', 'cebolla': 'onion', 'ajo': 'garlic',
  'aguacate': 'avocado', 'palta': 'avocado', 'champiñón': 'mushroom',
  'manzana': 'apple', 'banana': 'banana', 'plátano': 'banana',
  'naranja': 'orange', 'fresa': 'strawberry', 'uva': 'grape',
  'piña': 'pineapple', 'mango': 'mango', 'papaya': 'papaya',
  'sandía': 'watermelon', 'melón': 'melon', 'pera': 'pear',
  'aceite': 'oil', 'aceite de oliva': 'olive oil', 'mantequilla': 'butter',
  'agua': 'water', 'café': 'coffee', 'té': 'tea',
  'tofu': 'tofu', 'almendras': 'almonds', 'nueces': 'walnuts',
  'maní': 'peanuts', 'cacahuate': 'peanuts', 'papa': 'potato',
  'camote': 'sweet potato', 'yuca': 'cassava', 'choclo': 'corn',
  'chía': 'chia seeds', 'linaza': 'flaxseed'
};

// ============================================================================
// 🔍 BÚSQUEDA EN SQLITE USDA
// ============================================================================
function searchUsdaFoods(query, maxResults = 20) {
  if (!usdaDb) return [];
  
  const queryLower = query.toLowerCase().trim();
  const translated = SPANISH_TO_ENGLISH[queryLower] || queryLower;
  
  const sql = `
    SELECT 
      f.fdc_id,
      f.name,
      f.data_type,
      COALESCE(SUM(CASE WHEN fn.nutrient_id = 1008 THEN fn.amount END), 0) as calories,
      COALESCE(SUM(CASE WHEN fn.nutrient_id = 1003 THEN fn.amount END), 0) as protein,
      COALESCE(SUM(CASE WHEN fn.nutrient_id = 1004 THEN fn.amount END), 0) as fat,
      COALESCE(SUM(CASE WHEN fn.nutrient_id = 1005 THEN fn.amount END), 0) as carbs,
      COALESCE(SUM(CASE WHEN fn.nutrient_id = 1079 THEN fn.amount END), 0) as fiber,
      COALESCE(SUM(CASE WHEN fn.nutrient_id = 1087 THEN fn.amount END), 0) as sodium,
      COALESCE(SUM(CASE WHEN fn.nutrient_id = 1090 THEN fn.amount END), 0) as sugars
    FROM foods f
    LEFT JOIN food_nutrients fn ON f.fdc_id = fn.fdc_id
    WHERE LOWER(f.name) LIKE ? OR LOWER(f.name) LIKE ?
    GROUP BY f.fdc_id
    HAVING calories > 0
    ORDER BY 
      CASE 
        WHEN LOWER(f.name) = ? THEN 0
        WHEN LOWER(f.name) LIKE ? THEN 1
        ELSE 2
      END,
      calories DESC
    LIMIT ?
  `;
  
  try {
    const results = usdaDb.prepare(sql).all(
      `%${translated}%`,
      `%${queryLower}%`,
      translated,
      `${translated}%`,
      maxResults
    );
    
    return results.map(food => ({
      food_id: `usda_${food.fdc_id}`,
      name: capitalizeFirst(food.name.toLowerCase()),
      brand: '',
      serving_size: 100,
      serving_unit: 'g',
      calories: round2(food.calories),
      protein: round2(food.protein),
      carbs: round2(food.carbs),
      fat: round2(food.fat),
      fiber: round2(food.fiber),
      sodium: round2(food.sodium),
      sugars: round2(food.sugars),
      image_url: '',
      fatsecret_id: `usda_${food.fdc_id}`,
      source: food.data_type === 'sr_legacy' ? 'usda_sr_legacy' : 'usda_foundation'
    }));
  } catch (e) {
    console.error('❌ [USDA-SQLite] Error en búsqueda:', e.message);
    return [];
  }
}

function capitalizeFirst(str) {
  return str.split(' ').map(word => 
    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  ).join(' ');
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ============================================================================
// ENDPOINTS
// ============================================================================

// 🔐 Health check
router.get('/health', function(req, res) {
  return res.json({
    status: (FATSECRET_CONFIG.consumer_key && FATSECRET_CONFIG.consumer_secret) ? 'configured' : 'not_configured',
    api_base: FATSECRET_CONFIG.api_base,
    oauth_method: 'HMAC-SHA1',
    usda_sqlite: usdaDb ? 'enabled' : 'disabled',
    usda_total_foods: usdaDb ? usdaDb.prepare('SELECT COUNT(*) as count FROM foods').get().count : 0
  });
});

// 🔍 Buscar alimentos
router.post('/search', async function(req, res) {
  const { query, max_results = 10 } = req.body;

  if (!query || query.trim().length < 2) {
    return res.status(400).json({ 
      error: true, 
      mensaje: 'query es requerido (mínimo 2 caracteres)' 
    });
  }

  // 1️⃣ Intentar FatSecret API
  if (FATSECRET_CONFIG.consumer_key && FATSECRET_CONFIG.consumer_secret) {
    try {
      const requestData = {
        url: FATSECRET_CONFIG.api_base,
        method: 'GET',
        data: {
          method: 'foods.search',
          search_expression: query.trim(),
          max_results: max_results.toString(),
          format: 'json'
        }
      };

      const signed = oauthClient.authorize(requestData, { token: '', key: '' });
      const authHeader = oauthClient.toHeader(signed);
      
      const apiParams = {
        method: requestData.data.method,
        search_expression: requestData.data.search_expression,
        max_results: requestData.data.max_results,
        format: requestData.data.format
      };
      
      const queryString = Object.keys(apiParams)
        .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(String(apiParams[key])))
        .join('&');
      const fullUrl = requestData.url + '?' + queryString;

      const response = await axios.get(fullUrl, {
        headers: { 'Authorization': authHeader.Authorization },
        timeout: 30000,
        family: 4
      });

      const foods = response.data?.foods?.food || [];
      
      if (foods.length > 0) {
        const alimentos = foods
          .filter(f => f.calories > 0)
          .map(f => ({
            food_id: f.food_id,
            name: f.food_name,
            brand: f.brand_name,
            serving_size: f.serving_size,
            serving_unit: f.serving_unit,
            calories: f.calories,
            protein: f.protein_g,
            carbs: f.carbohydrate_g,
            fat: f.total_fat_g,
            fiber: f.fiber_g,
            image_url: f.image_url,
            fatsecret_id: f.food_id,
            source: 'fatsecret'
          }));

        console.log(`✅ [FATSECRET] ${alimentos.length} alimentos para "${query}"`);
        return res.json({
          error: false,
          query: query,
          total: alimentos.length,
          alimentos: alimentos
        });
      }
    } catch (err) {
      console.warn('⚠️ [FATSECRET] Error, intentando USDA:', err.message);
    }
  }

  // 2️⃣ NUEVO: Buscar en SQLite de USDA
  if (usdaDb) {
    console.log(`🔍 [USDA-SQLite] Buscando "${query}"...`);
    const usdaResults = searchUsdaFoods(query, max_results);
    
    if (usdaResults.length > 0) {
      console.log(`✅ [USDA-SQLite] ${usdaResults.length} alimentos encontrados`);
      return res.json({
        error: false,
        query: query,
        total: usdaResults.length,
        alimentos: usdaResults,
        source: 'usda_sqlite'
      });
    }
  }

  // 3️⃣ Fallback final: mockDB
  console.log(`⚠️ [FALLBACK] Usando mockDB para "${query}"`);
  return res.json({
    error: false,
    query: query,
    total: getMockFoods(query, max_results).length,
    alimentos: getMockFoods(query, max_results),
    source: 'mockdb'
  });
});

// ============================================================================
// 🎭 FALLBACK: MOCKDB
// ============================================================================
function getMockFoods(query, maxResults) {
  const queryLower = query.toLowerCase().trim();
  
  let key = Object.keys(mockDB).find(k => queryLower === k);
  if (!key) {
    key = Object.keys(mockDB).find(k => queryLower.includes(k) || k.includes(queryLower));
  }
  if (!key && SPANISH_TO_ENGLISH[queryLower]) {
    const translated = SPANISH_TO_ENGLISH[queryLower];
    key = Object.keys(mockDB).find(k => translated.includes(k) || k.includes(translated));
  }
  
  if (key && mockDB[key]) {
    return mockDB[key].slice(0, maxResults).map(f => ({ ...f, fatsecret_id: f.food_id }));
  }
  
  return mockDB['vegetables'].slice(0, maxResults).map(f => ({ ...f, fatsecret_id: f.food_id }));
}

const mockDB = {
  'pollo': [
    { food_id: 'mock_pollo_1', name: 'Pechuga de pollo a la plancha', brand: '', serving_size: 100, serving_unit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6, fiber: 0, image_url: '' },
    { food_id: 'mock_pollo_2', name: 'Pollo guisado casero', brand: '', serving_size: 100, serving_unit: 'g', calories: 190, protein: 25, carbs: 5, fat: 8, fiber: 1, image_url: '' }
  ],
  'huevo': [
    { food_id: 'mock_huevo_1', name: 'Huevo de gallina cocido', brand: '', serving_size: 50, serving_unit: 'unidad', calories: 78, protein: 6.3, carbs: 0.6, fat: 5.3, fiber: 0, image_url: '' }
  ],
  'arroz': [
    { food_id: 'mock_arroz_1', name: 'Arroz blanco cocido', brand: '', serving_size: 100, serving_unit: 'g', calories: 130, protein: 2.7, carbs: 28, fat: 0.3, fiber: 0.4, image_url: '' }
  ],
  'avena': [
    { food_id: 'mock_avena_1', name: 'Avena en hojuelas', brand: 'Quaker', serving_size: 40, serving_unit: 'g', calories: 150, protein: 5, carbs: 27, fat: 3, fiber: 4, image_url: '' }
  ],
  'pan': [
    { food_id: 'mock_pan_1', name: 'Pan integral de trigo', brand: '', serving_size: 30, serving_unit: 'rebanada', calories: 80, protein: 4, carbs: 15, fat: 1, fiber: 2, image_url: '' }
  ],
  'vegetables': [
    { food_id: 'mock_veg_1', name: 'Brócoli cocido', brand: '', serving_size: 100, serving_unit: 'g', calories: 35, protein: 2.4, carbs: 7, fat: 0.4, fiber: 3.3, image_url: '' },
    { food_id: 'mock_veg_2', name: 'Zanahoria cocida', brand: '', serving_size: 100, serving_unit: 'g', calories: 35, protein: 0.8, carbs: 8, fat: 0.2, fiber: 2.8, image_url: '' }
  ]
};

console.log('✅ [ROUTER] fatsecret.js cargado con SQLite USDA');
module.exports = router;