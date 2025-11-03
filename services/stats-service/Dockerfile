FROM node:18-alpine
WORKDIR /app
# Build with repo root as context
COPY services/stats-service/package.json services/stats-service/package-lock.json* ./
RUN npm ci || npm install --production
COPY services/stats-service/. .
COPY protos ./protos
ENV HOST=0.0.0.0
ENV PORT=50053
EXPOSE 50053
CMD ["node", "index.js"]

