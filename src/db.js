import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { todayInBangkok } from './dates.js';

/**
 * ทุกอย่างที่วิ่งผ่านบอท: ข้อความ รายงาน ปัญหา รูป ตำแหน่ง อัปเดตงาน และข้อความจากสำนักงาน
 * แชทรายคน: supervisor_id มีค่า, group_id = NULL
 * แชทกลุ่ม: group_id มีค่า, supervisor_id = คนส่ง (ถ้าเป็นผู้คุมงานที่รู้จัก), sender_name = ชื่อคนส่ง
 */
const messagesTable = (name) => `CREATE TABLE IF NOT EXISTS ${name} (
  id              INTEGER PRIMARY KEY,
  supervisor_id   INTEGER REFERENCES supervisors(id) ON DELETE CASCADE,
  group_id        INTEGER REFERENCES line_groups(id) ON DELETE CASCADE,
  sender_name     TEXT,
  direction       TEXT NOT NULL,                      -- in (จากหน้างาน) | out (จากสำนักงาน)
  kind            TEXT NOT NULL,                      -- text | report | issue | image | location | status | task | system | summary | reminder
  text            TEXT,
  task_id         INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  image_path      TEXT,
  latitude        REAL,
  longitude       REAL,
  line_message_id TEXT,
  error           TEXT,
  resolved        INTEGER NOT NULL DEFAULT 0,
  read_at         TEXT,
  created_at      TEXT NOT NULL
);`;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS supervisors (
  id               INTEGER PRIMARY KEY,
  line_user_id     TEXT NOT NULL UNIQUE,
  line_name        TEXT,
  picture_url      TEXT,
  name             TEXT,
  phone            TEXT,
  site             TEXT,
  status           TEXT NOT NULL DEFAULT 'pending',   -- pending | active | inactive
  role             TEXT NOT NULL DEFAULT 'supervisor', -- supervisor (ผู้คุมงาน) | office (สำนักงาน รับสรุปภาพรวม)
  is_following     INTEGER NOT NULL DEFAULT 1,
  pending_action   TEXT,                              -- report | issue (รอข้อความถัดไป)
  photo_task_id    INTEGER,                           -- งานที่กำลังส่งรูป
  photo_task_until TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id            INTEGER PRIMARY KEY,
  title         TEXT NOT NULL,
  detail        TEXT,
  site          TEXT,
  supervisor_id INTEGER REFERENCES supervisors(id) ON DELETE SET NULL,
  due_date      TEXT,
  status        TEXT NOT NULL DEFAULT 'todo',         -- todo | in_progress | done
  done_at       TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- กลุ่ม LINE ที่บอทอยู่ (ผูกกับหน้างานได้)
CREATE TABLE IF NOT EXISTS line_groups (
  id            INTEGER PRIMARY KEY,
  line_group_id TEXT NOT NULL UNIQUE,
  name          TEXT,
  picture_url   TEXT,
  site          TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',      -- pending | active | inactive
  is_member     INTEGER NOT NULL DEFAULT 1,           -- บอทยังอยู่ในกลุ่มไหม
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

${messagesTable('messages')}

-- กันประมวลผลซ้ำเมื่อ LINE ส่ง webhook เดิมซ้ำ (redelivery)
CREATE TABLE IF NOT EXISTS webhook_events (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

-- งานไหนเตือนใกล้ครบกำหนดไปแล้ว (ต่อวันกำหนดเสร็จ: ถ้าเลื่อนกำหนด จะเตือนใหม่ได้)
CREATE TABLE IF NOT EXISTS task_reminders (
  task_id  INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  due_date TEXT NOT NULL,
  sent_at  TEXT NOT NULL,
  PRIMARY KEY (task_id, due_date)
);

-- ค่าตั้งของระบบที่แก้จากหน้าเว็บได้ (เก็บเป็น JSON)
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

// สร้างหลังจาก migrate() เพราะฐานข้อมูลเดิมอาจยังไม่มีคอลัมน์ใหม่
const INDEXES = `
CREATE INDEX IF NOT EXISTS idx_messages_supervisor ON messages (supervisor_id, id);
CREATE INDEX IF NOT EXISTS idx_messages_group ON messages (group_id, id);
CREATE INDEX IF NOT EXISTS idx_messages_kind ON messages (kind, resolved);
CREATE INDEX IF NOT EXISTS idx_messages_task ON messages (task_id);
CREATE INDEX IF NOT EXISTS idx_tasks_supervisor ON tasks (supervisor_id, status);
`;

const SUPERVISOR_FIELDS = [
  'line_name', 'picture_url', 'name', 'phone', 'site', 'status', 'role', 'is_following',
  'pending_action', 'photo_task_id', 'photo_task_until',
];
const GROUP_FIELDS = ['name', 'picture_url', 'site', 'status', 'is_member'];
const TASK_FIELDS = ['title', 'detail', 'site', 'supervisor_id', 'due_date', 'status', 'done_at'];

const DISPLAY_NAME = `COALESCE(NULLIF(TRIM(s.name), ''), s.line_name, 'ผู้ใช้ LINE')`;

const nowIso = () => new Date().toISOString();
const toSql = (v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v);

export function openDatabase(filename = ':memory:') {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  db.exec(SCHEMA);
  migrate(db);
  db.exec(INDEXES);
  return createRepository(db);
}

/** ปรับฐานข้อมูลเดิมให้ตรงกับโครงสร้างใหม่ (CREATE TABLE IF NOT EXISTS ไม่เพิ่มคอลัมน์ให้ตารางที่มีอยู่แล้ว) */
function migrate(db) {
  const columns = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!columns('supervisors').includes('role')) {
    db.exec(`ALTER TABLE supervisors ADD COLUMN role TEXT NOT NULL DEFAULT 'supervisor'`);
  }
  // รองรับกลุ่ม LINE: supervisor_id ต้องว่างได้ + เพิ่ม group_id/sender_name
  // SQLite แก้ NOT NULL ของคอลัมน์เดิมไม่ได้ จึงสร้างตารางใหม่แล้วคัดลอกข้อมูลทั้งหมด
  if (!columns('messages').includes('group_id')) {
    const keep = [
      'id', 'supervisor_id', 'direction', 'kind', 'text', 'task_id', 'image_path', 'latitude', 'longitude',
      'line_message_id', 'error', 'resolved', 'read_at', 'created_at',
    ].join(', ');
    db.exec('PRAGMA foreign_keys = OFF');
    try {
      db.exec('BEGIN');
      db.exec(messagesTable('messages_new'));
      db.exec(`INSERT INTO messages_new (${keep}) SELECT ${keep} FROM messages`);
      db.exec('DROP TABLE messages');
      db.exec('ALTER TABLE messages_new RENAME TO messages');
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }
}

function createRepository(db) {
  const get = (sql, ...params) => db.prepare(sql).get(...params.map(toSql)) ?? null;
  const all = (sql, ...params) => db.prepare(sql).all(...params.map(toSql));
  const run = (sql, ...params) => db.prepare(sql).run(...params.map(toSql));

  function updateRow(table, allowed, id, fields) {
    const entries = Object.entries(fields).filter(([k, v]) => allowed.includes(k) && v !== undefined);
    if (!entries.length) return;
    const sets = entries.map(([k]) => `${k} = ?`).join(', ');
    run(`UPDATE ${table} SET ${sets}, updated_at = ? WHERE id = ?`, ...entries.map(([, v]) => v), nowIso(), id);
  }

  // ---------- ผู้คุมงาน ----------
  const SUPERVISOR_SELECT = `SELECT s.*, ${DISPLAY_NAME} AS display_name FROM supervisors s`;

  function getSupervisor(id) {
    return get(`${SUPERVISOR_SELECT} WHERE s.id = ?`, id);
  }

  function getSupervisorByLineId(lineUserId) {
    return get(`${SUPERVISOR_SELECT} WHERE s.line_user_id = ?`, lineUserId);
  }

  function createSupervisor({
    line_user_id, line_name = null, picture_url = null, status = 'pending',
    name = null, phone = null, site = null, created_at = nowIso(),
  }) {
    const r = run(
      `INSERT INTO supervisors (line_user_id, line_name, picture_url, status, name, phone, site, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      line_user_id, line_name, picture_url, status, name, phone, site, created_at, created_at,
    );
    return getSupervisor(Number(r.lastInsertRowid));
  }

  function updateSupervisor(id, fields) {
    updateRow('supervisors', SUPERVISOR_FIELDS, id, fields);
    return getSupervisor(id);
  }

  function listSupervisors() {
    return all(`
      SELECT s.*, ${DISPLAY_NAME} AS display_name,
        (SELECT COUNT(*) FROM messages m
          WHERE m.supervisor_id = s.id AND m.group_id IS NULL AND m.direction = 'in' AND m.read_at IS NULL) AS unread,
        (SELECT MAX(m.created_at) FROM messages m WHERE m.supervisor_id = s.id AND m.group_id IS NULL) AS last_message_at,
        (SELECT COUNT(*) FROM tasks t WHERE t.supervisor_id = s.id AND t.status != 'done') AS open_tasks
      FROM supervisors s
      ORDER BY last_message_at DESC NULLS LAST, s.id DESC
    `);
  }

  // ---------- กลุ่ม LINE ----------
  const getGroup = (id) => get('SELECT * FROM line_groups WHERE id = ?', id);
  const getGroupByLineId = (lineGroupId) => get('SELECT * FROM line_groups WHERE line_group_id = ?', lineGroupId);

  function createGroup({ line_group_id, name = null, picture_url = null, status = 'pending', created_at = nowIso() }) {
    const r = run(
      `INSERT INTO line_groups (line_group_id, name, picture_url, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      line_group_id, name, picture_url, status, created_at, created_at,
    );
    return getGroup(Number(r.lastInsertRowid));
  }

  function updateGroup(id, fields) {
    updateRow('line_groups', GROUP_FIELDS, id, fields);
    return getGroup(id);
  }

  function listGroups() {
    return all(`
      SELECT g.*,
        (SELECT COUNT(*) FROM messages m WHERE m.group_id = g.id AND m.direction = 'in' AND m.read_at IS NULL) AS unread,
        (SELECT MAX(m.created_at) FROM messages m WHERE m.group_id = g.id) AS last_message_at,
        (SELECT COUNT(*) FROM tasks t WHERE g.site IS NOT NULL AND t.site = g.site AND t.status != 'done') AS open_tasks
      FROM line_groups g
      ORDER BY last_message_at DESC NULLS LAST, g.id DESC
    `);
  }

  /** กลุ่มที่ใช้งานอยู่ บอทยังอยู่ในกลุ่ม และผูกกับหน้างานนี้ */
  function listActiveGroupsForSite(site) {
    if (!site) return [];
    return all(`SELECT * FROM line_groups WHERE site = ? AND status = 'active' AND is_member = 1 ORDER BY id`, site);
  }

  // ---------- งาน ----------
  const TASK_SELECT = `
    SELECT t.*,
      CASE WHEN s.id IS NULL THEN NULL ELSE ${DISPLAY_NAME} END AS supervisor_name,
      (SELECT COUNT(*) FROM messages m WHERE m.task_id = t.id AND m.kind = 'image') AS photo_count
    FROM tasks t LEFT JOIN supervisors s ON s.id = t.supervisor_id`;
  const TASK_ORDER = `
    ORDER BY CASE t.status WHEN 'in_progress' THEN 0 WHEN 'todo' THEN 1 ELSE 2 END,
      t.due_date IS NULL, t.due_date, t.id DESC`;

  function getTask(id) {
    if (!Number.isInteger(id)) return null;
    return get(`${TASK_SELECT} WHERE t.id = ?`, id);
  }

  function createTask({
    title, detail = null, site = null, supervisor_id = null, due_date = null,
    status = 'todo', created_at = nowIso(),
  }) {
    const r = run(
      `INSERT INTO tasks (title, detail, site, supervisor_id, due_date, status, done_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      title, detail, site, supervisor_id, due_date, status, status === 'done' ? created_at : null, created_at, created_at,
    );
    return getTask(Number(r.lastInsertRowid));
  }

  function updateTask(id, fields) {
    const extra = {};
    if (fields.status !== undefined) {
      extra.done_at = fields.status === 'done' ? (getTask(id)?.done_at ?? nowIso()) : null;
    }
    updateRow('tasks', TASK_FIELDS, id, { ...fields, ...extra });
    return getTask(id);
  }

  function deleteTask(id) {
    return run('DELETE FROM tasks WHERE id = ?', id).changes > 0;
  }

  function listTasks({ status, supervisor_id } = {}) {
    const where = [];
    const params = [];
    if (status) { where.push('t.status = ?'); params.push(status); }
    if (supervisor_id) { where.push('t.supervisor_id = ?'); params.push(supervisor_id); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return all(`${TASK_SELECT} ${clause} ${TASK_ORDER}`, ...params);
  }

  function listOpenTasksForSite(site) {
    return all(`${TASK_SELECT} WHERE t.site = ? AND t.status != 'done' ${TASK_ORDER}`, site);
  }

  function listOpenTasksFor(supervisorId) {
    return all(`${TASK_SELECT} WHERE t.supervisor_id = ? AND t.status != 'done' ${TASK_ORDER}`, supervisorId);
  }

  /** งานค้างที่ครบกำหนดวันที่ระบุ มีผู้รับผิดชอบ และยังไม่เคยเตือนสำหรับกำหนดนี้ */
  function listTasksToRemind(dueDate) {
    return all(`${TASK_SELECT}
      WHERE t.due_date = ? AND t.status != 'done' AND t.supervisor_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM task_reminders r WHERE r.task_id = t.id AND r.due_date = t.due_date)
      ORDER BY t.supervisor_id, t.id`, dueDate);
  }

  function markReminded(taskIds, dueDate) {
    const at = nowIso();
    for (const id of taskIds) {
      run('INSERT OR IGNORE INTO task_reminders (task_id, due_date, sent_at) VALUES (?, ?, ?)', id, dueDate, at);
    }
  }

  function listSites() {
    return all(`
      SELECT DISTINCT site FROM (SELECT site FROM tasks UNION SELECT site FROM supervisors)
      WHERE site IS NOT NULL AND TRIM(site) != '' ORDER BY site
    `).map((r) => r.site);
  }

  // ---------- ข้อความ / ไทม์ไลน์ ----------
  // supervisor_name = ชื่อคนส่ง/คนรับ (ผู้คุมงานที่รู้จัก หรือชื่อในกลุ่ม), group_name = ชื่อกลุ่ม (ถ้าเป็นแชทกลุ่ม)
  const MESSAGE_SELECT = `
    SELECT m.*,
      CASE WHEN s.id IS NULL THEN COALESCE(m.sender_name, 'สมาชิกกลุ่ม') ELSE ${DISPLAY_NAME} END AS supervisor_name,
      g.name AS group_name, t.title AS task_title,
      COALESCE(g.site, t.site, s.site) AS site
    FROM messages m
    LEFT JOIN supervisors s ON s.id = m.supervisor_id
    LEFT JOIN line_groups g ON g.id = m.group_id
    LEFT JOIN tasks t ON t.id = m.task_id`;

  function getMessage(id) {
    return get(`${MESSAGE_SELECT} WHERE m.id = ?`, id);
  }

  function addMessage({
    supervisor_id = null, group_id = null, sender_name = null, direction, kind, text = null, task_id = null,
    image_path = null, latitude = null, longitude = null, line_message_id = null, error = null, created_at = nowIso(),
  }) {
    const r = run(
      `INSERT INTO messages (supervisor_id, group_id, sender_name, direction, kind, text, task_id, image_path,
                             latitude, longitude, line_message_id, error, read_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      supervisor_id, group_id, sender_name, direction, kind, text, task_id, image_path,
      latitude, longitude, line_message_id, error, direction === 'out' ? created_at : null, created_at,
    );
    return getMessage(Number(r.lastInsertRowid));
  }

  function listMessages(supervisorId, { limit = 200 } = {}) {
    return all(
      `SELECT * FROM (${MESSAGE_SELECT} WHERE m.supervisor_id = ? AND m.group_id IS NULL ORDER BY m.id DESC LIMIT ?)
       ORDER BY id ASC`,
      supervisorId, limit,
    );
  }

  function listGroupMessages(groupId, { limit = 200 } = {}) {
    return all(
      `SELECT * FROM (${MESSAGE_SELECT} WHERE m.group_id = ? ORDER BY m.id DESC LIMIT ?) ORDER BY id ASC`,
      groupId, limit,
    );
  }

  function markRead(supervisorId) {
    return run(
      `UPDATE messages SET read_at = ?
       WHERE supervisor_id = ? AND group_id IS NULL AND direction = 'in' AND read_at IS NULL`,
      nowIso(), supervisorId,
    ).changes;
  }

  function markGroupRead(groupId) {
    return run(
      `UPDATE messages SET read_at = ? WHERE group_id = ? AND direction = 'in' AND read_at IS NULL`,
      nowIso(), groupId,
    ).changes;
  }

  function setMessageResolved(id, resolved) {
    run('UPDATE messages SET resolved = ? WHERE id = ?', resolved ? 1 : 0, id);
    return getMessage(id);
  }

  function recentActivity(limit = 25) {
    return all(`${MESSAGE_SELECT} ORDER BY m.id DESC LIMIT ?`, limit);
  }

  function openIssues() {
    return all(`${MESSAGE_SELECT} WHERE m.kind = 'issue' AND m.resolved = 0 ORDER BY m.id DESC`);
  }

  // ---------- webhook ----------
  let insertsSincePurge = 0;
  function markEventProcessed(eventId) {
    const inserted = run('INSERT OR IGNORE INTO webhook_events (id, created_at) VALUES (?, ?)', eventId, nowIso()).changes === 1;
    if (inserted && ++insertsSincePurge >= 500) {
      insertsSincePurge = 0;
      const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      run('DELETE FROM webhook_events WHERE created_at < ?', weekAgo);
    }
    return inserted;
  }

  // ---------- สรุปภาพรวมสำหรับสำนักงาน ----------
  function listTasksDoneBetween(startIso, endIso) {
    return all(`${TASK_SELECT} WHERE t.done_at >= ? AND t.done_at < ? ORDER BY t.done_at`, startIso, endIso);
  }

  /** งานที่ "ยังทำอยู่" ในช่วงเวลา: สร้างก่อนสิ้นช่วง และยังไม่เสร็จหรือเสร็จหลังต้นช่วง */
  function listTasksActiveBetween(startIso, endIso) {
    return all(
      `${TASK_SELECT} WHERE t.created_at < ? AND (t.done_at IS NULL OR t.done_at >= ?)
       ORDER BY t.site, t.due_date IS NULL, t.due_date, t.id`,
      endIso, startIso,
    );
  }

  function listOpenTasksDueBefore(date) {
    return all(`${TASK_SELECT} WHERE t.status != 'done' AND t.due_date < ? ORDER BY t.due_date, t.id`, date);
  }

  function listOpenTasksDueOn(date) {
    return all(`${TASK_SELECT} WHERE t.status != 'done' AND t.due_date = ? ORDER BY t.id`, date);
  }

  /** ข้อความจากผู้คุมงานในช่วงเวลา (เฉพาะประเภทที่ระบุ) */
  function listInboundBetween(startIso, endIso, kinds) {
    const marks = kinds.map(() => '?').join(', ');
    return all(
      `${MESSAGE_SELECT} WHERE m.direction = 'in' AND m.created_at >= ? AND m.created_at < ? AND m.kind IN (${marks})
       ORDER BY m.id`,
      startIso, endIso, ...kinds,
    );
  }

  // ---------- ค่าตั้ง ----------
  function getSetting(key, fallback = null) {
    const row = get('SELECT value FROM settings WHERE key = ?', key);
    if (!row) return fallback;
    try {
      return JSON.parse(row.value);
    } catch {
      return fallback;
    }
  }

  function setSetting(key, value) {
    run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      key, JSON.stringify(value), nowIso(),
    );
    return value;
  }

  // ---------- ภาพรวม ----------
  function summary() {
    const count = (sql, ...p) => get(sql, ...p).n;
    return {
      supervisors: count(`SELECT COUNT(*) n FROM supervisors WHERE status = 'active'`),
      pending_supervisors: count(`SELECT COUNT(*) n FROM supervisors WHERE status = 'pending'`),
      pending_groups: count(`SELECT COUNT(*) n FROM line_groups WHERE status = 'pending' AND is_member = 1`),
      open_tasks: count(`SELECT COUNT(*) n FROM tasks WHERE status != 'done'`),
      overdue_tasks: count(`SELECT COUNT(*) n FROM tasks WHERE status != 'done' AND due_date < ?`, todayInBangkok()),
      open_issues: count(`SELECT COUNT(*) n FROM messages WHERE kind = 'issue' AND resolved = 0`),
      unread: count(`SELECT COUNT(*) n FROM messages WHERE direction = 'in' AND read_at IS NULL`),
      issues: openIssues(),
      activity: recentActivity(),
    };
  }

  return {
    raw: db,
    close: () => db.close(),
    getSupervisor, getSupervisorByLineId, createSupervisor, updateSupervisor, listSupervisors,
    getGroup, getGroupByLineId, createGroup, updateGroup, listGroups, listActiveGroupsForSite, listOpenTasksForSite,
    getTask, createTask, updateTask, deleteTask, listTasks, listOpenTasksFor, listSites,
    listTasksToRemind, markReminded,
    getMessage, addMessage, listMessages, listGroupMessages, markRead, markGroupRead, setMessageResolved, recentActivity, openIssues,
    listTasksDoneBetween, listTasksActiveBetween, listOpenTasksDueBefore, listOpenTasksDueOn, listInboundBetween,
    markEventProcessed, getSetting, setSetting, summary,
  };
}
