// ข้อความทั้งหมดที่บอทส่งหาผู้คุมงาน (ภาษาไทย) รวมไว้ที่เดียวเพื่อแก้ถ้อยคำได้ง่าย
import { formatThaiDate, isOverdue } from './dates.js';

export const STATUS_LABEL = { todo: 'ยังไม่เริ่ม', in_progress: 'กำลังทำ', done: 'เสร็จแล้ว' };
const STATUS_COLOR = { todo: '#8A8A8A', in_progress: '#E8A317', done: '#06C755' };
const GREEN = '#06C755';
const RED = '#D93025';
export const PHOTO_WINDOW_MINUTES = 30;

const clip = (value, max) => {
  const s = String(value ?? '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

// ---------- quick reply (ปุ่มลอยเหนือช่องพิมพ์) ----------
const qMessage = (label, text) => ({ type: 'action', action: { type: 'message', label, text } });
const qPostback = (label, data, displayText) => ({
  type: 'action',
  action: { type: 'postback', label, data: new URLSearchParams(data).toString(), displayText },
});
const qCamera = () => ({ type: 'action', action: { type: 'camera', label: '📷 ถ่ายรูป' } });
const qCameraRoll = () => ({ type: 'action', action: { type: 'cameraRoll', label: '🖼️ เลือกรูป' } });
const qLocation = () => ({ type: 'action', action: { type: 'location', label: '📍 ส่งตำแหน่ง' } });
const qCancel = () => qMessage('✖️ ยกเลิก', 'ยกเลิก');

export function mainQuickReply() {
  return {
    items: [
      qMessage('📋 งานของฉัน', 'งานของฉัน'),
      qMessage('📊 สรุป', 'สรุป'),
      qMessage('📝 รายงาน', 'รายงาน'),
      qMessage('🚨 แจ้งปัญหา', 'แจ้งปัญหา'),
      qCamera(),
      qCameraRoll(),
      qLocation(),
      qMessage('❓ เมนู', 'เมนู'),
    ],
  };
}

export function text(body, quickReply) {
  const msg = { type: 'text', text: clip(body, 5000) };
  if (quickReply) msg.quickReply = quickReply;
  return msg;
}

export const nameOf = (sup) => sup?.name?.trim() || sup?.line_name || '';

// ---------- ข้อความทั่วไป ----------
export function menu() {
  return text(
    [
      '👷 เมนูผู้คุมงาน',
      '',
      '📋 "งานของฉัน" — ดูงานที่ได้รับมอบหมาย และกดอัปเดตสถานะ',
      '📊 "สรุป" — ดูสรุปงานค้าง (คนในสำนักงานจะได้สรุปภาพรวมทั้งหมด)',
      '📝 "รายงาน ..." — ส่งรายงานประจำวัน',
      '🚨 "แจ้งปัญหา ..." — แจ้งปัญหาหน้างานถึงสำนักงานทันที',
      '📷 ส่งรูป / 📍 ส่งตำแหน่ง — บันทึกเข้าระบบอัตโนมัติ',
      '💬 พิมพ์ข้อความอื่น — ส่งถึงสำนักงานโดยตรง',
    ].join('\n'),
    mainQuickReply(),
  );
}

export function welcome(sup) {
  const name = nameOf(sup);
  const hello = name ? `สวัสดีครับ คุณ${name} 👷` : 'สวัสดีครับ 👷';
  if (sup.status === 'active') {
    return [text(`${hello}\nยินดีต้อนรับสู่ระบบประสานงานหน้างาน`), menu()];
  }
  if (sup.status === 'inactive') return [notActive(sup)];
  return [
    text(
      `${hello}\nขอบคุณที่เพิ่มเพื่อนครับ ระบบแจ้งสำนักงานให้อนุมัติบัญชีของคุณแล้ว\nเมื่ออนุมัติเรียบร้อย จะแจ้งกลับทาง LINE นี้ครับ`,
    ),
  ];
}

export function notActive(sup) {
  if (sup.status === 'inactive') {
    return text('บัญชีของคุณถูกปิดใช้งานอยู่ครับ กรุณาติดต่อสำนักงาน');
  }
  return text('⏳ บัญชีของคุณกำลังรอสำนักงานอนุมัติครับ ข้อความนี้ส่งถึงสำนักงานแล้ว');
}

export function approved(sup) {
  return text(
    `✅ สำนักงานอนุมัติบัญชีของคุณ${nameOf(sup)}แล้วครับ\nกดปุ่มด้านล่าง หรือพิมพ์ "เมนู" เพื่อเริ่มใช้งาน`,
    mainQuickReply(),
  );
}

export function askFor(kind) {
  const body =
    kind === 'issue'
      ? '🚨 พิมพ์รายละเอียดปัญหาได้เลยครับ\nเช่น ปูนมาส่งไม่ครบ ขาด 20 ถุง'
      : '📝 พิมพ์รายละเอียดรายงานได้เลยครับ\nเช่น เทพื้นชั้น 2 เสร็จ 80% คนงาน 12 คน พรุ่งนี้ผูกเหล็กคาน';
  return text(`${body}\n\n(พิมพ์ "ยกเลิก" เพื่อยกเลิก)`, { items: [qCancel()] });
}

export function ack(kind) {
  const body = {
    report: '📝 บันทึกรายงานแล้ว ขอบคุณครับ',
    issue: '🚨 แจ้งปัญหาถึงสำนักงานแล้ว จะติดต่อกลับโดยเร็วครับ',
  }[kind] ?? '📨 ส่งข้อความถึงสำนักงานแล้วครับ';
  return text(body, mainQuickReply());
}

export function officeMessage(body) {
  return text(`💬 สำนักงาน:\n${body}`, mainQuickReply());
}

// ---------- การ์ดงาน (Flex Message) ----------
const smallText = (value, color = '#666666') => ({ type: 'text', text: value, size: 'sm', color, wrap: true });

const postbackButton = (label, data, displayText, style = 'secondary') => ({
  type: 'button',
  style,
  height: 'sm',
  ...(style === 'primary' ? { color: GREEN } : {}),
  action: { type: 'postback', label, data: new URLSearchParams(data).toString(), displayText },
});

export function taskBubble(task, { heading } = {}) {
  const overdue = isOverdue(task);
  const body = [];
  if (heading) body.push({ type: 'text', text: heading, size: 'xs', color: GREEN, weight: 'bold' });
  body.push({ type: 'text', text: clip(`#${task.id} ${task.title}`, 200), weight: 'bold', size: 'md', wrap: true });
  if (task.site) body.push(smallText(`📍 ${clip(task.site, 200)}`));
  if (task.due_date) {
    body.push(smallText(`📅 กำหนดเสร็จ ${formatThaiDate(task.due_date)}${overdue ? ' (เลยกำหนด)' : ''}`, overdue ? RED : undefined));
  }
  if (task.detail) body.push({ ...smallText(clip(task.detail, 400), '#444444'), margin: 'md' });
  body.push({
    type: 'text',
    text: `สถานะ: ${STATUS_LABEL[task.status] ?? task.status}`,
    size: 'sm',
    weight: 'bold',
    color: STATUS_COLOR[task.status] ?? '#666666',
    margin: 'md',
  });

  const buttons = [];
  if (task.status === 'todo') {
    buttons.push(postbackButton('▶️ เริ่มงาน', { action: 'status', task: task.id, value: 'in_progress' }, `เริ่มงาน #${task.id}`));
  }
  if (task.status !== 'done') {
    buttons.push(postbackButton('✅ เสร็จแล้ว', { action: 'status', task: task.id, value: 'done' }, `งาน #${task.id} เสร็จแล้ว`, 'primary'));
  }
  buttons.push(postbackButton('📷 ส่งรูปงานนี้', { action: 'photo', task: task.id }, `ส่งรูปงาน #${task.id}`));

  return {
    type: 'bubble',
    size: 'kilo',
    body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: body },
    footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: buttons },
  };
}

const MAX_BUBBLES = 12;

export function taskList(tasks) {
  const shown = tasks.slice(0, MAX_BUBBLES);
  const intro =
    tasks.length > MAX_BUBBLES
      ? `📋 คุณมีงานค้าง ${tasks.length} งาน (แสดง ${MAX_BUBBLES} งานที่ใกล้กำหนดที่สุด)`
      : `📋 คุณมีงานค้าง ${tasks.length} งาน ปัดซ้าย-ขวาเพื่อดู แล้วกดปุ่มเพื่ออัปเดตครับ`;
  return [
    text(intro),
    {
      type: 'flex',
      altText: `งานของคุณ ${tasks.length} รายการ`,
      contents: { type: 'carousel', contents: shown.map((t) => taskBubble(t)) },
      quickReply: mainQuickReply(),
    },
  ];
}

export function newTask(task) {
  return {
    type: 'flex',
    altText: clip(`📋 งานใหม่: ${task.title}`, 400),
    contents: taskBubble(task, { heading: '📋 งานใหม่จากสำนักงาน' }),
  };
}

const dueWhen = (daysBefore) =>
  daysBefore === 0 ? 'วันนี้' : daysBefore === 1 ? 'พรุ่งนี้' : `ในอีก ${daysBefore} วัน`;

/** เตือนงานใกล้ครบกำหนด: 1 ข้อความต่อคน (งานเดียว = การ์ดเดียว, หลายงาน = ปัดดูได้) */
export function dueReminder(tasks, daysBefore) {
  const when = dueWhen(daysBefore);
  const heading = `⏰ ครบกำหนด${when}`;
  const bubbles = tasks.slice(0, MAX_BUBBLES).map((t) => taskBubble(t, { heading }));
  return {
    type: 'flex',
    altText: clip(`⏰ งานครบกำหนด${when} ${tasks.length} งาน: ${tasks.map((t) => t.title).join(', ')}`, 400),
    contents: bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles },
    quickReply: mainQuickReply(),
  };
}

export function dueReminderLog(tasks, daysBefore) {
  return `⏰ เตือนงานครบกำหนด${dueWhen(daysBefore)}: ${tasks.map((t) => `#${t.id} ${t.title}`).join(', ')}`;
}

export function statusUpdated(task) {
  if (task.status === 'done') {
    return text(`✅ บันทึกแล้ว: งาน #${task.id} ${task.title} เสร็จเรียบร้อย\nส่งรูปผลงานให้สำนักงานได้เลยครับ`, {
      items: [
        qPostback('📷 ส่งรูปงานนี้', { action: 'photo', task: task.id }, `ส่งรูปงาน #${task.id}`),
        qMessage('📋 งานของฉัน', 'งานของฉัน'),
      ],
    });
  }
  return text(`▶️ บันทึกแล้ว: เริ่มงาน #${task.id} ${task.title}`, mainQuickReply());
}

export function askPhoto(task) {
  return text(
    `📷 ส่งรูปของงาน #${task.id} ${task.title} ได้เลยครับ\n(รูปที่ส่งภายใน ${PHOTO_WINDOW_MINUTES} นาทีจะผูกกับงานนี้)`,
    { items: [qCamera(), qCameraRoll(), qCancel()] },
  );
}
