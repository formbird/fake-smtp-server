FROM node:20-alpine

WORKDIR /www

COPY package*.json /www/

RUN npm install

COPY . .

RUN npm run build

EXPOSE 1025
EXPOSE 1080

CMD ["node", "index.js"]
