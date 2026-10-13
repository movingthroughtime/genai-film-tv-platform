FROM node:20-alpine

WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY worker.js ./

CMD ["node", "worker.js"]
