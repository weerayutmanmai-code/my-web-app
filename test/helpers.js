import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { openDatabase } from '../src/db.js';
import { createBot } from '../src/bot.js';

export const silentLogger = { info() {}, warn() {}, error() {} };

/** LINE client ปลอม: เก็บทุกการเรียกไว้ตรวจในเทสต์ */
export function fakeLine({ dryRun = false } = {}) {
  const calls = { reply: [], push: [] };
  return {
    dryRun,
    calls,
    pushError: null,
    async reply(replyToken, messages) {
      calls.reply.push({ replyToken, messages });
    },
    async push(to, messages) {
      if (this.pushError) throw this.pushError;
      calls.push.push({ to, messages });
    },
    async getProfile(userId) {
      return { userId, displayName: `ช่าง-${userId}`, pictureUrl: 'https://profile.line-scdn.net/example' };
    },
    async getGroupSummary(groupId) {
      return { groupId, groupName: `กลุ่ม-${groupId}`, pictureUrl: 'https://profile.line-scdn.net/group' };
    },
    async getGroupMemberProfile(groupId, userId) {
      return { userId, displayName: `สมาชิก-${userId}` };
    },
    async getContent() {
      return { buffer: Buffer.from('fake-jpeg-bytes'), contentType: 'image/jpeg' };
    },
  };
}

export function setup({ autoApprove = false } = {}) {
  const db = openDatabase(':memory:');
  const line = fakeLine();
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-bot-uploads-'));
  const config = {
    lineChannelSecret: 'test-secret',
    adminUser: 'admin',
    adminPassword: 'pw',
    uploadDir,
    autoApprove,
  };
  const bot = createBot({ db, line, config, logger: silentLogger });
  return { db, line, bot, config };
}

const id = () => crypto.randomUUID();
const source = (userId) => ({ type: 'user', userId });

export const ev = {
  follow: (userId = 'U1') => ({ type: 'follow', replyToken: 'rt', source: source(userId), webhookEventId: id() }),
  unfollow: (userId = 'U1') => ({ type: 'unfollow', source: source(userId), webhookEventId: id() }),
  text: (text, userId = 'U1') => ({
    type: 'message', replyToken: 'rt', source: source(userId), webhookEventId: id(),
    message: { type: 'text', id: id(), text },
  }),
  image: (userId = 'U1', extra = {}) => ({
    type: 'message', replyToken: 'rt', source: source(userId), webhookEventId: id(),
    message: { type: 'image', id: `m${Date.now()}${Math.floor(Math.random() * 1000)}`, contentProvider: { type: 'line' }, ...extra },
  }),
  location: (userId = 'U1') => ({
    type: 'message', replyToken: 'rt', source: source(userId), webhookEventId: id(),
    message: { type: 'location', id: id(), title: 'ไซต์งาน', address: 'ลาดพร้าว 71', latitude: 13.8, longitude: 100.6 },
  }),
  postback: (data, userId = 'U1') => ({
    type: 'postback', replyToken: 'rt', source: source(userId), webhookEventId: id(), postback: { data },
  }),
};

/** สร้างผู้คุมงานที่อนุมัติแล้ว */
export async function activeSupervisor(ctx, userId = 'U1') {
  await ctx.bot.handleEvent(ev.follow(userId));
  const sup = ctx.db.getSupervisorByLineId(userId);
  return ctx.db.updateSupervisor(sup.id, { status: 'active' });
}

export const lastReply = (line) => line.calls.reply.at(-1)?.messages ?? [];
export const replyText = (line) => lastReply(line).map((m) => m.text ?? m.altText).join('\n');
