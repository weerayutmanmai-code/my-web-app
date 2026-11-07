import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { verifySignature } from './line.js';
import { createApiRouter } from './api.js';
import { createMorningSummary } from './morning-summary.js';
import { createDueReminders } from './reminders.js';
import { createOfficeSummary } from './office-summary.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));

/** ล็อกหน้าเว็บสำนักงานด้วย HTTP Basic Auth (ถ้าตั้ง ADMIN_PASSWORD ไว้) */
function basicAuth({ adminUser, adminPassword }) {
  if (!adminPassword) return (req, res, next) => next();
  const expected = Buffer.from(`${adminUser}:${adminPassword}`);
  return (req, res, next) => {
    const [scheme, encoded] = (req.get('authorization') || '').split(' ');
    if (scheme === 'Basic' && encoded) {
      const given = Buffer.from(encoded, 'base64');
      if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) return next();
    }
    res
      .status(401)
      .set('WWW-Authenticate', 'Basic realm="Site coordination", charset="UTF-8"')
      .type('text/plain; charset=utf-8')
      .send('ต้องเข้าสู่ระบบก่อน');
  };
}

export function createApp({
  db, line, bot, config, morningSummary, dueReminders, officeSummary, logger = console,
}) {
  const schedules = {
    morningSummary: morningSummary ?? createMorningSummary({ db, line, logger }),
    dueReminders: dueReminders ?? createDueReminders({ db, line, logger }),
    officeSummary: officeSummary ?? createOfficeSummary({ db, line, config, logger }),
  };
  const app = express();
  app.disable('x-powered-by');

  app.get('/healthz', (req, res) => res.json({ ok: true }));

  // LINE webhook: ต้องอ่าน body ดิบเพื่อตรวจลายเซ็น และไม่อยู่หลังรหัสผ่าน
  app.post('/webhook', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => {
    if (!config.lineChannelSecret) {
      logger.warn('[webhook] ยังไม่ได้ตั้งค่า LINE_CHANNEL_SECRET');
      return res.status(503).json({ error: 'LINE_CHANNEL_SECRET is not configured' });
    }
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!verifySignature(config.lineChannelSecret, raw, req.get('x-line-signature'))) {
      return res.status(401).json({ error: 'invalid signature' });
    }
    let payload;
    try {
      payload = JSON.parse(raw.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'invalid JSON' });
    }

    // ตอบ LINE ทันที แล้วค่อยประมวลผล (LINE แนะนำให้ตอบ webhook ให้เร็ว)
    res.status(200).json({ ok: true });
    const events = Array.isArray(payload.events) ? payload.events : [];
    app.locals.lastWebhook = bot.handleEvents(events);
    return undefined;
  });

  app.use(basicAuth(config));
  app.use('/api', express.json({ limit: '100kb' }), createApiRouter({ db, line, ...schedules, publicUrl: config.publicUrl }));
  app.use('/uploads', express.static(config.uploadDir, { index: false, fallthrough: false, maxAge: '7d' }));
  app.use(express.static(PUBLIC_DIR, { index: 'index.html' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) logger.error(err);
    res.status(status).json({ error: status >= 500 ? 'เกิดข้อผิดพลาดในระบบ' : err.message });
  });

  return app;
}
