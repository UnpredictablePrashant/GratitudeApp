FROM node:18-alpine
WORKDIR /app
# Build with repo root as context
COPY services/moods-api/package.json services/moods-api/package-lock.json* ./
RUN npm ci || npm install --production
COPY services/moods-api/. .
COPY protos ./protos
ENV PORT=5002
EXPOSE 5002
CMD ["node", "index.js"]

