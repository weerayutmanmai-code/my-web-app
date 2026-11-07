// สรุปงานส่งเข้า LINE ผู้คุมงานทุกเช้า
import * as M from './messages.js';
import { bangkokParts, formatThaiDate, formatThaiLongDate } from './dates.js';
import { createDailySchedule, validateSchedule } from './scheduler.js';
import { pushToSupervisor } from './notify.js';

export { CATCH_UP_MINUTES } from './scheduler.js';

const SETTINGS_KEY = 'morning_summary';

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  time: '07:30',
  days: [1, 2, 3, 4, 5, 6], // จันทร์-เสาร์ (0 = อาทิตย์)
});

const MAX_LISTED_TASKS = 20;

export const validateSettings = (input) => validateSchedule(input);

/** ข้อความสรุปงานของผู้คุมงานหนึ่งคน (null = ไม่มีงานค้าง ไม่ต้องส่ง) */
export function buildSummaryText(sup, tasks, today, { greeting = '🌅 สวัสดีตอนเช้าครับ', showAssignee = false } = {}) {
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
    const owner = showAssignee ? ` — ${t.supervisor_name ?? 'ยังไม่มีผู้รับผิดชอบ'}` : '';
    return `• #${t.id} ${t.title}${owner}${extras.length ? ` (${extras.join(' · ')})` : ''}`;
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
    `${greeting}${name ? ` คุณ${name}` : ''}`,
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
      const { pushed } = await pushToSupervisor({ db, line }, sup, [M.text(r.text, M.mainQuickReply())], {
        kind: 'summary',
        text: r.text,
      });
      if (pushed) result.sent += 1;
      else result.failed += 1;
    }
    logger.info(`[morning-summary] ส่งสำเร็จ ${result.sent} คน, ไม่สำเร็จ ${result.failed} คน`);
    return result;
  }

  const schedule = createDailySchedule({
    db, key: SETTINGS_KEY, defaults: DEFAULT_SETTINGS, label: 'morning-summary', now, logger,
    run: () => sendAll(),
  });

  function status() {
    return { settings: schedule.getSettings(), last_sent_date: schedule.lastRunDate(), ...preview() };
  }

  return {
    getSettings: schedule.getSettings,
    updateSettings: schedule.updateSettings,
    tick: schedule.tick,
    start: schedule.start,
    preview,
    sendAll,
    status,
  };
}
