# ============================================
# API NUTRICIÓN - Node.js / Express + SQLite
# ============================================

FROM node:20-bookworm

# 📦 Dependencias de compilación para better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev
RUN npm rebuild better-sqlite3

# Copiar el resto del proyecto
COPY . .

# 🔥 NUEVO: Verificar que la DB existe
RUN ls -lh data/usda_foods.db || echo "⚠️ usda_foods.db no encontrado"

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --spider -q http://localhost:3000/ || exit 1

CMD ["node", "index.js"]