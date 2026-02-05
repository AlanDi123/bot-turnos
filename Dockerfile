FROM node:20-slim

# Instalar Git y dependencias mínimas necesarias
# Limpiamos caché en el mismo paso para reducir tamaño de imagen
RUN apt-get update && \
    apt-get install -y git python3 make g++ && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY package*.json ./

# Instalar dependencias y limpiar caché de npm
RUN npm install --omit=dev && npm cache clean --force

COPY . .

# Variables de entorno por defecto
ENV PORT=3000
ENV TZ=America/Argentina/Buenos_Aires

EXPOSE 3000
CMD [ "node", "index.js" ]