FROM node:18-slim

# 1. Instalar Git y herramientas básicas (Necesario para descargar Baileys)
RUN apt-get update && \
    apt-get install -y git python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY package*.json ./

# 2. Instalar dependencias
RUN npm install

COPY . .

EXPOSE 3000
CMD [ "node", "index.js" ]