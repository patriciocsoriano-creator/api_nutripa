# ============================================
# API NUTRICIÓN - Node.js / Express + SQLite
# ============================================

# Imagen oficial de Node.js (Debian)
FROM node:20-bookworm

#  Instalar dependencias de compilación para better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/*

# Directorio de trabajo dentro del contenedor
WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./

# 📦 Instalar dependencias (recompilar better-sqlite3 para Linux)
RUN npm install --omit=dev
RUN npm rebuild better-sqlite3

# Copiar el resto del proyecto
COPY . .

# 🔍 Verificar que la DB existe
RUN ls -la data/ || echo " Carpeta data/ no encontrada"

# Puerto de la aplicación
EXPOSE 3000

# Healthcheck opcional
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --spider -q http://localhost:3000/ || exit 1

# Comando para iniciar la API
CMD ["node", "index.js"]