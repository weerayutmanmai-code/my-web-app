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
// ในกลุ่มคุยกันเยอะ จึงเข้มกว่า: "รายงาน" ต้องตามด้วยเว้นวรรค/โคลอน (กัน "รายงานตัวครับ") และต้องพิมพ์ "แจ้งปัญหา" เต็มคำ
const GROUP_REPORT_RE = /^(?:รายงาน(?:ประจำวัน)?|report)(?:$|[\s:]+([\s\S]*)$)/i;
const GROUP_ISSUE_RE = /^(?:แจ้งปัญหา|issue)[\s:]*([\s\S]*)$/i;

/** ตัด @ชื่อบอท ออกจากข้อความในกลุ่ม */
function stripBotMention(msg) {
  let text = String(msg.text ?? '');
  const selves = (msg.mention?.mentionees ?? []).filter((m) => m.isSelf).sort((a, b) => b.index - a.index);
  for (const m of selves) text = text.slice(0, m.index) + text.slice(m.index + m.length);
  return text;
}

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
    const source = event.source ?? {};
    if (source.type === 'group' && source.groupId) return handleGroupEvent(event, source.groupId, source.userId ?? null);
    // แชทแบบ room (หลายคนแต่ไม่ใช่กลุ่ม) ยังไม่รองรับ
    const userId = source.type === 'user' ? source.userId : null;
    if (!userId) return undefined;

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

  /** ดาวน์โหลดรูปจาก LINE แล้วบันทึกลงแชท (ส่วนตัวหรือกลุ่มตาม base) */
  async function storeImage(msg, base, task) {
    let imagePath = null;
    let error = null;
    try {
      imagePath = await saveImage(msg.id);
    } catch (err) {
      error = 'ดาวน์โหลดรูปจาก LINE ไม่สำเร็จ';
      logger.error(`[bot] ${error}: ${err.message}`);
    }
    db.addMessage({ ...base, kind: 'image', task_id: task?.id ?? null, image_path: imagePath, error });
  }

  // ส่งหลายรูปพร้อมกัน LINE จะส่งมาทีละ event: ตอบครั้งเดียวตอนรูปสุดท้าย
  const isLastOfSet = (msg) => !msg.imageSet?.total || msg.imageSet.index === msg.imageSet.total;

  async function onImage(event, sup, msg, base) {
    const task = activePhotoTask(sup);
    await storeImage(msg, base, task);
    if (!isLastOfSet(msg)) return undefined;
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
    return applyTaskAction(event, sup, null);
  }

  /**
   * ปุ่มบนการ์ดงาน (แชทส่วนตัวและกลุ่ม)
   * ส่วนตัว: กดได้เฉพาะงานของตัวเอง / กลุ่ม: ผู้รับผิดชอบหรือคนในสำนักงาน
   */
  async function applyTaskAction(event, sup, group) {
    const quickReply = group ? M.groupQuickReply() : M.mainQuickReply();
    const params = new URLSearchParams(event.postback?.data ?? '');
    const action = params.get('action');
    const task = db.getTask(Number(params.get('task')));
    const allowed = task && (task.supervisor_id === sup.id || (group && sup.role === 'office'));
    if (!allowed) {
      const body = group && task
        ? `งาน #${task.id} เป็นความรับผิดชอบของ ${task.supervisor_name ?? 'คนอื่น'} — กดได้เฉพาะผู้รับผิดชอบหรือสำนักงานครับ`
        : 'ไม่พบงานนี้ หรืองานนี้ไม่ได้อยู่ในความรับผิดชอบของคุณแล้วครับ';
      return reply(event.replyToken, [M.text(body, quickReply)]);
    }

    if (action === 'status') {
      const value = params.get('value');
      if (!['in_progress', 'done'].includes(value)) return undefined;
      if (task.status === value) {
        return reply(event.replyToken, [
          M.text(`งาน #${task.id} อยู่ในสถานะ "${M.STATUS_LABEL[value]}" อยู่แล้วครับ`, quickReply),
        ]);
      }
      if (task.status === 'done') {
        return reply(event.replyToken, [
          M.text(`งาน #${task.id} ปิดไปแล้วครับ ถ้าต้องแก้ไขให้แจ้งสำนักงาน`, quickReply),
        ]);
      }
      const updated = db.updateTask(task.id, { status: value });
      const by = group ? ` (โดย ${sup.display_name})` : '';
      db.addMessage({
        supervisor_id: sup.id,
        group_id: group?.id ?? null,
        direction: 'in',
        kind: 'status',
        task_id: task.id,
        text: value === 'done'
          ? `✅ งาน #${task.id} ${task.title} — เสร็จแล้ว${by}`
          : `▶️ งาน #${task.id} ${task.title} — เริ่มทำแล้ว${by}`,
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

  // ======================= กลุ่ม LINE =======================

  async function ensureGroup(lineGroupId) {
    const existing = db.getGroupByLineId(lineGroupId);
    if (existing) return { group: existing, created: false };
    let summary = null;
    try {
      summary = await line.getGroupSummary(lineGroupId);
    } catch (err) {
      logger.warn(`[bot] ดึงข้อมูลกลุ่มไม่สำเร็จ: ${err.message}`);
    }
    const group = db.createGroup({
      line_group_id: lineGroupId,
      name: summary?.groupName ?? null,
      picture_url: summary?.pictureUrl ?? null,
      status: config.autoApprove ? 'active' : 'pending',
    });
    return { group, created: true };
  }

  /** คนส่งในกลุ่ม: ผู้คุมงานที่รู้จัก หรือชื่อจากโปรไฟล์ในกลุ่ม */
  async function groupSender(group, userId) {
    const sup = userId ? db.getSupervisorByLineId(userId) : null;
    if (sup) return { sup, name: sup.display_name };
    let name = null;
    if (userId) {
      try {
        name = (await line.getGroupMemberProfile(group.line_group_id, userId))?.displayName ?? null;
      } catch (err) {
        logger.warn(`[bot] ดึงชื่อสมาชิกกลุ่มไม่สำเร็จ: ${err.message}`);
      }
    }
    return { sup: null, name };
  }

  async function handleGroupEvent(event, lineGroupId, userId) {
    if (event.type === 'leave') {
      const group = db.getGroupByLineId(lineGroupId);
      if (!group) return undefined;
      db.updateGroup(group.id, { is_member: 0 });
      db.addMessage({ group_id: group.id, direction: 'in', kind: 'system', text: 'บอทถูกนำออกจากกลุ่ม' });
      return undefined;
    }
    if (!['join', 'message', 'postback'].includes(event.type)) return undefined;

    let { group, created } = await ensureGroup(lineGroupId);
    if (event.type === 'join') {
      if (!created) group = db.updateGroup(group.id, { is_member: 1 });
      db.addMessage({
        group_id: group.id,
        direction: 'in',
        kind: 'system',
        text: created ? 'บอทถูกเชิญเข้ากลุ่มใหม่ — รออนุมัติและผูกกับหน้างาน' : 'บอทถูกเชิญกลับเข้ากลุ่ม',
      });
      return reply(event.replyToken, [M.groupWelcome()]);
    }
    if (!group.is_member) group = db.updateGroup(group.id, { is_member: 1 });

    if (event.type === 'postback') return onGroupPostback(event, group, userId);
    const msg = event.message ?? {};
    if (msg.type === 'text') return onGroupText(event, group, userId, msg);
    if (msg.type === 'image') return onGroupImage(event, group, userId, msg);
    return undefined; // อย่างอื่นในกลุ่ม (สติกเกอร์ ไฟล์ ฯลฯ) ไม่เก็บ
  }

  async function onGroupText(event, group, userId, msg) {
    const raw = stripBotMention(msg).trim();
    const word = raw.toLowerCase();
    const report = raw.match(GROUP_REPORT_RE);
    const issue = !report && raw.match(GROUP_ISSUE_RE);
    const command = MENU_WORDS.has(word) || TASK_WORDS.has(word) || SUMMARY_WORDS.has(word) || report || issue;
    if (!command) return undefined; // แชทปกติในกลุ่ม: ไม่ตอบและไม่เก็บ

    if (group.status !== 'active') return reply(event.replyToken, [M.groupNotActive(group)]);
    if (MENU_WORDS.has(word)) return reply(event.replyToken, [M.groupMenu(group)]);
    if (TASK_WORDS.has(word)) return replyGroupTasks(event.replyToken, group);
    if (SUMMARY_WORDS.has(word)) return replyGroupSummary(event.replyToken, group);

    const kind = report ? 'report' : 'issue';
    const body = ((report ? report[1] : issue[1]) ?? '').trim();
    if (!body) {
      const example = kind === 'report'
        ? 'รายงาน เทพื้นชั้น 2 เสร็จ 80% คนงาน 12 คน'
        : 'แจ้งปัญหา ปูนมาส่งไม่ครบ ขาด 20 ถุง';
      return reply(event.replyToken, [
        M.text(`ในกลุ่มให้พิมพ์รายละเอียดต่อท้ายในข้อความเดียวกันครับ\nเช่น ${example}`, M.groupQuickReply()),
      ]);
    }

    const { sup, name } = await groupSender(group, userId);
    db.addMessage({
      group_id: group.id,
      supervisor_id: sup?.id ?? null,
      sender_name: name,
      direction: 'in',
      kind,
      text: body,
      line_message_id: msg.id ?? null,
    });
    const ack = kind === 'issue'
      ? `🚨 แจ้งปัญหาถึงสำนักงานแล้วครับ${name ? ` (${name})` : ''}`
      : `📝 บันทึกรายงาน${name ? `ของ ${name}` : ''}แล้วครับ`;
    return reply(event.replyToken, [M.text(ack, M.groupQuickReply())]);
  }

  const noSiteReply = (replyToken) => reply(replyToken, [
    M.text('กลุ่มนี้ยังไม่ได้ผูกกับหน้างาน ให้สำนักงานตั้งค่าในหน้าเว็บก่อนครับ', M.groupQuickReply()),
  ]);

  async function replyGroupTasks(replyToken, group) {
    if (!group.site) return noSiteReply(replyToken);
    const tasks = db.listOpenTasksForSite(group.site);
    if (!tasks.length) {
      return reply(replyToken, [M.text(`🎉 หน้างาน ${group.site} ไม่มีงานค้างครับ`, M.groupQuickReply())]);
    }
    return reply(replyToken, M.taskList(tasks, {
      owner: `หน้างาน ${group.site} `,
      showAssignee: true,
      quickReply: M.groupQuickReply(),
    }));
  }

  async function replyGroupSummary(replyToken, group) {
    if (!group.site) return noSiteReply(replyToken);
    const tasks = db.listOpenTasksForSite(group.site);
    const text = buildSummaryText({}, tasks, todayInBangkok(), {
      greeting: `📊 สรุปงานหน้างาน ${group.site}`,
      showAssignee: true,
    }) ?? `🎉 หน้างาน ${group.site} ไม่มีงานค้างครับ`;
    return reply(replyToken, [M.text(text, M.groupQuickReply())]);
  }

  async function onGroupPostback(event, group, userId) {
    if (group.status !== 'active') return reply(event.replyToken, [M.groupNotActive(group)]);
    const sup = userId ? db.getSupervisorByLineId(userId) : null;
    if (!sup || sup.status !== 'active') {
      return reply(event.replyToken, [M.text(
        'ปุ่มนี้ใช้ได้เฉพาะผู้คุมงานที่ลงทะเบียนกับบอทแล้วครับ (เพิ่มเพื่อนบอท แล้วรอสำนักงานอนุมัติ)',
        M.groupQuickReply(),
      )]);
    }
    return applyTaskAction(event, sup, group);
  }

  /** รูปในกลุ่ม: เก็บเฉพาะรูปที่ส่งหลังกด "ส่งรูปงานนี้" (รูปทั่วไปในกลุ่มไม่เก็บ) */
  async function onGroupImage(event, group, userId, msg) {
    if (group.status !== 'active') return undefined;
    const sup = userId ? db.getSupervisorByLineId(userId) : null;
    if (!sup || sup.status !== 'active') return undefined;
    const task = activePhotoTask(sup);
    if (!task) return undefined;
    await storeImage(msg, {
      group_id: group.id, supervisor_id: sup.id, direction: 'in', line_message_id: msg.id ?? null,
    }, task);
    if (!isLastOfSet(msg)) return undefined;
    return reply(event.replyToken, [
      M.text(`📷 บันทึกรูปของงาน #${task.id} แล้วครับ (${sup.display_name})`, M.groupQuickReply()),
    ]);
  }

  return { handleEvents, handleEvent };
}
