FROM node:18-alpine
WORKDIR /app
# Build with repo root as context
COPY services/stats-api/package.json services/stats-api/package-lock.json* ./
RUN npm ci || npm install --production
COPY services/stats-api/. .
COPY protos ./protos
ENV PORT=5003
EXPOSE 5003
CMD ["node", "index.js"]

