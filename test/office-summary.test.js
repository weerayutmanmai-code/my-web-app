import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOfficeSummary, createOfficeSummary } from '../src/office-summary.js';
import { setup, activeSupervisor, ev, replyText, silentLogger } from './helpers.js';

// เวลาไทย: เสาร์ 7 พ.ย. 2026
const bkk = (date, time) => new Date(`${date}T${time}:00+07:00`);
const FRI = '2026-11-06';
const SAT = '2026-11-07';
const SUN = '2026-11-08';
const at = (date, time) => bkk(date, time).toISOString();

/** ข้อมูลตัวอย่าง: ผู้คุมงาน 2 คน + คนในสำนักงาน 1 คน */
async function seed(ctx) {
  const a = await activeSupervisor(ctx, 'U1');
  ctx.db.updateSupervisor(a.id, { name: 'สมชาย' });
  const b = await activeSupervisor(ctx, 'U2');
  ctx.db.updateSupervisor(b.id, { name: 'ประเสริฐ' });
  const office = await activeSupervisor(ctx, 'UO');
  ctx.db.updateSupervisor(office.id, { name: 'คุณแอน', role: 'office' });

  const done = ctx.db.createTask({ title: 'ก่ออิฐ', supervisor_id: a.id, due_date: SAT });
  ctx.db.raw.prepare('UPDATE tasks SET status = ?, done_at = ? WHERE id = ?').run('done', at(SAT, '10:00'), done.id);
  const doneYesterday = ctx.db.createTask({ title: 'งานเมื่อวาน', supervisor_id: a.id });
  ctx.db.raw.prepare('UPDATE tasks SET status = ?, done_at = ? WHERE id = ?').run('done', at(FRI, '15:00'), doneYesterday.id);
  ctx.db.createTask({ title: 'วงกบ', supervisor_id: b.id, due_date: '2026-11-05' }); // เลยกำหนด
  ctx.db.createTask({ title: 'เทพื้น', supervisor_id: a.id, due_date: SUN }); // ครบกำหนดพรุ่งนี้

  ctx.db.addMessage({ supervisor_id: a.id, direction: 'in', kind: 'report', text: 'เทพื้นเสร็จ 80% คนงาน 12 คน', created_at: at(SAT, '17:00') });
  ctx.db.addMessage({ supervisor_id: b.id, direction: 'in', kind: 'issue', text: 'วงกบขนาดไม่ตรงแบบ', created_at: at(SAT, '11:00') });
  ctx.db.addMessage({ supervisor_id: b.id, direction: 'in', kind: 'issue', text: 'ปัญหาเก่า', created_at: at(FRI, '09:00') });
  ctx.db.addMessage({ supervisor_id: a.id, direction: 'in', kind: 'image', created_at: at(SAT, '12:00') });
  ctx.db.addMessage({ supervisor_id: a.id, direction: 'in', kind: 'image', created_at: at(SAT, '12:01') });
  return { a, b, office };
}

test('สรุปตอนเย็น: กิจกรรมวันนี้ + งานที่ครบกำหนดพรุ่งนี้', async () => {
  const ctx = setup();
  await seed(ctx);
  const { report_date: date, text } = buildOfficeSummary({ db: ctx.db, now: bkk(SAT, '18:00'), publicUrl: 'https://app.example' });

  assert.equal(date, SAT);
  assert.match(text, /📊 สรุปภาพรวมงานประจำวัน\nวันเสาร์ที่ 7 พ.ย. 69/);
  assert.match(text, /✅ งานเสร็จวันนี้ 1 งาน\n• #\d+ ก่ออิฐ — สมชาย/);
  assert.doesNotMatch(text, /งานเมื่อวาน/);
  assert.match(text, /📝 รายงานประจำวัน 1\/2 คน\n• สมชาย: เทพื้นเสร็จ 80% คนงาน 12 คน\n• ยังไม่ส่งรายงาน: ประเสริฐ/);
  assert.doesNotMatch(text, /ยังไม่ส่งรายงาน:.*คุณแอน/, 'คนในสำนักงานไม่ต้องส่งรายงาน');
  assert.match(text, /🚨 ปัญหาใหม่วันนี้ 1 เรื่อง \(ยังไม่ปิดทั้งหมด 2 เรื่อง\)\n• ประเสริฐ: วงกบขนาดไม่ตรงแบบ/);
  assert.match(text, /📷 รูปจากหน้างานวันนี้ 2 รูป/);
  assert.match(text, /⚠️ งานเลยกำหนด 1 งาน\n• #\d+ วงกบ — ประเสริฐ \(กำหนด 5 พ.ย. 69\)/);
  assert.match(text, /📅 ครบกำหนดพรุ่งนี้ 1 งาน\n• #\d+ เทพื้น — สมชาย/);
  assert.match(text, /📋 งานค้างทั้งหมด 2 งาน/);
  assert.match(text, /ดูรายละเอียด: https:\/\/app\.example$/);
});

test('สรุปตอนเช้า: กิจกรรมเมื่อวาน + งานที่ครบกำหนดวันนี้', async () => {
  const ctx = setup();
  await seed(ctx);
  const { report_date: date, text } = buildOfficeSummary({ db: ctx.db, now: bkk(SUN, '08:00') });
  assert.equal(date, SAT);
  assert.match(text, /✅ งานเสร็จเมื่อวาน 1 งาน/);
  assert.match(text, /📅 ครบกำหนดวันนี้ 1 งาน\n• #\d+ เทพื้น/);
  assert.doesNotMatch(text, /ดูรายละเอียด/, 'ไม่มี publicUrl ก็ไม่ใส่ลิงก์');
});

test('วันที่ไม่มีอะไรเกิดขึ้น: ยังได้สรุปสั้นๆ', () => {
  const ctx = setup();
  const { text } = buildOfficeSummary({ db: ctx.db, now: bkk(SAT, '18:00') });
  assert.match(text, /📊 สรุปภาพรวมงานประจำวัน/);
  assert.match(text, /📋 งานค้างทั้งหมด 0 งาน/);
  assert.doesNotMatch(text, /✅|🚨|⚠️/);
});

test('ส่งเฉพาะคนในสำนักงานที่ใช้งานอยู่ และ tick ส่ง 18:00 วันละครั้ง', async () => {
  const ctx = setup();
  const { office } = await seed(ctx);
  const clock = { now: bkk(SAT, '17:59') };
  const summary = createOfficeSummary({ db: ctx.db, line: ctx.line, logger: silentLogger, now: () => clock.now });

  assert.deepEqual(summary.preview().recipients, [{ supervisor_id: office.id, name: 'คุณแอน' }]);
  assert.equal(await summary.tick(), null);
  clock.now = bkk(SAT, '18:00');
  assert.deepEqual(await summary.tick(), { sent: 1, failed: 0, recipients: 1 });
  assert.equal(await summary.tick(), null, 'วันนี้ส่งแล้ว');

  const pushes = ctx.line.calls.push;
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].to, 'UO');
  assert.match(pushes[0].messages[0].text, /สรุปภาพรวมงานประจำวัน/);
  assert.equal(ctx.db.listMessages(office.id).at(-1).kind, 'summary');

  clock.now = bkk(SUN, '18:00');
  assert.equal(await summary.tick(), null, 'อาทิตย์ไม่อยู่ในวันที่ส่ง (ค่าเริ่มต้น จ.-ส.)');
});

test('พิมพ์ "สรุป": สำนักงานได้ภาพรวม ผู้คุมงานได้งานของตัวเอง', async () => {
  const ctx = setup();
  await seed(ctx);

  await ctx.bot.handleEvent(ev.text('สรุป', 'UO'));
  assert.match(replyText(ctx.line), /📊 สรุปภาพรวมงานประจำวัน/);

  await ctx.bot.handleEvent(ev.text('สรุป', 'U2'));
  assert.match(replyText(ctx.line), /📊 สรุปงานของคุณ คุณประเสริฐ/);
  assert.match(replyText(ctx.line), /วงกบ/);

  const idle = await activeSupervisor(ctx, 'U9');
  assert.ok(idle);
  await ctx.bot.handleEvent(ev.text('สรุป', 'U9'));
  assert.match(replyText(ctx.line), /ไม่มีงานค้าง/);
  assert.equal(ctx.line.calls.push.length, 0, 'ตอบด้วย reply ไม่ใช้โควตา push');
});
