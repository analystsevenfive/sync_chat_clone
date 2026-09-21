# 🚀 คู่มือการเชื่อมต่อ Chatcone (portal.chatcone.com) เข้าสู่ Google Sheets ด้วย Webhook

ระบบนี้ช่วยให้คุณสามารถซิงค์ **ประวัติข้อความแชท (Chat Messages & Conversation Logs)** จากทุกช่องทาง (LINE OA, Facebook Messenger, Instagram, Webchat) บน Chatcone เข้าสู่ Google Sheets แบบ **Real-time อัตโนมัติ 24 ชั่วโมง** โดยไม่ต้องเปิดคอมพิวเตอร์ทิ้งไว้

---

## 📁 ไฟล์ทั้งหมดในโปรเจกต์

| ไฟล์ | รายละเอียด |
| :--- | :--- |
| **[ChatconeSync.gs](file:///c:/Users/0125024/Documents/sync-chat-clone/ChatconeSync.gs)** | โค้ด Google Apps Script สำหรับคัดลอกไปวางใน Google Sheets |
| **[test-webhook.html](file:///c:/Users/0125024/Documents/sync-chat-clone/test-webhook.html)** | หน้าเว็บจำลองทดสอบการส่ง Webhook เข้า Google Sheets |
| **[test-webhook.js](file:///c:/Users/0125024/Documents/sync-chat-clone/test-webhook.js)** | สคริปต์ Node.js สำหรับยิงทดสอบ Webhook ผ่าน Terminal |

---

## 🛠️ ขั้นตอนที่ 1: ติดตั้ง Google Apps Script บน Google Sheets

1. เข้าไปที่ [Google Sheets](https://sheets.new) และสร้าง Spreadsheet ใหม่ (ตั้งชื่อเช่น `Chatcone_Sync_DB`)
2. ไปที่เมนูด้านบน คลิก **ส่วนขยาย (Extensions)** > **Apps Script**
3. ลบโค้ดเริ่มต้นในหน้าต่าง `Code.gs` ออกทั้งหมด
4. เปิดไฟล์ **[ChatconeSync.gs](file:///c:/Users/0125024/Documents/sync-chat-clone/ChatconeSync.gs)** ในโปรเจกต์นี้ คัดลอกโค้ดทั้งหมดแล้วนำไปวางใน Apps Script
5. กดปุ่ม 💾 **บันทึกโครงการ (Save)** (ไอคอนแผ่นดิสก์)

---

## 🌐 ขั้นตอนที่ 2: เผยแพร่ Web App (Deploy) เพื่อรับ Webhook URL

1. ที่มุมขวาบนของ Google Apps Script คลิกปุ่มสีน้ำเงิน **"การทำให้ใช้งานได้" (Deploy)** > เลือก **"การทำให้ใช้งานได้รายการใหม่" (New deployment)**
2. คลิกไอคอนรูปฟันเฟือง ⚙️ ข้าง "เลือกประเภท" (Select type) > เลือก **เว็บแอป (Web app)**
3. กรอกการตั้งค่าดังนี้:
   - **คำอธิบาย (Description):** `Chatcone Webhook Sync`
   - **ดำเนินการในฐานะ (Execute as):** `ตัวฉัน (Me - your-email@gmail.com)`
   - **ใครมีสิทธิ์เข้าถึง (Who has access):** `ทุกคน (Anyone)`  *(⚠️ **สำคัญมาก**: ต้องเลือก Anyone เพื่อให้ระบบ Chatcone ส่งข้อมูลเข้ามาได้)*
4. คลิก **"ทำให้ใช้งานได้" (Deploy)**
5. หากมีหน้าต่างขออนุญาต (Authorization required):
   - คลิก **"ตรวจสอบสิทธิ์การเข้าถึง" (Review permissions)**
   - เลือกบัญชี Google ของคุณ
   - หากเจอหน้าต่าง "Google ยังไม่ได้ยืนยันแอปนี้" ให้คลิก **ขั้นสูง (Advanced)** > คลิก **"ไปที่ Untitled project (ไม่ปลอดภัย)"**
   - คลิก **"อนุญาต" (Allow)**
6. **คัดลอก URL เว็บแอป (Web app URL)** ที่ได้รับ (รูปแบบจะขึ้นต้นด้วย `https://script.google.com/macros/s/AKfycb.../exec`)

---

## 🔗 ขั้นตอนที่ 3: นำ Webhook URL ไปใส่ใน Chatcone (portal.chatcone.com)

1. เข้าสู่ระบบ [portal.chatcone.com](https://portal.chatcone.com/)
2. ไปที่เมนู **ตั้งค่า (Settings)** หรือ **การเชื่อมต่อ / Integrations / Webhook**
3. เพิ่ม Webhook Endpoint ใหม่:
   - **Webhook URL:** วาง URL เว็บแอปที่คัดลอกมาจากขั้นตอนที่ 2
   - **Events / กิจกรรมที่ต้องการส่ง:** ติ๊กเลือก `Message Created` / `New Message` / `Incoming Message` / `Outgoing Message`
4. กด **บันทึก (Save)** หรือ **เปิดใช้งาน (Enable)**

---

## 🧪 ขั้นตอนที่ 4: ทดสอบการทำงาน (Testing)

### วิธีที่ 1: ทดสอบผ่านหน้าเว็บจำลอง (แนะนำ สะดวกที่สุด)
1. ดับเบิ้ลคลิกเปิดไฟล์ **`test-webhook.html`** บนเบราว์เซอร์ (Chrome / Edge)
2. วาง **Web app URL** ของคุณลงในช่องด้านบน
3. เลือกปุ่มตัวอย่าง (เช่น LINE, Facebook, หรือ Admin ตอบ)
4. กดปุ่ม **"🚀 ส่งข้อมูลเข้า Google Sheet (Send Webhook)"**
5. เปิดหน้า Google Sheets ดู จะพบว่ามีชีตชื่อ **`Chat_Logs`** ถูกสร้างขึ้นพร้อมข้อมูลจัดรูปแบบสวยงามทันที!

### วิธีที่ 2: ทดสอบผ่าน Apps Script โดยตรง
1. ในหน้า Apps Script ให้เลือกฟังก์ชัน **`testMockChatconeWebhook`** ที่ดรอปดาวน์ด้านบน
2. กดปุ่ม **"เรียกใช้" (Run)**
3. ข้อมูลตัวอย่างจะถูกบันทึกลงชีตทันที

---

## 📊 โครงสร้างคอลัมน์ใน Google Sheets

เมื่อมีข้อความเข้ามา ระบบจะจัดเก็บข้อมูลลงตารางดังนี้:

| Col | คอลัมน์ | คำอธิบาย |
|:---:|:---|:---|
| **A** | **Timestamp (วัน-เวลา)** | เวลาที่ส่งข้อความ (เวลาประเทศไทย `YYYY-MM-DD HH:mm:ss`) |
| **B** | **Channel (ช่องทาง)** | ช่องทาง เช่น `LINE OA`, `Facebook Messenger`, `Instagram`, `Webchat` |
| **C** | **Sender Type (ประเภทผู้ส่ง)** | `Customer` (ลูกค้า) หรือ `Agent` (แอดมิน) หรือ `Bot` |
| **D** | **Sender Name (ชื่อผู้ส่ง)** | ชื่อโปรไฟล์ลูกค้า หรือชื่อแอดมินที่ตอบ |
| **E** | **Customer ID (รหัสลูกค้า)** | รหัส UID ของลูกค้าในระบบ |
| **F** | **Message Type (ประเภทข้อความ)** | `text`, `image`, `sticker`, `file`, `audio`, `video` |
| **G** | **Message Content (เนื้อหาข้อความ)** | ข้อความที่ส่ง (สะอาดตา ไม่มีวงเล็บปน) |
| **H** | **Response Time (วินาที)** | ตัวเลขวินาทีที่แอดมินใช้ตอบ (เช่น `209`, `295`) สำหรับคำนวณสูตรหาค่าเฉลี่ย SLA |
| **I** | **Response Time (อ่านง่าย)** | รูปแบบเวลาที่อ่านง่าย เช่น `3 นาที 29 วินาที` |
| **J** | **Media URL (ลิงก์ไฟล์/รูป)** | URL ของรูปภาพ สลิป หรือไฟล์แนบ |
| **K** | **Conversation ID** | รหัสห้องสนทนา |
| **L** | **Message ID** | รหัสข้อความ (ใช้เช็คการส่งซ้ำ) |
| **M** | **Raw JSON Data** | ข้อมูลดิบทั้งหมดในรูปแบบ JSON สำหรับใช้อ้างอิงย้อนหลัง |

---

## 💡 คำแนะนำเพิ่มเติม & Troubleshooting

- **หากข้อมูลไม่เข้า:** ตรวจสอบตอน Deploy ว่าในช่อง **"ใครมีสิทธิ์เข้าถึง (Who has access)"** ได้เลือกเป็น **"ทุกคน (Anyone)"** หรือไม่ หากไม่ได้เลือก ให้กด *Deploy > Manage deployments > Edit > เลือก Anyone > Deploy ใหม่อีกครั้ง*
- **การปรับแต่งเพิ่มเติม:** คุณสามารถเปลี่ยนชื่อ Sheet จาก `"Chat_Logs"` เป็นชื่ออื่นได้ที่บรรทัด `const SHEET_NAME = "ชื่อชีต";` ในไฟล์ `ChatconeSync.gs`
- **ระบบ Concurrency Lock:** สคริปต์มีการใส่ `LockService` เพื่อรองรับกรณีที่มีลูกค้าทักเข้ามาพร้อมกันหลายคนโดยที่แถวข้อมูลจะไม่ชนหรือทับซ้อนกัน
