// routes/fatsecret.js - VERSIÓN FINAL OPTIMIZADA CON SQLITE USDA
const express = require('express');
const router = express.Router();
const oauth = require('oauth-1.0a');
const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

console.log(' [ROUTER] Cargando fatsecret.js (con SQLite USDA optimizado)');

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
    usdaDb.pragma('cache_size = -64000'); // 64MB cache
    usdaDb.pragma('temp_store = MEMORY');
    
    const totalFoods = usdaDb.prepare('SELECT COUNT(*) as count FROM foods').get().count;
    const totalNutrients = usdaDb.prepare('SELECT COUNT(*) as count FROM food_nutrients').get().count;
    console.log(` [USDA-SQLite] Base de datos cargada:`);
    console.log(`    Alimentos: ${totalFoods.toLocaleString()}`);
    console.log(`    Nutrientes: ${totalNutrients.toLocaleString()}`);
  } else {
    console.warn(` [USDA-SQLite] DB no encontrada en: ${dbPath}`);
  }
} catch (e) {
  console.error(' [USDA-SQLite] Error cargando:', e.message);
}

if (!FATSECRET_CONFIG.consumer_key || !FATSECRET_CONFIG.consumer_secret) {
  console.warn(' [FATSECRET] Credenciales NO configuradas. Usando USDA como fuente principal.');
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
//  DICCIONARIO DE TRADUCCIÓN ESPAÑOL → INGLÉS (AMPLIADO)
// ============================================================================
const SPANISH_TO_ENGLISH = {
  // Proteínas animales
  'pollo': 'chicken', 'pechuga': 'chicken breast', 'pavo': 'turkey',
  'carne': 'beef', 'res': 'beef', 'cerdo': 'pork', 'pescado': 'fish',
  'atún': 'tuna', 'salmón': 'salmon', 'merluza': 'cod', 'bacalao': 'cod',
  'pescado blanco': 'white fish', 'camarones': 'shrimp', 'langostinos': 'shrimp',
  'pulpo': 'octopus', 'calamar': 'squid', 'tilapia': 'tilapia',
  'trucha': 'trout', 'sardina': 'sardine', 'anchoa': 'anchovy',
  
  // Huevos y lácteos
  'huevo': 'egg', 'huevos': 'eggs', 'leche': 'milk',
  'yogur': 'yogurt', 'yogurt': 'yogurt', 'yogur natural': 'plain yogurt',
  'yogur griego': 'greek yogurt', 'kéfir': 'kefir',
  'queso': 'cheese', 'requesón': 'cottage cheese', 'queso cottage': 'cottage cheese',
  'queso fresco': 'fresh cheese', 'queso oaxaca': 'oaxaca cheese',
  'queso cotija': 'cotija cheese', 'queso panela': 'panela cheese',
  'queso mozzarella': 'mozzarella cheese', 'queso cheddar': 'cheddar cheese',
  'queso parmesano': 'parmesan cheese', 'queso feta': 'feta cheese',
  'mantequilla': 'butter', 'crema': 'cream', 'nata': 'cream',
  
  // Cereales y granos
  'arroz': 'rice', 'arroz blanco': 'white rice', 'arroz integral': 'brown rice',
  'avena': 'oatmeal', 'avena en hojuelas': 'rolled oats',
  'pan': 'bread', 'pan integral': 'whole wheat bread', 'pan blanco': 'white bread',
  'pan de centeno': 'rye bread', 'tortilla': 'tortilla',
  'pasta': 'pasta', 'fideos': 'noodles', 'espagueti': 'spaghetti',
  'quinoa': 'quinoa', 'trigo': 'wheat', 'cebada': 'barley',
  'centeno': 'rye', 'cuscús': 'couscous', 'bulgur': 'bulgur',
  'amaranto': 'amaranth', 'mijo': 'millet', 'sorgo': 'sorghum',
  
  // Legumbres
  'frijoles': 'beans', 'frijol': 'bean', 'frijoles negros': 'black beans',
  'lentejas': 'lentils', 'lenteja': 'lentil', 'garbanzos': 'chickpeas',
  'garbanzo': 'chickpea', 'habas': 'fava beans', 'haba': 'fava bean',
  'soya': 'soybean', 'soja': 'soybean', 'edamame': 'edamame',
  
  // Verduras
  'verduras': 'vegetables', 'vegetales': 'vegetables',
  'ensalada': 'salad', 'lechuga': 'lettuce',
  'espinaca': 'spinach', 'espinacas': 'spinach',
  'brócoli': 'broccoli', 'brocoli': 'broccoli',
  'coliflor': 'cauliflower', 'zanahoria': 'carrot', 'zanahorias': 'carrots',
  'tomate': 'tomato', 'tomates': 'tomatoes', 'jitomate': 'tomato',
  'pepino': 'cucumber', 'pimiento': 'bell pepper', 'pimientos': 'bell peppers',
  'cebolla': 'onion', 'cebollas': 'onions', 'ajo': 'garlic',
  'aguacate': 'avocado', 'palta': 'avocado',
  'champiñón': 'mushroom', 'champiñones': 'mushrooms', 'hongos': 'mushrooms',
  'rábano': 'radish', 'nabo': 'turnip', 'remolacha': 'beet', 'betabel': 'beet',
  'apio': 'celery', 'espárragos': 'asparagus', 'espárrago': 'asparagus',
  'ejotes': 'green beans', 'guisantes': 'peas', 'chícharos': 'peas',
  'calabacín': 'zucchini', 'calabaza': 'squash', ' chayote': 'chayote',
  'alcachofa': 'artichoke', 'berenjena': 'eggplant', 'col': 'cabbage',
  'repollo': 'cabbage', 'kale': 'kale', 'acelga': 'swiss chard',
  'pepino': 'cucumber', 'camote': 'sweet potato', 'papa': 'potato',
  'yuca': 'cassava', 'mandioca': 'cassava', 'ñame': 'yam',
  
  // Frutas
  'manzana': 'apple', 'manzanas': 'apples',
  'banana': 'banana', 'plátano': 'banana', 'banano': 'banana',
  'naranja': 'orange', 'naranjas': 'oranges',
  'fresa': 'strawberry', 'fresas': 'strawberries',
  'uva': 'grape', 'uvas': 'grapes',
  'piña': 'pineapple', 'pina': 'pineapple',
  'mango': 'mango', 'papaya': 'papaya',
  'sandía': 'watermelon', 'melón': 'melon',
  'pera': 'pear', 'peras': 'pears',
  'durazno': 'peach', 'duraznos': 'peaches',
  'ciruela': 'plum', 'ciruelas': 'plums',
  'kiwi': 'kiwi', 'cereza': 'cherry', 'cerezas': 'cherries',
  'arándano': 'blueberry', 'arándanos': 'blueberries',
  'mora': 'blackberry', 'moras': 'blackberries',
  'frambuesa': 'raspberry', 'frambuesas': 'raspberries',
  'granada': 'pomegranate', 'higo': 'fig', 'dátil': 'date', 'datil': 'date',
  'limón': 'lemon', 'limon': 'lemon', 'lima': 'lime',
  'mandarina': 'tangerine', 'toronja': 'grapefruit', 'pomelo': 'grapefruit',
  'guayaba': 'guava', 'tamarindo': 'tamarind', 'jicama': 'jicama',
  
  // Grasas y aceites
  'aceite': 'oil', 'aceite de oliva': 'olive oil',
  'aceite de coco': 'coconut oil', 'aceite de girasol': 'sunflower oil',
  'aceite de maíz': 'corn oil', 'aceite de soya': 'soybean oil',
  'aceite de canola': 'canola oil', 'aceite de ajonjolí': 'sesame oil',
  'margarina': 'margarine', 'manteca': 'lard',
  
  // Frutos secos y semillas
  'almendras': 'almonds', 'almendra': 'almond',
  'nueces': 'walnuts', 'nuez': 'walnut',
  'maní': 'peanuts', 'cacahuate': 'peanuts', 'cacahuates': 'peanuts',
  'pistachos': 'pistachios', 'pistacho': 'pistachio',
  'anacardos': 'cashews', 'merey': 'cashews',
  'avellanas': 'hazelnuts', 'avellana': 'hazelnut',
  'pecanas': 'pecans', 'pecana': 'pecan',
  'semillas de girasol': 'sunflower seeds', 'semillas de calabaza': 'pumpkin seeds',
  'chía': 'chia seeds', 'linaza': 'flaxseed', 'ajonjolí': 'sesame seeds',
  
  // Bebidas
  'agua': 'water', 'jugo': 'juice',
  'jugo de naranja': 'orange juice', 'jugo de manzana': 'apple juice',
  'café': 'coffee', 'té': 'tea', 'leche de almendras': 'almond milk',
  'leche de soya': 'soy milk', 'leche de avena': 'oat milk',
  'leche de coco': 'coconut milk',
  
  // Otros
  'tofu': 'tofu', 'tempeh': 'tempeh',
  'miel': 'honey', 'azúcar': 'sugar', 'sal': 'salt',
  'chocolate': 'chocolate', 'cacao': 'cocoa',
  'sopa': 'soup', 'caldo': 'broth',
  'mostaza': 'mustard', 'kétchup': 'ketchup', 'mayonesa': 'mayonnaise',
  'vinagre': 'vinegar'
};

// ============================================================================
//  BÚSQUEDA EN SQLITE USDA (OPTIMIZADA)
// ============================================================================
function searchUsdaFoods(query, maxResults = 20) {
  if (!usdaDb) return [];
  
  const queryLower = query.toLowerCase().trim();
  const translated = SPANISH_TO_ENGLISH[queryLower] || queryLower;
  
  // Query optimizado: usa MAX en lugar de SUM (más preciso para nutrientes únicos)
  const sql = `
    SELECT 
      f.fdc_id,
      f.name,
      f.data_type,
      MAX(CASE WHEN fn.nutrient_id = 1008 THEN fn.amount END) as calories,
      MAX(CASE WHEN fn.nutrient_id = 1003 THEN fn.amount END) as protein,
      MAX(CASE WHEN fn.nutrient_id = 1004 THEN fn.amount END) as fat,
      MAX(CASE WHEN fn.nutrient_id = 1005 THEN fn.amount END) as carbs,
      MAX(CASE WHEN fn.nutrient_id = 1079 THEN fn.amount END) as fiber,
      MAX(CASE WHEN fn.nutrient_id = 1087 THEN fn.amount END) as calcium,
      MAX(CASE WHEN fn.nutrient_id = 1089 THEN fn.amount END) as iron,
      MAX(CASE WHEN fn.nutrient_id = 1090 THEN fn.amount END) as magnesium,
      MAX(CASE WHEN fn.nutrient_id = 1091 THEN fn.amount END) as phosphorus,
      MAX(CASE WHEN fn.nutrient_id = 1093 THEN fn.amount END) as sodium
    FROM foods f
    INNER JOIN food_nutrients fn ON f.fdc_id = fn.fdc_id
    WHERE (
      LOWER(f.name) LIKE ? 
      OR LOWER(f.name) LIKE ?
      OR LOWER(f.name) LIKE ?
    )
    GROUP BY f.fdc_id
    HAVING calories > 0 AND calories < 1000
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
      `%${translated.split(' ')[0]}%`, // Buscar también por primera palabra
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
      calcium: round2(food.calcium),
      iron: round2(food.iron),
      magnesium: round2(food.magnesium),
      phosphorus: round2(food.phosphorus),
      sodium: round2(food.sodium),
      image_url: '',
      fatsecret_id: `usda_${food.fdc_id}`,
      source: food.data_type === 'sr_legacy' ? 'usda_sr_legacy' : 'usda_foundation'
    }));
  } catch (e) {
    console.error(' [USDA-SQLite] Error en búsqueda:', e.message);
    return [];
  }
}

function capitalizeFirst(str) {
  if (!str) return '';
  return str.split(' ').map(word => 
    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  ).join(' ');
}

function round2(n) {
  if (n === null || n === undefined) return 0;
  return Math.round(n * 100) / 100;
}

// ============================================================================
// ENDPOINTS
// ============================================================================

//  Health check
router.get('/health', function(req, res) {
  let usdaInfo = { status: 'disabled', total_foods: 0 };
  
  if (usdaDb) {
    try {
      const totalFoods = usdaDb.prepare('SELECT COUNT(*) as count FROM foods').get().count;
      usdaInfo = { status: 'enabled', total_foods: totalFoods };
    } catch (e) {
      usdaInfo = { status: 'error', message: e.message };
    }
  }
  
  return res.json({
    status: (FATSECRET_CONFIG.consumer_key && FATSECRET_CONFIG.consumer_secret) ? 'configured' : 'not_configured',
    api_base: FATSECRET_CONFIG.api_base,
    oauth_method: 'HMAC-SHA1',
    usda_sqlite: usdaInfo
  });
});

// Buscar alimentos
router.post('/search', async function(req, res) {
  const { query, max_results = 10 } = req.body;
  const startTime = Date.now();

  if (!query || query.trim().length < 2) {
    return res.status(400).json({ 
      error: true, 
      mensaje: 'query es requerido (mínimo 2 caracteres)' 
    });
  }

  //  Intentar FatSecret API (si hay credenciales)
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
        timeout: 15000,
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
            calories: parseFloat(f.calories) || 0,
            protein: parseFloat(f.protein_g) || 0,
            carbs: parseFloat(f.carbohydrate_g) || 0,
            fat: parseFloat(f.total_fat_g) || 0,
            fiber: parseFloat(f.fiber_g) || 0,
            image_url: f.image_url || '',
            fatsecret_id: f.food_id,
            source: 'fatsecret'
          }));

        const duration = Date.now() - startTime;
        console.log(` [FATSECRET] ${alimentos.length} alimentos para "${query}" (${duration}ms)`);
        return res.json({
          error: false,
          query: query,
          total: alimentos.length,
          alimentos: alimentos,
          source: 'fatsecret',
          duration_ms: duration
        });
      }
    } catch (err) {
      console.warn(` [FATSECRET] Error para "${query}": ${err.message}. Intentando USDA...`);
    }
  }

  //  Buscar en SQLite de USDA (8,116 alimentos)
  if (usdaDb) {
    const usdaResults = searchUsdaFoods(query, max_results);
    
    if (usdaResults.length > 0) {
      const duration = Date.now() - startTime;
      console.log(` [USDA-SQLite] ${usdaResults.length} alimentos para "${query}" (${duration}ms)`);
      return res.json({
        error: false,
        query: query,
        total: usdaResults.length,
        alimentos: usdaResults,
        source: 'usda_sqlite',
        duration_ms: duration
      });
    }
  }

  //  Fallback final: mockDB
  const mockResults = getMockFoods(query, max_results);
  const duration = Date.now() - startTime;
  console.log(` [FALLBACK] mockDB para "${query}" (${duration}ms)`);
  
  return res.json({
    error: false,
    query: query,
    total: mockResults.length,
    alimentos: mockResults,
    source: 'mockdb',
    duration_ms: duration
  });
});

// ============================================================================
//  FALLBACK: MOCKDB (AMPLIADO)
// ============================================================================
function getMockFoods(query, maxResults) {
  const queryLower = query.toLowerCase().trim();
  
  // Búsqueda directa
  let key = Object.keys(mockDB).find(k => queryLower === k);
  
  // Búsqueda parcial
  if (!key) {
    key = Object.keys(mockDB).find(k => queryLower.includes(k) || k.includes(queryLower));
  }
  
  // Búsqueda con traducción
  if (!key && SPANISH_TO_ENGLISH[queryLower]) {
    const translated = SPANISH_TO_ENGLISH[queryLower];
    key = Object.keys(mockDB).find(k => translated.includes(k) || k.includes(translated));
  }
  
  // Búsqueda por palabras
  if (!key) {
    const words = queryLower.split(/\s+/);
    for (const word of words) {
      if (word.length >= 3) {
        key = Object.keys(mockDB).find(k => k.includes(word));
        if (key) break;
        
        if (SPANISH_TO_ENGLISH[word]) {
          const translatedWord = SPANISH_TO_ENGLISH[word];
          key = Object.keys(mockDB).find(k => k.includes(translatedWord));
          if (key) break;
        }
      }
    }
  }
  
  if (key && mockDB[key]) {
    return mockDB[key].slice(0, maxResults).map(f => ({ ...f, fatsecret_id: f.food_id }));
  }
  
  // Fallback genérico
  return mockDB['vegetales'].slice(0, maxResults).map(f => ({ ...f, fatsecret_id: f.food_id }));
}

const mockDB = {
  // ========== PROTEÍNAS ==========
  'pollo': [
    { food_id: 'mock_pollo_1', name: 'Pechuga de pollo a la plancha', brand: '', serving_size: 100, serving_unit: 'g', calories: 165, protein: 31, carbs: 0, fat: 3.6, fiber: 0, image_url: '' },
    { food_id: 'mock_pollo_2', name: 'Pollo guisado casero', brand: '', serving_size: 100, serving_unit: 'g', calories: 190, protein: 25, carbs: 5, fat: 8, fiber: 1, image_url: '' },
    { food_id: 'mock_pollo_3', name: 'Muslo de pollo asado', brand: '', serving_size: 100, serving_unit: 'g', calories: 209, protein: 26, carbs: 0, fat: 10.9, fiber: 0, image_url: '' }
  ],
  'pescado': [
    { food_id: 'mock_pescado_1', name: 'Filete de pescado blanco a la plancha', brand: '', serving_size: 100, serving_unit: 'g', calories: 120, protein: 22, carbs: 0, fat: 3, fiber: 0, image_url: '' },
    { food_id: 'mock_pescado_2', name: 'Salmón al horno', brand: '', serving_size: 100, serving_unit: 'g', calories: 206, protein: 22, carbs: 0, fat: 13, fiber: 0, image_url: '' },
    { food_id: 'mock_pescado_3', name: 'Atún en agua', brand: '', serving_size: 100, serving_unit: 'g', calories: 116, protein: 25.5, carbs: 0, fat: 0.8, fiber: 0, image_url: '' }
  ],
  'huevo': [
    { food_id: 'mock_huevo_1', name: 'Huevo de gallina cocido', brand: '', serving_size: 50, serving_unit: 'unidad', calories: 78, protein: 6.3, carbs: 0.6, fat: 5.3, fiber: 0, image_url: '' },
    { food_id: 'mock_huevo_2', name: 'Clara de huevo', brand: '', serving_size: 33, serving_unit: 'unidad', calories: 17, protein: 3.6, carbs: 0.2, fat: 0.1, fiber: 0, image_url: '' }
  ],
  'carne': [
    { food_id: 'mock_carne_1', name: 'Carne molida magra cocida', brand: '', serving_size: 100, serving_unit: 'g', calories: 250, protein: 26, carbs: 0, fat: 15, fiber: 0, image_url: '' },
    { food_id: 'mock_carne_2', name: 'Bistec de res a la plancha', brand: '', serving_size: 100, serving_unit: 'g', calories: 271, protein: 26, carbs: 0, fat: 18, fiber: 0, image_url: '' }
  ],
  
  // ========== LÁCTEOS ==========
  'leche': [
    { food_id: 'mock_leche_1', name: 'Leche entera', brand: '', serving_size: 240, serving_unit: 'ml', calories: 149, protein: 7.7, carbs: 11.7, fat: 7.9, fiber: 0, image_url: '' },
    { food_id: 'mock_leche_2', name: 'Leche descremada', brand: '', serving_size: 240, serving_unit: 'ml', calories: 83, protein: 8.3, carbs: 12.2, fat: 0.2, fiber: 0, image_url: '' }
  ],
  'yogur': [
    { food_id: 'mock_yogur_1', name: 'Yogur natural sin azúcar', brand: '', serving_size: 125, serving_unit: 'g', calories: 70, protein: 6, carbs: 8, fat: 2, fiber: 0, image_url: '' },
    { food_id: 'mock_yogur_2', name: 'Yogur griego natural', brand: '', serving_size: 150, serving_unit: 'g', calories: 90, protein: 16, carbs: 6, fat: 0, fiber: 0, image_url: '' }
  ],
  'queso': [
    { food_id: 'mock_queso_1', name: 'Queso cottage', brand: '', serving_size: 100, serving_unit: 'g', calories: 98, protein: 11, carbs: 3.4, fat: 4.3, fiber: 0, image_url: '' },
    { food_id: 'mock_queso_2', name: 'Queso mozzarella', brand: '', serving_size: 30, serving_unit: 'g', calories: 85, protein: 6.3, carbs: 0.7, fat: 6.3, fiber: 0, image_url: '' }
  ],
  
  // ========== CEREALES ==========
  'arroz': [
    { food_id: 'mock_arroz_1', name: 'Arroz blanco cocido', brand: '', serving_size: 100, serving_unit: 'g', calories: 130, protein: 2.7, carbs: 28, fat: 0.3, fiber: 0.4, image_url: '' },
    { food_id: 'mock_arroz_2', name: 'Arroz integral cocido', brand: '', serving_size: 100, serving_unit: 'g', calories: 112, protein: 2.6, carbs: 23, fat: 0.9, fiber: 1.8, image_url: '' }
  ],
  'avena': [
    { food_id: 'mock_avena_1', name: 'Avena en hojuelas', brand: 'Quaker', serving_size: 40, serving_unit: 'g', calories: 150, protein: 5, carbs: 27, fat: 3, fiber: 4, image_url: '' }
  ],
  'pan': [
    { food_id: 'mock_pan_1', name: 'Pan integral de trigo', brand: '', serving_size: 30, serving_unit: 'rebanada', calories: 80, protein: 4, carbs: 15, fat: 1, fiber: 2, image_url: '' },
    { food_id: 'mock_pan_2', name: 'Pan blanco', brand: '', serving_size: 30, serving_unit: 'rebanada', calories: 79, protein: 2.7, carbs: 15, fat: 1, fiber: 0.6, image_url: '' }
  ],
  'pasta': [
    { food_id: 'mock_pasta_1', name: 'Pasta cocida', brand: '', serving_size: 100, serving_unit: 'g', calories: 131, protein: 5, carbs: 25, fat: 1.1, fiber: 1.8, image_url: '' }
  ],
  'quinoa': [
    { food_id: 'mock_quinoa_1', name: 'Quinoa cocida', brand: '', serving_size: 100, serving_unit: 'g', calories: 120, protein: 4.4, carbs: 21, fat: 1.9, fiber: 2.8, image_url: '' }
  ],
  
  // ========== LEGUMBRES ==========
  'lentejas': [
    { food_id: 'mock_lentejas_1', name: 'Lentejas cocidas', brand: '', serving_size: 100, serving_unit: 'g', calories: 116, protein: 9, carbs: 20, fat: 0.4, fiber: 8, image_url: '' }
  ],
  'frijoles': [
    { food_id: 'mock_frijoles_1', name: 'Frijoles negros cocidos', brand: '', serving_size: 100, serving_unit: 'g', calories: 132, protein: 8.9, carbs: 24, fat: 0.5, fiber: 8.7, image_url: '' }
  ],
  'garbanzos': [
    { food_id: 'mock_garbanzos_1', name: 'Garbanzos cocidos', brand: '', serving_size: 100, serving_unit: 'g', calories: 164, protein: 8.9, carbs: 27, fat: 2.6, fiber: 7.6, image_url: '' }
  ],
  
  // ========== VERDURAS ==========
  'vegetales': [
    { food_id: 'mock_veg_1', name: 'Brócoli cocido', brand: '', serving_size: 100, serving_unit: 'g', calories: 35, protein: 2.4, carbs: 7, fat: 0.4, fiber: 3.3, image_url: '' },
    { food_id: 'mock_veg_2', name: 'Zanahoria cocida', brand: '', serving_size: 100, serving_unit: 'g', calories: 35, protein: 0.8, carbs: 8, fat: 0.2, fiber: 2.8, image_url: '' },
    { food_id: 'mock_veg_3', name: 'Espinacas cocidas', brand: '', serving_size: 100, serving_unit: 'g', calories: 23, protein: 3, carbs: 3.8, fat: 0.3, fiber: 2.4, image_url: '' },
    { food_id: 'mock_veg_4', name: 'Pepino en rodajas', brand: '', serving_size: 100, serving_unit: 'g', calories: 15, protein: 0.7, carbs: 3.6, fat: 0.1, fiber: 0.5, image_url: '' }
  ],
  
  // ========== FRUTAS ==========
  'manzana': [
    { food_id: 'mock_manzana_1', name: 'Manzana con cáscara', brand: '', serving_size: 100, serving_unit: 'g', calories: 52, protein: 0.3, carbs: 14, fat: 0.2, fiber: 2.4, image_url: '' }
  ],
  'banana': [
    { food_id: 'mock_banana_1', name: 'Banana cruda', brand: '', serving_size: 100, serving_unit: 'g', calories: 89, protein: 1.1, carbs: 23, fat: 0.3, fiber: 2.6, image_url: '' }
  ],
  'pera': [
    { food_id: 'mock_pera_1', name: 'Pera fresca', brand: '', serving_size: 100, serving_unit: 'g', calories: 57, protein: 0.4, carbs: 15, fat: 0.1, fiber: 3.1, image_url: '' }
  ],
  
  // ========== FRUTOS SECOS ==========
  'almendras': [
    { food_id: 'mock_almendras_1', name: 'Almendras crudas', brand: '', serving_size: 30, serving_unit: 'g', calories: 170, protein: 6, carbs: 6, fat: 15, fiber: 3.5, image_url: '' }
  ],
  'nueces': [
    { food_id: 'mock_nueces_1', name: 'Nueces crudas', brand: '', serving_size: 30, serving_unit: 'g', calories: 185, protein: 4.3, carbs: 3.9, fat: 18.5, fiber: 1.9, image_url: '' }
  ],
  
  // ========== OTROS ==========
  'tofu': [
    { food_id: 'mock_tofu_1', name: 'Tofu firme', brand: '', serving_size: 100, serving_unit: 'g', calories: 144, protein: 17, carbs: 3, fat: 9, fiber: 2, image_url: '' }
  ],
  'papa': [
    { food_id: 'mock_papa_1', name: 'Papa cocida', brand: '', serving_size: 100, serving_unit: 'g', calories: 87, protein: 1.9, carbs: 20, fat: 0.1, fiber: 2.2, image_url: '' }
  ],
  'aguacate': [
    { food_id: 'mock_aguacate_1', name: 'Aguacate crudo', brand: '', serving_size: 100, serving_unit: 'g', calories: 160, protein: 2, carbs: 8.5, fat: 14.7, fiber: 6.7, image_url: '' }
  ]
};

console.log(' [ROUTER] fatsecret.js cargado con SQLite USDA optimizado');
module.exports = router;