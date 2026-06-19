// scripts/import-usda.js

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '../data/usda_foods.db');

const FOUNDATION_DIR = path.join(
  __dirname,
  '../data/usda_csv/foundation'
);

const SR_LEGACY_DIR = path.join(
  __dirname,
  '../data/usda_csv/sr_legacy'
);

const IMPORTANT_NUTRIENTS = [
  1008, // kcal
  1003, // protein
  1004, // fat
  1005, // carbs
  1079, // fiber
  1087, // calcium
  1089, // iron
  1090, // magnesium
  1091, // phosphorus
  1093  // sodium
];

const FOUNDATION_NUTRIENT_MAP = {
  2047: 1008,
  2048: 1008,

  1003: 1003,
  1004: 1004,
  1005: 1005,
  1079: 1079,
  1087: 1087,
  1089: 1089,
  1090: 1090,
  1091: 1091,
  1093: 1093
};

async function main() {

  console.log('🚀 Iniciando importación USDA clínica...\n');

  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
    console.log('🗑️ DB anterior eliminada');
  }

  const db = new Database(DB_PATH);

  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  db.exec(`
    CREATE TABLE foods (
      fdc_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      data_type TEXT,
      is_sr_legacy INTEGER DEFAULT 0
    );

    CREATE TABLE food_nutrients (
      fdc_id INTEGER,
      nutrient_id INTEGER,
      amount REAL,
      PRIMARY KEY (fdc_id, nutrient_id)
    );

    CREATE INDEX idx_foods_name
    ON foods(name);

    CREATE INDEX idx_food_nutrients_fdc
    ON food_nutrients(fdc_id);
  `);

  console.log('✅ Tablas creadas\n');

  // ==================================================
  // FOUNDATION IDS REALES
  // ==================================================

  console.log('📥 Leyendo foundation_food.csv...');

  const foundationIds = new Set();

  await new Promise((resolve, reject) => {

    fs.createReadStream(
      path.join(
        FOUNDATION_DIR,
        'foundation_food.csv'
      )
    )
      .pipe(csv())
      .on('data', row => {

        const id = parseInt(row.fdc_id);

        if (!isNaN(id)) {
          foundationIds.add(id);
        }

      })
      .on('end', resolve)
      .on('error', reject);

  });

  console.log(
    `✅ Foundation Foods reales: ${foundationIds.size}\n`
  );

  // ==================================================
  // SR LEGACY
  // ==================================================

  console.log('📚 Importando SR Legacy...');

  await importCSVSimple(
    db,
    path.join(SR_LEGACY_DIR, 'food.csv'),
    `
      INSERT OR IGNORE INTO foods
      (
        fdc_id,
        name,
        category,
        data_type,
        is_sr_legacy
      )
      VALUES (?, ?, ?, ?, ?)
    `,
    row => {

      const fdcId = parseInt(row.fdc_id);

      if (isNaN(fdcId)) {
        return null;
      }

      return [
        fdcId,
        row.description,
        row.food_category_id,
        'sr_legacy',
        1
      ];
    }
  );

  await importCSVSimple(
    db,
    path.join(SR_LEGACY_DIR, 'food_nutrient.csv'),
    `
      INSERT OR IGNORE INTO food_nutrients
      (
        fdc_id,
        nutrient_id,
        amount
      )
      VALUES (?, ?, ?)
    `,
    row => {

      const nutrientId = parseInt(row.nutrient_id);

      if (
        !IMPORTANT_NUTRIENTS.includes(
          nutrientId
        )
      ) {
        return null;
      }

      const fdcId = parseInt(row.fdc_id);

      if (isNaN(fdcId)) {
        return null;
      }

      return [
        fdcId,
        nutrientId,
        parseFloat(row.amount) || 0
      ];
    }
  );

  console.log('✅ SR Legacy importado\n');

  // ==================================================
  // FOUNDATION REAL
  // ==================================================

  console.log('🏛️ Importando Foundation Foods reales...');

  await importCSVSimple(
    db,
    path.join(FOUNDATION_DIR, 'food.csv'),
    `
      INSERT OR IGNORE INTO foods
      (
        fdc_id,
        name,
        category,
        data_type,
        is_sr_legacy
      )
      VALUES (?, ?, ?, ?, ?)
    `,
    row => {

      const fdcId = parseInt(row.fdc_id);

      if (
        isNaN(fdcId) ||
        !foundationIds.has(fdcId)
      ) {
        return null;
      }

      return [
        fdcId,
        row.description,
        row.food_category_id,
        'foundation',
        0
      ];
    }
  );

  await importCSVSimple(
    db,
    path.join(
      FOUNDATION_DIR,
      'food_nutrient.csv'
    ),
    `
      INSERT OR IGNORE INTO food_nutrients
      (
        fdc_id,
        nutrient_id,
        amount
      )
      VALUES (?, ?, ?)
    `,
    row => {

      const fdcId = parseInt(row.fdc_id);

      if (
        isNaN(fdcId) ||
        !foundationIds.has(fdcId)
      ) {
        return null;
      }

      const originalNutrientId =
        parseInt(row.nutrient_id);

      const nutrientId =
        FOUNDATION_NUTRIENT_MAP[
          originalNutrientId
        ];

      if (
        !nutrientId ||
        !IMPORTANT_NUTRIENTS.includes(
          nutrientId
        )
      ) {
        return null;
      }

      return [
        fdcId,
        nutrientId,
        parseFloat(row.amount) || 0
      ];
    }
  );

  console.log(
    '✅ Foundation Foods reales importados\n'
  );

  // ==================================================
  // ELIMINAR ALIMENTOS SIN NUTRIENTES
  // ==================================================

  console.log(
    '🧹 Eliminando alimentos sin nutrientes...'
  );

  const deleted =
    db.prepare(`
      DELETE FROM foods
      WHERE fdc_id NOT IN (
        SELECT DISTINCT fdc_id
        FROM food_nutrients
      )
    `).run();

  console.log(
    `✅ Eliminados: ${deleted.changes}`
  );

  // ==================================================
  // ESTADÍSTICAS
  // ==================================================

  const totalFoods =
    db.prepare(`
      SELECT COUNT(*) count
      FROM foods
    `).get().count;

  const srLegacyCount =
    db.prepare(`
      SELECT COUNT(*) count
      FROM foods
      WHERE is_sr_legacy = 1
    `).get().count;

  const foundationCount =
    db.prepare(`
      SELECT COUNT(*) count
      FROM foods
      WHERE is_sr_legacy = 0
    `).get().count;

  const nutrientCount =
    db.prepare(`
      SELECT COUNT(*) count
      FROM food_nutrients
    `).get().count;

  console.log('\n📊 ESTADÍSTICAS FINALES');
  console.log('=======================');

  console.log(
    `🍎 Total alimentos: ${totalFoods.toLocaleString()}`
  );

  console.log(
    `📚 SR Legacy: ${srLegacyCount.toLocaleString()}`
  );

  console.log(
    `🏛️ Foundation: ${foundationCount.toLocaleString()}`
  );

  console.log(
    `🔬 Nutrientes: ${nutrientCount.toLocaleString()}`
  );

  console.log(
    `\n💾 DB: ${DB_PATH}`
  );

  console.log(
    `📦 Tamaño: ${
      (
        fs.statSync(DB_PATH).size /
        1024 /
        1024
      ).toFixed(2)
    } MB`
  );

  db.close();

  console.log(
    '\n✅ Base clínica creada correctamente'
  );
}

function importCSVSimple(
  db,
  filePath,
  sql,
  rowMapper
) {

  return new Promise(
    (resolve, reject) => {

      const stmt = db.prepare(sql);

      let count = 0;
      let inserted = 0;

      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', row => {

          const mapped =
            rowMapper(row);

          if (mapped) {

            const result =
              stmt.run(...mapped);

            if (
              result.changes > 0
            ) {
              inserted++;
            }
          }

          count++;
        })
        .on('end', () => {

          console.log(
            `   ✓ ${path.basename(filePath)} -> ${inserted.toLocaleString()} registros`
          );

          resolve();
        })
        .on('error', reject);

    }
  );
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});