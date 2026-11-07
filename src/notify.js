// ส่งข้อความหาผู้คุมงานทาง LINE (push) แล้วบันทึกลงแชท
// บันทึกเสมอแม้ส่งไม่สำเร็จ พร้อมเหตุผล เพื่อให้สำนักงานเห็นในหน้าเว็บ

export async function pushToSupervisor({ db, line }, sup, messages, log) {
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

/** ส่งข้อความเข้ากลุ่ม LINE แล้วบันทึกลงแชทกลุ่ม (นับโควตาตามจำนวนสมาชิกในกลุ่ม) */
export async function pushToGroup({ db, line }, group, messages, log) {
  let error = null;
  if (group.status !== 'active') error = 'กลุ่มนี้ยังไม่เปิดใช้งาน';
  else if (!group.is_member) error = 'บอทไม่ได้อยู่ในกลุ่มนี้แล้ว';
  else if (line.dryRun) error = 'โหมดทดลอง: ยังไม่ได้ตั้งค่า LINE จึงไม่ได้ส่งจริง';
  else {
    try {
      await line.push(group.line_group_id, messages);
    } catch (err) {
      error = `ส่ง LINE ไม่สำเร็จ (${err.message})`;
    }
  }
  db.addMessage({ group_id: group.id, direction: 'out', ...log, error });
  return { pushed: !error, push_error: error };
}
