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

const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** วันที่ เวลา และวันในสัปดาห์ตามเวลาไทย: { date: 'YYYY-MM-DD', time: 'HH:MM', weekday: 0-6 (0 = อาทิตย์) } */
export function bangkokParts(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).map((p) => [p.type, p.value]),
  );
  return { date: todayInBangkok(date), time: `${parts.hour}:${parts.minute}`, weekday: WEEKDAY[parts.weekday] };
}

/** "2026-11-07" -> "วันเสาร์ที่ 7 พ.ย. 69" */
export function formatThaiLongDate(value) {
  if (!isValidDateString(value)) return value ?? '';
  return new Date(`${value}T00:00:00+07:00`).toLocaleDateString('th-TH', {
    weekday: 'long', day: 'numeric', month: 'short', year: '2-digit', timeZone: TZ,
  });
}

/** "2026-11-07" + 1 -> "2026-11-08" */
export function addDays(value, days) {
  const d = new Date(`${value}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ช่วงเวลาของวันหนึ่งตามเวลาไทย เป็น ISO (UTC) สำหรับเทียบกับ created_at/done_at ในฐานข้อมูล */
export function bangkokDayRange(value) {
  return {
    start: new Date(`${value}T00:00:00+07:00`).toISOString(),
    end: new Date(`${addDays(value, 1)}T00:00:00+07:00`).toISOString(),
  };
}

export function isOverdue(task, today = todayInBangkok()) {
  return Boolean(task?.due_date) && task.status !== 'done' && task.due_date < today;
}
