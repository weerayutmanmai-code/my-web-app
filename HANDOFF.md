# HANDOFF — LINE chatbot สำหรับ "โปรแกรมรายงานผลการก่อสร้าง"

อัปเดตล่าสุด: 8 พ.ย. 2569 (2026-11-08) ราว 02:30 น.
ไฟล์นี้สรุปสถานะทั้งหมด เพื่อให้คนหรือเซสชัน Claude ถัดไปทำต่อได้ทันที ไม่ต้องย้อนอ่านแชท

---

## 1. เป้าหมายที่ถูกต้อง (อ่านก่อน)

ผู้ใช้ต้องการ **LINE chatbot ที่เป็นสื่อกลางให้ผู้ควบคุมงานกรอกข้อมูลลงเว็บแอปที่มีอยู่แล้ว**
คือ "โปรแกรมรายงานผลการก่อสร้าง" ที่ทำงานบน Google Apps Script:

```
https://script.google.com/macros/s/AKfycbygV0sD-NHv5x1WIRCVtH3kuRQMnn81dG8IC6-pv_IOICu1_idaoRufK_4psem8kLR68A/exec
```

เว็บแอปนี้สร้างโดย "บัญชี1" (บัญชี Claude อีกบัญชีของผู้ใช้ ซึ่งตอนนี้โควตารายสัปดาห์หมด)

### ⚠️ สิ่งที่ผิดพลาดไปก่อนหน้า
เซสชันนี้ **ตีความผิดตั้งแต่ต้น** และสร้างเว็บแอปจัดการงานใหม่ทั้งชุด (repo นี้ PR #1–#7) แทนที่จะต่อกับเว็บแอปที่มีอยู่
ส่วนที่ **ใช้ต่อได้** คือโครงข่าย LINE ↔ Railway (ข้อ 2) ส่วนระบบจัดการงาน/สรุป/เตือน/Excel ใน repo นี้ **ไม่ใช่สิ่งที่ผู้ใช้ต้องการ**
และยังไม่ได้ตัดออก รอผู้ใช้ตัดสินใจ

นอกจากนี้ ผู้ใช้เคยกดข้อความแนะนำ "ทดสอบแล้ว ได้รับแล้ว" โดยยังไม่ได้ทำจริง จึง **อย่าถือว่าฟีเจอร์ใดทดสอบแล้ว** นอกจากที่ระบุในข้อ 2.3
ให้ขอหลักฐาน (สกรีนช็อต / ลิงก์) ทุกครั้ง

---

## 2. โครงสร้างพื้นฐานที่ตั้งค่าไว้แล้ว (ยืนยันด้วยสกรีนช็อตจริง)

### 2.1 LINE
| รายการ | ค่า |
|---|---|
| บัญชี LINE OA | **ควบคุมงาน-อบต.** (ID `@259dfneu`) แพ็กเกจฟรี 300 ข้อความ push/เดือน |
| Provider (LINE Developers) | **อบต.คลองสะแก** |
| Messaging API | เปิดแล้ว |
| Channel secret | **ออกใหม่แล้ว** (ค่าเก่าเคยหลุดในสกรีนช็อตแชท ใช้ไม่ได้แล้ว) |
| Channel access token (long-lived) | ออกแล้ว |
| Webhook URL | `https://my-web-app-production-3582.up.railway.app/webhook` กด Verify ได้ **Success** และเปิด Use webhook แล้ว |
| ตั้งค่าการตอบกลับ (OA Manager) | แชท: เปิด / ข้อความทักทายเพื่อนใหม่: ปิด / Webhook: เปิด / วิธีตอบ: แชทแบบแมนนวล / เวลาตอบข้อความ: ปิด |
| ให้บอทเข้ากลุ่มได้ | **ยังไม่ได้เปิด** |

### 2.2 Railway
| รายการ | ค่า |
|---|---|
| บัญชี | Login ด้วย GitHub `weerayutmanmai-code` แพ็กเกจ **Trial (30 วันหรือเครดิต $5)** เริ่ม 7 พ.ย. 2569 → **หมดราว 7 ธ.ค. 2569** ต้องเลือกแพ็กเกจก่อน ไม่งั้นระบบหยุด |
| โปรเจกต์ | `steadfast-connection` (environment `production`) |
| Service | `my-web-app` deploy จาก GitHub `weerayutmanmai-code/my-web-app` branch `main` (auto-deploy เมื่อ merge) |
| โดเมน | `https://my-web-app-production-3582.up.railway.app` (`/healthz` ตอบ `{"ok":true}`) |
| Volume | `my-web-app-volume` mount ที่ `/data` ขนาด 500 MB, US East |
| Variables (ชื่อเท่านั้น) | `ADMIN_PASSWORD`, `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN` (`NODE_ENV=production`, `DATA_DIR=/data` มาจาก Dockerfile) |
| หน้าเว็บ | ล็อกอิน `admin` + ADMIN_PASSWORD (ผู้ใช้ยืนยันว่าเข้าได้ แถบ "โหมดทดลอง" หายแล้ว) |

**ห้ามขอหรือรับรหัสลับในแชท** ให้ผู้ใช้คัดลอก-วางลง Railway Variables เอง

### 2.3 ทดสอบกับ LINE จริงแล้ว (มีสกรีนช็อตยืนยัน)
- ส่งข้อความ `เมนู` → บอทตอบ "⏳ บัญชีของคุณกำลังรอสำนักงานอนุมัติ…" (LINE → ระบบ ใช้ได้)
- อนุมัติผู้ใช้ "วี" จากหน้าเว็บ → LINE ได้ "✅ สำนักงานอนุมัติบัญชีของคุณวีแล้วครับ" พร้อม quick reply (ระบบ → LINE push ใช้ได้)

### 2.4 ยังไม่เคยทดสอบกับ LINE จริง
การ์ดงาน Flex + ปุ่ม, รูป/ตำแหน่ง, รายงาน/แจ้งปัญหา, สรุปเช้า, เตือนใกล้ครบกำหนด, สรุปสำนักงาน, กลุ่ม LINE, Excel
(ผ่านเฉพาะเทสต์อัตโนมัติ 74 ข้อ และ webhook จำลอง/Playwright ในเครื่องพัฒนา)

---

## 3. สิ่งที่รู้เกี่ยวกับเว็บแอปเดิม (จากไฟล์ที่ผู้ใช้อัปโหลด)

แหล่งที่มา:
- ไฟล์ HTML หน้าเว็บ `โปรแกรมรายงานผลการก่อสร้าง` เวอร์ชัน **1.4.7-web** (~10,600 บรรทัด, 1.5 MB)
- เว็บเพจที่บันทึกจากหน้าแก้โค้ด Apps Script เวอร์ชัน **2.2-gas** (เห็นเฉพาะ ~100 บรรทัดแรกของไฟล์แรก จากทั้งหมด **2 ไฟล์ `.gs`**)
- สกรีนช็อตหน้าแก้โค้ด (เห็นฟังก์ชัน `addMultiCols`, `nameMap_`, ฟังก์ชันดีบัก `dbgRep`)

### 3.1 สถาปัตยกรรม
- `doGet()` ส่งหน้า loader → เรียก `crApp()` ซึ่งอ่าน **ไฟล์ .html ล่าสุดในโฟลเดอร์ Drive ของแอป** แล้ว `document.write`
- ข้อมูลโครงการ: **Google Sheets** (ค่าคงที่ `SHEET_NAME`, แบ่งข้อความยาวเป็นก้อน `CH = 40000` ตัวอักษร, มีแท็บข้อมูล/สรุป/ถังขยะ)
- รูปถ่าย: **Google Drive**
- ยังมีชีตที่อ่านเป็นตาราง เช่น **"บันทึกประจำวัน"** (คอลัมน์รวม คนงาน, วัสดุ, เครื่องจักร) และชีตตัวเลือก `ตัวเลือก_วัสดุ`, `ตัวเลือก_เครื่องจักร…`
- โฟลเดอร์รากจำไว้ใน Script Properties `ROOT_ID`

### 3.2 ฟังก์ชันฝั่งเซิร์ฟเวอร์ที่หน้าเว็บเรียกผ่าน `google.script.run`
| ฟังก์ชัน | พฤติกรรม (อนุมานจากโค้ดฝั่งหน้าเว็บ) |
|---|---|
| `crInfo()` | `{version, dataDir, sheetUrl, folderUrl}` |
| `crLoad()` | `{rev, rows}` |
| `crGetRev()` | `rev` |
| `crSave(changes, baseRev)` | `changes = {put:{key: string}, del:[key]}` → `{rev, others}` (others = มีคนอื่นบันทึกระหว่างนั้น) |
| `crRestoreData(rows)` | แทนข้อมูลทั้งหมด |
| `crSavePhoto(dataUrl, name?)` | → ชื่อไฟล์รูป |
| `crGetPhotos(names)`, `crDeletePhoto(name)`, `crListPhotos()` | จัดการรูป |
| `crAiStatus()`, `crAiChat(x)` | ผู้ช่วย AI ในหน้าเว็บ (มีฟีเจอร์แชทบันทึกประจำวันอยู่แล้วในหน้าเว็บ: `chatLogDay`) |
| `crApp()` | คืน HTML ของแอป |

### 3.3 รูปแบบข้อมูล
- แถวข้อมูลคีย์ `p:<projectId>` → ค่าคือ `JSON.stringify(project)` ทั้งโครงการ
- Project (ฟิลด์หลัก): `id, name, location, scope, contractNo, contractDate, startDate, endDate, contractPrice, contractor, employer, committee[], supervisors[{name, position}], budgets[], boq[], machines[], installments[], materialTests[], materialApprovals[], weeks[], months[], startReport, dueReports[], accelMemos[], lat, lng, ptypes[], createdAt`
- Week: `{id, no, docNo, from, to, reportDate, planPct, days:{}, progress:{}, photos:[], hasProblem, problem}`
- **บันทึกประจำวัน** = `project.weeks[i].days['YYYY-MM-DD']`
  ```
  { status: 'work' | 'none' | '',   // ทำงาน / ไม่ทำงาน / ยังไม่บันทึก
    detail, remark, foreman, workers,
    weather: {}, machines: {}, materials: [] }
  ```
- ยังไม่รู้: โครงสร้างภายในของ `weather`, `machines`, `materials`, รูปของแต่ละวันผูกที่ไหน, `crSave` เขียนชีตยังไงและล็อกอย่างไร

---

## 4. สิ่งที่ติดอยู่ (blockers)

1. **ต้องได้โค้ด `.gs` ทั้ง 2 ไฟล์เป็นข้อความ** ผู้ใช้พยายามคัดลอกบนมือถือแล้ว แต่ Command Palette ไม่มี "Select All"
   → แนะนำให้ทำบนคอมพิวเตอร์: script.google.com → โปรเจกต์ (ชื่อเริ่มด้วย "ระบบรายงานผลการก่อสร้าง…") → คลิกไฟล์ → Ctrl+A, Ctrl+C → วางในแชท ทีละไฟล์
   → ตรวจว่าเป็นโปรเจกต์ถูก: Deploy → จัดการการทำให้ใช้งานได้ ต้องเห็นรหัส `AKfycbygV0s…`
2. **ตั้งค่า deploy ปัจจุบัน** (Execute as / Who has access) ยังไม่รู้
3. ผู้คุมงาน 1 คนดูแลกี่โครงการ และต้องการกรอกฟิลด์ไหนผ่าน LINE (ข้อเสนอ: เริ่มที่บันทึกประจำวัน + รูป)
4. เครื่องพัฒนาของ Claude เข้า `script.google.com` และเว็บ LINE ไม่ได้ (proxy ปฏิเสธ) ต้องให้ผู้ใช้ส่งข้อมูลมาเอง

---

## 5. แผนที่เสนอ (ยังไม่ได้รับอนุมัติ ยังไม่ได้เริ่ม)

**หลักการ:** ไม่แก้พฤติกรรมเดิมของหน้าเว็บ ไม่แตะข้อมูลจริงจนกว่าจะทดสอบกับโครงการทดลอง

1. **ช่องรับข้อมูลของบอทใน Apps Script** ผ่าน `doPost` ตรวจรหัสลับจาก Script Properties `BOT_TOKEN` (ห้ามเขียนรหัสในโค้ด)
   - `{token, action:"listProjects"}` → `{ok, projects:[{id,name,startDate,endDate}]}`
   - `{token, action:"dailyUpsert", projectId, date, fields:{status, detail, remark, foreman, workers, weather, machines}}` → `{ok, rev}`
     ทำผ่าน `crLoad` / `crSave` เดิม (ใช้กลไก rev เดิม กันเขียนทับ) แก้เฉพาะฟิลด์ที่ส่งมา ถ้ายังไม่มีสัปดาห์ของวันนั้น ให้ตอบ error ให้ไปสร้างในเว็บก่อน (เวอร์ชันแรก)
   - `{token, action:"addPhoto", projectId, date, mime, base64}` → `{ok, photoName}` ผ่าน `crSavePhoto` (ต้องรู้ก่อนว่ารูปผูกกับวันที่ไหน)
2. **⚠️ เรื่องความปลอดภัยที่ต้องให้ผู้ใช้เลือก:** การเรียกจากเซิร์ฟเวอร์ต้องตั้ง deployment เป็น "Anyone" ถ้าทำกับ deployment เดิม **ข้อมูลโครงการอาจเปิดให้ทุกคนที่มีลิงก์เห็น** (หน้าเว็บเรียก `crLoad` ได้)
   ทางเลือกที่ปลอดภัยกว่า:
   - (ก) **โปรเจกต์ Apps Script ใหม่แยกต่างหาก** ที่มีแค่ `doPost` + token เรียกฟังก์ชันของโปรเจกต์เดิมแบบ Library หรืออ่าน/เขียนชีตเดียวกันตามรูปแบบเดิม
   - (ข) deployment ใหม่ของโปรเจกต์เดิม + ให้ `doGet` ไม่ส่งหน้าแอปให้ผู้ที่ไม่ใช่เจ้าของ
3. **ฝั่ง LINE (repo นี้):** เปลี่ยนบอทให้ถามทีละขั้น (เลือกโครงการ → วันที่ → ทำงาน/ไม่ทำงาน → รายละเอียด → หัวหน้าช่าง/จำนวนคนงาน → หมายเหตุ → รูป → ยืนยัน) แล้วเรียก `doPost`
   เก็บ URL และ BOT_TOKEN เป็น Railway Variables (เช่น `GAS_URL`, `GAS_BOT_TOKEN`)
4. ทดสอบกับโครงการทดลอง แล้วค่อยใช้จริง
5. หลังใช้ได้: ตัดฟีเจอร์ที่ไม่ต้องการออกจาก repo นี้ (ระบบงาน/สรุป/เตือน/Excel/กลุ่ม) ตามที่ผู้ใช้ตกลง

ทางเลือกอื่นที่เคยเสนอ: ย้ายบอททั้งหมดไปไว้ใน Apps Script (ไม่ใช้ Railway) แต่ Apps Script อ่าน header `x-line-signature` ไม่ได้ จึงตรวจลายเซ็น LINE ไม่ได้

---

## 6. สถานะ repo นี้ (`weerayutmanmai-code/my-web-app`)

- Node.js 22 + Express + SQLite (`node:sqlite`) + exceljs; ทดสอบด้วย `npm test` (74 เทสต์ผ่าน)
- `main` มี PR #1–#7 (merge แล้วทั้งหมด): บอท+เว็บจัดการงาน, Railway config, สรุปเช้า, เตือนใกล้ครบกำหนด, สรุปสำนักงาน, กลุ่ม LINE, Excel
- branch ทำงาน: `claude/continuation-check-o9nt8e`
- โครงสร้างโค้ดดูใน `README.md` หัวข้อ "โครงสร้างโค้ด"
- ไฟล์ที่ใช้ต่อได้ตรงๆ: `src/line.js` (เรียก LINE API + ตรวจลายเซ็น), `src/app.js` (webhook), โครง `src/bot.js`

---

## 7. ข้อควรระวัง
- ห้ามส่งหรือรับรหัสลับ (Channel secret/token, ADMIN_PASSWORD, BOT_TOKEN, API key) ในแชท ถ้าหลุด ให้ออกใหม่ทันที
- ขอหลักฐานจริงทุกขั้น (สกรีนช็อตแบบจับภาพหน้าจอจะชัดกว่าถ่ายจอ)
- ผู้ใช้ทำงานบนมือถือเป็นหลัก หน้า Railway/LINE Developers ใช้โหมด "เว็บไซต์เวอร์ชันคอมพิวเตอร์" ได้ดีกว่า
- อธิบายทีละขั้น ช้าๆ ภาษาง่าย ตามที่ผู้ใช้ขอ
- โควตา LINE ฟรี 300 push/เดือน (reply ไม่นับ)
- Railway Trial หมดราว 7 ธ.ค. 2569

---

## 8. ขั้นถัดไปเมื่อกลับมาทำต่อ
1. ผู้ใช้คัดลอกโค้ด `.gs` ทั้ง 2 ไฟล์ (บนคอมพิวเตอร์) มาวาง โดยแทนรหัสลับด้วย `xxx`
2. ผู้ใช้ส่งสกรีนช็อต Deploy → จัดการการทำให้ใช้งานได้
3. Claude อ่านโค้ด สรุปรูปแบบการเก็บข้อมูลกลับให้ผู้ใช้ตรวจ แล้วให้เลือกทางเลือกความปลอดภัย (ข้อ 5.2)
4. เขียน `doPost` + คู่มือวาง/deploy ทีละขั้น → ทดสอบกับโครงการทดลอง
5. แก้บอทใน repo นี้ให้เรียก Apps Script → PR → ผู้ใช้สั่ง merge
