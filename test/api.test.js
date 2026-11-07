import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { setup, ev, activeSupervisor, silentLogger } from './helpers.js';

let ctx;
let app;
let server;
let base;
const auth = `Basic ${Buffer.from('admin:pw').toString('base64')}`;

before(async () => {
  ctx = setup();
  app = createApp({ ...ctx, logger: silentLogger });
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { authorization: auth, ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

function signedWebhook(payload, secret = 'test-secret') {
  const body = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', secret).update(body).digest('base64');
  return fetch(`${base}/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-line-signature': signature },
    body,
  });
}

test('หน้าเว็บและ API ต้องใส่รหัสผ่าน แต่ /healthz ไม่ต้อง', async () => {
  assert.equal((await fetch(`${base}/api/summary`)).status, 401);
  assert.equal((await fetch(`${base}/`)).status, 401);
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
  const ok = await api('/summary');
  assert.equal(ok.status, 200);
  assert.equal(ok.data.line_configured, true);
});

test('webhook: ลายเซ็นผิดถูกปฏิเสธ ลายเซ็นถูกประมวลผล', async () => {
  const bad = await signedWebhook({ events: [ev.follow('UW')] }, 'wrong-secret');
  assert.equal(bad.status, 401);
  assert.equal(ctx.db.getSupervisorByLineId('UW'), null);

  // ปุ่ม Verify ใน LINE Developers ส่ง events ว่าง
  assert.equal((await signedWebhook({ destination: 'x', events: [] })).status, 200);

  const good = await signedWebhook({ destination: 'x', events: [ev.follow('UW')] });
  assert.equal(good.status, 200);
  await app.locals.lastWebhook;
  assert.equal(ctx.db.getSupervisorByLineId('UW').status, 'pending');
});

test('อนุมัติผู้คุมงานจากเว็บ: เปลี่ยนสถานะและแจ้งทาง LINE', async () => {
  await ctx.bot.handleEvent(ev.follow('UA'));
  const sup = ctx.db.getSupervisorByLineId('UA');

  const res = await api(`/supervisors/${sup.id}`, {
    method: 'PATCH',
    body: { status: 'active', name: 'สมชาย ใจดี', phone: '081-234-5678' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.pushed, true);
  assert.equal(res.data.supervisor.status, 'active');
  assert.equal(res.data.supervisor.display_name, 'สมชาย ใจดี');
  const push = ctx.line.calls.push.at(-1);
  assert.equal(push.to, 'UA');
  assert.match(push.messages[0].text, /อนุมัติ/);
});

test('มอบหมายงาน: บันทึกงานและส่งการ์ดงานไปที่ LINE ของผู้คุมงาน', async () => {
  const sup = await activeSupervisor(ctx, 'UT');
  const res = await api('/tasks', {
    method: 'POST',
    body: { title: 'เทพื้นชั้น 3', site: 'บ้านคุณวิภา', supervisor_id: sup.id, due_date: '2026-11-20', detail: 'ใช้ปูน 240 ksc' },
  });
  assert.equal(res.status, 201);
  assert.equal(res.data.pushed, true);
  assert.equal(res.data.task.supervisor_name, sup.display_name);

  const push = ctx.line.calls.push.at(-1);
  assert.equal(push.to, 'UT');
  assert.equal(push.messages[0].type, 'flex');
  assert.match(JSON.stringify(push.messages[0]), /เทพื้นชั้น 3/);

  const log = ctx.db.listMessages(sup.id).at(-1);
  assert.equal(log.direction, 'out');
  assert.equal(log.kind, 'task');
  assert.equal(log.task_id, res.data.task.id);
});

test('มอบหมายงานโดยไม่แจ้ง LINE (notify=false)', async () => {
  const sup = await activeSupervisor(ctx, 'UN');
  const pushes = ctx.line.calls.push.length;
  const res = await api('/tasks', { method: 'POST', body: { title: 'งานเงียบ', supervisor_id: sup.id, notify: false } });
  assert.equal(res.status, 201);
  assert.equal(ctx.line.calls.push.length, pushes);
});

test('เปลี่ยนผู้รับผิดชอบงาน: แจ้งคนใหม่', async () => {
  const a = await activeSupervisor(ctx, 'UR1');
  const b = await activeSupervisor(ctx, 'UR2');
  const { data } = await api('/tasks', { method: 'POST', body: { title: 'ย้ายคน', supervisor_id: a.id } });
  const res = await api(`/tasks/${data.task.id}`, { method: 'PATCH', body: { supervisor_id: b.id } });
  assert.equal(res.status, 200);
  assert.equal(res.data.pushed, true);
  assert.equal(ctx.line.calls.push.at(-1).to, 'UR2');
});

test('ตรวจข้อมูลงาน: ไม่มีชื่อ / วันที่ผิด / สถานะผิด', async () => {
  assert.equal((await api('/tasks', { method: 'POST', body: { title: '  ' } })).status, 400);
  assert.equal((await api('/tasks', { method: 'POST', body: { title: 'x', due_date: '2026-13-40' } })).status, 400);
  const { data } = await api('/tasks', { method: 'POST', body: { title: 'x' } });
  assert.equal((await api(`/tasks/${data.task.id}`, { method: 'PATCH', body: { status: 'bogus' } })).status, 400);
  assert.equal((await api('/tasks/99999', { method: 'DELETE' })).status, 404);
  assert.equal((await api(`/tasks/${data.task.id}`, { method: 'DELETE' })).status, 204);
});

test('ตอบแชทจากเว็บ: ส่งไป LINE และขึ้นในแชท', async () => {
  const sup = await activeSupervisor(ctx, 'UC');
  const res = await api(`/supervisors/${sup.id}/messages`, { method: 'POST', body: { text: 'พรุ่งนี้ของเข้า 8 โมงครับ' } });
  assert.equal(res.status, 201);
  assert.equal(res.data.pushed, true);
  assert.match(ctx.line.calls.push.at(-1).messages[0].text, /พรุ่งนี้ของเข้า 8 โมง/);

  const thread = await api(`/supervisors/${sup.id}/messages`);
  const last = thread.data.at(-1);
  assert.equal(last.direction, 'out');
  assert.equal(last.text, 'พรุ่งนี้ของเข้า 8 โมงครับ');
});

test('ส่งหาผู้คุมงานที่บล็อกบอท: ไม่ยิง LINE และบอกเหตุผล', async () => {
  const sup = await activeSupervisor(ctx, 'UB');
  await ctx.bot.handleEvent(ev.unfollow('UB'));
  const pushes = ctx.line.calls.push.length;
  const res = await api(`/supervisors/${sup.id}/messages`, { method: 'POST', body: { text: 'ทดสอบ' } });
  assert.equal(res.data.pushed, false);
  assert.match(res.data.push_error, /บล็อก/);
  assert.equal(ctx.line.calls.push.length, pushes);
});

test('LINE ส่งไม่สำเร็จ: บันทึกข้อผิดพลาดไว้ในแชท', async () => {
  const sup = await activeSupervisor(ctx, 'UE');
  ctx.line.pushError = new Error('LINE API 429: You have reached your monthly limit.');
  try {
    const res = await api(`/supervisors/${sup.id}/messages`, { method: 'POST', body: { text: 'ทดสอบ' } });
    assert.equal(res.data.pushed, false);
    assert.match(res.data.push_error, /monthly limit/);
    assert.match(ctx.db.listMessages(sup.id).at(-1).error, /monthly limit/);
  } finally {
    ctx.line.pushError = null;
  }
});

test('สรุปงานทุกเช้า: ดูค่าตั้ง แก้ค่าตั้ง และกดส่งทันที', async () => {
  const sup = await activeSupervisor(ctx, 'UM');
  ctx.db.createTask({ title: 'งานสำหรับสรุปเช้า', supervisor_id: sup.id });

  const status = await api('/morning-summary');
  assert.equal(status.status, 200);
  assert.deepEqual(status.data.settings, { enabled: true, time: '07:30', days: [1, 2, 3, 4, 5, 6] });
  const mine = status.data.recipients.find((r) => r.supervisor_id === sup.id);
  assert.match(mine.text, /งานสำหรับสรุปเช้า/);

  const bad = await api('/morning-summary', { method: 'PUT', body: { time: '25:00' } });
  assert.equal(bad.status, 400);

  const updated = await api('/morning-summary', { method: 'PUT', body: { time: '06:45', days: [1, 3, 5] } });
  assert.equal(updated.status, 200);
  assert.deepEqual(updated.data.settings, { enabled: true, time: '06:45', days: [1, 3, 5] });

  const sent = await api('/morning-summary/send', { method: 'POST' });
  assert.equal(sent.status, 200);
  assert.ok(sent.data.sent >= 1);
  assert.ok(ctx.line.calls.push.some((p) => p.to === 'UM' && /งานสำหรับสรุปเช้า/.test(p.messages[0].text)));
});

test('ปิดเรื่องปัญหา และอ่านข้อความแล้ว', async () => {
  const sup = await activeSupervisor(ctx, 'UI');
  await ctx.bot.handleEvent(ev.text('แจ้งปัญหา น้ำไม่ไหล', 'UI'));
  const issue = ctx.db.listMessages(sup.id).find((m) => m.kind === 'issue');

  const res = await api(`/messages/${issue.id}`, { method: 'PATCH', body: { resolved: true } });
  assert.equal(res.data.resolved, 1);

  await api(`/supervisors/${sup.id}/read`, { method: 'POST' });
  const list = await api('/supervisors');
  assert.equal(list.data.find((s) => s.id === sup.id).unread, 0);
});
