FROM node:20-slim

# Instalar Git y dependencias de sistema para Baileys
RUN apt-get update && \
    apt-get install -y git python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY . .

# Variables de entorno por defecto para evitar crash si faltan
ENV PORT=3000
ENV TZ=America/Argentina/Buenos_Aires

EXPOSE 3000
CMD [ "node", "index.js" ]