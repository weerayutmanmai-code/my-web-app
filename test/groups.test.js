import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/db.js';
import { buildOfficeSummary } from '../src/office-summary.js';
import { setup, activeSupervisor, replyText, lastReply } from './helpers.js';

const id = () => crypto.randomUUID();
const G = 'Cgroup1';
const groupSource = (userId) => ({ type: 'group', groupId: G, ...(userId ? { userId } : {}) });
const gev = {
  join: () => ({ type: 'join', replyToken: 'rt', source: groupSource(), webhookEventId: id() }),
  leave: () => ({ type: 'leave', source: groupSource(), webhookEventId: id() }),
  text: (text, userId = 'Ux', extra = {}) => ({
    type: 'message', replyToken: 'rt', source: groupSource(userId), webhookEventId: id(),
    message: { type: 'text', id: id(), text, ...extra },
  }),
  image: (userId) => ({
    type: 'message', replyToken: 'rt', source: groupSource(userId), webhookEventId: id(),
    message: { type: 'image', id: `m${Math.floor(Math.random() * 1e9)}`, contentProvider: { type: 'line' } },
  }),
  postback: (data, userId) => ({ type: 'postback', replyToken: 'rt', source: groupSource(userId), webhookEventId: id(), postback: { data } }),
};

/** กลุ่มที่อนุมัติแล้ว ผูกกับหน้างาน + ผู้คุมงาน 2 คน + งาน 2 งาน */
async function activeGroup(ctx) {
  await ctx.bot.handleEvent(gev.join());
  const group = ctx.db.updateGroup(ctx.db.getGroupByLineId(G).id, { status: 'active', site: 'ลาดพร้าว 71' });
  const a = await activeSupervisor(ctx, 'UA');
  ctx.db.updateSupervisor(a.id, { name: 'สมชาย' });
  const b = await activeSupervisor(ctx, 'UB');
  ctx.db.updateSupervisor(b.id, { name: 'ประเสริฐ' });
  const taskA = ctx.db.createTask({ title: 'เทพื้น', site: 'ลาดพร้าว 71', supervisor_id: a.id });
  const taskB = ctx.db.createTask({ title: 'ผูกเหล็ก', site: 'ลาดพร้าว 71', supervisor_id: b.id });
  ctx.db.createTask({ title: 'งานไซต์อื่น', site: 'บางนา', supervisor_id: a.id });
  ctx.line.calls.reply.length = 0;
  return { group, a, b, taskA, taskB };
}

test('บอทเข้ากลุ่ม: ลงทะเบียนกลุ่มเป็นรออนุมัติ และทักทาย', async () => {
  const ctx = setup();
  await ctx.bot.handleEvent(gev.join());
  const group = ctx.db.getGroupByLineId(G);
  assert.equal(group.status, 'pending');
  assert.equal(group.name, `กลุ่ม-${G}`);
  assert.match(replyText(ctx.line), /บอทไม่เก็บแชทปกติ/);
  assert.equal(ctx.db.summary().pending_groups, 1);
  assert.equal(ctx.db.listGroupMessages(group.id)[0].kind, 'system');
  assert.equal(ctx.db.listSupervisors().length, 0, 'ไม่สร้างผู้คุมงานจากการเข้ากลุ่ม');
});

test('กลุ่มรออนุมัติ: ตอบเฉพาะเมื่อพิมพ์คำสั่ง', async () => {
  const ctx = setup();
  await ctx.bot.handleEvent(gev.join());
  const replies = ctx.line.calls.reply.length;
  await ctx.bot.handleEvent(gev.text('วันนี้ฝนตกนะ'));
  assert.equal(ctx.line.calls.reply.length, replies, 'แชทปกติไม่ตอบ');
  await ctx.bot.handleEvent(gev.text('งาน'));
  assert.match(replyText(ctx.line), /รอสำนักงานอนุมัติ/);
});

test('แชทปกติในกลุ่ม: ไม่ตอบ ไม่เก็บ และไม่สร้างผู้ใช้', async () => {
  const ctx = setup();
  const { group } = await activeGroup(ctx);
  const before = ctx.db.listGroupMessages(group.id).length;
  for (const t of ['สวัสดีครับ', 'รายงานตัวครับ', 'ปัญหาคือฝนตก', 'โอเค']) await ctx.bot.handleEvent(gev.text(t, 'Ustranger'));
  await ctx.bot.handleEvent(gev.image('Ustranger'));
  assert.equal(ctx.line.calls.reply.length, 0);
  assert.equal(ctx.db.listGroupMessages(group.id).length, before);
  assert.equal(ctx.db.getSupervisorByLineId('Ustranger'), null);
});

test('"งาน" ในกลุ่ม: แสดงงานค้างของหน้างานนั้น พร้อมชื่อผู้รับผิดชอบ', async () => {
  const ctx = setup();
  await activeGroup(ctx);
  await ctx.bot.handleEvent(gev.text('งาน'));
  const [intro, flex] = lastReply(ctx.line);
  assert.match(intro.text, /หน้างาน ลาดพร้าว 71 มีงานค้าง 2 งาน/);
  const json = JSON.stringify(flex);
  assert.match(json, /เทพื้น/);
  assert.match(json, /👷 สมชาย/);
  assert.doesNotMatch(json, /งานไซต์อื่น/);
});

test('@บอท งาน: ตัด mention ออกก่อนอ่านคำสั่ง', async () => {
  const ctx = setup();
  await activeGroup(ctx);
  await ctx.bot.handleEvent(gev.text('@ผู้ช่วยไซต์ งาน', 'Ux', {
    mention: { mentionees: [{ index: 0, length: '@ผู้ช่วยไซต์'.length, type: 'user', isSelf: true }] },
  }));
  assert.match(replyText(ctx.line), /มีงานค้าง 2 งาน/);
});

test('"สรุป" ในกลุ่ม: สรุปงานของหน้างาน', async () => {
  const ctx = setup();
  await activeGroup(ctx);
  await ctx.bot.handleEvent(gev.text('สรุป'));
  const text = replyText(ctx.line);
  assert.match(text, /📊 สรุปงานหน้างาน ลาดพร้าว 71/);
  assert.match(text, /เทพื้น — สมชาย/);
  assert.equal(ctx.line.calls.push.length, 0, 'ใช้ reply ไม่ใช้โควตา');
});

test('รายงาน/แจ้งปัญหาในกลุ่ม: บันทึกพร้อมชื่อคนส่ง', async () => {
  const ctx = setup();
  const { group, a } = await activeGroup(ctx);

  await ctx.bot.handleEvent(gev.text('รายงาน เทพื้นเสร็จ 80%', 'UA'));
  await ctx.bot.handleEvent(gev.text('แจ้งปัญหาปูนไม่พอ', 'Ustranger'));
  await ctx.bot.handleEvent(gev.text('รายงาน', 'UA'));
  assert.match(replyText(ctx.line), /พิมพ์รายละเอียดต่อท้ายในข้อความเดียวกัน/);

  const msgs = ctx.db.listGroupMessages(group.id).filter((m) => m.kind !== 'system');
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].kind, 'report');
  assert.equal(msgs[0].supervisor_id, a.id);
  assert.equal(msgs[0].supervisor_name, 'สมชาย');
  assert.equal(msgs[1].kind, 'issue');
  assert.equal(msgs[1].supervisor_id, null);
  assert.equal(msgs[1].supervisor_name, 'สมาชิก-Ustranger');
  assert.equal(msgs[1].group_name, group.name);

  assert.equal(ctx.db.listMessages(a.id).filter((m) => m.kind === 'report').length, 0, 'ไม่ปนกับแชทส่วนตัว');
  assert.ok(ctx.db.openIssues().some((m) => m.text === 'ปูนไม่พอ'), 'ขึ้นในปัญหาค้างของสำนักงาน');

  const { text } = buildOfficeSummary({ db: ctx.db, now: new Date() });
  assert.match(text, new RegExp(`สมชาย \\(กลุ่ม ${group.name}\\): เทพื้นเสร็จ 80%`));
  assert.match(text, /รายงานประจำวัน 1\/2 คน/, 'นับรายงานจากกลุ่มของผู้คุมงานที่รู้จัก');
});

test('ปุ่มในกลุ่ม: ผู้รับผิดชอบกดได้ คนอื่นกดไม่ได้ สำนักงานกดได้', async () => {
  const ctx = setup();
  const { group, taskA, taskB } = await activeGroup(ctx);

  await ctx.bot.handleEvent(gev.postback(`action=status&task=${taskA.id}&value=done`, 'UB'));
  assert.equal(ctx.db.getTask(taskA.id).status, 'todo');
  assert.match(replyText(ctx.line), /เป็นความรับผิดชอบของ สมชาย/);

  await ctx.bot.handleEvent(gev.postback(`action=status&task=${taskA.id}&value=done`, 'Ustranger'));
  assert.equal(ctx.db.getTask(taskA.id).status, 'todo');
  assert.match(replyText(ctx.line), /เฉพาะผู้คุมงานที่ลงทะเบียน/);
  assert.equal(ctx.db.getSupervisorByLineId('Ustranger'), null);

  await ctx.bot.handleEvent(gev.postback(`action=status&task=${taskA.id}&value=done`, 'UA'));
  assert.equal(ctx.db.getTask(taskA.id).status, 'done');
  const log = ctx.db.listGroupMessages(group.id).at(-1);
  assert.equal(log.kind, 'status');
  assert.match(log.text, /เสร็จแล้ว \(โดย สมชาย\)/);

  const office = await activeSupervisor(ctx, 'UO');
  ctx.db.updateSupervisor(office.id, { role: 'office' });
  await ctx.bot.handleEvent(gev.postback(`action=status&task=${taskB.id}&value=in_progress`, 'UO'));
  assert.equal(ctx.db.getTask(taskB.id).status, 'in_progress');
});

test('ส่งรูปในกลุ่มหลังกด "ส่งรูปงานนี้": เก็บรูปผูกกับงาน', async () => {
  const ctx = setup();
  const { group, taskA } = await activeGroup(ctx);
  await ctx.bot.handleEvent(gev.postback(`action=photo&task=${taskA.id}`, 'UA'));
  await ctx.bot.handleEvent(gev.image('UA'));
  const img = ctx.db.listGroupMessages(group.id).find((m) => m.kind === 'image');
  assert.equal(img.task_id, taskA.id);
  assert.ok(fs.existsSync(path.join(ctx.config.uploadDir, img.image_path)));
  assert.match(replyText(ctx.line), new RegExp(`งาน #${taskA.id}.*สมชาย`));
});

test('บอทถูกนำออกจากกลุ่ม: ทำเครื่องหมายว่าไม่ได้อยู่ในกลุ่ม', async () => {
  const ctx = setup();
  const { group } = await activeGroup(ctx);
  await ctx.bot.handleEvent(gev.leave());
  assert.equal(ctx.db.getGroup(group.id).is_member, 0);
  assert.deepEqual(ctx.db.listActiveGroupsForSite('ลาดพร้าว 71'), []);
});

test('ย้ายฐานข้อมูลเดิม (ก่อนรองรับกลุ่ม) โดยข้อมูลไม่หาย', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'site-bot-db-')), 'app.db');
  const old = new DatabaseSync(file);
  old.exec(`
    CREATE TABLE supervisors (id INTEGER PRIMARY KEY, line_user_id TEXT NOT NULL UNIQUE, line_name TEXT, picture_url TEXT,
      name TEXT, phone TEXT, site TEXT, status TEXT NOT NULL DEFAULT 'pending', is_following INTEGER NOT NULL DEFAULT 1,
      pending_action TEXT, photo_task_id INTEGER, photo_task_until TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, detail TEXT, site TEXT,
      supervisor_id INTEGER REFERENCES supervisors(id) ON DELETE SET NULL, due_date TEXT, status TEXT NOT NULL DEFAULT 'todo',
      done_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE messages (id INTEGER PRIMARY KEY, supervisor_id INTEGER NOT NULL REFERENCES supervisors(id) ON DELETE CASCADE,
      direction TEXT NOT NULL, kind TEXT NOT NULL, text TEXT, task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      image_path TEXT, latitude REAL, longitude REAL, line_message_id TEXT, error TEXT, resolved INTEGER NOT NULL DEFAULT 0,
      read_at TEXT, created_at TEXT NOT NULL);
    CREATE INDEX idx_messages_supervisor ON messages (supervisor_id, id);
    INSERT INTO supervisors (id, line_user_id, name, status, created_at, updated_at) VALUES (1, 'U1', 'สมชาย', 'active', 'x', 'x');
    INSERT INTO tasks (id, title, supervisor_id, created_at, updated_at) VALUES (1, 'เทพื้น', 1, 'x', 'x');
    INSERT INTO messages (supervisor_id, direction, kind, text, task_id, created_at) VALUES (1, 'in', 'report', 'รายงานเก่า', 1, '2026-01-01T00:00:00Z');
    INSERT INTO messages (supervisor_id, direction, kind, text, resolved, created_at) VALUES (1, 'in', 'issue', 'ปัญหาเก่า', 0, '2026-01-01T00:01:00Z');
  `);
  old.close();

  const db = openDatabase(file);
  const sup = db.getSupervisorByLineId('U1');
  assert.equal(sup.role, 'supervisor');
  const msgs = db.listMessages(sup.id);
  assert.deepEqual(msgs.map((m) => m.text), ['รายงานเก่า', 'ปัญหาเก่า']);
  assert.equal(msgs[0].task_title, 'เทพื้น');
  assert.equal(db.openIssues().length, 1);

  const group = db.createGroup({ line_group_id: 'Cnew', name: 'กลุ่มใหม่' });
  db.addMessage({ group_id: group.id, sender_name: 'ช่างเอ', direction: 'in', kind: 'report', text: 'จากกลุ่ม' });
  assert.equal(db.listGroupMessages(group.id).length, 1);
  assert.equal(db.raw.prepare('PRAGMA foreign_key_check').all().length, 0);
  assert.equal(db.raw.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  db.close();

  const reopened = openDatabase(file); // เปิดซ้ำต้องไม่ย้ายซ้ำ/ไม่พัง
  assert.equal(reopened.recentActivity(10).length, 3);
  reopened.close();
});
