FROM node:24-alpine3.21
WORKDIR /app
COPY package* .
RUN npm ci || npm install --production
COPY . .
EXPOSE 5001
CMD [ "node", "index.js" ]
