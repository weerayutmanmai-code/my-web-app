import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDueReminders } from '../src/reminders.js';
import { dueReminder } from '../src/messages.js';
import { addDays } from '../src/dates.js';
import { setup, activeSupervisor, ev, silentLogger } from './helpers.js';

// เวลาไทย: เสาร์ 7 พ.ย. 2026
const bkk = (date, time) => new Date(`${date}T${time}:00+07:00`);
const SAT = '2026-11-07';
const SUN = '2026-11-08';
const MON = '2026-11-09';

function makeReminders(ctx, at) {
  const clock = { now: at };
  const reminders = createDueReminders({ db: ctx.db, line: ctx.line, logger: silentLogger, now: () => clock.now });
  return { reminders, clock };
}

test('addDays ข้ามเดือน/ปีถูกต้อง', () => {
  assert.equal(addDays('2026-11-07', 1), '2026-11-08');
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addDays('2026-12-31', 2), '2027-01-02');
  assert.equal(addDays('2026-11-07', 0), '2026-11-07');
});

test('ข้อความเตือน: งานเดียวเป็นการ์ดเดียว หลายงานเป็นแบบปัดดู', () => {
  const t = (id) => ({ id, title: `งาน ${id}`, status: 'todo', due_date: SUN });
  const one = dueReminder([t(1)], 1);
  assert.equal(one.contents.type, 'bubble');
  assert.match(JSON.stringify(one), /⏰ ครบกำหนดพรุ่งนี้/);
  assert.ok(one.quickReply);

  const many = dueReminder([t(1), t(2)], 2);
  assert.equal(many.contents.type, 'carousel');
  assert.equal(many.contents.contents.length, 2);
  assert.match(many.altText, /ครบกำหนดในอีก 2 วัน 2 งาน/);

  assert.match(JSON.stringify(dueReminder([t(1)], 0)), /ครบกำหนดวันนี้/);
});

test('เลือกเฉพาะงานค้างที่ครบกำหนดพรุ่งนี้ ของผู้คุมงานที่ใช้งานอยู่และยังเป็นเพื่อนกับบอท', async () => {
  const ctx = setup();
  const a = await activeSupervisor(ctx, 'U1');
  const blocked = await activeSupervisor(ctx, 'U2');
  await ctx.bot.handleEvent(ev.unfollow('U2'));

  const due1 = ctx.db.createTask({ title: 'เทพื้น', supervisor_id: a.id, due_date: SUN });
  const due2 = ctx.db.createTask({ title: 'ผูกเหล็ก', supervisor_id: a.id, due_date: SUN, status: 'in_progress' });
  ctx.db.createTask({ title: 'เสร็จแล้ว', supervisor_id: a.id, due_date: SUN, status: 'done' });
  ctx.db.createTask({ title: 'วันอื่น', supervisor_id: a.id, due_date: MON });
  ctx.db.createTask({ title: 'ไม่มีคนรับ', due_date: SUN });
  ctx.db.createTask({ title: 'คนบล็อก', supervisor_id: blocked.id, due_date: SUN });

  const { reminders } = makeReminders(ctx, bkk(SAT, '16:00'));
  const { target_date: target, recipients } = reminders.preview();
  assert.equal(target, SUN);
  assert.equal(recipients.length, 1);
  assert.equal(recipients[0].supervisor_id, a.id);
  assert.deepEqual(recipients[0].tasks.map((t) => t.id), [due1.id, due2.id]);
});

test('ส่งเตือน: 1 ข้อความต่อคน และไม่เตือนงานเดิมซ้ำ', async () => {
  const ctx = setup();
  const a = await activeSupervisor(ctx, 'U1');
  const b = await activeSupervisor(ctx, 'U2');
  ctx.db.createTask({ title: 'งาน A1', supervisor_id: a.id, due_date: SUN });
  ctx.db.createTask({ title: 'งาน A2', supervisor_id: a.id, due_date: SUN });
  const b1 = ctx.db.createTask({ title: 'งาน B1', supervisor_id: b.id, due_date: SUN });
  const { reminders } = makeReminders(ctx, bkk(SAT, '16:00'));

  const result = await reminders.sendDue();
  assert.deepEqual(result, { sent: 2, failed: 0, recipients: 2, tasks: 3 });
  assert.equal(ctx.line.calls.push.length, 2);
  const toA = ctx.line.calls.push.find((p) => p.to === 'U1');
  assert.equal(toA.messages.length, 1);
  assert.equal(toA.messages[0].contents.type, 'carousel');

  const logB = ctx.db.listMessages(b.id).at(-1);
  assert.equal(logB.kind, 'reminder');
  assert.equal(logB.task_id, b1.id);
  assert.match(logB.text, /งาน B1/);

  assert.deepEqual(await reminders.sendDue(), { sent: 0, failed: 0, recipients: 0, tasks: 0 });
  assert.equal(ctx.line.calls.push.length, 2);
});

test('เลื่อนกำหนดเสร็จ: เตือนใหม่ตามวันใหม่', async () => {
  const ctx = setup();
  const a = await activeSupervisor(ctx, 'U1');
  const task = ctx.db.createTask({ title: 'งาน', supervisor_id: a.id, due_date: SUN });
  const { reminders, clock } = makeReminders(ctx, bkk(SAT, '16:00'));
  await reminders.sendDue();

  ctx.db.updateTask(task.id, { due_date: MON });
  clock.now = bkk(SUN, '16:00');
  const result = await reminders.sendDue();
  assert.equal(result.tasks, 1);
  assert.equal(ctx.line.calls.push.length, 2);
});

test('ส่งไม่สำเร็จ: ยังไม่นับว่าเตือนแล้ว กดส่งซ้ำได้', async () => {
  const ctx = setup();
  const a = await activeSupervisor(ctx, 'U1');
  ctx.db.createTask({ title: 'งาน', supervisor_id: a.id, due_date: SUN });
  const { reminders } = makeReminders(ctx, bkk(SAT, '16:00'));

  ctx.line.pushError = new Error('LINE API 429: monthly limit');
  assert.deepEqual(await reminders.sendDue(), { sent: 0, failed: 1, recipients: 1, tasks: 0 });
  assert.match(ctx.db.listMessages(a.id).at(-1).error, /monthly limit/);

  ctx.line.pushError = null;
  assert.equal((await reminders.sendDue()).sent, 1);
});

test('tick: เตือนเวลา 16:00 วันละครั้ง และตั้งเตือนล่วงหน้า / ปิดได้', async () => {
  const ctx = setup();
  const a = await activeSupervisor(ctx, 'U1');
  ctx.db.createTask({ title: 'พรุ่งนี้', supervisor_id: a.id, due_date: SUN });
  ctx.db.createTask({ title: 'มะรืน', supervisor_id: a.id, due_date: MON });
  const { reminders, clock } = makeReminders(ctx, bkk(SAT, '15:59'));

  assert.equal(await reminders.tick(), null, 'ยังไม่ถึงเวลา');
  clock.now = bkk(SAT, '16:00');
  assert.equal((await reminders.tick()).tasks, 1);
  clock.now = bkk(SAT, '16:30');
  assert.equal(await reminders.tick(), null, 'วันนี้ทำไปแล้ว');

  // วันอาทิตย์ (ค่าเริ่มต้นเตือนทุกวัน) แต่ปิดไว้
  reminders.updateSettings({ enabled: false });
  clock.now = bkk(SUN, '16:00');
  assert.equal(await reminders.tick(), null);

  // เปิดใหม่ เตือนล่วงหน้า 0 วัน = เตือนงานที่ครบกำหนดวันนี้ (อาทิตย์) ซึ่งเตือนไปแล้วเมื่อวาน
  reminders.updateSettings({ enabled: true, days_before: 0 });
  assert.equal((await reminders.tick()).tasks, 0);

  assert.throws(() => reminders.updateSettings({ days_before: 9 }), /0–3/);
  assert.throws(() => reminders.updateSettings({ time: 'สี่โมง' }), /HH:MM/);
});
