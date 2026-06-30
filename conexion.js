// conexion.js - RAÍZ DEL PROYECTO (INICIALIZACIÓN INMEDIATA)
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');

console.log(' [CONEXION] Iniciando conexión inmediata a BD...');

const app = express();

//  CORS explícito
app.use(cors({
  origin: [
    'http://localhost:8100',
    'http://localhost:4200',
    'capacitor://localhost',
    'http://localhost',
    'http://app.72.61.11.127.nip.io'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.options(/.*/, cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

//  POOL MySQL - Se crea INMEDIATAMENTE al cargar este módulo
console.log(' [CONEXION] Creando pool de conexiones...');

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',  // IP para evitar problemas DNS en Windows
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'nutripa_db',
  port: parseInt(process.env.DB_PORT) || 3306,
  charset: 'utf8mb4',
  
  //  Opciones válidas para createPool:
  waitForConnections: true,
  connectionLimit: 80,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  
  //  Timeouts válidos:
  connectTimeout: 10000,    // 10s para conectar
  idleTimeout: 60000        // 60s para conexiones inactivas
  
  //  REMOVER: acquireTimeout (NO válido para pool)
});

//  Verificar conexión inmediatamente (sin bloquear el arranque del servidor)
(async () => {
  try {
    console.log(' [CONEXION] Probando conexión inicial...');
    const connection = await pool.getConnection();
    console.log(' [CONEXION] Conexión a BD exitosa');
    connection.release();
  } catch (error) {
    console.warn(' [CONEXION] No se pudo conectar a BD inicialmente:', error.message);
    console.warn(' [CONEXION] El servidor seguirá corriendo. Reintentará en la próxima petición.');
  }
})();

//  Funciones exportadas
async function getConnection() {
  return await pool.getConnection();
}

async function query(sql, params) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function closePool() {
  console.log('🔌 [CONEXION] Cerrando pool...');
  await pool.end();
  console.log(' [CONEXION] Pool cerrado');
}

function getPool() {
  return pool;
}

module.exports.getPool = getPool;

app.get('/', (req, res) => {
  res.json({
    status: 'OK',
    message: 'API Nutrición activa',
    db: 'connected module loaded'
  });
});

console.log(' [CONEXION] Módulo exportado (pool inicializado)');
module.exports = {
  getConnection,
  query,
  closePool,
  app,
  pool,
  getPool
};