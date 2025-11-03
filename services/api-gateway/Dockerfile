# API Gateway (REST -> gRPC)
FROM node:18-alpine
WORKDIR /app
# Build with repo root as context: `docker build -f services/api-gateway/Dockerfile -t <img> .`
COPY services/api-gateway/package.json services/api-gateway/package-lock.json* ./
RUN npm ci || npm install --production
COPY services/api-gateway/. .
COPY protos ./protos
ENV PORT=5000
EXPOSE 5000
CMD ["node", "index.js"]
