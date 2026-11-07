import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup, ev, activeSupervisor, lastReply, replyText } from './helpers.js';

test('เพิ่มเพื่อนครั้งแรก: สร้างผู้คุมงานสถานะรออนุมัติ และแจ้งสำนักงาน', async () => {
  const ctx = setup();
  await ctx.bot.handleEvent(ev.follow('U1'));

  const sup = ctx.db.getSupervisorByLineId('U1');
  assert.equal(sup.status, 'pending');
  assert.equal(sup.line_name, 'ช่าง-U1');
  assert.match(replyText(ctx.line), /อนุมัติ/);
  const [msg] = ctx.db.listMessages(sup.id);
  assert.equal(msg.kind, 'system');
  assert.equal(ctx.db.summary().pending_supervisors, 1);
});

test('AUTO_APPROVE: ผู้คุมงานใช้งานได้ทันที', async () => {
  const ctx = setup({ autoApprove: true });
  await ctx.bot.handleEvent(ev.follow('U1'));
  assert.equal(ctx.db.getSupervisorByLineId('U1').status, 'active');
  assert.match(replyText(ctx.line), /เมนูผู้คุมงาน/);
});

test('ผู้ใช้ที่ยังไม่อนุมัติ: เก็บข้อความไว้ แต่ยังใช้คำสั่งไม่ได้', async () => {
  const ctx = setup();
  await ctx.bot.handleEvent(ev.text('งานของฉัน', 'U2'));
  const sup = ctx.db.getSupervisorByLineId('U2');
  assert.equal(sup.status, 'pending');
  assert.match(replyText(ctx.line), /รอสำนักงานอนุมัติ/);
  assert.ok(ctx.db.listMessages(sup.id).some((m) => m.text === 'งานของฉัน'));
});

test('"งานของฉัน": แสดงเฉพาะงานค้างของตัวเองเป็นการ์ด', async () => {
  const ctx = setup();
  const me = await activeSupervisor(ctx, 'U1');
  const other = await activeSupervisor(ctx, 'U2');
  ctx.db.createTask({ title: 'เทพื้นชั้น 2', supervisor_id: me.id, due_date: '2026-11-10' });
  ctx.db.createTask({ title: 'งานเสร็จแล้ว', supervisor_id: me.id, status: 'done' });
  ctx.db.createTask({ title: 'งานของคนอื่น', supervisor_id: other.id });

  await ctx.bot.handleEvent(ev.text('งานของฉัน', 'U1'));
  const [intro, flex] = lastReply(ctx.line);
  assert.match(intro.text, /งานค้าง 1 งาน/);
  assert.equal(flex.type, 'flex');
  assert.equal(flex.contents.type, 'carousel');
  assert.equal(flex.contents.contents.length, 1);
  assert.match(JSON.stringify(flex), /เทพื้นชั้น 2/);
  assert.doesNotMatch(JSON.stringify(flex), /งานของคนอื่น/);
});

test('ไม่มีงานค้าง: ตอบว่าไม่มีงาน', async () => {
  const ctx = setup();
  await activeSupervisor(ctx);
  await ctx.bot.handleEvent(ev.text('งาน'));
  assert.match(replyText(ctx.line), /ไม่มีงานค้าง/);
});

test('กดปุ่ม "เสร็จแล้ว": อัปเดตสถานะงานและบันทึกลงไทม์ไลน์', async () => {
  const ctx = setup();
  const sup = await activeSupervisor(ctx);
  const task = ctx.db.createTask({ title: 'ผูกเหล็กคาน', supervisor_id: sup.id });

  await ctx.bot.handleEvent(ev.postback(`action=status&task=${task.id}&value=in_progress`));
  assert.equal(ctx.db.getTask(task.id).status, 'in_progress');

  await ctx.bot.handleEvent(ev.postback(`action=status&task=${task.id}&value=done`));
  const done = ctx.db.getTask(task.id);
  assert.equal(done.status, 'done');
  assert.ok(done.done_at);
  assert.match(replyText(ctx.line), /เสร็จเรียบร้อย/);
  const statusLogs = ctx.db.listMessages(sup.id).filter((m) => m.kind === 'status');
  assert.equal(statusLogs.length, 2);
  assert.equal(statusLogs[1].task_id, task.id);

  // กด "เริ่มงาน" จากการ์ดเก่าหลังปิดงานแล้ว ต้องไม่ย้อนสถานะ
  await ctx.bot.handleEvent(ev.postback(`action=status&task=${task.id}&value=in_progress`));
  assert.equal(ctx.db.getTask(task.id).status, 'done');
});

test('กดปุ่มงานของคนอื่น: ปฏิเสธ และไม่เปลี่ยนสถานะ', async () => {
  const ctx = setup();
  await activeSupervisor(ctx, 'U1');
  const other = await activeSupervisor(ctx, 'U2');
  const task = ctx.db.createTask({ title: 'งาน U2', supervisor_id: other.id });

  await ctx.bot.handleEvent(ev.postback(`action=status&task=${task.id}&value=done`, 'U1'));
  assert.equal(ctx.db.getTask(task.id).status, 'todo');
  assert.match(replyText(ctx.line), /ไม่พบงานนี้/);
});

test('รายงานแบบสองขั้น: พิมพ์ "รายงาน" แล้วพิมพ์รายละเอียด', async () => {
  const ctx = setup();
  const sup = await activeSupervisor(ctx);

  await ctx.bot.handleEvent(ev.text('รายงาน'));
  assert.equal(ctx.db.getSupervisor(sup.id).pending_action, 'report');
  assert.match(replyText(ctx.line), /พิมพ์รายละเอียดรายงาน/);

  await ctx.bot.handleEvent(ev.text('เทพื้นเสร็จ 80% คนงาน 12 คน'));
  const report = ctx.db.listMessages(sup.id).find((m) => m.kind === 'report');
  assert.equal(report.text, 'เทพื้นเสร็จ 80% คนงาน 12 คน');
  assert.equal(ctx.db.getSupervisor(sup.id).pending_action, null);
  assert.match(replyText(ctx.line), /บันทึกรายงานแล้ว/);
});

test('"ยกเลิก" ล้างสถานะที่รอไว้ ข้อความถัดไปเป็นแชทธรรมดา', async () => {
  const ctx = setup();
  const sup = await activeSupervisor(ctx);
  await ctx.bot.handleEvent(ev.text('แจ้งปัญหา'));
  await ctx.bot.handleEvent(ev.text('ยกเลิก'));
  await ctx.bot.handleEvent(ev.text('สวัสดีครับ'));
  const kinds = ctx.db.listMessages(sup.id).filter((m) => m.kind !== 'system').map((m) => m.kind);
  assert.deepEqual(kinds, ['text']);
});

test('แจ้งปัญหาบรรทัดเดียว: ขึ้นเป็นปัญหาที่ยังไม่ปิดในภาพรวม', async () => {
  const ctx = setup();
  await activeSupervisor(ctx);
  await ctx.bot.handleEvent(ev.text('แจ้งปัญหา ปูนมาส่งไม่ครบ'));
  const { open_issues, issues } = ctx.db.summary();
  assert.equal(open_issues, 1);
  assert.equal(issues[0].text, 'ปูนมาส่งไม่ครบ');
});

test('ข้อความทั่วไป: ส่งถึงสำนักงานและนับเป็นยังไม่อ่าน', async () => {
  const ctx = setup();
  const sup = await activeSupervisor(ctx);
  ctx.db.markRead(sup.id);
  await ctx.bot.handleEvent(ev.text('พรุ่งนี้ฝนตก ขอเลื่อนเทปูน'));
  assert.equal(ctx.db.summary().unread, 1);
  assert.match(replyText(ctx.line), /ส่งข้อความถึงสำนักงานแล้ว/);
});

test('ส่งรูปหลังกด "ส่งรูปงานนี้": บันทึกไฟล์และผูกกับงาน', async () => {
  const ctx = setup();
  const sup = await activeSupervisor(ctx);
  const task = ctx.db.createTask({ title: 'ฉาบผนัง', supervisor_id: sup.id });

  await ctx.bot.handleEvent(ev.postback(`action=photo&task=${task.id}`));
  assert.match(replyText(ctx.line), /ส่งรูปของงาน/);

  const replies = ctx.line.calls.reply.length;
  await ctx.bot.handleEvent(ev.image('U1', { imageSet: { id: 'set1', index: 1, total: 2 } }));
  assert.equal(ctx.line.calls.reply.length, replies, 'ยังไม่ตอบจนกว่าจะได้รูปสุดท้าย');
  await ctx.bot.handleEvent(ev.image('U1', { imageSet: { id: 'set1', index: 2, total: 2 } }));
  assert.match(replyText(ctx.line), new RegExp(`งาน #${task.id}`));

  const images = ctx.db.listMessages(sup.id).filter((m) => m.kind === 'image');
  assert.equal(images.length, 2);
  for (const img of images) {
    assert.equal(img.task_id, task.id);
    assert.ok(fs.existsSync(path.join(ctx.config.uploadDir, img.image_path)));
  }
  assert.equal(ctx.db.getTask(task.id).photo_count, 2);
});

test('ส่งรูปเฉยๆ: บันทึกโดยไม่ผูกกับงาน', async () => {
  const ctx = setup();
  const sup = await activeSupervisor(ctx);
  await ctx.bot.handleEvent(ev.image());
  const [img] = ctx.db.listMessages(sup.id).filter((m) => m.kind === 'image');
  assert.equal(img.task_id, null);
  assert.ok(img.image_path);
});

test('ส่งตำแหน่ง: บันทึกพิกัด', async () => {
  const ctx = setup();
  const sup = await activeSupervisor(ctx);
  await ctx.bot.handleEvent(ev.location());
  const [loc] = ctx.db.listMessages(sup.id).filter((m) => m.kind === 'location');
  assert.equal(loc.latitude, 13.8);
  assert.match(loc.text, /ลาดพร้าว 71/);
});

test('webhook เดิมส่งซ้ำ: ประมวลผลครั้งเดียว', async () => {
  const ctx = setup();
  const sup = await activeSupervisor(ctx);
  const event = ev.text('ข้อความเดียว');
  await ctx.bot.handleEvent(event);
  await ctx.bot.handleEvent(event);
  assert.equal(ctx.db.listMessages(sup.id).filter((m) => m.text === 'ข้อความเดียว').length, 1);
});

test('บล็อกบอท: ทำเครื่องหมายว่าไม่ได้ติดตาม', async () => {
  const ctx = setup();
  const sup = await activeSupervisor(ctx);
  await ctx.bot.handleEvent(ev.unfollow());
  assert.equal(ctx.db.getSupervisor(sup.id).is_following, 0);
});
