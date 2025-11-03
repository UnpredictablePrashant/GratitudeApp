FROM node:18-alpine
WORKDIR /app
# Build with repo root as context
COPY services/moods-service/package.json services/moods-service/package-lock.json* ./
RUN npm ci || npm install --production
COPY services/moods-service/. .
COPY protos ./protos
ENV HOST=0.0.0.0
ENV PORT=50052
EXPOSE 50052
CMD ["node", "index.js"]

