import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { buildReport, validateRange } from '../src/export.js';
import { setup, activeSupervisor } from './helpers.js';

const at = (date, time) => new Date(`${date}T${time}:00+07:00`).toISOString();
const NOW = new Date('2026-11-07T12:00:00+07:00');

/** อ่านไฟล์ที่สร้างกลับมา เพื่อตรวจสิ่งที่ผู้ใช้จะเห็นใน Excel จริง */
async function roundTrip(workbook) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await workbook.xlsx.writeBuffer());
  return wb;
}
const rowValues = (ws) => {
  const rows = [];
  ws.eachRow((row) => rows.push(row.values.slice(1)));
  return rows;
};

async function seed(ctx) {
  const a = await activeSupervisor(ctx, 'U1');
  ctx.db.updateSupervisor(a.id, { name: 'สมชาย', site: 'ลาดพร้าว' });
  const b = await activeSupervisor(ctx, 'U2');
  ctx.db.updateSupervisor(b.id, { name: 'ประเสริฐ', site: 'บางนา' });

  const t1 = ctx.db.createTask({ title: 'เทพื้น', site: 'ลาดพร้าว', supervisor_id: a.id, due_date: '2026-11-05', created_at: at('2026-11-01', '09:00') });
  ctx.db.raw.prepare('UPDATE tasks SET status = ?, done_at = ? WHERE id = ?').run('done', at('2026-11-06', '10:00'), t1.id); // เสร็จช้า
  ctx.db.createTask({ title: 'ผูกเหล็ก', site: 'ลาดพร้าว', supervisor_id: a.id, due_date: '2026-11-04', created_at: at('2026-11-02', '09:00') }); // เลยกำหนด
  ctx.db.createTask({ title: 'วงกบ', site: 'บางนา', supervisor_id: b.id, created_at: at('2026-11-03', '09:00') });
  ctx.db.createTask({ title: 'งานหลังช่วง', site: 'บางนา', supervisor_id: b.id, created_at: at('2026-12-01', '09:00') });

  const add = (sup, kind, text, when, extra = {}) =>
    ctx.db.addMessage({ supervisor_id: sup.id, direction: 'in', kind, text, created_at: when, ...extra });
  add(a, 'report', 'รายงานวันที่ 2', at('2026-11-02', '17:00'));
  add(a, 'report', 'รายงานวันที่ 2 รอบสอง', at('2026-11-02', '18:00'));
  add(a, 'report', 'รายงานวันที่ 3', at('2026-11-03', '17:00'));
  add(b, 'issue', 'ไฟดับ', at('2026-11-04', '13:00'));
  add(a, 'image', null, at('2026-11-06', '10:05'), { task_id: t1.id, image_path: '2026-11/abc.jpg' });
  add(a, 'report', 'นอกช่วง', at('2026-10-31', '17:00'));
  return { a, b, t1 };
}

test('validateRange', () => {
  assert.deepEqual(validateRange({ from: '2026-11-01', to: '2026-11-30' }), { from: '2026-11-01', to: '2026-11-30' });
  assert.throws(() => validateRange({ from: '2026-11-30', to: '2026-11-01' }), /ไม่เกินวันที่สิ้นสุด/);
  assert.throws(() => validateRange({ from: '2026-13-01', to: '2026-11-01' }), /ช่วงวันที่/);
  assert.throws(() => validateRange({ from: '2025-01-01', to: '2026-11-30' }), /ไม่เกิน 366 วัน/);
});

test('รายงานทุกหน้างาน: มีครบ 5 แผ่นงานและตัวเลขถูกต้อง', async () => {
  const ctx = setup();
  const { t1 } = await seed(ctx);
  const { workbook, filename } = buildReport({
    db: ctx.db, from: '2026-11-01', to: '2026-11-07', publicUrl: 'https://app.example', now: NOW,
  });
  assert.equal(filename, 'รายงานหน้างาน_2026-11-01_2026-11-07.xlsx');
  const wb = await roundTrip(workbook);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['สรุป', 'งาน', 'รายงานประจำวัน', 'ปัญหา', 'รูปภาพ']);

  const summary = rowValues(wb.getWorksheet('สรุป'));
  const total = (label) => summary.find((r) => r[0] === label)?.[1];
  assert.equal(total('งานที่ทำอยู่ในช่วงนี้'), 3, 'ไม่รวมงานที่สร้างหลังช่วง');
  assert.equal(total('เสร็จในช่วงนี้'), 1);
  assert.equal(total('เลยกำหนด (ณ วันออกรายงาน)'), 1);
  assert.equal(total('รายงานประจำวัน'), 3, 'ไม่รวมรายงานนอกช่วง');
  assert.equal(total('ปัญหาที่ยังไม่ปิด'), 1);
  const somchai = summary.find((r) => r[0] === 'สมชาย');
  // [ชื่อ, หน้างาน, เสร็จ, ค้าง, เลยกำหนด, วันที่ส่งรายงาน, ปัญหา, รูป]
  assert.deepEqual(somchai, ['สมชาย', 'ลาดพร้าว', 1, 1, 1, 2, 0, 1]);

  const tasks = rowValues(wb.getWorksheet('งาน'));
  assert.equal(tasks[0][0], '#');
  const done = tasks.find((r) => r[0] === t1.id);
  assert.equal(done[4], 'เสร็จแล้ว');
  assert.equal(done[6], 'เสร็จช้ากว่ากำหนด');
  assert.ok(done[5] instanceof Date, 'กำหนดเสร็จเป็นวันที่ของ Excel');
  assert.equal(done[8].toISOString(), '2026-11-06T10:00:00.000Z', 'เวลาแสดงเป็นเวลาไทย');
  assert.equal(tasks.find((r) => r[1] === 'ผูกเหล็ก')[6], 'เลยกำหนด');
  assert.ok(!tasks.some((r) => r[1] === 'งานหลังช่วง'));
  assert.ok(wb.getWorksheet('งาน').autoFilter, 'กรองข้อมูลได้');

  const reports = rowValues(wb.getWorksheet('รายงานประจำวัน'));
  assert.equal(reports.length, 4);
  assert.equal(reports[1][1], 'สมชาย');
  assert.equal(reports[1][3], 'ลาดพร้าว');

  const issues = rowValues(wb.getWorksheet('ปัญหา'));
  assert.deepEqual(issues[1].slice(1), ['ประเสริฐ', '', 'บางนา', 'ไฟดับ', 'ยังไม่ปิด']);

  const photo = rowValues(wb.getWorksheet('รูปภาพ'))[1];
  assert.equal(photo[4], `#${t1.id} เทพื้น`);
  assert.deepEqual(photo[5], { text: 'เปิดรูป', hyperlink: 'https://app.example/uploads/2026-11/abc.jpg' });
});

test('กรองเฉพาะหน้างาน', async () => {
  const ctx = setup();
  await seed(ctx);
  const { workbook, filename } = buildReport({ db: ctx.db, from: '2026-11-01', to: '2026-11-07', site: 'บางนา', now: NOW });
  assert.equal(filename, 'รายงานหน้างาน_2026-11-01_2026-11-07_บางนา.xlsx');
  const wb = await roundTrip(workbook);
  const tasks = rowValues(wb.getWorksheet('งาน')).slice(1);
  assert.deepEqual(tasks.map((r) => r[1]), ['วงกบ']);
  const people = rowValues(wb.getWorksheet('สรุป')).map((r) => r[0]);
  assert.ok(people.includes('ประเสริฐ'));
  assert.ok(!people.includes('สมชาย'), 'คนที่ไม่เกี่ยวกับหน้างานนี้ไม่แสดง');
  assert.equal(rowValues(wb.getWorksheet('รายงานประจำวัน'))[1][0], 'ไม่มีข้อมูลในช่วงนี้');
});
