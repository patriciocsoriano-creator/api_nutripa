// routes/fatsecret.js - VERSIÓN MEJORADA CON JSON LOCAL USDA + TRADUCCIÓN
const express = require('express');
const router = express.Router();
const oauth = require('oauth-1.0a');
const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

console.log('✅ [ROUTER] Cargando fatsecret.js (Proxy OAuth 1.0a + Fallback USDA)');

// ============================================================================
// CONFIGURACIÓN
// ============================================================================
const FATSECRET_CONFIG = {
  consumer_key: process.env.FATSECRET_CONSUMER_KEY || '',
  consumer_secret: process.env.FATSECRET_CONSUMER_SECRET || '',
  api_base: 'https://platform.fatsecret.com/rest/server.api'
};

// Cargar JSON local de USDA (fallback secundario)
let usdaFoodData = [];
try {
  const usdaPath = path.join(__dirname, '../data/food_db.json');
  if (fs.existsSync(usdaPath)) {
    usdaFoodData = require(usdaPath);
    console.log(`✅ [USDA] Fallback local cargado: ${usdaFoodData.length} alimentos`);
  }
} catch (e) {
  console.log('⚠️ [USDA] No se encontró data/food_db.json, se usará mockDB como fallback');
}

if (!FATSECRET_CONFIG.consumer_key || !FATSECRET_CONFIG.consumer_secret) {
  console.warn('⚠️ [FATSECRET] Credenciales NO configuradas. Usando fallback local.');
}

// Cliente OAuth para FatSecret
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
// DICCIONARIO DE TRADUCCIÓN ESPAÑOL → INGLÉS (para USDA JSON)
// ============================================================================
const SPANISH_TO_ENGLISH = {
  // Proteínas
  'pollo': 'chicken',
  'pechuga': 'chicken breast',
  'pavo': 'turkey',
  'carne': 'beef',
  'res': 'beef',
  'cerdo': 'pork',
  'pescado': 'fish',
  'atún': 'tuna',
  'salmón': 'salmon',
  'merluza': 'cod',
  'pescado blanco': 'white fish',
  'mariscos': 'seafood',
  'camarones': 'shrimp',
  'huevo': 'egg',
  'huevos': 'eggs',
  
  // Lácteos
  'leche': 'milk',
  'yogur': 'yogurt',
  'yogurt': 'yogurt',
  'yogur natural': 'plain yogurt',
  'queso': 'cheese',
  'requesón': 'cottage cheese',
  'fresco': 'fresco cheese',
  'oaxaca': 'oaxaca cheese',
  'cotija': 'cotija cheese',
  
  // Cereales y granos
  'arroz': 'rice',
  'arroz blanco': 'white rice',
  'arroz integral': 'brown rice',
  'avena': 'oatmeal',
  'avena en hojuelas': 'rolled oats',
  'pan': 'bread',
  'pan integral': 'whole wheat bread',
  'pan blanco': 'white bread',
  'tortilla': 'tortilla',
  'pasta': 'pasta',
  'fideos': 'noodles',
  'quinoa': 'quinoa',
  'cebada': 'barley',
  
  // Legumbres
  'frijoles': 'beans',
  'lentejas': 'lentils',
  'garbanzos': 'chickpeas',
  'habas': 'fava beans',
  
  // Verduras
  'verduras': 'vegetables',
  'vegetales': 'vegetables',
  'ensalada': 'salad',
  'lechuga': 'lettuce',
  'espinaca': 'spinach',
  'espinacas': 'spinach',
  'brócoli': 'broccoli',
  'coliflor': 'cauliflower',
  'zanahoria': 'carrot',
  'tomate': 'tomato',
  'tomates': 'tomatoes',
  'pepino': 'cucumber',
  'pimiento': 'bell pepper',
  'cebolla': 'onion',
  'ajo': 'garlic',
  'aguacate': 'avocado',
  'palta': 'avocado',
  'champiñón': 'mushroom',
  'hongos': 'mushroom',
  'rábano': 'radish',
  'nabo': 'parsnip',
  'remolacha': 'beet',
  'tomatillo': 'tomatillo',
  
  // Frutas
  'manzana': 'apple',
  'banana': 'banana',
  'plátano': 'banana',
  'naranja': 'orange',
  'fresa': 'strawberry',
  'fresas': 'strawberries',
  'uva': 'grape',
  'uvas': 'grapes',
  'piña': 'pineapple',
  'mango': 'mango',
  'papaya': 'papaya',
  'sandía': 'watermelon',
  'melón': 'melon',
  'cereza': 'cherry',
  'cereza dulce': 'sweet cherry',
  'mora': 'blackberry',
  'frambuesa': 'raspberry',
  'arándano': 'blueberry',
  'albaricoque': 'apricot',
  'pera': 'pear',
  
  // Grasas y aceites
  'aceite': 'oil',
  'aceite de oliva': 'olive oil',
  'aceite de coco': 'coconut oil',
  'aceite de girasol': 'sunflower oil',
  'aceite de maíz': 'corn oil',
  'aceite de soya': 'soybean oil',
  'aceite de canola': 'canola oil',
  'aceite de maní': 'peanut oil',
  'mantequilla': 'butter',
  'margarina': 'margarine',
  
  // Bebidas
  'agua': 'water',
  'jugo': 'juice',
  'jugo de naranja': 'orange juice',
  'jugo de manzana': 'apple juice',
  'café': 'coffee',
  'té': 'tea',
  'leche de avena': 'oat milk',
  
  // Snacks y otros
  'sopa': 'soup',
  'tofu': 'tofu',
  'nueces': 'nuts',
  'almendras': 'almonds',
  'maní': 'peanuts',
  'cacahuate': 'peanuts',
  'nuez de brasil': 'brazil nut',
  'galleta': 'cookie',
  'galleta de avena': 'oatmeal cookie',
  'pan de molde': 'white bread',
  'mostaza': 'mustard',
  'salsa': 'sauce'
};

// ============================================================================
// HELPERS PARA PROCESAR DATOS DE USDA
// ============================================================================

/**
 * Extrae un nutriente específico del array foodNutrients de USDA
 * IDs comunes: 1008=Energía, 1003=Proteína, 1005=Carbohidratos, 1004=Grasa, 1079=Fibra, 1087=Sodio
 */
function getUsdaNutrient(food, nutrientId) {
  if (!food.foodNutrients || !Array.isArray(food.foodNutrients)) return 0;
  const nutrient = food.foodNutrients.find(n => n.nutrient?.id === nutrientId);
  return nutrient ? parseFloat(nutrient.amount) || 0 : 0;
}

/**
 * Mapea un alimento de USDA al formato estándar de la app
 */
function mapUsdaFood(usdaFood) {
  return {
    food_id: `usda_${usdaFood.fdcId || usdaFood.id}`,
    name: usdaFood.foodDescription || usdaFood.description || 'Alimento sin nombre',
    brand: usdaFood.brandOwner || '',
    serving_size: 100, // USDA suele reportar por 100g
    serving_unit: 'g',
    calories: getUsdaNutrient(usdaFood, 1008),
    protein: getUsdaNutrient(usdaFood, 1003),
    carbs: getUsdaNutrient(usdaFood, 1005),
    fat: getUsdaNutrient(usdaFood, 1004),
    fiber: getUsdaNutrient(usdaFood, 1079),
    sodium: getUsdaNutrient(usdaFood, 1087),
    image_url: '', // USDA no incluye imágenes en el JSON base
    fatsecret_id: `usda_${usdaFood.fdcId || usdaFood.id}`,
    source: 'usda_fallback'
  };
}

/**
 * Busca en el JSON local de USDA usando traducción español→inglés
 */
function searchUsdaFoods(query, maxResults) {
  const queryLower = query.toLowerCase().trim();
  
  // 1️⃣ Intentar búsqueda directa en inglés
  let resultados = usdaFoodData.filter(food => 
    food.foodDescription?.toLowerCase().includes(queryLower)
  );
  
  // 2️⃣ Si no hay resultados, intentar con traducción
  if (resultados.length === 0 && SPANISH_TO_ENGLISH[queryLower]) {
    const translated = SPANISH_TO_ENGLISH[queryLower];
    resultados = usdaFoodData.filter(food => 
      food.foodDescription?.toLowerCase().includes(translated.toLowerCase())
    );
  }
  
  // 3️⃣ Búsqueda por palabras clave individuales
  if (resultados.length === 0) {
    const words = queryLower.split(/\s+/).filter(w => w.length >= 3);
    for (const word of words) {
      // Buscar directo
      resultados = usdaFoodData.filter(food => 
        food.foodDescription?.toLowerCase().includes(word)
      );
      if (resultados.length > 0) break;
      
      // Buscar con traducción
      if (SPANISH_TO_ENGLISH[word]) {
        const translated = SPANISH_TO_ENGLISH[word];
        resultados = usdaFoodData.filter(food => 
          food.foodDescription?.toLowerCase().includes(translated.toLowerCase())
        );
        if (resultados.length > 0) break;
      }
    }
  }
  
  // Mapear y retornar
  return resultados
    .slice(0, maxResults)
    .map(mapUsdaFood)
    .filter(f => f.calories > 0); // Solo alimentos con calorías válidas
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
    usda_fallback: usdaFoodData.length > 0 ? 'enabled' : 'disabled'
  });
});

// 🔍 Buscar alimentos en FatSecret (con fallback a USDA y mockDB)
router.post('/search', async function(req, res) {
  const { query, max_results = 10 } = req.body;

  // Si no hay credenciales, usar fallback inmediatamente
  if (!FATSECRET_CONFIG.consumer_key || !FATSECRET_CONFIG.consumer_secret) {
    console.log('⚠️ [FATSECRET] Sin credenciales, usando fallback local');
    return res.json({
      error: false,
      query: query,
      total: getMockFoods(query, max_results).length,
      alimentos: getMockFoods(query, max_results)
    });
  }

  if (!query || query.trim().length < 2) {
    return res.status(400).json({ error: true, mensaje: 'query es requerido (mínimo 2 caracteres)' });
  }

  try {
    // Preparar request para FatSecret
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
    
    console.log('🔍 [FATSECRET] URL:', fullUrl.substring(0, 200) + '...');

    // Timeout aumentado a 30s + configuración DNS explícita
    const response = await axios.get(fullUrl, {
      headers: { 'Authorization': authHeader.Authorization },
      timeout: 30000,
      family: 4,
      validateStatus: function(status) {
        return status >= 200 && status < 300;
      }
    });

    const foods = response.data?.foods?.food || [];
    
    // ✅ CASO 1: FatSecret retornó alimentos reales
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

      console.log(`✅ [FATSECRET] ${alimentos.length} alimentos encontrados para "${query}"`);
      return res.json({
        error: false,
        query: query,
        total: alimentos.length,
        alimentos: alimentos
      });
    }

    // ⚠️ CASO 2: FatSecret retornó 0 → Intentar con JSON local USDA
    if (usdaFoodData.length > 0) {
      console.log(`🔍 [USDA] Buscando fallback local para "${query}"`);
      const usdaResults = searchUsdaFoods(query, max_results);
      
      if (usdaResults.length > 0) {
        console.log(`✅ [USDA] ${usdaResults.length} alimentos encontrados en fallback local`);
        return res.json({
          error: false,
          query: query,
          total: usdaResults.length,
          alimentos: usdaResults
        });
      }
    }

    // ⚠️ CASO 3: USDA también falló → Usar mockDB
    console.log(`⚠️ [FALLBACK] Usando mockDB para "${query}"`);
    return res.json({
      error: false,
      query: query,
      total: getMockFoods(query, max_results).length,
      alimentos: getMockFoods(query, max_results)
    });

  } catch (err) {
    console.error('❌ [FATSECRET] Error en búsqueda:', {
      message: err.message,
      code: err.code,
      status: err.response?.status,
      url: err.config?.url
    });

    // FALLBACK para errores de red/DNS
    if (err.message?.includes('ENOTFOUND') || 
        err.message?.includes('timeout') || 
        err.message?.includes('ECONNREFUSED') ||
        err.code === 'ENOTFOUND' ||
        err.code === 'ETIMEDOUT' ||
        err.code === 'ECONNRESET') {
      
      console.log('⚠️ [FATSECRET] Error de conectividad, intentando fallback USDA');
      
      // Intentar USDA primero
      if (usdaFoodData.length > 0) {
        const usdaResults = searchUsdaFoods(query, max_results);
        if (usdaResults.length > 0) {
          return res.json({
            error: false,
            query: query,
            total: usdaResults.length,
            alimentos: usdaResults
          });
        }
      }
      
      // Fallback final a mockDB
      return res.json({
        error: false,
        query: query,
        total: getMockFoods(query, max_results).length,
        alimentos: getMockFoods(query, max_results)
      });
    }

    // Otros errores (OAuth inválido, etc.)
    const statusCode = err.response?.status || 500;
    const mensaje = err.response?.data?.error?.message || err.message || 'Error al conectar con FatSecret API';

    return res.status(statusCode).json({
      error: true,
      mensaje: mensaje,
      detalles: process.env.NODE_ENV === 'development' ? { message: err.message, code: err.code } : undefined
    });
  }
});

// 🔍 Obtener detalles de un alimento por ID (solo FatSecret por ahora)
router.post('/food/:food_id', async function(req, res) {
  const { food_id } = req.params;

  if (!FATSECRET_CONFIG.consumer_key || !FATSECRET_CONFIG.consumer_secret) {
    return res.json({ error: false, alimento: getMockFoodById(food_id) });
  }

  try {
    const requestData = {
      url: FATSECRET_CONFIG.api_base,
      method: 'GET',
      data: {
        method: 'food.get',
        food_id: food_id,
        format: 'json'
      }
    };

    const signed = oauthClient.authorize(requestData, { token: '', key: '' });
    const authHeader = oauthClient.toHeader(signed);
    
    const apiParams = {
      method: requestData.data.method,
      food_id: requestData.data.food_id,
      format: requestData.data.format
    };
    
    const queryString = Object.keys(apiParams)
      .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(String(apiParams[key])))
      .join('&');
    const fullUrl = requestData.url + '?' + queryString;

    const response = await axios.get(fullUrl, {
      headers: { 'Authorization': authHeader.Authorization },
      timeout: 60000,
      family: 4,
      validateStatus: function(status) {
        return status >= 200 && status < 300;
      }
    });

    const food = response.data?.food;
    
    if (!food) {
      return res.json({ error: false, alimento: getMockFoodById(food_id) });
    }

    const alimento = {
      food_id: food.food_id,
      name: food.food_name,
      brand: food.brand_name,
      servings: food.servings?.serving || [],
      nutrition: {
        calories: food.calories,
        protein: food.protein_g,
        carbs: food.carbohydrate_g,
        fat: food.total_fat_g,
        fiber: food.fiber_g,
        sodium: food.sodium_mg
      },
      image_url: food.picture_url
    };

    return res.json({ error: false, alimento: alimento });

  } catch (err) {
    console.error('❌ [FATSECRET] Error obteniendo alimento:', err.message);
    
    if (err.message?.includes('ENOTFOUND') || err.code === 'ENOTFOUND') {
      return res.json({ error: false, alimento: getMockFoodById(food_id) });
    }
    
    return res.status(500).json({ error: true, mensaje: 'Error al obtener detalles del alimento' });
  }
});

// ============================================================================
// 🎭 FALLBACK: MOCKDB (cuando FatSecret y USDA fallan)
// ============================================================================

function getMockFoods(query, maxResults) {
  const queryLower = query.toLowerCase().trim();
  
  // Búsqueda en claves del mockDB
  let key = Object.keys(mockDB).find(k => queryLower === k);
  
  if (!key) {
    key = Object.keys(mockDB).find(k => 
      queryLower.includes(k) || k.includes(queryLower)
    );
  }
  
  if (!key && SPANISH_TO_ENGLISH[queryLower]) {
    const translated = SPANISH_TO_ENGLISH[queryLower];
    key = Object.keys(mockDB).find(k => 
      translated.includes(k) || k.includes(translated)
    );
  }
  
  if (!key) {
    const words = queryLower.split(/\s+/);
    for (const word of words) {
      if (word.length >= 3) {
        key = Object.keys(mockDB).find(k => k.includes(word));
        if (key) break;
        
        const translatedWord = SPANISH_TO_ENGLISH[word];
        if (translatedWord) {
          key = Object.keys(mockDB).find(k => k.includes(translatedWord));
          if (key) break;
        }
      }
    }
  }
  
  if (key && mockDB[key]) {
    return mockDB[key].slice(0, maxResults).map(f => ({ ...f, fatsecret_id: f.food_id }));
  }
  
  console.log(`⚠️ [FALLBACK] No hay coincidencia para "${query}", retornando verduras genéricas`);
  return mockDB['vegetables'].slice(0, maxResults).map(f => ({ ...f, fatsecret_id: f.food_id }));
}

const mockDB = {
  // ========== PROTEÍNAS ANIMALES ==========
  'chicken': [
    { food_id: 'mock_chicken_1', name: 'Chicken breast, grilled', brand: '', serving_size: 100, serving_unit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6, fiber: 0, image_url: '' },
    { food_id: 'mock_chicken_2', name: 'Chicken thigh, roasted', brand: '', serving_size: 100, serving_unit: 'g', calories: 209, protein: 26, carbs: 0, fat: 10.9, fiber: 0, image_url: '' }
  ],
  'pollo': [
    { food_id: 'mock_pollo_1', name: 'Pechuga de pollo a la plancha', brand: '', serving_size: 100, serving_unit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6, fiber: 0, image_url: '' },
    { food_id: 'mock_pollo_2', name: 'Pollo guisado casero', brand: '', serving_size: 100, serving_unit: 'g', calories: 190, protein: 25, carbs: 5, fat: 8, fiber: 1, image_url: '' }
  ],
  'beef': [
    { food_id: 'mock_beef_1', name: 'Beef, lean ground, cooked', brand: '', serving_size: 100, serving_unit: 'g', calories: 250, protein: 26, carbs: 0, fat: 15, fiber: 0, image_url: '' }
  ],
  'fish': [
    { food_id: 'mock_fish_1', name: 'White fish, grilled', brand: '', serving_size: 100, serving_unit: 'g', calories: 120, protein: 22, carbs: 0, fat: 3, fiber: 0, image_url: '' },
    { food_id: 'mock_fish_2', name: 'Salmon, baked', brand: '', serving_size: 100, serving_unit: 'g', calories: 206, protein: 22, carbs: 0, fat: 13, fiber: 0, image_url: '' }
  ],
  'pescado': [
    { food_id: 'mock_pescado_1', name: 'Filete de pescado blanco a la plancha', brand: '', serving_size: 100, serving_unit: 'g', calories: 120, protein: 22, carbs: 0, fat: 3, fiber: 0, image_url: '' }
  ],
  'egg': [
    { food_id: 'mock_egg_1', name: 'Egg, whole, boiled', brand: '', serving_size: 50, serving_unit: 'unidad', calories: 78, protein: 6.3, carbs: 0.6, fat: 5.3, fiber: 0, image_url: '' }
  ],
  'huevo': [
    { food_id: 'mock_huevo_1', name: 'Huevo de gallina cocido', brand: '', serving_size: 50, serving_unit: 'unidad', calories: 78, protein: 6.3, carbs: 0.6, fat: 5.3, fiber: 0, image_url: '' }
  ],
  
  // ========== LÁCTEOS ==========
  'milk': [
    { food_id: 'mock_milk_1', name: 'Milk, whole, 3.25% fat', brand: '', serving_size: 240, serving_unit: 'ml', calories: 149, protein: 7.7, carbs: 11.7, fat: 7.9, fiber: 0, image_url: '' }
  ],
  'yogurt': [
    { food_id: 'mock_yogurt_1', name: 'Yogurt, plain, low fat', brand: '', serving_size: 125, serving_unit: 'g', calories: 70, protein: 6, carbs: 8, fat: 2, fiber: 0, image_url: '' }
  ],
  'cheese': [
    { food_id: 'mock_cheese_1', name: 'Cheese, cheddar', brand: '', serving_size: 30, serving_unit: 'g', calories: 114, protein: 7, carbs: 0.4, fat: 9.4, fiber: 0, image_url: '' }
  ],
  
  // ========== CEREALES Y GRANOS ==========
  'rice': [
    { food_id: 'mock_rice_1', name: 'Rice, white, cooked', brand: '', serving_size: 100, serving_unit: 'g', calories: 130, protein: 2.7, carbs: 28, fat: 0.3, fiber: 0.4, image_url: '' }
  ],
  'arroz': [
    { food_id: 'mock_arroz_1', name: 'Arroz blanco cocido', brand: '', serving_size: 100, serving_unit: 'g', calories: 130, protein: 2.7, carbs: 28, fat: 0.3, fiber: 0.4, image_url: '' }
  ],
  'oatmeal': [
    { food_id: 'mock_oatmeal_1', name: 'Oatmeal, cooked with water', brand: '', serving_size: 100, serving_unit: 'g', calories: 71, protein: 2.5, carbs: 12, fat: 1.5, fiber: 2, image_url: '' }
  ],
  'avena': [
    { food_id: 'mock_avena_1', name: 'Avena en hojuelas', brand: 'Quaker', serving_size: 40, serving_unit: 'g', calories: 150, protein: 5, carbs: 27, fat: 3, fiber: 4, image_url: '' }
  ],
  'bread': [
    { food_id: 'mock_bread_1', name: 'Bread, whole wheat', brand: '', serving_size: 30, serving_unit: 'slice', calories: 80, protein: 4, carbs: 15, fat: 1, fiber: 2, image_url: '' }
  ],
  'pan': [
    { food_id: 'mock_pan_1', name: 'Pan integral de trigo', brand: '', serving_size: 30, serving_unit: 'rebanada', calories: 80, protein: 4, carbs: 15, fat: 1, fiber: 2, image_url: '' }
  ],
  
  // ========== VERDURAS ==========
  'vegetables': [
    { food_id: 'mock_veg_1', name: 'Broccoli, cooked', brand: '', serving_size: 100, serving_unit: 'g', calories: 35, protein: 2.4, carbs: 7, fat: 0.4, fiber: 3.3, image_url: '' },
    { food_id: 'mock_veg_2', name: 'Carrot, cooked', brand: '', serving_size: 100, serving_unit: 'g', calories: 35, protein: 0.8, carbs: 8, fat: 0.2, fiber: 2.8, image_url: '' },
    { food_id: 'mock_veg_3', name: 'Spinach, cooked', brand: '', serving_size: 100, serving_unit: 'g', calories: 23, protein: 3, carbs: 3.8, fat: 0.3, fiber: 2.4, image_url: '' }
  ],
  'verduras': [
    { food_id: 'mock_verduras_1', name: 'Brócoli cocido', brand: '', serving_size: 100, serving_unit: 'g', calories: 35, protein: 2.4, carbs: 7, fat: 0.4, fiber: 3.3, image_url: '' },
    { food_id: 'mock_verduras_2', name: 'Zanahoria cocida', brand: '', serving_size: 100, serving_unit: 'g', calories: 35, protein: 0.8, carbs: 8, fat: 0.2, fiber: 2.8, image_url: '' }
  ],
  
  // ========== FRUTAS ==========
  'apple': [
    { food_id: 'mock_apple_1', name: 'Apple, raw, with skin', brand: '', serving_size: 100, serving_unit: 'g', calories: 52, protein: 0.3, carbs: 14, fat: 0.2, fiber: 2.4, image_url: '' }
  ],
  'banana': [
    { food_id: 'mock_banana_1', name: 'Banana, raw', brand: '', serving_size: 100, serving_unit: 'g', calories: 89, protein: 1.1, carbs: 23, fat: 0.3, fiber: 2.6, image_url: '' }
  ]
};

function getMockFoodById(foodId) {
  return {
    food_id: foodId,
    name: 'Alimento de desarrollo',
    brand: '',
    servings: [{
      serving_id: '0',
      serving_description: '100 g',
      calories: 100,
      protein: 10,
      carbs: 15,
      fat: 3,
      fiber: 2,
      sodium: 50
    }],
    image_url: ''
  };
}

console.log('✅ [ROUTER] fatsecret.js cargado correctamente con fallback USDA');
module.exports = router;