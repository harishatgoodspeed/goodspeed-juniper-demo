# Railway image. Nixpacks does not install Chromium or Tesseract, and the
# audit needs both: Playwright for LinkedIn guest reads, logo rasterising,
# and the PDF, and Tesseract for screenshot OCR.
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    python3 \
    make \
    g++ \
    tesseract-ocr \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci
# Downloads the Chromium build that matches this playwright version, plus
# the system libraries it links against.
RUN npx playwright install --with-deps chromium

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright

# Railway injects PORT. migrate applies SQLite migrations before listen.
CMD ["sh", "-c", "npm run migrate && npm start"]
