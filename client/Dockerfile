FROM node:24-alpine3.21
WORKDIR /app
COPY package* .
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "start"]