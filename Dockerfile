# Usamos Node 20 que tiene mejor soporte nativo para crypto
FROM node:20-slim

# Instalar Git y herramientas de compilación (Vitales para Baileys)
RUN apt-get update && \
    apt-get install -y git python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY package*.json ./

# Instalar dependencias
RUN npm install

COPY . .

EXPOSE 3000
CMD [ "node", "index.js" ]