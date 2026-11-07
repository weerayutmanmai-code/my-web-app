export const TZ = 'Asia/Bangkok';

/** วันที่ปัจจุบันตามเวลาไทย ในรูปแบบ YYYY-MM-DD */
export function todayInBangkok(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function isValidDateString(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** "2026-11-15" -> "15 พ.ย. 69" */
export function formatThaiDate(value) {
  if (!isValidDateString(value)) return value ?? '';
  return new Date(`${value}T00:00:00+07:00`).toLocaleDateString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
    timeZone: TZ,
  });
}

export function isOverdue(task, today = todayInBangkok()) {
  return Boolean(task?.due_date) && task.status !== 'done' && task.due_date < today;
}
