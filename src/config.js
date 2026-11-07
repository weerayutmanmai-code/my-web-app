import path from 'node:path';

export function loadConfig(env = process.env) {
  const dataDir = path.resolve(env.DATA_DIR || 'data');
  const config = {
    port: Number(env.PORT) || 3000,
    lineChannelSecret: env.LINE_CHANNEL_SECRET || '',
    lineChannelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN || '',
    adminUser: env.ADMIN_USER || 'admin',
    adminPassword: env.ADMIN_PASSWORD || '',
    dataDir,
    dbPath: env.DB_PATH || path.join(dataDir, 'app.db'),
    uploadDir: path.join(dataDir, 'uploads'),
    autoApprove: /^(1|true|yes)$/i.test(env.AUTO_APPROVE || ''),
    // ลิงก์หน้าเว็บที่แนบในสรุปของสำนักงาน (Railway ตั้ง RAILWAY_PUBLIC_DOMAIN ให้เองเมื่อสร้างโดเมน)
    publicUrl: (env.PUBLIC_URL || (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : '')).replace(/\/+$/, ''),
    production: env.NODE_ENV === 'production',
  };

  if (config.production && !config.adminPassword) {
    throw new Error('ต้องตั้งค่า ADMIN_PASSWORD เมื่อรันแบบ production เพื่อป้องกันไม่ให้คนนอกเปิดหน้าเว็บสำนักงานได้');
  }
  return config;
}
