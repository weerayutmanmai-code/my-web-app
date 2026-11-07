// REST API สำหรับหน้าเว็บสำนักงาน
import express from 'express';
import * as M from './messages.js';
import { isValidDateString } from './dates.js';

const TASK_STATUSES = ['todo', 'in_progress', 'done'];
const SUPERVISOR_STATUSES = ['pending', 'active', 'inactive'];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** undefined = ไม่เปลี่ยน, ค่าว่าง = null, อื่นๆ = ตัดช่องว่างและจำกัดความยาว */
function str(value, max) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const s = String(value).trim().slice(0, max);
  return s || null;
}

function parseDate(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (!isValidDateString(value)) throw new HttpError(400, 'รูปแบบวันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)');
  return value;
}

function idParam(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'รหัสไม่ถูกต้อง');
  return id;
}

export function createApiRouter({ db, line }) {
  const router = express.Router();

  const findSupervisor = (id) => {
    const sup = db.getSupervisor(id);
    if (!sup) throw new HttpError(404, 'ไม่พบผู้คุมงาน');
    return sup;
  };
  const findTask = (id) => {
    const task = db.getTask(id);
    if (!task) throw new HttpError(404, 'ไม่พบงาน');
    return task;
  };

  /** ส่งข้อความหาผู้คุมงานทาง LINE แล้วบันทึกลงแชท (บันทึกแม้ส่งไม่สำเร็จ พร้อมเหตุผล) */
  async function pushToSupervisor(sup, messages, log) {
    let error = null;
    if (sup.status !== 'active') error = 'บัญชีผู้คุมงานยังไม่เปิดใช้งาน';
    else if (!sup.is_following) error = 'ผู้คุมงานบล็อกบอท หรือยังไม่ได้เพิ่มบอทเป็นเพื่อน';
    else if (line.dryRun) error = 'โหมดทดลอง: ยังไม่ได้ตั้งค่า LINE จึงไม่ได้ส่งจริง';
    else {
      try {
        await line.push(sup.line_user_id, messages);
      } catch (err) {
        error = `ส่ง LINE ไม่สำเร็จ (${err.message})`;
      }
    }
    db.addMessage({ supervisor_id: sup.id, direction: 'out', ...log, error });
    return { pushed: !error, push_error: error };
  }

  const notifyAssignment = (sup, task) =>
    pushToSupervisor(sup, [M.newTask(task)], {
      kind: 'task',
      task_id: task.id,
      text: `📋 มอบหมายงาน #${task.id}: ${task.title}`,
    });

  // ---------- ภาพรวม ----------
  router.get('/summary', (req, res) => {
    res.json({ ...db.summary(), line_configured: !line.dryRun });
  });

  router.get('/sites', (req, res) => {
    res.json(db.listSites());
  });

  // ---------- ผู้คุมงาน ----------
  router.get('/supervisors', (req, res) => {
    res.json(db.listSupervisors());
  });

  router.patch('/supervisors/:id', async (req, res) => {
    const id = idParam(req);
    const before = findSupervisor(id);
    const b = req.body ?? {};
    if (b.status !== undefined && !SUPERVISOR_STATUSES.includes(b.status)) {
      throw new HttpError(400, 'สถานะไม่ถูกต้อง');
    }
    const after = db.updateSupervisor(id, {
      name: str(b.name, 100),
      phone: str(b.phone, 30),
      site: str(b.site, 200),
      status: b.status,
    });

    let push = { pushed: false, push_error: null };
    if (before.status !== 'active' && after.status === 'active') {
      push = await pushToSupervisor(after, [M.approved(after)], { kind: 'system', text: '✅ สำนักงานอนุมัติบัญชีแล้ว' });
    }
    res.json({ supervisor: db.getSupervisor(id), ...push });
  });

  router.get('/supervisors/:id/messages', (req, res) => {
    const id = idParam(req);
    findSupervisor(id);
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
    res.json(db.listMessages(id, { limit }));
  });

  router.post('/supervisors/:id/read', (req, res) => {
    const id = idParam(req);
    findSupervisor(id);
    res.json({ marked: db.markRead(id) });
  });

  router.post('/supervisors/:id/messages', async (req, res) => {
    const sup = findSupervisor(idParam(req));
    const text = str(req.body?.text, 4000);
    if (!text) throw new HttpError(400, 'กรุณาพิมพ์ข้อความ');
    const result = await pushToSupervisor(sup, [M.officeMessage(text)], { kind: 'text', text });
    res.status(201).json(result);
  });

  // ---------- งาน ----------
  router.get('/tasks', (req, res) => {
    const status = TASK_STATUSES.includes(req.query.status) ? req.query.status : undefined;
    const supervisorId = Number(req.query.supervisor_id) || undefined;
    res.json(db.listTasks({ status, supervisor_id: supervisorId }));
  });

  router.post('/tasks', async (req, res) => {
    const b = req.body ?? {};
    const title = str(b.title, 200);
    if (!title) throw new HttpError(400, 'กรุณาใส่ชื่องาน');
    const sup = b.supervisor_id ? findSupervisor(Number(b.supervisor_id)) : null;
    const task = db.createTask({
      title,
      detail: str(b.detail, 2000) ?? null,
      site: str(b.site, 200) ?? null,
      supervisor_id: sup?.id ?? null,
      due_date: parseDate(b.due_date) ?? null,
    });

    let push = { pushed: false, push_error: null };
    if (sup && b.notify !== false) push = await notifyAssignment(sup, task);
    res.status(201).json({ task, ...push });
  });

  router.patch('/tasks/:id', async (req, res) => {
    const id = idParam(req);
    const before = findTask(id);
    const b = req.body ?? {};
    const fields = {};

    if ('title' in b) {
      fields.title = str(b.title, 200);
      if (!fields.title) throw new HttpError(400, 'กรุณาใส่ชื่องาน');
    }
    if ('detail' in b) fields.detail = str(b.detail, 2000);
    if ('site' in b) fields.site = str(b.site, 200);
    if ('due_date' in b) fields.due_date = parseDate(b.due_date);
    if ('status' in b) {
      if (!TASK_STATUSES.includes(b.status)) throw new HttpError(400, 'สถานะงานไม่ถูกต้อง');
      fields.status = b.status;
    }
    let newSup = null;
    if ('supervisor_id' in b) {
      if (b.supervisor_id === null || b.supervisor_id === '') {
        fields.supervisor_id = null;
      } else {
        newSup = findSupervisor(Number(b.supervisor_id));
        fields.supervisor_id = newSup.id;
      }
    }

    const task = db.updateTask(id, fields);
    let push = { pushed: false, push_error: null };
    if (newSup && newSup.id !== before.supervisor_id && b.notify !== false) {
      push = await notifyAssignment(newSup, task);
    }
    res.json({ task, ...push });
  });

  router.delete('/tasks/:id', (req, res) => {
    const id = idParam(req);
    findTask(id);
    db.deleteTask(id);
    res.status(204).end();
  });

  // ---------- ข้อความ ----------
  router.patch('/messages/:id', (req, res) => {
    const id = idParam(req);
    if (!db.getMessage(id)) throw new HttpError(404, 'ไม่พบข้อความ');
    res.json(db.setMessageResolved(id, Boolean(req.body?.resolved)));
  });

  router.use((req, res) => {
    res.status(404).json({ error: 'ไม่พบ API นี้' });
  });

  return router;
}
