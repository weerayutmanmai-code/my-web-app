// สรุปภาพรวมประจำวันส่งให้คนในสำนักงานทาง LINE
import * as M from './messages.js';
import { addDays, bangkokDayRange, bangkokParts, formatThaiDate, formatThaiLongDate } from './dates.js';
import { createDailySchedule } from './scheduler.js';
import { pushToSupervisor } from './notify.js';

const SETTINGS_KEY = 'office_summary';

export const DEFAULT_OFFICE_SETTINGS = Object.freeze({
  enabled: true,
  time: '18:00',
  days: [1, 2, 3, 4, 5, 6], // จันทร์-เสาร์
});

const MAX_ITEMS = 8;
const SNIPPET = 70;

const snippet = (text) => {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > SNIPPET ? `${s.slice(0, SNIPPET - 1)}…` : s;
};

function listSection(title, items, format) {
  if (!items.length) return [];
  const rows = items.slice(0, MAX_ITEMS).map(format);
  if (items.length > MAX_ITEMS) rows.push(`…และอีก ${items.length - MAX_ITEMS} รายการ`);
  return ['', title, ...rows];
}

const who = (name) => (name ? ` — ${name}` : '');

/**
 * สร้างสรุปภาพรวม
 * - ก่อนเที่ยง: สรุปกิจกรรมของเมื่อวาน และบอกงานที่ครบกำหนดวันนี้
 * - ตั้งแต่เที่ยง: สรุปกิจกรรมของวันนี้ และบอกงานที่ครบกำหนดพรุ่งนี้
 */
export function buildOfficeSummary({ db, now = new Date(), publicUrl = '' }) {
  const { date: today, time } = bangkokParts(now);
  const morning = time < '12:00';
  const reportDate = morning ? addDays(today, -1) : today;
  const upcomingDate = morning ? today : addDays(today, 1);
  const { start, end } = bangkokDayRange(reportDate);

  const done = db.listTasksDoneBetween(start, end);
  const inbound = db.listInboundBetween(start, end, ['report', 'issue', 'image']);
  const reports = inbound.filter((m) => m.kind === 'report');
  const issues = inbound.filter((m) => m.kind === 'issue');
  const photos = inbound.filter((m) => m.kind === 'image').length;
  const overdue = db.listOpenTasksDueBefore(today);
  const upcoming = db.listOpenTasksDueOn(upcomingDate);
  const s = db.summary();

  const crew = db.listSupervisors().filter((p) => p.status === 'active' && p.role !== 'office');
  const reported = new Set(reports.map((m) => m.supervisor_id));
  const notReported = crew.filter((p) => !reported.has(p.id)).map((p) => p.display_name);

  const dayWord = morning ? 'เมื่อวาน' : 'วันนี้';
  const lines = [
    '📊 สรุปภาพรวมงานประจำวัน',
    formatThaiLongDate(reportDate),
    ...listSection(`✅ งานเสร็จ${dayWord} ${done.length} งาน`, done, (t) => `• #${t.id} ${t.title}${who(t.supervisor_name)}`),
    ...listSection(
      `📝 รายงานประจำวัน ${reported.size}/${crew.length} คน`,
      reports,
      (m) => `• ${m.supervisor_name}: ${snippet(m.text)}`,
    ),
  ];
  if (notReported.length) {
    const names = notReported.slice(0, MAX_ITEMS).join(', ');
    lines.push(`• ยังไม่ส่งรายงาน: ${names}${notReported.length > MAX_ITEMS ? ` และอีก ${notReported.length - MAX_ITEMS} คน` : ''}`);
  }
  lines.push(
    ...listSection(
      `🚨 ปัญหาใหม่${dayWord} ${issues.length} เรื่อง (ยังไม่ปิดทั้งหมด ${s.open_issues} เรื่อง)`,
      issues,
      (m) => `• ${m.supervisor_name}: ${snippet(m.text)}`,
    ),
  );
  if (!issues.length && s.open_issues) lines.push('', `🚨 ปัญหาที่ยังไม่ปิด ${s.open_issues} เรื่อง`);
  if (photos) lines.push('', `📷 รูปจากหน้างาน${dayWord} ${photos} รูป`);
  lines.push(
    ...listSection(`⚠️ งานเลยกำหนด ${overdue.length} งาน`, overdue, (t) =>
      `• #${t.id} ${t.title}${who(t.supervisor_name)} (กำหนด ${formatThaiDate(t.due_date)})`),
    ...listSection(`📅 ครบกำหนด${morning ? 'วันนี้' : 'พรุ่งนี้'} ${upcoming.length} งาน`, upcoming, (t) =>
      `• #${t.id} ${t.title}${who(t.supervisor_name)}`),
    '',
    `📋 งานค้างทั้งหมด ${s.open_tasks} งาน${s.pending_supervisors ? ` · รออนุมัติ ${s.pending_supervisors} คน` : ''}`,
  );
  if (publicUrl) lines.push('', `ดูรายละเอียด: ${publicUrl}`);

  return { report_date: reportDate, text: lines.join('\n') };
}

export function createOfficeSummary({ db, line, config = {}, logger = console, now = () => new Date() }) {
  const build = () => buildOfficeSummary({ db, now: now(), publicUrl: config.publicUrl });

  /** คนในสำนักงานที่จะได้รับ (ใช้งานอยู่และยังเป็นเพื่อนกับบอท) */
  const officeMembers = () =>
    db.listSupervisors().filter((p) => p.role === 'office' && p.status === 'active' && p.is_following);

  function preview() {
    const { report_date: reportDate, text } = build();
    return {
      report_date: reportDate,
      text,
      recipients: officeMembers().map((p) => ({ supervisor_id: p.id, name: p.display_name })),
    };
  }

  async function sendAll() {
    const { text, recipients } = preview();
    const result = { sent: 0, failed: 0, recipients: recipients.length };
    for (const r of recipients) {
      const member = db.getSupervisor(r.supervisor_id);
      const { pushed } = await pushToSupervisor({ db, line }, member, [M.text(text, M.mainQuickReply())], {
        kind: 'summary',
        text,
      });
      if (pushed) result.sent += 1;
      else result.failed += 1;
    }
    logger.info(`[office-summary] ส่งสำเร็จ ${result.sent} คน, ไม่สำเร็จ ${result.failed} คน`);
    return result;
  }

  const schedule = createDailySchedule({
    db, key: SETTINGS_KEY, defaults: DEFAULT_OFFICE_SETTINGS, label: 'office-summary', now, logger,
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
    build,
    preview,
    sendAll,
    status,
  };
}
