import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { createLineClient } from './line.js';
import { createBot } from './bot.js';
import { createApp } from './app.js';
import { createMorningSummary } from './morning-summary.js';
import { createDueReminders } from './reminders.js';

const config = loadConfig();
const db = openDatabase(config.dbPath);
const line = createLineClient({ channelAccessToken: config.lineChannelAccessToken });
const bot = createBot({ db, line, config });
const morningSummary = createMorningSummary({ db, line });
const dueReminders = createDueReminders({ db, line });
const app = createApp({ db, line, bot, config, morningSummary, dueReminders });
const stopSchedules = [morningSummary.start(), dueReminders.start()];

const server = app.listen(config.port, () => {
  console.log(`🚀 เว็บสำนักงาน: http://localhost:${config.port}`);
  console.log(`🔗 Webhook URL ที่ต้องใส่ใน LINE Developers: https://<โดเมนของคุณ>/webhook`);
  console.log(`💾 ข้อมูลเก็บที่: ${config.dataDir}`);
  if (!config.lineChannelSecret) console.warn('⚠️  ยังไม่ได้ตั้ง LINE_CHANNEL_SECRET: webhook จะยังไม่รับข้อความจาก LINE');
  if (line.dryRun) console.warn('⚠️  ยังไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN: โหมดทดลอง ไม่ส่งข้อความจริง');
  if (!config.adminPassword) console.warn('⚠️  ยังไม่ได้ตั้ง ADMIN_PASSWORD: ใครก็เปิดหน้าเว็บได้ (ใช้ได้เฉพาะทดสอบในเครื่อง)');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopSchedules.forEach((stop) => stop());
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
