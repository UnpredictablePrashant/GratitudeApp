# Entries gRPC service
FROM node:18-alpine
WORKDIR /app
# Build with repo root as context: `docker build -f services/entries-service/Dockerfile -t <img> .`
COPY services/entries-service/package.json services/entries-service/package-lock.json* ./
RUN npm ci || npm install --production
COPY services/entries-service/. .
COPY protos ./protos
ENV HOST=0.0.0.0
ENV PORT=50051
EXPOSE 50051
CMD ["node", "index.js"]
