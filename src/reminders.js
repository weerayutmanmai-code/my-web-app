// เตือนงานใกล้ครบกำหนด: ส่งการ์ดงานที่ครบกำหนดในอีก N วันให้ผู้คุมงานที่รับผิดชอบ
import * as M from './messages.js';
import { addDays, bangkokParts } from './dates.js';
import { createDailySchedule } from './scheduler.js';
import { pushToSupervisor } from './notify.js';

const SETTINGS_KEY = 'due_reminder';

export const DEFAULT_REMINDER_SETTINGS = Object.freeze({
  enabled: true,
  time: '16:00',
  days: [0, 1, 2, 3, 4, 5, 6], // ทุกวัน (งานที่ครบกำหนดวันจันทร์จะได้เตือนวันอาทิตย์)
  days_before: 1, // 0 = เตือนวันเดียวกับวันครบกำหนด
});

export const MAX_DAYS_BEFORE = 3;

const validators = {
  days_before: (value) => {
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 && n <= MAX_DAYS_BEFORE
      ? { value: n }
      : { error: `จำนวนวันที่เตือนล่วงหน้าต้องเป็น 0–${MAX_DAYS_BEFORE}` };
  },
};

export function createDueReminders({ db, line, logger = console, now = () => new Date() }) {
  let schedule;

  /** งานที่จะเตือนรอบนี้ จัดกลุ่มตามผู้คุมงาน (เฉพาะคนที่ใช้งานอยู่และยังเป็นเพื่อนกับบอท) */
  function preview(settings = schedule.getSettings()) {
    const targetDate = addDays(bangkokParts(now()).date, settings.days_before);
    const groups = new Map();
    for (const task of db.listTasksToRemind(targetDate)) {
      if (!groups.has(task.supervisor_id)) groups.set(task.supervisor_id, []);
      groups.get(task.supervisor_id).push(task);
    }
    const recipients = [];
    for (const [supervisorId, tasks] of groups) {
      const sup = db.getSupervisor(supervisorId);
      if (!sup || sup.status !== 'active' || !sup.is_following) continue;
      recipients.push({
        supervisor_id: sup.id,
        name: sup.display_name,
        tasks: tasks.map(({ id, title, site, due_date, status }) => ({ id, title, site, due_date, status })),
      });
    }
    return { target_date: targetDate, days_before: settings.days_before, recipients };
  }

  /** ส่งเตือนงานที่ยังไม่ได้เตือน (ส่งไม่สำเร็จจะยังไม่นับว่าเตือนแล้ว กด "ส่งตอนนี้" ซ้ำได้) */
  async function sendDue(settings = schedule.getSettings()) {
    const { target_date: targetDate, recipients } = preview(settings);
    const result = { sent: 0, failed: 0, recipients: recipients.length, tasks: 0 };
    for (const r of recipients) {
      const sup = db.getSupervisor(r.supervisor_id);
      const tasks = r.tasks.map((t) => db.getTask(t.id));
      const { pushed } = await pushToSupervisor(
        { db, line },
        sup,
        [M.dueReminder(tasks, settings.days_before)],
        {
          kind: 'reminder',
          task_id: tasks.length === 1 ? tasks[0].id : null,
          text: M.dueReminderLog(tasks, settings.days_before),
        },
      );
      if (pushed) {
        db.markReminded(tasks.map((t) => t.id), targetDate);
        result.sent += 1;
        result.tasks += tasks.length;
      } else {
        result.failed += 1;
      }
    }
    logger.info(`[due-reminder] เตือนสำเร็จ ${result.sent} คน (${result.tasks} งาน), ไม่สำเร็จ ${result.failed} คน`);
    return result;
  }

  schedule = createDailySchedule({
    db,
    key: SETTINGS_KEY,
    defaults: DEFAULT_REMINDER_SETTINGS,
    validators,
    label: 'due-reminder',
    now,
    logger,
    run: (settings) => sendDue(settings),
  });

  function status() {
    return { settings: schedule.getSettings(), last_run_date: schedule.lastRunDate(), ...preview() };
  }

  return {
    getSettings: schedule.getSettings,
    updateSettings: schedule.updateSettings,
    tick: schedule.tick,
    start: schedule.start,
    preview: () => preview(),
    sendDue: () => sendDue(),
    status,
  };
}
