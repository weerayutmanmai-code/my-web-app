# HANDOFF: LINE chatbot สำหรับระบบรายงานผลการก่อสร้าง
อัปเดต: 2569-11-09 17:06 (เวลาไทย) · บัญชี 2 · Claude Code (มือถือ)

ไฟล์นี้สรุปสถานะทั้งหมด เพื่อให้บัญชี 1 หรือเซสชัน Claude ถัดไปทำต่อได้ทันที ไม่ต้องย้อนอ่านแชท
ศูนย์ส่งต่องาน: ชีต "เลขา-02 ศูนย์ส่งต่องาน (บัญชี 2)" แท็บ `สถานะงาน` แถว "LINE chatbot สำหรับระบบรายงานผลการก่อสร้าง"

## วิธีให้บัญชี 1 รับช่วง (อ่านก่อน)
1. อ่านไฟล์นี้ทั้งไฟล์ (ข้อ 9 คือข้อมูลล่าสุดจากโค้ดจริง)
2. โค้ด Apps Script อ่านได้จาก Google Drive โดยตรง: ไฟล์ id `1qHsQ05WW_tZDZ3Zz1pZeW2qZRw_bJXgBRSFt5bEg9R7Hq2MJB0ZOAPyB`
   ส่งออกเป็น `application/vnd.google-apps.script+json` ได้ (ไม่ต้องให้ผู้ใช้คัดลอก)
3. ยังไม่มีการแก้โค้ด Apps Script หรือข้อมูลโครงการใดๆ ทั้งสิ้น
4. ขั้นแรกที่ต้องทำ: ให้ผู้ใช้เลือกทางเลือกความปลอดภัย (ข้อ 5.2 และข้อ 9.4) ก่อนเขียนโค้ด

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

1. ~~ต้องได้โค้ด `.gs`~~ **แก้แล้ว (9 พ.ย.)**: ดึงจาก Drive ได้ด้วยตัวเชื่อม Google Drive (ดูข้อ 9) ไม่ต้องให้ผู้ใช้คัดลอก
2. ~~ตั้งค่า deploy~~ **รู้แล้ว** จาก appsscript.json: `executeAs: USER_DEPLOYING`, `access: ANYONE` (ต้องล็อกอิน Google) ยังไม่ได้เทียบรหัส deployment `AKfycbygV0s…` ในหน้า Deploy
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
1. สรุปข้อ 9 ให้ผู้ใช้ฟังเป็นภาษาง่าย แล้วให้เลือกทางเลือกความปลอดภัย (ข้อ 9.4)
2. อ่านโค้ดฝั่งหน้าเว็บที่แปลงผล `crAiChat` → `project.weeks[].days[date]` (ค้น `chatLogDay` ในไฟล์ HTML `โปรแกรมรายงานผลการก่อสร้าง-24.html` ในโฟลเดอร์ระบบ) เพื่อให้บอทเขียนข้อมูลรูปแบบเดียวกับหน้าเว็บ
3. เขียนส่วนรับข้อมูลของบอท + คู่มือวาง/deploy ทีละขั้น → ทดสอบกับโครงการทดลอง
4. แก้บอทใน repo นี้ให้เรียก Apps Script → PR → ผู้ใช้สั่ง merge

---

## 9. สิ่งที่รู้จากโค้ด Apps Script จริง (ดึงจาก Drive 9 พ.ย. 2569)

โปรเจกต์ "ระบบรายงานผลการก่อสร้าง" (อยู่ในโฟลเดอร์ Z-รวมไฟล์) มี `appsscript.json` + ไฟล์ `สคริปต์.gs` 848 บรรทัด
(หน้าแก้โค้ดเคยแสดง 2 ไฟล์ แต่ไฟล์ที่ส่งออกได้มีไฟล์ .gs เดียว ยังไม่ได้ยืนยันว่าอีกไฟล์คืออะไร)

### 9.1 ค่าตั้งและที่เก็บ
- `VERSION = '2.2-gas'`, timezone Asia/Bangkok, V8
- webapp: `executeAs: USER_DEPLOYING`, `access: ANYONE` → **ใครก็ได้ที่ล็อกอิน Google และมีลิงก์ เปิดแอปและอ่าน/แก้ข้อมูลทุกโครงการได้** (ข้อสังเกตด้านความปลอดภัยที่ควรแจ้งผู้ใช้ ไม่ได้แก้)
- ชีต `ฐานข้อมูลรายงานผลการก่อสร้าง` (id ใน Script Properties `SHEET_ID`) แท็บ:
  - `ข้อมูลระบบ (ห้ามแก้ไข)` คอลัมน์ `key | rev | แก้ไขล่าสุด | จำนวนส่วน | เครื่องที่แก้ | ข้อมูล…` ข้อความแบ่งก้อนละ 40,000 ตัวอักษร ขึ้นต้นด้วย `~`
  - `รายชื่อโครงการ` (สรุปอัตโนมัติจากแถว `p:`)
  - `ถังขยะ (ข้อมูลที่ถูกลบหรือเขียนทับ)`
- รูป: โฟลเดอร์ `รูปถ่าย` (Script Properties `PHOTO_ID`), สำรอง: `ไฟล์สำรองข้อมูล`
- Script Properties ที่ใช้: `ROOT_ID, SHEET_ID, PHOTO_ID, BACKUP_ID, REV, GEMINI_API_KEY, GEMINI_MODEL, AI_*` (ไม่มีรหัสลับในโค้ด)

### 9.2 ฟังก์ชันที่บอทใช้ต่อได้ (ฝั่งเซิร์ฟเวอร์จริง)
- `crLoad()` → `{rev, rows}` ภายใต้ `LockService` script lock
- `crSave({put, del, cid, seen}, base)` → `{rev, others}` ภายใต้ lock: ถ้าแถวถูกเครื่องอื่นแก้หลัง `seen` จะเก็บฉบับเดิมลงถังขยะก่อนเขียนทับ (ไม่ได้ปฏิเสธ) → บอทควรอ่าน-แก้-เขียนภายใน lock เดียว หรือส่ง `cid` เฉพาะ เช่น `line-bot` และ `seen` = rev ที่เพิ่งอ่าน
- `crSavePhoto(dataUrl, name?)` → ชื่อไฟล์ใน `รูปถ่าย`
- `crAiChat({v:2, text, hist, ctx, flow})` → `{data, model, left}` ใช้ Gemini แปลงข้อความพูดคุยเป็นข้อมูล (จำกัด `AI_CHAT_DAILY_MAX` 400/วัน, `AI_CHAT_RPM_MAX` 8/นาที) `data.day` มีรูปแบบ:
  ```
  { status: 'work'|'none'|null, stopCause, weather: {clear, rain: 'light'|'mid'|'heavy'|'unknown', time},
    foreman: number, workers: number, machines: [{name, n}], detail: [string], materials: [{name, qty, unit}],
    order, stopOrder: bool, remark, visitIn: 'HH:MM', visitOut: 'HH:MM' }
  ```
  พร้อม `say` (ข้อความตอบผู้ใช้), `ask` (ถามต่อเรื่องไหน), `ready`, `quick` (ปุ่มลัด ≤4), `unclear`
  → **บอท LINE ใช้ผู้ช่วย AI ตัวเดียวกับหน้าเว็บได้** ผู้คุมงานพิมพ์เล่าเป็นภาษาพูด บอทถามต่อจนครบ แล้วสรุปให้ยืนยัน
- การแปลง `data.day` ไปเก็บใน `project.weeks[].days[date]` ทำ **ฝั่งหน้าเว็บ** (ยังไม่ได้อ่าน) ต้องทำซ้ำในฝั่งเซิร์ฟเวอร์ให้ตรงกัน

### 9.3 ทำไมต่อจากเซิร์ฟเวอร์ตรงๆ ไม่ได้
deployment ปัจจุบันต้องล็อกอิน Google เซิร์ฟเวอร์บอทบน Railway จึงเรียก `doGet/doPost` ของ deployment นี้ไม่ได้

### 9.4 ทางเลือกให้ผู้ใช้ตัดสิน
- (ก) **แนะนำ:** โปรเจกต์ Apps Script ใหม่ "ช่องรับข้อมูลบอท" deploy แบบ `ANYONE_ANONYMOUS` + ตรวจ `BOT_TOKEN` มีแค่ `doPost` เรียกโปรเจกต์เดิมเป็น Library (หรือคัดลอกเฉพาะฟังก์ชันอ่าน/เขียนชีต) ไม่แตะ deployment เดิม
- (ข) เพิ่ม `doPost` ในโปรเจกต์เดิม + deployment ใหม่แบบ `ANYONE_ANONYMOUS` และให้ `doGet` ของ deployment นั้นไม่ส่งหน้าแอป (ซับซ้อนกว่า เสี่ยงกว่า)
- ทั้งสองทาง เซิร์ฟเวอร์ Railway เก็บ `GAS_URL`, `GAS_BOT_TOKEN` เป็น Variables
