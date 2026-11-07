FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public

# ฐานข้อมูลและรูปจากหน้างานอยู่ที่ /data ต้องผูกกับ volume/disk ถาวรตอนรัน
# (ไม่ใช้คำสั่ง VOLUME เพราะ Railway ไม่รองรับ ให้สร้าง Volume ที่ mount /data แทน)
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
