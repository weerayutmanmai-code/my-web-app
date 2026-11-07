// ตัวตั้งเวลางานรายวัน (เวลาไทย) ที่แก้ค่าได้จากหน้าเว็บ
// ใช้ร่วมกันโดย "สรุปงานทุกเช้า" และ "เตือนงานใกล้ครบกำหนด"
import { bangkokParts } from './dates.js';

/** ถ้าเซิร์ฟเวอร์ดับตอนถึงเวลา จะทำย้อนหลังให้ถ้ากลับมาภายในกี่นาที (เลยจากนี้ถือว่าสายเกินไป ข้ามวันนั้น) */
export const CATCH_UP_MINUTES = 180;

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/**
 * ตรวจค่าตั้ง enabled / time / days และค่าเฉพาะของแต่ละงานผ่าน validators
 * validators: { key: (value) => ({ value }) | ({ error }) }
 */
export function validateSchedule(input = {}, validators = {}) {
  const errors = [];
  const out = {};
  if (input.enabled !== undefined) out.enabled = Boolean(input.enabled);
  if (input.time !== undefined) {
    if (typeof input.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) {
      errors.push('เวลาต้องอยู่ในรูปแบบ HH:MM เช่น 07:30');
    } else {
      out.time = input.time;
    }
  }
  if (input.days !== undefined) {
    const days = Array.isArray(input.days) ? [...new Set(input.days.map(Number))].sort() : null;
    if (!days || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
      errors.push('วันที่ส่งไม่ถูกต้อง');
    } else {
      out.days = days;
    }
  }
  for (const [key, validate] of Object.entries(validators)) {
    if (input[key] === undefined) continue;
    const result = validate(input[key]);
    if (result.error) errors.push(result.error);
    else out[key] = result.value;
  }
  return { settings: out, errors };
}

/**
 * งานที่ทำวันละครั้งเมื่อถึงเวลา
 * - ค่าตั้งเก็บใน settings[key] และวันที่ทำล่าสุดใน settings[`${key}_last_date`]
 * - บันทึกวันที่ก่อนเริ่มทำ กันทำซ้ำถ้าระบบรีสตาร์ทกลางทาง
 */
export function createDailySchedule({
  db, key, defaults, validators = {}, run, label = key, now = () => new Date(), logger = console,
}) {
  const lastKey = `${key}_last_date`;
  let running = false;

  const getSettings = () => ({ ...defaults, ...db.getSetting(key, {}) });
  const lastRunDate = () => db.getSetting(lastKey);

  function updateSettings(input) {
    const { settings, errors } = validateSchedule(input, validators);
    if (errors.length) {
      const err = new Error(errors.join(', '));
      err.status = 400;
      throw err;
    }
    return db.setSetting(key, { ...getSettings(), ...settings });
  }

  /** เรียกทุกนาที: ถึงเวลาแล้ว + อยู่ในวันที่เลือก + วันนี้ยังไม่ได้ทำ -> ทำ */
  async function tick() {
    if (running) return null;
    const settings = getSettings();
    if (!settings.enabled) return null;
    const nowParts = bangkokParts(now());
    if (!settings.days.includes(nowParts.weekday)) return null;
    const late = toMinutes(nowParts.time) - toMinutes(settings.time);
    if (late < 0 || late > CATCH_UP_MINUTES) return null;
    if (lastRunDate() === nowParts.date) return null;

    running = true;
    try {
      db.setSetting(lastKey, nowParts.date);
      return await run(settings);
    } finally {
      running = false;
    }
  }

  function start(intervalMs = 60_000) {
    const runTick = () => tick().catch((err) => logger.error(`[${label}] ผิดพลาด`, err));
    runTick();
    const timer = setInterval(runTick, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  return { getSettings, updateSettings, lastRunDate, tick, start };
}
