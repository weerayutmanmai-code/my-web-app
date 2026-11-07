// ใส่ข้อมูลตัวอย่างเพื่อลองดูหน้าเว็บโดยยังไม่ต้องเชื่อม LINE
//   npm run seed:demo           (ใส่ได้เฉพาะตอนฐานข้อมูลยังว่าง)
//   npm run seed:demo -- --force
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { todayInBangkok } from '../src/dates.js';

const config = loadConfig();
const db = openDatabase(config.dbPath);

if (db.listSupervisors().length && !process.argv.includes('--force')) {
  console.log('ฐานข้อมูลมีข้อมูลอยู่แล้ว ไม่ได้ใส่ข้อมูลตัวอย่าง (ใช้ --force ถ้าต้องการใส่เพิ่ม)');
  process.exit(0);
}

const minutesAgo = (n) => new Date(Date.now() - n * 60_000).toISOString();
const dayOffset = (n) => todayInBangkok(new Date(Date.now() + n * 86_400_000));
const uid = () => `Udemo${Math.random().toString(16).slice(2, 14)}`;

const somchai = db.createSupervisor({
  line_user_id: uid(), line_name: 'Somchai 👷', name: 'สมชาย ใจดี', phone: '081-234-5678',
  site: 'บ้านคุณวิภา ลาดพร้าว 71', status: 'active', created_at: minutesAgo(60 * 24 * 7),
});
const prasert = db.createSupervisor({
  line_user_id: uid(), line_name: 'ประเสริฐ ท.', name: 'ประเสริฐ ทองดี', phone: '089-765-4321',
  site: 'อาคารพาณิชย์ บางนา กม.5', status: 'active', created_at: minutesAgo(60 * 24 * 5),
});
const wichai = db.createSupervisor({
  line_user_id: uid(), line_name: 'Wichai.K', status: 'pending', created_at: minutesAgo(25),
});

const t1 = db.createTask({ title: 'เทพื้นคอนกรีตชั้น 2', site: somchai.site, supervisor_id: somchai.id, due_date: dayOffset(1), detail: 'คอนกรีต 240 ksc ประมาณ 12 คิว นัดรถปูน 08:00', created_at: minutesAgo(60 * 30) });
const t2 = db.createTask({ title: 'ผูกเหล็กคานชั้น 3', site: somchai.site, supervisor_id: somchai.id, due_date: dayOffset(4), created_at: minutesAgo(60 * 20) });
const t3 = db.createTask({ title: 'ติดตั้งวงกบประตู-หน้าต่าง', site: prasert.site, supervisor_id: prasert.id, due_date: dayOffset(-2), created_at: minutesAgo(60 * 72) });
const t4 = db.createTask({ title: 'ก่ออิฐผนังห้องน้ำ', site: prasert.site, supervisor_id: prasert.id, due_date: dayOffset(-1), created_at: minutesAgo(60 * 96) });
db.createTask({ title: 'สำรวจหน้างานลูกค้าใหม่ รามอินทรา', site: 'รามอินทรา ซ.40', due_date: dayOffset(6), created_at: minutesAgo(60 * 3) });

db.updateTask(t1.id, { status: 'in_progress' });
db.updateTask(t4.id, { status: 'done' });

const log = (sup, kind, text, at, extra = {}) =>
  db.addMessage({ supervisor_id: sup.id, direction: 'in', kind, text, created_at: minutesAgo(at), ...extra });
const out = (sup, kind, text, at, extra = {}) =>
  db.addMessage({ supervisor_id: sup.id, direction: 'out', kind, text, created_at: minutesAgo(at), ...extra });

out(somchai, 'task', `📋 มอบหมายงาน #${t1.id}: ${t1.title}`, 60 * 30, { task_id: t1.id });
log(somchai, 'status', `▶️ งาน #${t1.id} ${t1.title} — เริ่มทำแล้ว`, 60 * 4, { task_id: t1.id });
log(somchai, 'report', 'ตั้งแบบหล่อพื้นชั้น 2 เสร็จ 100% ผูกเหล็กเสริมเสร็จ 80%\nคนงาน 11 คน พรุ่งนี้เทปูนตามแผน', 60 * 3);
log(somchai, 'location', 'บ้านคุณวิภา — ลาดพร้าว 71 แขวงลาดพร้าว', 60 * 3 - 5, { latitude: 13.8159, longitude: 100.6036 });
out(somchai, 'text', 'รับทราบครับ ยืนยันรถปูนเข้า 8 โมงตรง', 60 * 2);
log(somchai, 'text', 'ครับผม พรุ่งนี้จะส่งรูปตอนเทให้ดูครับ', 60 * 2 - 3);

out(prasert, 'task', `📋 มอบหมายงาน #${t3.id}: ${t3.title}`, 60 * 72, { task_id: t3.id });
log(prasert, 'status', `✅ งาน #${t4.id} ${t4.title} — เสร็จแล้ว`, 60 * 6, { task_id: t4.id });
log(prasert, 'issue', 'วงกบที่ส่งมาขนาดไม่ตรงแบบ 2 ชุด (ห้องนอน 2 และห้องน้ำ) ต้องเปลี่ยนก่อนติดตั้ง', 50);
log(prasert, 'text', 'รบกวนสำนักงานประสานร้านให้หน่อยครับ', 48);

log(wichai, 'system', 'ผู้คุมงานใหม่เพิ่มบอทเป็นเพื่อน — รออนุมัติ', 25);
log(wichai, 'text', 'สวัสดีครับ ผมวิชัย คุมงานไซต์รามอินทราครับ', 24);

db.markRead(somchai.id);
console.log(`ใส่ข้อมูลตัวอย่างแล้วที่ ${config.dbPath}`);
