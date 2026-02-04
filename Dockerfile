FROM node:18-slim

# Solo necesitamos Node, nada de Chrome
WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000
CMD [ "node", "index.js" ]