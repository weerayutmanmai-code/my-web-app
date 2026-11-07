// REST API สำหรับหน้าเว็บสำนักงาน
import express from 'express';
import * as M from './messages.js';
import { isValidDateString } from './dates.js';
import { pushToSupervisor as pushTo, pushToGroup } from './notify.js';

const TASK_STATUSES = ['todo', 'in_progress', 'done'];
const SUPERVISOR_STATUSES = ['pending', 'active', 'inactive'];
const ROLES = ['supervisor', 'office'];
const GROUP_STATUSES = ['pending', 'active', 'inactive'];

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

export function createApiRouter({ db, line, morningSummary, dueReminders, officeSummary }) {
  const router = express.Router();

  const findSupervisor = (id) => {
    const sup = db.getSupervisor(id);
    if (!sup) throw new HttpError(404, 'ไม่พบผู้คุมงาน');
    return sup;
  };
  const findGroup = (id) => {
    const group = db.getGroup(id);
    if (!group) throw new HttpError(404, 'ไม่พบกลุ่ม');
    return group;
  };
  const findTask = (id) => {
    const task = db.getTask(id);
    if (!task) throw new HttpError(404, 'ไม่พบงาน');
    return task;
  };

  const pushToSupervisor = (sup, messages, log) => pushTo({ db, line }, sup, messages, log);

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
    if (b.role !== undefined && !ROLES.includes(b.role)) {
      throw new HttpError(400, 'บทบาทไม่ถูกต้อง');
    }
    const after = db.updateSupervisor(id, {
      name: str(b.name, 100),
      phone: str(b.phone, 30),
      site: str(b.site, 200),
      status: b.status,
      role: b.role,
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

    // ส่งการ์ดเข้ากลุ่ม LINE ของหน้างานนี้ด้วย (ถ้าเลือก)
    const groups = [];
    if (b.notify_group === true) {
      for (const group of db.listActiveGroupsForSite(task.site)) {
        const r = await pushToGroup({ db, line }, group, [M.newTask(task, { showAssignee: true })], {
          kind: 'task',
          task_id: task.id,
          text: `📋 งานใหม่ #${task.id}: ${task.title}${task.supervisor_name ? ` (ผู้รับผิดชอบ ${task.supervisor_name})` : ''}`,
        });
        groups.push({ group_id: group.id, name: group.name, ...r });
      }
    }
    res.status(201).json({ task, ...push, groups });
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

  // ---------- กลุ่ม LINE ----------
  router.get('/groups', (req, res) => {
    res.json(db.listGroups());
  });

  router.patch('/groups/:id', (req, res) => {
    const id = idParam(req);
    findGroup(id);
    const b = req.body ?? {};
    if (b.status !== undefined && !GROUP_STATUSES.includes(b.status)) throw new HttpError(400, 'สถานะไม่ถูกต้อง');
    const group = db.updateGroup(id, { name: str(b.name, 100), site: str(b.site, 200), status: b.status });
    res.json({ group });
  });

  router.get('/groups/:id/messages', (req, res) => {
    const id = idParam(req);
    findGroup(id);
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
    res.json(db.listGroupMessages(id, { limit }));
  });

  router.post('/groups/:id/read', (req, res) => {
    const id = idParam(req);
    findGroup(id);
    res.json({ marked: db.markGroupRead(id) });
  });

  router.post('/groups/:id/messages', async (req, res) => {
    const group = findGroup(idParam(req));
    const text = str(req.body?.text, 4000);
    if (!text) throw new HttpError(400, 'กรุณาพิมพ์ข้อความ');
    const result = await pushToGroup({ db, line }, group, [M.text(`💬 สำนักงาน:\n${text}`, M.groupQuickReply())], {
      kind: 'text',
      text,
    });
    res.status(201).json(result);
  });

  // ---------- ข้อความ ----------
  router.patch('/messages/:id', (req, res) => {
    const id = idParam(req);
    if (!db.getMessage(id)) throw new HttpError(404, 'ไม่พบข้อความ');
    res.json(db.setMessageResolved(id, Boolean(req.body?.resolved)));
  });

  // ---------- สรุปงานทุกเช้า ----------
  router.get('/morning-summary', (req, res) => {
    res.json(morningSummary.status());
  });

  router.put('/morning-summary', (req, res) => {
    morningSummary.updateSettings(req.body ?? {});
    res.json(morningSummary.status());
  });

  router.post('/morning-summary/send', async (req, res) => {
    res.json(await morningSummary.sendAll());
  });

  // ---------- เตือนงานใกล้ครบกำหนด ----------
  router.get('/reminders', (req, res) => {
    res.json(dueReminders.status());
  });

  router.put('/reminders', (req, res) => {
    dueReminders.updateSettings(req.body ?? {});
    res.json(dueReminders.status());
  });

  router.post('/reminders/send', async (req, res) => {
    res.json(await dueReminders.sendDue());
  });

  // ---------- สรุปภาพรวมให้สำนักงาน ----------
  router.get('/office-summary', (req, res) => {
    res.json(officeSummary.status());
  });

  router.put('/office-summary', (req, res) => {
    officeSummary.updateSettings(req.body ?? {});
    res.json(officeSummary.status());
  });

  router.post('/office-summary/send', async (req, res) => {
    res.json(await officeSummary.sendAll());
  });

  router.use((req, res) => {
    res.status(404).json({ error: 'ไม่พบ API นี้' });
  });

  return router;
}
