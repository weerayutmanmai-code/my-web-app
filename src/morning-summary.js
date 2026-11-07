// สรุปงานส่งเข้า LINE ผู้คุมงานทุกเช้า
import * as M from './messages.js';
import { bangkokParts, formatThaiDate, formatThaiLongDate } from './dates.js';

const SETTINGS_KEY = 'morning_summary';
const LAST_SENT_KEY = 'morning_summary_last_date';

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  time: '07:30',
  days: [1, 2, 3, 4, 5, 6], // จันทร์-เสาร์ (0 = อาทิตย์)
});

/** ถ้าเซิร์ฟเวอร์ดับตอนถึงเวลาส่ง จะส่งย้อนหลังให้ถ้ากลับมาภายในกี่นาที (เลยจากนี้ถือว่าสายเกินไป) */
export const CATCH_UP_MINUTES = 180;
const MAX_LISTED_TASKS = 20;

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export function validateSettings(input = {}) {
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
  return { settings: out, errors };
}

/** ข้อความสรุปงานของผู้คุมงานหนึ่งคน (null = ไม่มีงานค้าง ไม่ต้องส่ง) */
export function buildSummaryText(sup, tasks, today) {
  const open = tasks.filter((t) => t.status !== 'done');
  if (!open.length) return null;

  const byDue = (a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || a.id - b.id;
  const overdue = open.filter((t) => t.due_date && t.due_date < today).sort(byDue);
  const dueToday = open.filter((t) => t.due_date === today).sort(byDue);
  const others = open.filter((t) => !t.due_date || t.due_date > today).sort(byDue);

  let listed = 0;
  const line = (t, { showDue }) => {
    listed += 1;
    const extras = [];
    if (showDue && t.due_date) extras.push(`กำหนด ${formatThaiDate(t.due_date)}`);
    if (t.status === 'in_progress') extras.push('▶️ กำลังทำ');
    return `• #${t.id} ${t.title}${extras.length ? ` (${extras.join(' · ')})` : ''}`;
  };
  const section = (title, list, opts) => {
    if (!list.length) return [];
    const rows = [];
    for (const t of list) {
      if (listed >= MAX_LISTED_TASKS) break;
      rows.push(line(t, opts));
    }
    return rows.length ? ['', `${title} ${list.length} งาน`, ...rows] : [];
  };

  const name = M.nameOf(sup);
  const body = [
    `🌅 สวัสดีตอนเช้าครับ${name ? ` คุณ${name}` : ''}`,
    `สรุปงาน${formatThaiLongDate(today)}`,
    ...section('🔴 เลยกำหนด', overdue, { showDue: true }),
    ...section('🟡 ครบกำหนดวันนี้', dueToday, { showDue: false }),
    ...section('📋 งานค้างอื่นๆ', others, { showDue: true }),
  ];
  if (open.length > listed) body.push(`…และอีก ${open.length - listed} งาน`);
  body.push('', 'กด "📋 งานของฉัน" เพื่ออัปเดตสถานะงานครับ');
  return body.join('\n');
}

export function createMorningSummary({ db, line, logger = console, now = () => new Date() }) {
  let running = false;

  const getSettings = () => ({ ...DEFAULT_SETTINGS, ...db.getSetting(SETTINGS_KEY, {}) });

  function updateSettings(input) {
    const { settings, errors } = validateSettings(input);
    if (errors.length) {
      const err = new Error(errors.join(', '));
      err.status = 400;
      throw err;
    }
    return db.setSetting(SETTINGS_KEY, { ...getSettings(), ...settings });
  }

  /** ใครจะได้รับสรุป และได้ข้อความว่าอะไร (ยังไม่ส่ง) */
  function preview() {
    const today = bangkokParts(now()).date;
    const recipients = [];
    for (const sup of db.listSupervisors()) {
      if (sup.status !== 'active' || !sup.is_following) continue;
      const tasks = db.listOpenTasksFor(sup.id);
      const text = buildSummaryText(sup, tasks, today);
      if (!text) continue;
      recipients.push({
        supervisor_id: sup.id,
        name: sup.display_name,
        task_count: tasks.length,
        overdue_count: tasks.filter((t) => t.due_date && t.due_date < today).length,
        text,
      });
    }
    return { today, recipients };
  }

  async function sendAll() {
    const { recipients } = preview();
    const result = { sent: 0, failed: 0, recipients: recipients.length };
    for (const r of recipients) {
      const sup = db.getSupervisor(r.supervisor_id);
      let error = null;
      if (line.dryRun) {
        error = 'โหมดทดลอง: ยังไม่ได้ตั้งค่า LINE จึงไม่ได้ส่งจริง';
      } else {
        try {
          await line.push(sup.line_user_id, [M.text(r.text, M.mainQuickReply())]);
        } catch (err) {
          error = `ส่ง LINE ไม่สำเร็จ (${err.message})`;
        }
      }
      db.addMessage({ supervisor_id: sup.id, direction: 'out', kind: 'summary', text: r.text, error });
      if (error) result.failed += 1;
      else result.sent += 1;
    }
    logger.info(`[morning-summary] ส่งสำเร็จ ${result.sent} คน, ไม่สำเร็จ ${result.failed} คน`);
    return result;
  }

  /** เรียกทุกนาที: ถึงเวลาแล้ว + วันนี้ยังไม่ได้ส่ง -> ส่ง */
  async function tick() {
    if (running) return null;
    const settings = getSettings();
    if (!settings.enabled) return null;
    const nowParts = bangkokParts(now());
    if (!settings.days.includes(nowParts.weekday)) return null;
    const late = toMinutes(nowParts.time) - toMinutes(settings.time);
    if (late < 0 || late > CATCH_UP_MINUTES) return null;
    if (db.getSetting(LAST_SENT_KEY) === nowParts.date) return null;

    running = true;
    try {
      db.setSetting(LAST_SENT_KEY, nowParts.date); // บันทึกก่อนส่ง กันส่งซ้ำถ้าระบบรีสตาร์ทกลางทาง
      return await sendAll();
    } finally {
      running = false;
    }
  }

  function status() {
    return { settings: getSettings(), last_sent_date: db.getSetting(LAST_SENT_KEY), ...preview() };
  }

  function start(intervalMs = 60_000) {
    const run = () => tick().catch((err) => logger.error('[morning-summary] ผิดพลาด', err));
    run();
    const timer = setInterval(run, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  return { getSettings, updateSettings, preview, sendAll, tick, status, start };
}
