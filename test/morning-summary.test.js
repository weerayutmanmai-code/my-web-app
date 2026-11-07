import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMorningSummary, buildSummaryText, validateSettings } from '../src/morning-summary.js';
import { bangkokParts } from '../src/dates.js';
import { setup, activeSupervisor, ev, silentLogger } from './helpers.js';

// เวลาไทย: เสาร์ 7 พ.ย. 2026 (UTC+7)
const bkk = (date, time) => new Date(`${date}T${time}:00+07:00`);
const SAT = '2026-11-07';
const SUN = '2026-11-08';

function makeSummary(ctx, at) {
  const clock = { now: at };
  const summary = createMorningSummary({ db: ctx.db, line: ctx.line, logger: silentLogger, now: () => clock.now });
  return { summary, clock };
}

test('bangkokParts: แปลงเป็นเวลาไทยถูกต้อง', () => {
  assert.deepEqual(bangkokParts(new Date('2026-11-07T00:31:00Z')), { date: SAT, time: '07:31', weekday: 6 });
  assert.deepEqual(bangkokParts(new Date('2026-11-07T17:05:00Z')), { date: SUN, time: '00:05', weekday: 0 });
});

test('buildSummaryText: แบ่งเลยกำหนด / วันนี้ / อื่นๆ และไม่รวมงานที่เสร็จแล้ว', () => {
  const sup = { name: 'สมชาย' };
  const tasks = [
    { id: 1, title: 'งานวันนี้', due_date: SAT, status: 'in_progress' },
    { id: 2, title: 'งานเลยกำหนด', due_date: '2026-11-05', status: 'todo' },
    { id: 3, title: 'งานอนาคต', due_date: '2026-11-10', status: 'todo' },
    { id: 4, title: 'งานไม่มีกำหนด', due_date: null, status: 'todo' },
    { id: 5, title: 'งานเสร็จแล้ว', due_date: '2026-11-01', status: 'done' },
  ];
  const text = buildSummaryText(sup, tasks, SAT);

  assert.match(text, /สวัสดีตอนเช้าครับ คุณสมชาย/);
  assert.match(text, /วันเสาร์ที่ 7 พ.ย. 69/);
  assert.match(text, /🔴 เลยกำหนด 1 งาน\n• #2 งานเลยกำหนด \(กำหนด 5 พ.ย. 69\)/);
  assert.match(text, /🟡 ครบกำหนดวันนี้ 1 งาน\n• #1 งานวันนี้ \(▶️ กำลังทำ\)/);
  assert.match(text, /📋 งานค้างอื่นๆ 2 งาน\n• #3 งานอนาคต \(กำหนด 10 พ.ย. 69\)\n• #4 งานไม่มีกำหนด/);
  assert.doesNotMatch(text, /งานเสร็จแล้ว/);
});

test('buildSummaryText: ไม่มีงานค้าง = ไม่ต้องส่ง', () => {
  assert.equal(buildSummaryText({ name: 'x' }, [], SAT), null);
  assert.equal(buildSummaryText({ name: 'x' }, [{ id: 1, title: 'a', status: 'done' }], SAT), null);
});

test('buildSummaryText: งานเยอะเกินแสดงแค่ 20 งาน', () => {
  const tasks = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, title: `งาน ${i + 1}`, due_date: null, status: 'todo' }));
  const text = buildSummaryText({ name: 'x' }, tasks, SAT);
  assert.equal(text.split('\n').filter((l) => l.startsWith('• ')).length, 20);
  assert.match(text, /และอีก 5 งาน/);
});

test('validateSettings', () => {
  assert.deepEqual(validateSettings({ time: '06:45', days: [6, 1, 1], enabled: 0 }).settings, { time: '06:45', days: [1, 6], enabled: false });
  assert.equal(validateSettings({ time: '7:30' }).errors.length, 1);
  assert.equal(validateSettings({ time: '24:00' }).errors.length, 1);
  assert.equal(validateSettings({ days: [7] }).errors.length, 1);
  assert.equal(validateSettings({ days: 'mon' }).errors.length, 1);
});

test('ส่งเฉพาะผู้คุมงานที่ใช้งานอยู่ ยังติดตามบอท และมีงานค้าง', async () => {
  const ctx = setup();
  const busy = await activeSupervisor(ctx, 'U1');
  const idle = await activeSupervisor(ctx, 'U2');
  const blocked = await activeSupervisor(ctx, 'U3');
  await ctx.bot.handleEvent(ev.follow('U4')); // รออนุมัติ
  const pending = ctx.db.getSupervisorByLineId('U4');

  ctx.db.createTask({ title: 'เทพื้น', supervisor_id: busy.id, due_date: SAT });
  ctx.db.createTask({ title: 'งานเสร็จ', supervisor_id: idle.id, status: 'done' });
  ctx.db.createTask({ title: 'งานคนบล็อก', supervisor_id: blocked.id });
  ctx.db.createTask({ title: 'งานคนรออนุมัติ', supervisor_id: pending.id });
  await ctx.bot.handleEvent(ev.unfollow('U3'));

  const { summary } = makeSummary(ctx, bkk(SAT, '07:31'));
  assert.deepEqual(summary.preview().recipients.map((r) => r.supervisor_id), [busy.id]);

  const result = await summary.sendAll();
  assert.deepEqual(result, { sent: 1, failed: 0, recipients: 1 });
  const push = ctx.line.calls.push.at(-1);
  assert.equal(push.to, 'U1');
  assert.match(push.messages[0].text, /🟡 ครบกำหนดวันนี้ 1 งาน\n• #\d+ เทพื้น/);
  assert.ok(push.messages[0].quickReply, 'มีปุ่มลัดให้กดดูงาน');

  const log = ctx.db.listMessages(busy.id).at(-1);
  assert.equal(log.kind, 'summary');
  assert.equal(log.direction, 'out');
});

test('ส่งไม่สำเร็จ: บันทึกข้อผิดพลาด และส่งคนถัดไปต่อ', async () => {
  const ctx = setup();
  const a = await activeSupervisor(ctx, 'U1');
  ctx.db.createTask({ title: 'งาน', supervisor_id: a.id });
  ctx.line.pushError = new Error('LINE API 429: monthly limit');
  const { summary } = makeSummary(ctx, bkk(SAT, '07:31'));
  const result = await summary.sendAll();
  assert.deepEqual(result, { sent: 0, failed: 1, recipients: 1 });
  assert.match(ctx.db.listMessages(a.id).at(-1).error, /monthly limit/);
});

test('tick: ส่งครั้งเดียวต่อวัน เมื่อถึงเวลา ในวันที่เลือก', async () => {
  const ctx = setup();
  const sup = await activeSupervisor(ctx, 'U1');
  ctx.db.createTask({ title: 'งาน', supervisor_id: sup.id });
  const { summary, clock } = makeSummary(ctx, bkk(SAT, '07:29'));
  const pushes = () => ctx.line.calls.push.length;

  assert.equal(await summary.tick(), null, 'ยังไม่ถึง 07:30');
  assert.equal(pushes(), 0);

  clock.now = bkk(SAT, '07:30');
  assert.equal((await summary.tick()).sent, 1);
  clock.now = bkk(SAT, '07:31');
  assert.equal(await summary.tick(), null, 'วันนี้ส่งไปแล้ว');
  assert.equal(pushes(), 1);

  clock.now = bkk(SUN, '07:31');
  assert.equal(await summary.tick(), null, 'อาทิตย์ไม่อยู่ในวันที่ส่ง (ค่าเริ่มต้น จ.-ส.)');
  assert.equal(pushes(), 1);
});

test('tick: เซิร์ฟเวอร์กลับมาช้า ส่งย้อนหลังได้ไม่เกิน 3 ชั่วโมง', async () => {
  const ctx = setup();
  const sup = await activeSupervisor(ctx, 'U1');
  ctx.db.createTask({ title: 'งาน', supervisor_id: sup.id });

  const late = makeSummary(ctx, bkk(SAT, '10:45'));
  assert.equal(await late.summary.tick(), null, 'เลย 10:30 แล้ว ไม่ส่ง');

  const ok = makeSummary(ctx, bkk(SAT, '10:30'));
  assert.equal((await ok.summary.tick()).sent, 1);
});

test('tick: ปิดใช้งาน / เปลี่ยนเวลาและวันจากหน้าเว็บ', async () => {
  const ctx = setup();
  const sup = await activeSupervisor(ctx, 'U1');
  ctx.db.createTask({ title: 'งาน', supervisor_id: sup.id });
  const { summary, clock } = makeSummary(ctx, bkk(SAT, '07:31'));

  summary.updateSettings({ enabled: false });
  assert.equal(await summary.tick(), null);

  summary.updateSettings({ enabled: true, time: '06:00', days: [0] });
  assert.equal(await summary.tick(), null, 'เสาร์ไม่อยู่ในวันที่เลือกแล้ว');
  clock.now = bkk(SUN, '06:05');
  assert.equal((await summary.tick()).sent, 1);

  assert.throws(() => summary.updateSettings({ time: 'เจ็ดโมง' }), /HH:MM/);
});
