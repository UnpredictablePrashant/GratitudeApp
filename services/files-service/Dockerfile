# Files Service (S3 upload/download)
FROM node:18-alpine
WORKDIR /app
# Build with repo root as context: `docker build -f services/files-service/Dockerfile -t <img> .`
COPY services/files-service/package.json services/files-service/package-lock.json* ./
RUN npm ci || npm install --production
COPY services/files-service/. .
ENV PORT=5004
EXPOSE 5004
CMD ["node", "index.js"]
