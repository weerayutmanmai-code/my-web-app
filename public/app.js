// หน้าเว็บสำนักงาน (vanilla JS ไม่ต้อง build)
const TZ = 'Asia/Bangkok';
const POLL_MS = 8000;

const TASK_STATUS = { todo: 'ยังไม่เริ่ม', in_progress: 'กำลังทำ', done: 'เสร็จแล้ว' };
const SUP_STATUS = { pending: 'รออนุมัติ', active: 'ใช้งานอยู่', inactive: 'ปิดใช้งาน' };
const KIND_TAG = {
  report: '📝 รายงาน',
  issue: '🚨 แจ้งปัญหา',
  status: '🔄 อัปเดตงาน',
  image: '📷 รูปภาพ',
  location: '📍 ตำแหน่ง',
  summary: '🌅 สรุปงานประจำวัน',
};
const KIND_ICON = { text: '💬', report: '📝', issue: '🚨', status: '🔄', task: '📋', image: '📷', location: '📍', system: 'ℹ️', summary: '🌅', reminder: '⏰' };
const DAY_LABELS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

const state = {
  summary: null,
  supervisors: [],
  tasks: [],
  sites: [],
  supId: null,
  taskFilter: 'open',
};

const view = document.getElementById('view');
let current = null; // { tab, refresh(force), onRoute?(id) }

// ---------------------------------------------------------------- utilities

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (typeof value !== 'string' && key in el) el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  return el;
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `เกิดข้อผิดพลาด (${res.status})`);
  return data;
}

const fmtDateTime = (iso) =>
  iso ? new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '';
const fmtDate = (d) =>
  d ? new Date(`${d}T00:00:00+07:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', timeZone: TZ }) : '';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const isOverdue = (t) => t.due_date && t.status !== 'done' && t.due_date < today();
const mapsUrl = (m) => `https://www.google.com/maps?q=${Number(m.latitude)},${Number(m.longitude)}`;

let toastTimer;
function toast(message, type = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast ${type}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, type === 'ok' ? 3500 : 7000);
}

/** แจ้งผลการส่ง LINE หลังทำรายการ */
function toastPush(result, okText) {
  if (result?.pushed) toast(`${okText} และแจ้งทาง LINE แล้ว`);
  else if (result?.push_error) toast(`${okText} แต่ยังไม่ได้ส่ง LINE: ${result.push_error}`, 'warn');
  else toast(okText);
}

function avatar(sup, size = '') {
  const url = typeof sup.picture_url === 'string' && sup.picture_url.startsWith('https://') ? sup.picture_url : null;
  if (url) return h('img', { class: `avatar ${size}`, src: url, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
  return h('span', { class: `avatar ${size}`, 'aria-hidden': 'true' }, (sup.display_name || '?').trim().charAt(0));
}

const supPill = (sup) => h('span', { class: `pill ${sup.status}` }, SUP_STATUS[sup.status] ?? sup.status);
const empty = (text) => h('div', { class: 'empty' }, text);

/** ผู้ใช้กำลังพิมพ์/เลือกอะไรอยู่ในส่วนนี้ไหม (กันการรีเฟรชทับ) */
const busy = (region) =>
  region.contains(document.activeElement) && document.activeElement.matches('input, select, textarea');

// ---------------------------------------------------------------- data

async function loadSummary() {
  state.summary = await api('/summary');
  const s = state.summary;
  const setBadge = (id, n) => {
    const el = document.getElementById(id);
    el.textContent = n;
    el.hidden = !n;
  };
  setBadge('badge-unread', s.unread);
  setBadge('badge-pending', s.pending_supervisors);
  document.getElementById('line-banner').hidden = s.line_configured;
  return s;
}
const loadSupervisors = async () => { state.supervisors = await api('/supervisors'); };
const loadTasks = async () => { state.tasks = await api('/tasks'); };
const loadSites = async () => { state.sites = await api('/sites'); };

const supervisorById = (id) => state.supervisors.find((s) => s.id === id);

function openChat(supId) {
  location.hash = `#inbox/${supId}`;
}

// ---------------------------------------------------------------- ภาพรวม

function OverviewTab() {
  const content = h('div', { class: 'page' });
  const officeCard = OfficeSummaryCard();
  const root = h('div', { class: 'page' }, content, officeCard.el);
  view.replaceChildren(root);

  const stat = (label, value, href, tone = '') =>
    h('a', { class: `stat ${value ? tone : ''}`, href }, h('div', { class: 'stat-label' }, label), h('div', { class: 'stat-value' }, value));

  function issueItem(m) {
    return h('li', {},
      h('span', { class: 'feed-icon' }, '🚨'),
      h('div', { class: 'feed-body' },
        h('div', { class: 'feed-title' }, h('span', {}, m.supervisor_name), h('time', {}, fmtDateTime(m.created_at))),
        h('div', { class: 'feed-text' }, m.text),
        h('div', { class: 'row-actions' },
          h('button', { class: 'btn sm', onclick: () => openChat(m.supervisor_id) }, '💬 เปิดแชท'),
          h('button', { class: 'btn sm', onclick: () => resolveIssue(m.id, true) }, '✔ ปิดเรื่อง'),
        ),
      ),
    );
  }

  function activityItem(m) {
    const label = m.direction === 'out' ? `สำนักงาน → ${m.supervisor_name}` : m.supervisor_name;
    let body = m.text;
    if (m.kind === 'image') body = m.task_id ? `ส่งรูปงาน #${m.task_id}` : 'ส่งรูป';
    if (m.kind === 'summary') body = 'ส่งสรุปงานประจำวันทาง LINE';
    return h('li', {},
      h('span', { class: 'feed-icon' }, KIND_ICON[m.kind] ?? '💬'),
      h('a', { class: 'feed-link', href: `#inbox/${m.supervisor_id}` },
        h('div', { class: 'feed-body' },
          h('div', { class: 'feed-title' }, h('span', {}, label), h('time', {}, fmtDateTime(m.created_at))),
          h('div', { class: 'feed-text muted' }, body),
        ),
      ),
    );
  }

  return {
    tab: 'overview',
    async refresh(force) {
      const [s] = await Promise.all([state.summary ?? loadSummary(), officeCard.refresh(force)]);
      content.replaceChildren(
        h('section', { class: 'stats' },
          stat('งานค้าง', s.open_tasks, '#tasks'),
          stat('งานเลยกำหนด', s.overdue_tasks, '#tasks', 'danger'),
          stat('ปัญหายังไม่ปิด', s.open_issues, '#overview', 'warn'),
          stat('รออนุมัติ', s.pending_supervisors, '#supervisors', 'warn'),
        ),
        h('div', { class: 'grid-2' },
          h('section', { class: 'card' },
            h('h2', {}, '🚨 ปัญหาจากหน้างานที่ยังไม่ปิด'),
            s.issues.length ? h('ul', { class: 'feed' }, s.issues.map(issueItem)) : empty('ไม่มีปัญหาค้าง 👍'),
          ),
          h('section', { class: 'card' },
            h('h2', {}, '🕒 ความเคลื่อนไหวล่าสุด'),
            s.activity.length
              ? h('ul', { class: 'feed' }, s.activity.map(activityItem))
              : empty('ยังไม่มีความเคลื่อนไหว ให้ผู้คุมงานเพิ่มเพื่อน LINE OA ของคุณเพื่อเริ่มใช้งาน'),
          ),
        ),
      );
    },
  };
}

async function resolveIssue(id, resolved) {
  try {
    await api(`/messages/${id}`, { method: 'PATCH', body: { resolved } });
    toast(resolved ? 'ปิดเรื่องแล้ว' : 'เปิดเรื่องอีกครั้งแล้ว');
    await tick(true);
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------------------------------------------------------------- ข้อความ

function InboxTab() {
  const list = h('div', { class: 'sup-list' });
  const header = h('div', { class: 'thread-header' });
  const thread = h('div', { class: 'thread' });
  const hint = h('div', { class: 'composer-hint', hidden: true });
  const input = h('textarea', { rows: 1, placeholder: 'พิมพ์ข้อความถึงผู้คุมงาน… (Enter = ส่ง, Shift+Enter = ขึ้นบรรทัดใหม่)' });
  const sendBtn = h('button', { class: 'btn primary', type: 'submit' }, 'ส่ง');
  const composer = h('form', { class: 'composer', onsubmit: send }, input, sendBtn);
  const root = h('div', { class: 'inbox' },
    h('aside', { class: 'sup-list-wrap' }, h('h2', {}, 'ผู้คุมงาน'), list),
    h('section', { class: 'thread-pane' }, header, thread, hint, composer),
  );
  view.replaceChildren(root);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      composer.requestSubmit();
    }
  });

  let renderedKey = '';

  async function send(e) {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || !state.supId) return;
    sendBtn.disabled = true;
    try {
      const result = await api(`/supervisors/${state.supId}/messages`, { method: 'POST', body: { text } });
      input.value = '';
      toastPush(result, 'บันทึกข้อความแล้ว');
      await refreshThread(true);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  }

  function renderList() {
    if (!state.supervisors.length) {
      list.replaceChildren(empty('ยังไม่มีผู้คุมงาน'));
      return;
    }
    list.replaceChildren(...state.supervisors.map((s) =>
      h('button', {
        class: `sup-item ${s.id === state.supId ? 'active' : ''}`,
        type: 'button',
        onclick: () => openChat(s.id),
      },
        avatar(s, 'sm'),
        h('div', { class: 'sup-item-body' },
          h('div', { class: 'sup-item-name' },
            h('span', {}, s.display_name),
            s.unread && s.id !== state.supId ? h('span', { class: 'badge' }, s.unread) : null,
          ),
          h('div', { class: 'sup-item-sub' },
            s.status !== 'active' ? `${SUP_STATUS[s.status]} · ` : '',
            s.role === 'office' ? 'สำนักงาน · ' : '',
            s.site || (s.last_message_at ? `ล่าสุด ${fmtDateTime(s.last_message_at)}` : 'ยังไม่มีข้อความ'),
          ),
        ),
      )));
  }

  function renderHeader(sup) {
    header.replaceChildren(
      h('a', { class: 'btn ghost sm back', href: '#inbox', onclick: () => { state.supId = null; } }, '←'),
      avatar(sup),
      h('div', { style: 'flex:1;min-width:0' },
        h('div', { class: 'name' }, sup.display_name, ' ', supPill(sup)),
        h('div', { class: 'small muted' },
          [sup.site && `📍 ${sup.site}`, sup.phone && `📞 ${sup.phone}`, `📋 งานค้าง ${sup.open_tasks ?? 0}`]
            .filter(Boolean).join('   '),
        ),
      ),
      sup.phone ? h('a', { class: 'btn sm', href: `tel:${sup.phone.replace(/[^\d+]/g, '')}` }, 'โทร') : null,
    );
    let reason = '';
    if (sup.status === 'pending') reason = 'ผู้คุมงานคนนี้ยังรออนุมัติ — อนุมัติได้ที่แท็บ "ผู้คุมงาน" ก่อนจึงจะส่งข้อความได้';
    else if (sup.status === 'inactive') reason = 'บัญชีนี้ถูกปิดใช้งาน';
    else if (!sup.is_following) reason = 'ผู้คุมงานบล็อกบอทหรือลบเพื่อนแล้ว ส่งข้อความไม่ได้';
    hint.textContent = reason;
    hint.hidden = !reason;
    input.disabled = sendBtn.disabled = Boolean(reason);
  }

  function messageEl(m) {
    if (m.kind === 'system') {
      return h('div', { class: 'msg system' }, `${m.text} · ${fmtDateTime(m.created_at)}`);
    }
    const parts = [];
    const tag = KIND_TAG[m.kind];
    if (tag) parts.push(h('div', { class: 'msg-tag' }, tag, m.task_id && m.kind === 'image' ? ` · งาน #${m.task_id} ${m.task_title ?? ''}` : ''));
    if (m.kind === 'image') {
      parts.push(m.image_path
        ? h('a', { href: `/uploads/${m.image_path}`, target: '_blank', rel: 'noopener' },
          h('img', { src: `/uploads/${m.image_path}`, alt: 'รูปจากหน้างาน', loading: 'lazy' }))
        : h('span', { class: 'muted' }, 'ไม่มีไฟล์รูป'));
    } else if (m.kind === 'location') {
      parts.push(h('a', { href: mapsUrl(m), target: '_blank', rel: 'noopener' }, `${m.text} (เปิดแผนที่)`));
    } else if (m.text) {
      parts.push(h('div', {}, m.text));
    }
    if (m.kind === 'issue') {
      parts.push(h('div', { class: 'row-actions' },
        m.resolved
          ? h('button', { class: 'btn sm', onclick: () => resolveIssue(m.id, false) }, '✔ ปิดเรื่องแล้ว · เปิดใหม่')
          : h('button', { class: 'btn sm', onclick: () => resolveIssue(m.id, true) }, 'ปิดเรื่อง'),
      ));
    }
    return h('div', { class: `msg ${m.direction} kind-${m.kind}` },
      h('div', { class: 'bubble' }, parts),
      h('div', { class: 'msg-meta' },
        m.direction === 'out' ? 'สำนักงาน · ' : '',
        fmtDateTime(m.created_at),
        m.error ? h('span', { class: 'msg-error' }, ` · ⚠️ ${m.error}`) : null,
      ),
    );
  }

  async function refreshThread(force = false) {
    root.classList.toggle('has-selection', Boolean(state.supId));
    const sup = state.supId ? supervisorById(state.supId) : null;
    if (!sup) {
      header.replaceChildren(h('div', { class: 'muted' }, 'เลือกผู้คุมงานทางซ้ายเพื่อดูข้อความ'));
      thread.replaceChildren(h('div', { class: 'thread-empty' }, '💬 ข้อความ รายงาน รูป และปัญหาจากหน้างานจะแสดงที่นี่'));
      hint.hidden = true;
      input.disabled = sendBtn.disabled = true;
      renderedKey = '';
      return;
    }
    renderHeader(sup);
    const messages = await api(`/supervisors/${sup.id}/messages`);
    if (sup.unread) {
      await api(`/supervisors/${sup.id}/read`, { method: 'POST' });
      sup.unread = 0;
      renderList();
      loadSummary().catch(() => {});
    }
    const key = `${sup.id}:${messages.length}:${messages.at(-1)?.id}:${messages.map((m) => m.resolved).join('')}`;
    if (!force && key === renderedKey) return;
    const sameThread = renderedKey.startsWith(`${sup.id}:`);
    const atBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
    renderedKey = key;
    thread.replaceChildren(...(messages.length ? messages.map(messageEl) : [h('div', { class: 'thread-empty' }, 'ยังไม่มีข้อความ')]));
    if (!sameThread || atBottom || force) thread.scrollTop = thread.scrollHeight;
  }

  return {
    tab: 'inbox',
    async refresh(force) {
      await loadSupervisors();
      renderList();
      await refreshThread(force);
    },
    async onRoute(id) {
      state.supId = id;
      renderList();
      await refreshThread(true);
      if (id && !input.disabled) input.focus();
    },
  };
}

// ---------------------------------------------------------------- งาน

function TasksTab() {
  const supSelect = h('select', { name: 'supervisor_id' });
  const siteList = h('datalist', { id: 'site-options' });
  const form = h('form', { class: 'card form-grid', onsubmit: createTask },
    h('h2', {}, '📋 มอบหมายงานใหม่'),
    h('label', {}, 'ชื่องาน *', h('input', { name: 'title', required: true, maxlength: '200', placeholder: 'เช่น เทพื้นคอนกรีตชั้น 2' })),
    h('div', { class: 'form-row' },
      h('label', {}, 'หน้างาน / โครงการ', h('input', { name: 'site', list: 'site-options', maxlength: '200', placeholder: 'เช่น บ้านคุณวิภา ลาดพร้าว 71' })),
      h('label', {}, 'ผู้คุมงาน', supSelect),
      h('label', {}, 'กำหนดเสร็จ', h('input', { name: 'due_date', type: 'date' })),
    ),
    h('label', {}, 'รายละเอียด', h('textarea', { name: 'detail', rows: 2, maxlength: '2000', placeholder: 'สเปก วัสดุ จำนวนคน หรือข้อควรระวัง' })),
    h('div', { class: 'form-actions' },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'notify', checked: 'checked' }), 'ส่งการ์ดงานให้ผู้คุมงานทาง LINE ทันที'),
      h('button', { class: 'btn primary', type: 'submit' }, 'มอบหมายงาน'),
    ),
    siteList,
  );
  const chips = h('div', { class: 'chips' });
  const list = h('div', { class: 'task-list' });
  const summaryCard = MorningSummaryCard();
  const reminderCard = ReminderCard();
  const root = h('div', { class: 'page' },
    form,
    summaryCard.el,
    reminderCard.el,
    h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'รายการงาน'), chips), list),
  );
  view.replaceChildren(root);

  const FILTERS = [
    ['open', 'งานค้าง', (t) => t.status !== 'done'],
    ['overdue', 'เลยกำหนด', isOverdue],
    ['todo', 'ยังไม่เริ่ม', (t) => t.status === 'todo'],
    ['in_progress', 'กำลังทำ', (t) => t.status === 'in_progress'],
    ['done', 'เสร็จแล้ว', (t) => t.status === 'done'],
    ['all', 'ทั้งหมด', () => true],
  ];

  function supervisorOptions(selected, { includeInactive = false } = {}) {
    const options = [h('option', { value: '' }, '— ยังไม่ระบุ —')];
    for (const s of state.supervisors) {
      if (s.status !== 'active' && !includeInactive && s.id !== selected) continue;
      if (s.role === 'office' && s.id !== selected) continue; // คนในสำนักงานไม่รับงาน
      const suffix = s.status !== 'active' ? ` (${SUP_STATUS[s.status]})` : '';
      options.push(h('option', { value: String(s.id) }, s.display_name + suffix));
    }
    return options;
  }

  function fillSupSelect() {
    const value = supSelect.value;
    supSelect.replaceChildren(...supervisorOptions(null));
    supSelect.value = value;
  }

  async function createTask(e) {
    e.preventDefault();
    const fd = new FormData(form);
    const body = {
      title: fd.get('title'),
      site: fd.get('site'),
      supervisor_id: fd.get('supervisor_id') || null,
      due_date: fd.get('due_date') || null,
      detail: fd.get('detail'),
      notify: fd.get('notify') === 'on',
    };
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    try {
      const result = await api('/tasks', { method: 'POST', body });
      form.reset();
      toastPush(result, `สร้างงาน #${result.task.id} แล้ว`);
      await refresh(true);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function patchTask(task, body, okText) {
    try {
      const result = await api(`/tasks/${task.id}`, { method: 'PATCH', body });
      toastPush(result, okText);
    } catch (err) {
      toast(err.message, 'error');
    }
    await refresh(true);
  }

  function taskRow(t) {
    const status = h('select', {
      'aria-label': 'สถานะงาน',
      onchange: (e) => patchTask(t, { status: e.target.value }, `อัปเดตงาน #${t.id} แล้ว`),
    }, Object.entries(TASK_STATUS).map(([v, label]) => h('option', { value: v }, label)));
    status.value = t.status;

    const assignee = h('select', {
      'aria-label': 'ผู้คุมงาน',
      onchange: (e) => {
        const target = supervisorById(Number(e.target.value));
        const question = target
          ? `มอบหมายงาน #${t.id} ให้ ${target.display_name} และแจ้งทาง LINE?`
          : `เอาผู้รับผิดชอบออกจากงาน #${t.id}?`;
        if (!confirm(question)) {
          e.target.value = t.supervisor_id ? String(t.supervisor_id) : '';
          return;
        }
        patchTask(t, { supervisor_id: e.target.value || null }, `เปลี่ยนผู้รับผิดชอบงาน #${t.id} แล้ว`);
      },
    }, supervisorOptions(t.supervisor_id));
    assignee.value = t.supervisor_id ? String(t.supervisor_id) : '';

    const remove = h('button', {
      class: 'btn sm ghost danger',
      title: 'ลบงาน',
      'aria-label': `ลบงาน #${t.id}`,
      onclick: async () => {
        if (!confirm(`ลบงาน #${t.id} "${t.title}"?`)) return;
        try {
          await api(`/tasks/${t.id}`, { method: 'DELETE' });
          toast(`ลบงาน #${t.id} แล้ว`);
        } catch (err) {
          toast(err.message, 'error');
        }
        await refresh(true);
      },
    }, '🗑');

    const late = isOverdue(t);
    return h('div', { class: `task status-${t.status} ${late ? 'overdue' : ''}` },
      h('div', {},
        h('div', { class: 'task-title' }, h('span', { class: 'task-id' }, `#${t.id} `), t.title),
        h('div', { class: 'task-meta' },
          t.site ? h('span', {}, `📍 ${t.site}`) : null,
          t.due_date ? h('span', { class: late ? 'late' : '' }, `📅 ${fmtDate(t.due_date)}${late ? ' · เลยกำหนด' : ''}`) : null,
          t.supervisor_name ? h('a', { href: `#inbox/${t.supervisor_id}` }, `👷 ${t.supervisor_name}`) : h('span', {}, '👷 ยังไม่มีผู้รับผิดชอบ'),
          t.photo_count ? h('span', {}, `📷 ${t.photo_count} รูป`) : null,
          t.done_at ? h('span', {}, `✅ เสร็จ ${fmtDateTime(t.done_at)}`) : null,
        ),
        t.detail ? h('div', { class: 'task-detail' }, t.detail) : null,
      ),
      h('div', { class: 'task-controls' }, status, assignee, remove),
    );
  }

  function renderChips() {
    chips.replaceChildren(...FILTERS.map(([key, label, fn]) =>
      h('button', {
        class: `chip ${state.taskFilter === key ? 'active' : ''}`,
        type: 'button',
        onclick: () => { state.taskFilter = key; renderChips(); renderList(); },
      }, `${label} (${state.tasks.filter(fn).length})`)));
  }

  function renderList() {
    const fn = FILTERS.find(([key]) => key === state.taskFilter)?.[2] ?? (() => true);
    const tasks = state.tasks.filter(fn);
    list.replaceChildren(...(tasks.length ? tasks.map(taskRow) : [empty('ไม่มีงานในหมวดนี้')]));
  }

  async function refresh(force) {
    await Promise.all([loadSupervisors(), loadTasks(), loadSites(), summaryCard.refresh(force), reminderCard.refresh(force)]);
    if (!busy(form)) fillSupSelect();
    siteList.replaceChildren(...state.sites.map((s) => h('option', { value: s })));
    if (!force && busy(list)) return;
    renderChips();
    renderList();
  }

  return { tab: 'tasks', refresh };
}

// ---------------------------------------------------------------- งานตั้งเวลา (สรุปเช้า / เตือนใกล้ครบกำหนด)

function daysText(days) {
  if (days.length === 7) return 'ทุกวัน';
  if (days.join() === '1,2,3,4,5,6') return 'จันทร์–เสาร์';
  if (days.join() === '1,2,3,4,5') return 'จันทร์–ศุกร์';
  return days.map((d) => DAY_LABELS[d]).join(' ') || 'ไม่ได้เลือกวัน';
}

const dueWhenText = (n) => (n === 0 ? 'วันนี้' : n === 1 ? 'พรุ่งนี้' : `ในอีก ${n} วัน`);

/**
 * การ์ดตั้งค่างานที่ทำวันละครั้ง: สถานะ, ตั้งเวลา/วัน/เปิดปิด, ตัวอย่างรายคน, ปุ่มส่งตอนนี้
 * opts: endpoint, title, enabledLabel, note, extraFields, status(data), previewTitle(data),
 *       emptyText, previewItem(r) -> { summary, body }, confirmText(data), sentText(result), savedText
 */
function ScheduleCard(opts) {
  let data = null;
  const statusLine = h('div', { class: 'small muted' });
  const enabledInput = h('input', { type: 'checkbox', name: 'enabled' });
  const timeInput = h('input', { type: 'time', name: 'time', required: true });
  const dayInputs = DAY_LABELS.map((_, i) => h('input', { type: 'checkbox', name: 'days', value: String(i) }));
  const extraInputs = (opts.extraFields ?? []).map((f) => ({
    ...f,
    input: h('select', { name: f.name }, f.options.map(([value, label]) => h('option', { value: String(value) }, label))),
  }));
  const previewHeading = h('h3', { class: 'summary-sub' });
  const recipientsBox = h('div', { class: 'summary-recipients' });
  const sendBtn = h('button', { class: 'btn', type: 'button', onclick: sendNow }, '📨 ส่งตอนนี้');

  const form = h('form', {
    class: 'form-grid',
    oninput: () => { form.dataset.dirty = '1'; },
    onsubmit: save,
  },
    h('label', { class: 'check' }, enabledInput, opts.enabledLabel),
    h('div', { class: 'summary-row' },
      h('label', {}, 'เวลาส่ง (เวลาไทย)', timeInput),
      extraInputs.map((f) => h('label', { class: 'summary-extra' }, f.label, f.input)),
      h('fieldset', { class: 'days' },
        h('legend', {}, 'วันที่ส่ง'),
        dayInputs.map((input, i) => h('label', { class: 'check day' }, input, DAY_LABELS[i])),
      ),
    ),
    h('div', { class: 'form-actions' },
      h('span', { class: 'small muted' }, opts.note),
      h('button', { class: 'btn primary', type: 'submit' }, 'บันทึกการตั้งค่า'),
    ),
  );

  const el = h('section', { class: 'card' },
    h('div', { class: 'card-head', style: 'margin-bottom:0' },
      h('div', {}, h('h2', {}, opts.title), statusLine),
      sendBtn,
    ),
    h('details', { class: 'summary-details' },
      h('summary', {}, 'ตั้งค่า และดูตัวอย่างข้อความที่แต่ละคนจะได้รับ'),
      form,
      previewHeading,
      recipientsBox,
    ),
  );

  function render() {
    const { settings, recipients } = data;
    statusLine.textContent = opts.status(data).join(' · ');
    previewHeading.textContent = opts.previewTitle(data);
    sendBtn.disabled = !recipients.length;

    if (!form.dataset.dirty && !busy(form)) {
      enabledInput.checked = settings.enabled;
      timeInput.value = settings.time;
      dayInputs.forEach((input, i) => { input.checked = settings.days.includes(i); });
      extraInputs.forEach((f) => { f.input.value = String(settings[f.name]); });
    }

    if (opts.sharedText) {
      // ทุกคนได้ข้อความเดียวกัน: แสดงรายชื่อผู้รับ + ตัวอย่างข้อความเดียว
      recipientsBox.replaceChildren(
        recipients.length
          ? h('div', { class: 'small' }, h('strong', {}, 'ส่งถึง: '), recipients.map((r) => r.name).join(', '))
          : h('div', { class: 'composer-hint', style: 'border-radius:8px' }, opts.emptyText),
        h('pre', { class: 'summary-shared' }, opts.sharedText(data)),
      );
    } else if (!busy(recipientsBox)) {
      // จำว่าเปิดดูตัวอย่างของใครค้างไว้ จะได้ไม่ถูกพับทุกครั้งที่รีเฟรช
      const openIds = new Set([...recipientsBox.querySelectorAll('details[open]')].map((d) => d.dataset.id));
      recipientsBox.replaceChildren(...(recipients.length
        ? recipients.map((r) => {
          const item = opts.previewItem(r);
          return h('details', {
            class: 'summary-preview',
            'data-id': String(r.supervisor_id),
            open: openIds.has(String(r.supervisor_id)),
          }, h('summary', {}, item.summary), h('pre', {}, item.body));
        })
        : [empty(opts.emptyText)]));
    }
  }

  async function refresh(force) {
    if (!force && form.dataset.dirty) return;
    data = await api(opts.endpoint);
    render();
  }

  async function save(e) {
    e.preventDefault();
    const body = {
      enabled: enabledInput.checked,
      time: timeInput.value,
      days: dayInputs.filter((i) => i.checked).map((i) => Number(i.value)),
    };
    for (const f of extraInputs) body[f.name] = Number(f.input.value);
    try {
      data = await api(opts.endpoint, { method: 'PUT', body });
      delete form.dataset.dirty;
      render();
      toast(opts.savedText);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function sendNow() {
    if (!data?.recipients.length) return;
    if (!confirm(opts.confirmText(data))) return;
    sendBtn.disabled = true;
    try {
      const r = await api(`${opts.endpoint}/send`, { method: 'POST' });
      if (r.failed) toast(`ส่งสำเร็จ ${r.sent} คน ไม่สำเร็จ ${r.failed} คน (ดูสาเหตุได้ในแท็บข้อความ)`, 'warn');
      else toast(opts.sentText(r));
      await tick(true);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      sendBtn.disabled = false;
    }
  }

  return { el, refresh };
}

const MorningSummaryCard = () => ScheduleCard({
  endpoint: '/morning-summary',
  title: '🌅 สรุปงานส่งเข้า LINE ทุกเช้า',
  enabledLabel: 'เปิดส่งสรุปอัตโนมัติทุกเช้า',
  note: 'ส่งเฉพาะคนที่มีงานค้าง คนละ 1 ข้อความ (นับโควตา LINE OA)',
  status: (d) => [
    d.settings.enabled ? `ส่งเวลา ${d.settings.time} น. (${daysText(d.settings.days)})` : 'ปิดอยู่',
    `วันนี้มีผู้รับ ${d.recipients.length} คน`,
    d.last_sent_date ? `ส่งอัตโนมัติล่าสุด ${fmtDate(d.last_sent_date)}` : 'ยังไม่เคยส่งอัตโนมัติ',
  ],
  previewTitle: () => 'ตัวอย่างข้อความวันนี้',
  emptyText: 'วันนี้ยังไม่มีใครมีงานค้าง จึงไม่มีข้อความที่จะส่ง',
  previewItem: (r) => ({
    summary: [
      h('strong', {}, r.name),
      ` · งานค้าง ${r.task_count}`,
      r.overdue_count ? h('span', { class: 'pill danger', style: 'margin-left:6px' }, `เลยกำหนด ${r.overdue_count}`) : null,
    ],
    body: r.text,
  }),
  confirmText: (d) => `ส่งสรุปงานตอนนี้ให้ผู้คุมงาน ${d.recipients.length} คน?\n(ใช้โควตาข้อความ LINE ${d.recipients.length} ข้อความ)`,
  sentText: (r) => `ส่งสรุปงานให้ ${r.sent} คนแล้ว`,
  savedText: 'บันทึกการตั้งค่าสรุปงานทุกเช้าแล้ว',
});

const OfficeSummaryCard = () => ScheduleCard({
  endpoint: '/office-summary',
  title: '📊 สรุปภาพรวมส่งให้สำนักงานทาง LINE',
  enabledLabel: 'เปิดส่งสรุปภาพรวมอัตโนมัติ',
  note: 'ส่งให้คนที่ตั้งบทบาทเป็น "สำนักงาน" คนละ 1 ข้อความ · ถ้าตั้งเวลาก่อนเที่ยงจะสรุปของเมื่อวาน · พิมพ์ "สรุป" ใน LINE ดูได้ทุกเมื่อ (ไม่นับโควตา)',
  status: (d) => [
    d.settings.enabled ? `ส่งเวลา ${d.settings.time} น. (${daysText(d.settings.days)})` : 'ปิดอยู่',
    d.recipients.length ? `ผู้รับ ${d.recipients.length} คน` : 'ยังไม่มีผู้รับ',
    d.last_sent_date ? `ส่งอัตโนมัติล่าสุด ${fmtDate(d.last_sent_date)}` : 'ยังไม่เคยส่งอัตโนมัติ',
  ],
  previewTitle: (d) => `ตัวอย่างสรุป (${fmtDate(d.report_date)})`,
  emptyText: 'ยังไม่มีผู้รับ: ให้คนในสำนักงานเพิ่มเพื่อน LINE OA แล้วตั้งบทบาทเป็น "สำนักงาน" ในแท็บผู้คุมงาน',
  sharedText: (d) => d.text,
  confirmText: (d) => `ส่งสรุปภาพรวมตอนนี้ให้สำนักงาน ${d.recipients.length} คน?\n(ใช้โควตาข้อความ LINE ${d.recipients.length} ข้อความ)`,
  sentText: (r) => `ส่งสรุปภาพรวมให้ ${r.sent} คนแล้ว`,
  savedText: 'บันทึกการตั้งค่าสรุปภาพรวมแล้ว',
});

const ReminderCard = () => ScheduleCard({
  endpoint: '/reminders',
  title: '⏰ เตือนงานใกล้ครบกำหนด',
  enabledLabel: 'เปิดเตือนอัตโนมัติ',
  extraFields: [{
    name: 'days_before',
    label: 'เตือนล่วงหน้า',
    options: [[0, 'วันเดียวกับวันครบกำหนด'], [1, '1 วัน (เตือนวันก่อน)'], [2, '2 วัน'], [3, '3 วัน']],
  }],
  note: 'ส่งการ์ดงานพร้อมปุ่มอัปเดตสถานะ คนละ 1 ข้อความ และเตือนแต่ละงานครั้งเดียว (นับโควตา LINE OA)',
  status: (d) => {
    const taskCount = d.recipients.reduce((n, r) => n + r.tasks.length, 0);
    return [
      d.settings.enabled
        ? `เตือนเวลา ${d.settings.time} น. (${daysText(d.settings.days)}) สำหรับงานที่ครบกำหนด${dueWhenText(d.settings.days_before)}`
        : 'ปิดอยู่',
      `รอบนี้ ${taskCount} งาน (${d.recipients.length} คน)`,
      d.last_run_date ? `เตือนอัตโนมัติล่าสุด ${fmtDate(d.last_run_date)}` : 'ยังไม่เคยเตือนอัตโนมัติ',
    ];
  },
  previewTitle: (d) => `งานที่จะเตือนรอบนี้ (ครบกำหนด ${fmtDate(d.target_date)})`,
  emptyText: 'ไม่มีงานที่ต้องเตือนในรอบนี้ (หรือเตือนไปครบแล้ว)',
  previewItem: (r) => ({
    summary: [h('strong', {}, r.name), ` · ${r.tasks.length} งาน`],
    body: r.tasks
      .map((t) => `• #${t.id} ${t.title}${t.site ? ` — ${t.site}` : ''}${t.status === 'in_progress' ? ' (กำลังทำ)' : ''}`)
      .join('\n'),
  }),
  confirmText: (d) => {
    const taskCount = d.recipients.reduce((n, r) => n + r.tasks.length, 0);
    return `ส่งเตือนตอนนี้ให้ผู้คุมงาน ${d.recipients.length} คน (${taskCount} งาน)?\n(ใช้โควตาข้อความ LINE ${d.recipients.length} ข้อความ)`;
  },
  sentText: (r) => `ส่งเตือนให้ ${r.sent} คนแล้ว (${r.tasks} งาน)`,
  savedText: 'บันทึกการตั้งค่าการเตือนแล้ว',
});

// ---------------------------------------------------------------- ผู้คุมงาน

function SupervisorsTab() {
  const grid = h('div', { class: 'sup-grid' });
  const root = h('div', { class: 'page' },
    h('section', { class: 'card' },
      h('h2', {}, '👷 ผู้คุมงาน'),
      h('p', { class: 'muted small', style: 'margin:4px 0 0' },
        'ผู้คุมงานเพิ่มเพื่อน LINE Official Account ของบริษัท แล้วจะขึ้นที่นี่อัตโนมัติ ตรวจสอบแล้วกด "อนุมัติ" เพื่อเปิดให้ใช้งาน · คนในสำนักงานก็เพิ่มเพื่อนได้ แล้วตั้งบทบาทเป็น "สำนักงาน" เพื่อรับสรุปภาพรวมทุกวัน'),
    ),
    grid,
  );
  view.replaceChildren(root);

  async function save(sup, form, extra = {}) {
    const fd = new FormData(form);
    const body = { name: fd.get('name'), phone: fd.get('phone'), site: fd.get('site'), role: fd.get('role'), ...extra };
    try {
      const result = await api(`/supervisors/${sup.id}`, { method: 'PATCH', body });
      delete form.dataset.dirty;
      if (extra.status === 'active' && sup.status !== 'active') toastPush(result, `อนุมัติ ${result.supervisor.display_name} แล้ว`);
      else toast('บันทึกแล้ว');
      await tick(true);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function card(sup) {
    const roleSelect = h('select', { name: 'role' },
      h('option', { value: 'supervisor' }, 'ผู้คุมงาน'),
      h('option', { value: 'office' }, 'สำนักงาน'));
    roleSelect.value = sup.role ?? 'supervisor';
    const form = h('form', {
      class: `card sup-card status-${sup.status}`,
      oninput: () => { form.dataset.dirty = '1'; },
      onsubmit: (e) => { e.preventDefault(); save(sup, form); },
    },
      h('div', { class: 'sup-head' },
        avatar(sup, 'lg'),
        h('div', { style: 'flex:1;min-width:0' },
          h('div', { class: 'name' }, sup.display_name),
          h('div', { class: 'small muted' },
            `LINE: ${sup.line_name ?? '-'}`,
            sup.is_following ? '' : ' · ', sup.is_following ? null : h('span', { class: 'pill danger' }, 'บล็อกบอทแล้ว'),
          ),
        ),
        h('div', { class: 'pills' }, supPill(sup), sup.role === 'office' ? h('span', { class: 'pill office' }, 'สำนักงาน') : null),
      ),
      h('div', { class: 'form-row', style: 'grid-template-columns:1.3fr 1fr' },
        h('label', {}, 'ชื่อ-นามสกุล', h('input', { name: 'name', value: sup.name ?? '', maxlength: '100', placeholder: sup.line_name ?? '' })),
        h('label', {}, 'บทบาท', roleSelect),
      ),
      h('div', { class: 'form-row', style: 'grid-template-columns:1fr 1fr' },
        h('label', {}, 'เบอร์โทร', h('input', { name: 'phone', value: sup.phone ?? '', maxlength: '30', inputmode: 'tel' })),
        h('label', {}, 'หน้างานประจำ', h('input', { name: 'site', value: sup.site ?? '', maxlength: '200', list: 'sup-site-options' })),
      ),
      h('div', { class: 'sup-foot' },
        h('span', { class: 'small muted' }, `งานค้าง ${sup.open_tasks} · เพิ่มเมื่อ ${fmtDateTime(sup.created_at)}`),
        h('div', { class: 'row-actions', style: 'margin:0' },
          h('button', { class: 'btn sm', type: 'button', onclick: () => openChat(sup.id) }, '💬 แชท'),
          sup.status === 'active'
            ? h('button', { class: 'btn sm danger', type: 'button', onclick: () => confirm(`ปิดใช้งาน ${sup.display_name}?`) && save(sup, form, { status: 'inactive' }) }, 'ปิดใช้งาน')
            : null,
          sup.status === 'inactive'
            ? h('button', { class: 'btn sm', type: 'button', onclick: () => save(sup, form, { status: 'active' }) }, 'เปิดใช้งาน')
            : null,
          h('button', { class: 'btn sm', type: 'submit' }, 'บันทึก'),
          sup.status === 'pending'
            ? h('button', { class: 'btn sm primary', type: 'button', onclick: () => save(sup, form, { status: 'active' }) }, '✅ อนุมัติ')
            : null,
        ),
      ),
    );
    return form;
  }

  const ORDER = { pending: 0, active: 1, inactive: 2 };

  return {
    tab: 'supervisors',
    async refresh(force) {
      if (!force && (busy(grid) || grid.querySelector('[data-dirty]'))) return;
      await Promise.all([loadSupervisors(), loadSites()]);
      const sorted = [...state.supervisors].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.display_name.localeCompare(b.display_name, 'th'));
      grid.replaceChildren(
        ...(sorted.length
          ? sorted.map(card)
          : [h('div', { class: 'card empty' }, 'ยังไม่มีผู้คุมงาน — ส่งลิงก์หรือ QR ของ LINE OA ให้ผู้คุมงานเพิ่มเพื่อน')]),
        h('datalist', { id: 'sup-site-options' }, state.sites.map((s) => h('option', { value: s }))),
      );
    },
  };
}

// ---------------------------------------------------------------- router + polling

const TABS = { overview: OverviewTab, inbox: InboxTab, tasks: TasksTab, supervisors: SupervisorsTab };

function parseHash() {
  const [tab, id] = location.hash.replace(/^#\/?/, '').split('/');
  return { tab: TABS[tab] ? tab : 'overview', id: Number(id) || null };
}

async function route() {
  const { tab, id } = parseHash();
  document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  try {
    if (current?.tab === tab && current.onRoute) {
      await current.onRoute(id);
      return;
    }
    if (tab === 'inbox') state.supId = id;
    view.replaceChildren(h('div', { class: 'loading' }, 'กำลังโหลด…'));
    current = TABS[tab]();
    await loadSummary();
    await current.refresh(true);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function tick(force = false) {
  try {
    await loadSummary();
    await current?.refresh(force);
  } catch (err) {
    console.warn(err);
  }
}

window.addEventListener('hashchange', route);
document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
setInterval(() => { if (!document.hidden) tick(); }, POLL_MS);
route();
