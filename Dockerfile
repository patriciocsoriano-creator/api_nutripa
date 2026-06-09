# ============================================
# API NUTRICIÓN - Node.js / Express
# ============================================

# Imagen oficial de Node.js
FROM node:18-alpine

# Directorio de trabajo dentro del contenedor
WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias
RUN npm install --omit=dev

# Copiar el resto del proyecto
COPY . .

# Puerto de la aplicación
EXPOSE 3000

# Healthcheck opcional
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --spider -q http://localhost:3000/ || exit 1

# Comando para iniciar la API
CMD ["node", "index.js"]