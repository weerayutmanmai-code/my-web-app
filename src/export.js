// ส่งออกรายงานเป็นไฟล์ Excel (.xlsx)
import ExcelJS from 'exceljs';
import { addDays, bangkokDayRange, formatThaiDate, isValidDateString, todayInBangkok } from './dates.js';

const STATUS = { todo: 'ยังไม่เริ่ม', in_progress: 'กำลังทำ', done: 'เสร็จแล้ว' };
const MAX_DAYS = 366;
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2F7EA' } };
const DATE_FMT = 'dd/mm/yyyy';
const DATETIME_FMT = 'dd/mm/yyyy hh:mm';

/** Excel ไม่มีเขตเวลา: เลื่อนเวลา UTC เป็นเวลาไทย เพื่อให้แสดงตรงกับที่เห็นในเว็บ */
const excelDateTime = (iso) => (iso ? new Date(Date.parse(iso) + 7 * 3600 * 1000) : null);
const excelDate = (ymd) => (ymd ? new Date(`${ymd}T00:00:00Z`) : null);
const bangkokDateOf = (iso) => todayInBangkok(new Date(iso));

export class ExportError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

/** ตรวจช่วงวันที่ (YYYY-MM-DD ทั้งสองค่า, from <= to, ไม่เกิน 1 ปี) */
export function validateRange({ from, to }) {
  if (!isValidDateString(from) || !isValidDateString(to)) throw new ExportError('กรุณาเลือกช่วงวันที่ให้ถูกต้อง');
  if (from > to) throw new ExportError('วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด');
  if (addDays(from, MAX_DAYS) <= to) throw new ExportError(`เลือกช่วงได้ไม่เกิน ${MAX_DAYS} วัน`);
  return { from, to };
}

const dayCount = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

/** แผ่นงานแบบตาราง: หัวตารางตัวหนา ล็อกแถวหัว และกรองข้อมูลได้ */
function addTableSheet(wb, name, columns, rows) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns.map(({ header, key, width, numFmt, wrap }) => ({
    header,
    key,
    width,
    style: { ...(numFmt ? { numFmt } : {}), alignment: { vertical: 'top', ...(wrap ? { wrapText: true } : {}) } },
  }));
  const head = ws.getRow(1);
  head.font = { bold: true };
  head.fill = HEADER_FILL;
  head.alignment = { vertical: 'middle' };
  for (const row of rows) ws.addRow(row);
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  if (!rows.length) ws.addRow({ [columns[0].key]: 'ไม่มีข้อมูลในช่วงนี้' });
  return ws;
}

function dueNote(task, today) {
  if (!task.due_date) return '';
  if (task.status !== 'done') return task.due_date < today ? 'เลยกำหนด' : '';
  return task.done_at && bangkokDateOf(task.done_at) > task.due_date ? 'เสร็จช้ากว่ากำหนด' : 'ทันกำหนด';
}

/**
 * สร้างรายงาน Excel ของช่วงวันที่ (เวลาไทย) และหน้างาน (ไม่ระบุ = ทุกหน้างาน)
 * คืนค่า { workbook, filename }
 */
export function buildReport({ db, from, to, site = null, publicUrl = '', now = new Date() }) {
  validateRange({ from, to });
  const { start } = bangkokDayRange(from);
  const { end } = bangkokDayRange(to);
  const today = todayInBangkok(now);
  const inSite = (x) => !site || x.site === site;

  const tasks = db.listTasksActiveBetween(start, end).filter(inSite);
  const inbound = db.listInboundBetween(start, end, ['report', 'issue', 'image']).filter(inSite);
  const reports = inbound.filter((m) => m.kind === 'report');
  const issues = inbound.filter((m) => m.kind === 'issue');
  const photos = inbound.filter((m) => m.kind === 'image');
  const doneInRange = (t) => t.done_at && t.done_at >= start && t.done_at < end;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'ศูนย์ประสานงานหน้างาน';
  wb.created = now;

  // ---------- สรุป ----------
  const ws = wb.addWorksheet('สรุป');
  ws.columns = [{ width: 28 }, { width: 22 }, { width: 16 }, { width: 10 }, { width: 11 }, { width: 18 }, { width: 13 }, { width: 8 }];
  ws.addRow(['รายงานสรุปงานหน้างาน']).font = { bold: true, size: 16 };
  ws.addRow([`ช่วงเวลา: ${formatThaiDate(from)} – ${formatThaiDate(to)} (${dayCount(from, to)} วัน)`]);
  ws.addRow([`หน้างาน: ${site || 'ทุกหน้างาน'}`]);
  ws.addRow([`ออกรายงานเมื่อ: ${now.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' })}`]);
  ws.addRow([]);
  ws.addRow(['ภาพรวม']).font = { bold: true, size: 13 };
  const openTasks = tasks.filter((t) => t.status !== 'done');
  const totals = [
    ['งานที่ทำอยู่ในช่วงนี้', tasks.length],
    ['เสร็จในช่วงนี้', tasks.filter(doneInRange).length],
    ['ยังไม่เสร็จ (ณ วันออกรายงาน)', openTasks.length],
    ['เลยกำหนด (ณ วันออกรายงาน)', openTasks.filter((t) => t.due_date && t.due_date < today).length],
    ['รายงานประจำวัน', reports.length],
    ['ปัญหาที่แจ้ง', issues.length],
    ['ปัญหาที่ยังไม่ปิด', issues.filter((m) => !m.resolved).length],
    ['รูปจากหน้างาน', photos.length],
  ];
  for (const row of totals) ws.addRow(row);
  ws.addRow([]);
  ws.addRow(['สรุปรายคน']).font = { bold: true, size: 13 };
  const head = ws.addRow([
    'ผู้คุมงาน', 'หน้างานประจำ', 'งานเสร็จในช่วงนี้', 'งานค้าง', 'เลยกำหนด',
    `วันที่ส่งรายงาน (จาก ${dayCount(from, to)} วัน)`, 'ปัญหาที่แจ้ง', 'รูป',
  ]);
  head.font = { bold: true };
  head.fill = HEADER_FILL;
  head.alignment = { wrapText: true, vertical: 'middle' };

  const crew = db.listSupervisors().filter((p) => p.role !== 'office');
  let peopleRows = 0;
  for (const p of crew) {
    const mine = tasks.filter((t) => t.supervisor_id === p.id);
    const msgs = inbound.filter((m) => m.supervisor_id === p.id);
    const row = [
      p.display_name,
      p.site ?? '',
      mine.filter(doneInRange).length,
      mine.filter((t) => t.status !== 'done').length,
      mine.filter((t) => t.status !== 'done' && t.due_date && t.due_date < today).length,
      new Set(msgs.filter((m) => m.kind === 'report').map((m) => bangkokDateOf(m.created_at))).size,
      msgs.filter((m) => m.kind === 'issue').length,
      msgs.filter((m) => m.kind === 'image').length,
    ];
    const hasActivity = mine.length || msgs.length;
    if (p.status !== 'active' && !hasActivity) continue;
    if (site && !hasActivity && p.site !== site) continue;
    ws.addRow(row);
    peopleRows += 1;
  }
  if (!peopleRows) ws.addRow(['ไม่มีข้อมูลในช่วงนี้']);

  // ---------- งาน ----------
  addTableSheet(wb, 'งาน', [
    { header: '#', key: 'id', width: 6 },
    { header: 'ชื่องาน', key: 'title', width: 34, wrap: true },
    { header: 'หน้างาน', key: 'site', width: 24, wrap: true },
    { header: 'ผู้รับผิดชอบ', key: 'owner', width: 18 },
    { header: 'สถานะ', key: 'status', width: 11 },
    { header: 'กำหนดเสร็จ', key: 'due', width: 12, numFmt: DATE_FMT },
    { header: 'ตามกำหนด', key: 'note', width: 16 },
    { header: 'สร้างเมื่อ', key: 'created', width: 16, numFmt: DATETIME_FMT },
    { header: 'เสร็จเมื่อ', key: 'done', width: 16, numFmt: DATETIME_FMT },
    { header: 'รูป', key: 'photos', width: 6 },
    { header: 'รายละเอียด', key: 'detail', width: 40, wrap: true },
  ], tasks.map((t) => ({
    id: t.id,
    title: t.title,
    site: t.site ?? '',
    owner: t.supervisor_name ?? '',
    status: STATUS[t.status] ?? t.status,
    due: excelDate(t.due_date),
    note: dueNote(t, today),
    created: excelDateTime(t.created_at),
    done: excelDateTime(t.done_at),
    photos: t.photo_count,
    detail: t.detail ?? '',
  })));

  const messageColumns = (textHeader) => [
    { header: 'วันเวลา', key: 'at', width: 16, numFmt: DATETIME_FMT },
    { header: 'ผู้ส่ง', key: 'sender', width: 20 },
    { header: 'กลุ่ม LINE', key: 'group', width: 18 },
    { header: 'หน้างาน', key: 'site', width: 24, wrap: true },
    { header: textHeader, key: 'text', width: 60, wrap: true },
  ];
  const messageRow = (m) => ({
    at: excelDateTime(m.created_at),
    sender: m.supervisor_name ?? '',
    group: m.group_name ?? '',
    site: m.site ?? '',
    text: m.text ?? '',
  });

  // ---------- รายงานประจำวัน / ปัญหา ----------
  addTableSheet(wb, 'รายงานประจำวัน', messageColumns('รายงาน'), reports.map(messageRow));
  addTableSheet(wb, 'ปัญหา', [
    ...messageColumns('ปัญหา'),
    { header: 'สถานะ', key: 'state', width: 12 },
  ], issues.map((m) => ({ ...messageRow(m), state: m.resolved ? 'ปิดแล้ว' : 'ยังไม่ปิด' })));

  // ---------- รูปภาพ ----------
  const base = publicUrl.replace(/\/+$/, '');
  const photoSheet = addTableSheet(wb, 'รูปภาพ', [
    { header: 'วันเวลา', key: 'at', width: 16, numFmt: DATETIME_FMT },
    { header: 'ผู้ส่ง', key: 'sender', width: 20 },
    { header: 'กลุ่ม LINE', key: 'group', width: 18 },
    { header: 'หน้างาน', key: 'site', width: 24, wrap: true },
    { header: 'งาน', key: 'task', width: 30, wrap: true },
    { header: 'รูป', key: 'link', width: 18 },
  ], photos.map((m) => ({
    at: excelDateTime(m.created_at),
    sender: m.supervisor_name ?? '',
    group: m.group_name ?? '',
    site: m.site ?? '',
    task: m.task_id ? `#${m.task_id} ${m.task_title ?? ''}` : '',
    link: !m.image_path
      ? (m.error ?? 'ไม่มีไฟล์')
      : base
        ? { text: 'เปิดรูป', hyperlink: `${base}/uploads/${m.image_path}` }
        : `/uploads/${m.image_path}`,
  })));
  photoSheet.getColumn('link').eachCell((cell, rowNumber) => {
    if (rowNumber > 1 && cell.value?.hyperlink) cell.font = { color: { argb: 'FF2457C5' }, underline: true };
  });

  const safeSite = site ? `_${site.replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40)}` : '';
  return { workbook: wb, filename: `รายงานหน้างาน_${from}_${to}${safeSite}.xlsx` };
}
