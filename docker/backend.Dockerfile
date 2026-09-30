FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY backend/package*.json ./
RUN npm ci --omit=dev

COPY backend/ai-service.js ./
COPY backend/crawler.js ./
COPY backend/db.js ./
COPY backend/index.js ./
COPY backend/secure-env.js ./
COPY backend/cleaner.js ./
COPY backend/image-optimizer.js ./
COPY backend/job-queue.js ./
COPY backend/scheduler.js ./
COPY backend/routes/ ./routes/
COPY backend/services/ ./services/
COPY frontend/public/images/ogimage.png /app/default-images/ogimage.png
COPY frontend/public/images/banner1.png /app/default-images/banner1.png
COPY frontend/public/images/meta-img.png /app/default-images/meta-img.png
COPY frontend/public/images/social-v3-deprecations.jpg /app/default-images/social-v3-deprecations.jpg

ENV NODE_ENV=production
ENV DB_PATH=/data/news.db
ENV IMAGES_DIR=/data/images

EXPOSE 3003

CMD ["sh", "-c", "mkdir -p /data/images && cp -n /app/default-images/* /data/images/ 2>/dev/null || true; node index.js"]
