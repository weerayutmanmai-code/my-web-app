// ตรรกะของบอท: รับ event จาก LINE webhook -> บันทึกลงระบบ -> ตอบผู้คุมงาน
import fs from 'node:fs/promises';
import path from 'node:path';
import * as M from './messages.js';
import { buildSummaryText } from './morning-summary.js';
import { buildOfficeSummary } from './office-summary.js';
import { todayInBangkok } from './dates.js';

const MENU_WORDS = new Set(['เมนู', 'menu', 'help', 'ช่วยเหลือ', 'วิธีใช้', '?']);
const TASK_WORDS = new Set(['งาน', 'งานของฉัน', 'งานวันนี้', 'ดูงาน', 'งานค้าง', 'tasks']);
const CANCEL_WORDS = new Set(['ยกเลิก', 'cancel']);
const SUMMARY_WORDS = new Set(['สรุป', 'สรุปงาน', 'สรุปวันนี้', 'summary']);
const REPORT_RE = /^(?:รายงาน(?:ประจำวัน)?|report)\s*([\s\S]*)$/i;
const ISSUE_RE = /^(?:แจ้งปัญหา|ปัญหา|issue)\s*([\s\S]*)$/i;

const FILE_LABEL = { video: 'วิดีโอ', audio: 'ข้อความเสียง', file: 'ไฟล์', image: 'รูป', location: 'ตำแหน่ง', sticker: 'สติกเกอร์' };
const IMAGE_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };

export function createBot({ db, line, config = {}, logger = console }) {
  const reply = async (replyToken, messages) => {
    if (!replyToken) return;
    try {
      await line.reply(replyToken, messages);
    } catch (err) {
      logger.error(`[bot] ตอบกลับไม่สำเร็จ: ${err.message}`);
    }
  };

  async function handleEvents(events = []) {
    // ทำทีละ event ตามลำดับ เพื่อให้ลำดับข้อความในระบบตรงกับในแชท
    for (const event of events) {
      try {
        await handleEvent(event);
      } catch (err) {
        logger.error('[bot] ประมวลผล event ไม่สำเร็จ', err);
      }
    }
  }

  async function handleEvent(event) {
    if (event.webhookEventId && !db.markEventProcessed(event.webhookEventId)) return; // ส่งซ้ำ
    // รองรับแชท 1:1 เท่านั้น (ยังไม่รองรับกลุ่ม)
    const userId = event.source?.type === 'user' ? event.source.userId : null;
    if (!userId) return;

    switch (event.type) {
      case 'follow': return onFollow(event, userId);
      case 'unfollow': return onUnfollow(userId);
      case 'message': return onMessage(event, userId);
      case 'postback': return onPostback(event, userId);
      default: return undefined;
    }
  }

  async function fetchProfile(userId) {
    try {
      return await line.getProfile(userId);
    } catch (err) {
      logger.warn(`[bot] ดึงโปรไฟล์ LINE ไม่สำเร็จ: ${err.message}`);
      return null;
    }
  }

  async function ensureSupervisor(userId) {
    const existing = db.getSupervisorByLineId(userId);
    if (existing) return { sup: existing, created: false };

    const profile = await fetchProfile(userId);
    const status = config.autoApprove ? 'active' : 'pending';
    const sup = db.createSupervisor({
      line_user_id: userId,
      line_name: profile?.displayName ?? null,
      picture_url: profile?.pictureUrl ?? null,
      status,
    });
    db.addMessage({
      supervisor_id: sup.id,
      direction: 'in',
      kind: 'system',
      text: status === 'active' ? 'ผู้คุมงานใหม่เพิ่มบอทเป็นเพื่อน' : 'ผู้คุมงานใหม่เพิ่มบอทเป็นเพื่อน — รออนุมัติ',
    });
    return { sup, created: true };
  }

  // ---------- follow / unfollow ----------
  async function onFollow(event, userId) {
    const { sup, created } = await ensureSupervisor(userId);
    if (!created) {
      const profile = await fetchProfile(userId);
      db.updateSupervisor(sup.id, {
        is_following: 1,
        ...(profile ? { line_name: profile.displayName, picture_url: profile.pictureUrl ?? null } : {}),
      });
      db.addMessage({ supervisor_id: sup.id, direction: 'in', kind: 'system', text: 'กลับมาเพิ่มบอทเป็นเพื่อนอีกครั้ง' });
    }
    return reply(event.replyToken, M.welcome(db.getSupervisor(sup.id)));
  }

  async function onUnfollow(userId) {
    const sup = db.getSupervisorByLineId(userId);
    if (!sup) return;
    db.updateSupervisor(sup.id, { is_following: 0 });
    db.addMessage({ supervisor_id: sup.id, direction: 'in', kind: 'system', text: 'บล็อกหรือลบบอทออกจากเพื่อน' });
  }

  // ---------- ข้อความ ----------
  async function onMessage(event, userId) {
    let { sup } = await ensureSupervisor(userId);
    if (!sup.is_following) sup = db.updateSupervisor(sup.id, { is_following: 1 });
    const msg = event.message ?? {};
    const base = { supervisor_id: sup.id, direction: 'in', line_message_id: msg.id ?? null };

    if (sup.status !== 'active') {
      // ยังไม่อนุมัติ: เก็บข้อความไว้ให้สำนักงานเห็น แต่ยังไม่เปิดให้ใช้คำสั่ง
      const body = msg.type === 'text' ? msg.text : `(ส่ง${FILE_LABEL[msg.type] ?? 'ไฟล์'})`;
      db.addMessage({ ...base, kind: 'text', text: body });
      return reply(event.replyToken, [M.notActive(sup)]);
    }

    switch (msg.type) {
      case 'text': return onText(event, sup, msg, base);
      case 'image': return onImage(event, sup, msg, base);
      case 'location': return onLocation(event, msg, base);
      case 'sticker':
        db.addMessage({ ...base, kind: 'text', text: '(ส่งสติกเกอร์)' });
        return undefined;
      default:
        db.addMessage({ ...base, kind: 'text', text: `(ส่ง${FILE_LABEL[msg.type] ?? 'ไฟล์'} — ระบบยังไม่รองรับ)` });
        return reply(event.replyToken, [M.text('ตอนนี้ระบบรับได้เฉพาะข้อความ รูปภาพ และตำแหน่งครับ', M.mainQuickReply())]);
    }
  }

  async function onText(event, sup, msg, base) {
    const raw = String(msg.text ?? '').trim();
    const word = raw.toLowerCase();

    if (MENU_WORDS.has(word)) return reply(event.replyToken, [M.menu()]);
    if (TASK_WORDS.has(word)) return replyTasks(event.replyToken, sup);
    if (SUMMARY_WORDS.has(word)) return replySummary(event.replyToken, sup);
    if (CANCEL_WORDS.has(word)) {
      db.updateSupervisor(sup.id, { pending_action: null, photo_task_id: null, photo_task_until: null });
      return reply(event.replyToken, [M.text('ยกเลิกแล้วครับ', M.mainQuickReply())]);
    }

    let kind = null;
    let body = raw;
    let match;
    if ((match = raw.match(REPORT_RE))) {
      kind = 'report';
      body = match[1].trim();
    } else if ((match = raw.match(ISSUE_RE))) {
      kind = 'issue';
      body = match[1].trim();
    } else if (sup.pending_action) {
      kind = sup.pending_action; // ข้อความนี้คือรายละเอียดที่ขอไว้ก่อนหน้า
    }

    if (kind && !body) {
      // พิมพ์แค่ "รายงาน" / "แจ้งปัญหา" -> รอรับรายละเอียดในข้อความถัดไป
      db.updateSupervisor(sup.id, { pending_action: kind });
      return reply(event.replyToken, [M.askFor(kind)]);
    }

    if (sup.pending_action) db.updateSupervisor(sup.id, { pending_action: null });
    db.addMessage({ ...base, kind: kind ?? 'text', text: body });
    return reply(event.replyToken, [M.ack(kind)]);
  }

  async function replyTasks(replyToken, sup) {
    const tasks = db.listOpenTasksFor(sup.id);
    if (!tasks.length) return reply(replyToken, [M.text('🎉 ตอนนี้ไม่มีงานค้างครับ', M.mainQuickReply())]);
    return reply(replyToken, M.taskList(tasks));
  }

  /** ตอบสรุปทันที (เป็น reply จึงไม่นับโควตา): สำนักงานได้ภาพรวม ผู้คุมงานได้งานของตัวเอง */
  async function replySummary(replyToken, sup) {
    const text = sup.role === 'office'
      ? buildOfficeSummary({ db, publicUrl: config.publicUrl }).text
      : buildSummaryText(sup, db.listOpenTasksFor(sup.id), todayInBangkok(), { greeting: '📊 สรุปงานของคุณ' })
        ?? '🎉 ตอนนี้ไม่มีงานค้างครับ';
    return reply(replyToken, [M.text(text, M.mainQuickReply())]);
  }

  function activePhotoTask(sup) {
    if (!sup.photo_task_id || !sup.photo_task_until) return null;
    if (sup.photo_task_until < new Date().toISOString()) return null;
    const task = db.getTask(sup.photo_task_id);
    return task && task.supervisor_id === sup.id ? task : null;
  }

  async function saveImage(messageId) {
    const { buffer, contentType } = await line.getContent(messageId);
    const ext = IMAGE_EXT[String(contentType).split(';')[0].trim()] ?? 'jpg';
    const month = new Date().toISOString().slice(0, 7);
    const dir = path.join(config.uploadDir, month);
    await fs.mkdir(dir, { recursive: true });
    const name = `${String(messageId).replace(/[^\w-]/g, '')}.${ext}`;
    await fs.writeFile(path.join(dir, name), buffer);
    return `${month}/${name}`;
  }

  async function onImage(event, sup, msg, base) {
    const task = activePhotoTask(sup);
    let imagePath = null;
    let error = null;
    try {
      imagePath = await saveImage(msg.id);
    } catch (err) {
      error = 'ดาวน์โหลดรูปจาก LINE ไม่สำเร็จ';
      logger.error(`[bot] ${error}: ${err.message}`);
    }
    db.addMessage({ ...base, kind: 'image', task_id: task?.id ?? null, image_path: imagePath, error });

    // ส่งหลายรูปพร้อมกัน LINE จะส่งมาทีละ event: ตอบครั้งเดียวตอนรูปสุดท้าย
    const set = msg.imageSet;
    if (set && set.total && set.index !== set.total) return undefined;
    const body = task
      ? `📷 บันทึกรูปของงาน #${task.id} แล้วครับ`
      : '📷 ได้รับรูปแล้ว ส่งถึงสำนักงานเรียบร้อยครับ';
    return reply(event.replyToken, [M.text(body, M.mainQuickReply())]);
  }

  async function onLocation(event, msg, base) {
    const label = [msg.title, msg.address].filter(Boolean).join(' — ') || 'ตำแหน่งที่ส่งมา';
    db.addMessage({ ...base, kind: 'location', text: label, latitude: msg.latitude, longitude: msg.longitude });
    return reply(event.replyToken, [M.text('📍 บันทึกตำแหน่งแล้วครับ', M.mainQuickReply())]);
  }

  // ---------- ปุ่มบนการ์ดงาน ----------
  async function onPostback(event, userId) {
    const { sup } = await ensureSupervisor(userId);
    if (sup.status !== 'active') return reply(event.replyToken, [M.notActive(sup)]);

    const params = new URLSearchParams(event.postback?.data ?? '');
    const action = params.get('action');
    const task = db.getTask(Number(params.get('task')));
    if (!task || task.supervisor_id !== sup.id) {
      return reply(event.replyToken, [
        M.text('ไม่พบงานนี้ หรืองานนี้ไม่ได้อยู่ในความรับผิดชอบของคุณแล้วครับ', M.mainQuickReply()),
      ]);
    }

    if (action === 'status') {
      const value = params.get('value');
      if (!['in_progress', 'done'].includes(value)) return undefined;
      if (task.status === value) {
        return reply(event.replyToken, [
          M.text(`งาน #${task.id} อยู่ในสถานะ "${M.STATUS_LABEL[value]}" อยู่แล้วครับ`, M.mainQuickReply()),
        ]);
      }
      if (task.status === 'done') {
        return reply(event.replyToken, [
          M.text(`งาน #${task.id} ปิดไปแล้วครับ ถ้าต้องแก้ไขให้แจ้งสำนักงาน`, M.mainQuickReply()),
        ]);
      }
      const updated = db.updateTask(task.id, { status: value });
      db.addMessage({
        supervisor_id: sup.id,
        direction: 'in',
        kind: 'status',
        task_id: task.id,
        text: value === 'done' ? `✅ งาน #${task.id} ${task.title} — เสร็จแล้ว` : `▶️ งาน #${task.id} ${task.title} — เริ่มทำแล้ว`,
      });
      return reply(event.replyToken, [M.statusUpdated(updated)]);
    }

    if (action === 'photo') {
      db.updateSupervisor(sup.id, {
        photo_task_id: task.id,
        photo_task_until: new Date(Date.now() + M.PHOTO_WINDOW_MINUTES * 60 * 1000).toISOString(),
      });
      return reply(event.replyToken, [M.askPhoto(task)]);
    }

    return undefined;
  }

  return { handleEvents, handleEvent };
}
