FROM node:18-alpine

WORKDIR /app

# Install poppler-utils for pdftoppm (PDF page → image conversion for OCR)
RUN apk add --no-cache poppler-utils

COPY backend/package*.json ./
RUN npm install --production

COPY backend/ ./

EXPOSE 3001

CMD ["node", "src/index.js"]
