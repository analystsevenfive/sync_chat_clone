/**
 * =========================================================================
 * Chatcone (portal.chatcone.com) to Google Sheets Webhook Sync Script
 * =========================================================================
 * สคริปต์นี้ใช้สำหรับรับ Webhook จาก Chatcone และบันทึกประวัติแชทลง Google Sheets อัตโนมัติ
 * พร้อมระบบ OCR สกัดเลขที่ใบเสนอราคา (Quotation No.) และยอดรวม (Grand Total) จากไฟล์ PDF
 * 
 * วิธีติดตั้ง:
 * 1. เปิด Google Sheet ใหม่ หรือ Sheet ที่ต้องการใช้งาน
 * 2. ไปที่เมนู "ส่วนขยาย" (Extensions) > "Apps Script"
 * 3. ลบโค้ดเดิมทั้งหมดออก แล้วนำโค้ดในไฟล์นี้ไปวางแทนที่
 * 4. กดปุ่ม "การทำให้ใช้งานได้" (Deploy) > "การทำให้ใช้งานได้รายการใหม่" (New deployment)
 * 5. เลือกประเภท "เว็บแอป" (Web app)
 *    - คำอธิบาย: Chatcone Sync
 *    - ดำเนินการในฐานะ: ตัวฉัน (Me)
 *    - ใครมีสิทธิ์เข้าถึง: ทุกคน (Anyone)  <--- สำคัญมาก!
 * 6. กด "ทำให้ใช้งานได้" (Deploy) และคัดลอก "URL เว็บแอป" (Web app URL)
 * 7. นำ URL ไปใส่ในส่วน Webhook ของ Chatcone (portal.chatcone.com)
 * =========================================================================
 */

// กำหนดชื่อชีตที่ต้องการบันทึกข้อมูล (หากไม่มีระบบจะสร้างให้อัตโนมัติ)
const SHEET_NAME = "Chat_Logs";
const LOG_SHEET_NAME = "Sync_Logs";

// กำหนด Timezone สำหรับเวลาในประเทศไทย
const TIMEZONE = "Asia/Bangkok";
const DATE_FORMAT = "yyyy-MM-dd HH:mm:ss";

// กรองเฉพาะข้อความ 3 วันล่าสุด (ครอบคลุมทั้ง SevenfiveOfficial และ Sevenfive Distributor)
const FILTER_LAST_DAYS = 3;

// =========================================================================
// 🏢 การตั้งค่าและตรวจจับบัญชีอัตโนมัติ (Multi-Account Auto-Detection)
// =========================================================================
const KNOWN_ACCOUNTS = {
  // SevenfiveOfficial (Slug: x0Wteloe)
  '68819f44dd184b85876ac383': 'SevenfiveOfficial', // company_id
  '6881b04f2d07422b089ec4c8': 'SevenfiveOfficial', // LINE OA channel_id
  '68819f44dd184bb7f86ac384': 'SevenfiveOfficial', // FB Messenger channel_id
  '68844b588be8b73f96d987f3': 'SevenfiveOfficial', // Webchat channel_id
  'x0wteloe': 'SevenfiveOfficial',                  // slug

  // Sevenfive Distributor (Slug: G6zVti0a)
  '68819f3edd184b81dc6ac35e': 'Sevenfive Distributor', // company_id
  '6881c67ddd184b54a06b025c': 'Sevenfive Distributor', // FB Messenger channel_id
  '68819f3edd184bf5276ac35f': 'Sevenfive Distributor', // LINE OA channel_id
  'g6zvti0a': 'Sevenfive Distributor',                 // slug

  // Sevenfive Distributor Conversation IDs & Customer IDs
  '6ab236169c044f50b2d4f07d': 'Sevenfive Distributor', // Vatsana Ngaovongsa conversation_id
  '68e354479c044f50b2ff1f84': 'Sevenfive Distributor', // Yim Pornpitra conversation_id
  '6ab1c3d49c044f50b2f735f9': 'Sevenfive Distributor', // MaPrang Sawasdee conversation_id
  '6aaa7e429c044f50b245f8ab': 'Sevenfive Distributor', // Chefkareem Bunchom conversation_id
  '6aaa52929c044f50b20c7040': 'Sevenfive Distributor', // Henglian Foodmachinery conversation_id
  '6ab3e6dc9c044f50b2dac441': 'Sevenfive Distributor', // Wirawan Watcharotone conversation_id
  '28411662208496281': 'Sevenfive Distributor',         // Vatsana social_id
  '8467799049993319': 'Sevenfive Distributor',          // Yim social_id
  '28363069283392839': 'Sevenfive Distributor',         // MaPrang social_id
  '27863191193295626': 'Sevenfive Distributor',
  '28976110988648055': 'Sevenfive Distributor'
};

// รายชื่อลูกค้าเฉพาะของ Sevenfive Distributor
const DISTRIBUTOR_KNOWN_NAMES = [
  'vatsana',
  'ngaovongsa',
  'yim pornpitra',
  'maprang',
  'sawasdee',
  'chefkareem',
  'henglian',
  'wirawan'
];

/**
 * 🏢 ระบบตรวจจับชื่อบัญชีอัตโนมัติ (Auto-Detect Account)
 * ตรวจสอบตามลำดับ:
 * 1. URL Query Parameter (?account=...)
 * 2. ฟิลด์ account หรือ account_name หรือ company_name ที่ระบุมา
 * 3. Company ID, Channel ID, Conversation ID, Customer ID จากตาราง KNOWN_ACCOUNTS
 * 4. ตรวจจากชื่อลูกค้า/ผู้ส่งที่ทราบว่าเป็นของ SevenfiveOfficial
 * 5. ตรวจจาก Slug หรือ Referer URL
 * 6. ค่าเดิม (Fallback)
 */
function resolveAccountName(item, payload, e, fallbackValue) {
  // 1. ถ้ามี URL query parameter เช่น ?account=SevenfiveOfficial
  if (e && e.parameter && e.parameter.account) {
    const acc = String(e.parameter.account).trim();
    if (/official/i.test(acc)) return "SevenfiveOfficial";
    if (/distributor/i.test(acc)) return "Sevenfive Distributor";
    return acc;
  }

  // 2. ถ้ามีชื่อบัญชีระบุมาตรงๆ ใน item หรือ payload
  const explicit = (item && (item.account || item.account_name || item.company_name)) ||
                   (payload && (payload.account || payload.account_name || payload.company_name));
  if (explicit && typeof explicit === "string") {
    const trimmed = explicit.trim();
    if (/official/i.test(trimmed)) return "SevenfiveOfficial";
    if (/distributor/i.test(trimmed)) return "Sevenfive Distributor";
    if (trimmed !== "Chatcone") return trimmed;
  }

  // 3. รวม key ที่อาจเป็น ID จาก item และ payload
  const candidateIds = [];

  function collectIds(obj) {
    if (!obj || typeof obj !== "object") return;
    if (obj.company_id) candidateIds.push(String(obj.company_id).toLowerCase());
    if (obj.companyId) candidateIds.push(String(obj.companyId).toLowerCase());
    if (typeof obj.company === "string") candidateIds.push(obj.company.toLowerCase());
    if (obj.channel_id) candidateIds.push(String(obj.channel_id).toLowerCase());
    if (obj.channelId) candidateIds.push(String(obj.channelId).toLowerCase());
    if (obj.slug) candidateIds.push(String(obj.slug).toLowerCase());
    if (obj.company_slug) candidateIds.push(String(obj.company_slug).toLowerCase());
    if (obj.conversation_id) candidateIds.push(String(obj.conversation_id).toLowerCase());
    if (obj.room_id) candidateIds.push(String(obj.room_id).toLowerCase());
    if (obj.customer_id) candidateIds.push(String(obj.customer_id).toLowerCase());
    if (obj.user_id) candidateIds.push(String(obj.user_id).toLowerCase());
    if (obj.social_id) candidateIds.push(String(obj.social_id).toLowerCase());
    if (obj.channel && typeof obj.channel === "object") {
      if (obj.channel.id) candidateIds.push(String(obj.channel.id).toLowerCase());
      if (obj.channel._id) candidateIds.push(String(obj.channel._id).toLowerCase());
      if (obj.channel.channel_id) candidateIds.push(String(obj.channel.channel_id).toLowerCase());
    }
    if (obj.follower && typeof obj.follower === "object") {
      if (obj.follower._id) candidateIds.push(String(obj.follower._id).toLowerCase());
      if (obj.follower.social_id) candidateIds.push(String(obj.follower.social_id).toLowerCase());
      if (obj.follower.channel_id) candidateIds.push(String(obj.follower.channel_id).toLowerCase());
    }
    if (obj.chat && typeof obj.chat === "object") {
      if (obj.chat.company_id) candidateIds.push(String(obj.chat.company_id).toLowerCase());
      if (obj.chat.channel_id) candidateIds.push(String(obj.chat.channel_id).toLowerCase());
    }
  }

  collectIds(item);
  collectIds(payload);

  for (let k = 0; k < candidateIds.length; k++) {
    const id = candidateIds[k];
    if (KNOWN_ACCOUNTS[id]) {
      return KNOWN_ACCOUNTS[id];
    }
  }

  // 4. ตรวจจากชื่อลูกค้าหรือผู้ส่ง
  const nameToCheck = String(
    (item && (item.sender_name || item.customer_name || item.name)) ||
    (payload && (payload.sender_name || payload.customer_name || payload.name)) ||
    ""
  ).toLowerCase().trim();

  if (nameToCheck) {
    for (let n = 0; n < DISTRIBUTOR_KNOWN_NAMES.length; n++) {
      if (nameToCheck.includes(DISTRIBUTOR_KNOWN_NAMES[n])) {
        return "Sevenfive Distributor";
      }
    }
  }

  // 5. ตรวจจาก URL หรือ Referer ใน Payload
  const referer = String(
    (item && (item.referer || item.origin)) ||
    (payload && (payload.referer || payload.origin)) ||
    ""
  ).toLowerCase();

  if (referer.includes("g6zvti0a")) return "Sevenfive Distributor";
  if (referer.includes("x0wteloe")) return "SevenfiveOfficial";

  // 6. หากส่ง fallbackValue มา (และไม่ใช่ค่าว่างและไม่ใช่ Chatcone) ให้ใช้ค่านั้น
  if (fallbackValue && typeof fallbackValue === "string" && fallbackValue.trim() && fallbackValue !== "Chatcone") {
    return fallbackValue.trim();
  }

  return "SevenfiveOfficial";
}

function ensureAccountColumn(sheet) {
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 1 || lastColumn < 3) return false;

  const headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  if (/^Account\b/i.test(String(headers[1] || ""))) return false;
  if (!/^Channel\b/i.test(String(headers[1] || "")) ||
      !/^Sender Type\b/i.test(String(headers[2] || ""))) return false;

  const rawIndex = headers.findIndex(header => /Raw JSON/i.test(String(header)));
  const messageIdIndex = headers.findIndex(header => /Message ID/i.test(String(header)));
  const senderNameIndex = headers.findIndex(header => /Sender Name/i.test(String(header)));
  const channelIndex = headers.findIndex(header => /^Channel\b/i.test(String(header)));
  const oldRows = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues()
    : [];

  sheet.insertColumnBefore(2);
  initializeSheet(SpreadsheetApp.getActiveSpreadsheet());

  if (oldRows.length > 0) {
    const accounts = oldRows.map(row => {
      if (!row.some(value => value !== "" && value !== null)) return [""];

      const rawJson = rawIndex >= 0 ? String(row[rawIndex] || "") : "";
      const messageId = messageIdIndex >= 0 ? String(row[messageIdIndex] || "") : "";
      let payload = null;
      let item = null;
      if (rawJson) {
        try {
          payload = JSON.parse(rawJson);
          const events = Array.isArray(payload)
            ? payload
            : (payload && Array.isArray(payload.events) ? payload.events : [payload]);
          item = events.find(event => messageId && String(event.message_id || event.msg_id || event.id || "") === messageId) || events[0];
        } catch (e) {}
      }

      if (!item) {
        item = {
          sender_name: senderNameIndex >= 0 ? row[senderNameIndex] : "",
          channel: channelIndex >= 0 ? row[channelIndex] : ""
        };
      }
      return [resolveAccountName(item, payload, null, "Sevenfive Distributor")];
    });
    sheet.getRange(2, 2, accounts.length, 1).setValues(accounts);
  }

  return true;
}

/**
 * คำนวณเวลาเริ่มต้นของช่วงที่ต้องการดึง (เมื่อวาน 00:00:00 ตามเวลาประเทศไทย)
 */
function getSyncStartDate() {
  const now = new Date();
  const tzOffset = 7 * 60 * 60 * 1000;
  const bkkNow = new Date(now.getTime() + tzOffset);
  const y = bkkNow.getUTCFullYear();
  const m = bkkNow.getUTCMonth();
  const d = bkkNow.getUTCDate();
  // เที่ยงคืนของเมื่อวานตามเวลาประเทศไทย (Asia/Bangkok)
  const yesterdayMidnight = new Date(Date.UTC(y, m, d - (FILTER_LAST_DAYS - 1), 0, 0, 0) - tzOffset);
  return yesterdayMidnight;
}

/**
 * ฟังก์ชันตรวจสอบว่าข้อความอยู่ในช่วง 2 วันล่าสุดหรือไม่ (ตั้งแต่เมื่อวาน 00:00:00 เป็นต้นมา)
 */
function isWithinSyncWindow(timeInput) {
  if (!timeInput) return true;
  try {
    const startDate = getSyncStartDate();
    let d = null;
    if (typeof timeInput === "string") {
      d = new Date(timeInput.replace(" ", "T") + (timeInput.includes("+") || timeInput.includes("Z") ? "" : "+07:00"));
      if (isNaN(d.getTime())) d = new Date(timeInput);
    } else if (typeof timeInput === "number") {
      d = new Date(timeInput < 10000000000 ? timeInput * 1000 : timeInput);
    } else if (timeInput instanceof Date) {
      d = timeInput;
    }
    if (d && !isNaN(d.getTime())) {
      return d.getTime() >= startDate.getTime();
    }
  } catch (e) {}
  return true;
}

/**
 * ฟังก์ชันรับคำขอ POST จาก Chatcone Webhook
 */
function doPost(e) {
  const lock = LockService.getScriptLock();
  // รอคิว Lock 10 วินาที เพื่อป้องกันข้อความแย่งกันเขียนแถวทับกัน (Concurrency Safe)
  try {
    lock.waitLock(10000);
  } catch (err) {
    return createJsonResponse({ status: "error", message: "Server busy, lock timeout" }, 503);
  }

  try {
    if (!e || (!e.postData && !e.parameter)) {
      return createJsonResponse({ status: "error", message: "No data received" }, 400);
    }

    // ดึง Raw Body จากคำขอ
    let rawContent = "";
    let payload = null;

    if (e.postData && e.postData.contents) {
      rawContent = e.postData.contents;
      try {
        payload = JSON.parse(rawContent);
      } catch (jsonErr) {
        // กรณีข้อมูลมาเป็น Form URL Encoded หรือ Text
        payload = e.parameter || { raw: rawContent };
      }
    } else if (e.parameter) {
      payload = e.parameter;
      rawContent = JSON.stringify(e.parameter);
    }

    // เปิด Spreadsheet ปัจจุบัน
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAME);
    
    // หากมีคำขอรายการ Message ID ที่มีอยู่ในชีตแล้ว
    if (payload && payload.action === "get_existing_ids") {
      const existingIds = [];
      if (sheet && sheet.getLastRow() > 1) {
        const lastCol = sheet.getLastColumn();
        const idColIndex = lastCol >= 16 ? 13 : 12; // คอลัมน์ M (13) สำหรับ 16 คอลัมน์, คอลัมน์ L (12) สำหรับ 15 คอลัมน์
        const idVals = sheet.getRange(2, idColIndex, sheet.getLastRow() - 1, 1).getValues();
        for (let r = 0; r < idVals.length; r++) {
          const val = String(idVals[r][0] || "").trim();
          if (val && val !== "-") {
            existingIds.push(val);
          }
        }
      }
      return createJsonResponse({
        status: "success",
        ids: existingIds,
        count: existingIds.length
      }, 200);
    }

    // หากมีคำขอบันทึกประวัติการ Sync ลงในชีต Sync_Logs โดยตรง (เช่น บันทึกสรุปรอบที่ไม่มีข้อความใหม่ หรือสรุปหลายชุด)
    if (payload && (payload.action === "log_summary" || payload.action === "record_log")) {
      recordSyncLog(
        payload.log_action || "Batch Sync",
        payload.status || "✅ ข้อมูลล่าสุดแล้ว",
        Number(payload.total_count) || 0,
        Number(payload.distributor_count) || 0,
        Number(payload.official_count) || 0,
        payload.details || "ตรวจสอบแล้ว ข้อมูลเป็นปัจจุบัน ไม่มีข้อความใหม่ที่ต้องซิงค์"
      );
      return createJsonResponse({
        status: "success",
        message: "Sync log recorded successfully",
        timestamp: Utilities.formatDate(new Date(), TIMEZONE, DATE_FORMAT)
      }, 200);
    }

    // หากมีคำสั่งจัดระเบียบตารางและล้างข้อมูลผิดพลาด (Quotation No.)
    if (payload && (payload.action === "fix_columns" || payload.action === "clean_quotations")) {
      fixAndCleanColumns();
      return createJsonResponse({
        status: "success",
        message: "Cleaned and reorganized columns successfully"
      }, 200);
    }

    // หากมีคำสั่งรีเซ็ตชีตเพื่อจัดคอลัมน์ใหม่ทั้งหมด
    if (payload && payload.action === "reset_and_sync") {
      if (sheet) {
        ensureAccountColumn(sheet);
        const lastRow = sheet.getLastRow();
        if (lastRow > 1) {
          sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
        }
      }
      sheet = initializeSheet(ss);
    } else if (!sheet) {
      sheet = initializeSheet(ss);
    } else {
      ensureAccountColumn(sheet);
      // ตรวจสอบว่าคอลัมน์หัวตารางเป็นเวอร์ชันล่าสุด 16 คอลัมน์หรือยัง
      const headers = getStandardHeaders();
      if (sheet.getLastColumn() < headers.length) {
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
        sheet.setColumnWidth(2, 170); // Account
        sheet.setColumnWidth(15, 160); // Quotation No.
        sheet.setColumnWidth(16, 150); // Grand Total
        sheet.getRange("P:P").setNumberFormat("#,##0.00");
      }
    }

    // แปลงข้อมูลจาก Chatcone ให้อยู่ในโครงสร้างมาตรฐาน (พร้อมส่ง context e เพื่อตรวจจับบัญชี)
    const parsedRows = parseChatconePayload(payload, rawContent, e);

    if (parsedRows && parsedRows.length > 0) {
      // ดึงข้อมูลแถวสุดท้ายเพื่อเพิ่มข้อมูล
      const lastRow = sheet.getLastRow();
      sheet.getRange(lastRow + 1, 1, parsedRows.length, parsedRows[0].length).setValues(parsedRows);
      
      // จัดรูปแบบชิดซ้าย/กลาง และฟอร์แมตตัวเลข
      sheet.getRange(lastRow + 1, 1, parsedRows.length, 1).setNumberFormat("@"); // Timestamp เป็น text หรือ date
      if (parsedRows[0].length >= 16) {
        sheet.getRange(lastRow + 1, 16, parsedRows.length, 1).setNumberFormat("#,##0.00"); // Grand Total เป็นตัวเลขเงิน
      }

      // นับแยกบัญชีเพื่อบันทึกประวัติลงใน Sync_Logs
      let countDist = 0;
      let countOff = 0;
      for (let i = 0; i < parsedRows.length; i++) {
        if (parsedRows[i][1] === "SevenfiveOfficial") {
          countOff++;
        } else {
          countDist++;
        }
      }

      if (!payload.skip_log) {
        recordSyncLog(
          (payload && payload.action === "sync") ? "Batch Sync" : "Webhook Ingestion",
          "✅ สำเร็จ",
          parsedRows.length,
          countDist,
          countOff,
          "บันทึกข้อความใหม่ลงชีต " + parsedRows.length + " แถว"
        );
      }
    } else if (payload && (payload.action === "sync" || payload.action === "reset_and_sync") && (!payload.events || payload.events.length === 0)) {
      // หากส่งคำขอ sync แต่ไม่มีข้อความใหม่ (0 ข้อความ) และไม่ได้สั่ง skip_log
      if (!payload.skip_log) {
        recordSyncLog(
          "Batch Sync",
          "✅ ข้อมูลล่าสุดแล้ว",
          0,
          0,
          0,
          "ตรวจสอบแล้ว ข้อมูลเป็นปัจจุบัน ไม่มีข้อความใหม่ที่ต้องซิงค์"
        );
      }
    }

    return createJsonResponse({
      status: "success",
      message: "Chat log recorded successfully",
      rows_added: parsedRows.length,
      timestamp: Utilities.formatDate(new Date(), TIMEZONE, DATE_FORMAT)
    }, 200);

  } catch (error) {
    console.error("Error in doPost:", error);
    return createJsonResponse({
      status: "error",
      message: error.toString(),
      stack: error.stack
    }, 500);
  } finally {
    lock.releaseLock();
  }
}

/**
 * ฟังก์ชันรับคำขอ GET เพื่อใช้ตรวจสุขภาพของ Webhook (Health Check)
 */
function doGet(e) {
  return createJsonResponse({
    status: "ok",
    service: "Chatcone to Google Sheets Webhook Sync",
    version: "1.3.0",
    features: ["chat_logging", "response_time_tracking", "pdf_quotation_ocr", "sync_summary_logs", "account_column"],
    server_time: Utilities.formatDate(new Date(), TIMEZONE, DATE_FORMAT),
    instructions: "This endpoint receives POST requests from Chatcone Webhook."
  }, 200);
}

/**
 * ฟังก์ชันตรวจสอบและดึงเลขที่ใบเสนอราคา (Quotation No.) ให้ถูกต้องตามรูปแบบ
 * ป้องกันคำที่ไม่ใช่เลขที่เอกสาร เช่น QTEC, QTDACCBDTCN8A, QUOTATION, INVOICE ฯลฯ
 * รูปแบบมาตรฐาน Sevenfive เช่น QT0926-01181, QT0826-00767, QT0926-01155
 */
function extractQuotationNo(text) {
  if (!text || typeof text !== "string") return "";
  const match = text.match(/(?:QT|QUO|INV)[-_]?(?:\d{3,6}[-_/]\d{2,6}|\d{5,10})(?:[-_]?(?:REV|R)?\d+)?(?![a-zA-Z\d])/i);
  return match ? match[0].toUpperCase() : "";
}

/**
 * ตรวจสอบว่าสตริงเป็นเลขที่ใบเสนอราคาที่ถูกต้องสมบูรณ์หรือไม่
 */
function isValidQuotationNo(val) {
  if (!val || typeof val !== "string") return false;
  return /^(?:QT|QUO|INV)[-_]?(?:\d{3,6}[-_/]\d{2,6}|\d{5,10})(?:[-_]?(?:REV|R)?\d+)?$/i.test(val.trim());
}

/**
 * ฟังก์ชันดึงเลขที่ใบเสนอราคา (Quotation No.) และยอดรวม (Grand Total) จากไฟล์ PDF
 * รองรับทั้งการแปลงข้อความจาก Google Drive OCR และการวิเคราะห์จากชื่อไฟล์/เนื้อหา
 */
function extractPdfQuotationData(fileUrl, fileName) {
  const result = {
    quotationNo: "",
    grandTotal: ""
  };

  const nameToCheck = fileName || "";
  // 1. ดึงเลขที่เอกสารเบื้องต้นจากชื่อไฟล์ เช่น QT0926-01155.ลัคกี เจแปน.pdf
  result.quotationNo = extractQuotationNo(nameToCheck);

  // หากไม่มี URL หรือไม่ใช่ลิงก์ HTTP/HTTPS ให้คืนผลลัพธ์ทันที
  if (!fileUrl || typeof fileUrl !== "string" || !fileUrl.startsWith("http")) {
    return result;
  }

  try {
    // 2. ดึงไฟล์ PDF
    const response = UrlFetchApp.fetch(fileUrl, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) {
      return result;
    }
    const blob = response.getBlob();
    const contentType = (blob.getContentType() || "").toLowerCase();
    if (!contentType.includes("pdf") && !contentType.includes("image") && !fileUrl.toLowerCase().includes(".pdf")) {
      return result;
    }

    const tempName = "temp_ocr_" + new Date().getTime();
    let tempFile = null;
    let docId = null;

    // 3. ใช้ Google Drive Advanced Service (รองรับทั้ง Drive API v2 และ v3)
    if (typeof Drive !== "undefined" && Drive.Files) {
      try {
        blob.setContentType("application/pdf");
        tempFile = DriveApp.createFile(blob);
        const tempFileId = tempFile.getId();

        let docFile = null;
        if (typeof Drive.Files.copy === "function") {
          // Drive API v3 / v2: copy file with OCR conversion
          docFile = Drive.Files.copy(
            {
              name: tempName,
              title: tempName,
              mimeType: "application/vnd.google-apps.document"
            },
            tempFileId,
            { ocr: true, ocrLanguage: "th" }
          );
        } else if (typeof Drive.Files.create === "function") {
          docFile = Drive.Files.create(
            {
              name: tempName,
              title: tempName,
              mimeType: "application/vnd.google-apps.document"
            },
            blob,
            { ocr: true, ocrLanguage: "th" }
          );
        } else if (typeof Drive.Files.insert === "function") {
          docFile = Drive.Files.insert(
            {
              title: tempName,
              mimeType: "application/vnd.google-apps.document"
            },
            blob,
            { ocr: true, ocrLanguage: "th" }
          );
        }

        if (docFile && docFile.id) {
          docId = docFile.id;
        }
      } catch (driveErr) {
        // หาก Drive API มีปัญหา จะลองต่อด้วย REST API
      } finally {
        if (tempFile) {
          try { tempFile.setTrashed(true); } catch (e) {}
        }
      }
    }

    // 4. หากยังไม่ได้ docId ให้ลองใช้ REST API
    if (!docId) {
      try {
        const restMetadata = {
          title: tempName,
          name: tempName
        };

        const boundary = "-------chatconeOcrBoundary" + new Date().getTime();
        const delimiter = "\r\n--" + boundary + "\r\n";
        const closeDelimiter = "\r\n--" + boundary + "--";

        const requestBody =
          delimiter +
          'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
          JSON.stringify(restMetadata) +
          delimiter +
          'Content-Type: application/pdf\r\n' +
          'Content-Transfer-Encoding: base64\r\n\r\n' +
          Utilities.base64Encode(blob.getBytes()) +
          closeDelimiter;

        const uploadRes = UrlFetchApp.fetch(
          "https://www.googleapis.com/upload/drive/v2/files?uploadType=multipart&ocr=true&ocrLanguage=th",
          {
            method: "post",
            contentType: "multipart/related; boundary=" + boundary,
            headers: {
              Authorization: "Bearer " + ScriptApp.getOAuthToken()
            },
            payload: requestBody,
            muteHttpExceptions: true
          }
        );

        if (uploadRes.getResponseCode() === 200) {
          const fileInfo = JSON.parse(uploadRes.getContentText());
          docId = fileInfo.id;
        }
      } catch (restErr) {}
    }

    if (docId) {
      const doc = DocumentApp.openById(docId);
      const text = doc.getBody().getText();

      // 4. ดึงเลขที่เอกสารจากเนื้อหาเพิ่มเติมหากในชื่อไฟล์ไม่มี
      if (!result.quotationNo) {
        result.quotationNo = extractQuotationNo(text);
      }

      // 5. สกัดยอดเงิน Grand Total (เช่น GRAND TOTAL 39,000.00 หรือ ยอดรวมทั้งสิ้น 39,000.00)
      const regex = /(?:\b(?:GRAND\s*TOTAL|TOTAL)\b|ยอดรวมทั้งสิ้น|รวมทั้งสิ้น|จำนวนเงินทั้งสิ้น|ยอดรวมสุทธิ)[\s\S]{0,35}?([\d]{1,3}(?:,\d{3})*(?:\.\d{2})|\d+\.\d{2})/i;
      const totalMatch = text.match(regex);
      if (totalMatch) {
        const numStr = totalMatch[1].replace(/,/g, "");
        const num = parseFloat(numStr);
        if (!isNaN(num)) {
          result.grandTotal = num;
        }
      }

      // Fallback: หากยังไม่เจอ ลองตรวจหาตัวเลขใกล้คำว่า BAHT ONLY หรือ บาท
      if (result.grandTotal === "") {
        const bahtMatch = text.match(/(?:BAHT\s*ONLY|บาทถ้วน|บาท)[\s\S]{0,50}?([\d]{1,3}(?:,\d{3})*(?:\.\d{2})|\d+\.\d{2})/i);
        if (bahtMatch) {
          const numStr = bahtMatch[1].replace(/,/g, "");
          const num = parseFloat(numStr);
          if (!isNaN(num)) {
            result.grandTotal = num;
          }
        }
      }

      // ลบไฟล์เอกสารชั่วคราวออกจาก Google Drive ทันทีเพื่อไม่ให้รกไดรฟ์
      DriveApp.getFileById(docId).setTrashed(true);
    }
  } catch (err) {
    console.error("OCR Extraction Error:", err);
  }

  return result;
}

/**
 * ฟังก์ชันแปลง Payload จาก Chatcone ให้อยู่ในโครงสร้าง Column ของ Google Sheets (15 Columns)
 */
function parseChatconePayload(payload, rawContent, e) {
  const rows = [];
  const nowStr = Utilities.formatDate(new Date(), TIMEZONE, DATE_FORMAT);

  // หาก payload มาในรูปแบบ Array (หลาย Events พร้อมกัน)
  const events = Array.isArray(payload) ? payload : (payload.events || [payload]);

  for (let i = 0; i < events.length; i++) {
    const item = events[i];
    
    // 1. Timestamp (เวลาที่เกิดข้อความ)
    let timestamp = nowStr;
    if (item.timestamp || item.created_at || item.datetime || item.time) {
      const t = item.timestamp || item.created_at || item.datetime || item.time;
      try {
        const dateObj = new Date(typeof t === "number" && t < 10000000000 ? t * 1000 : t);
        if (!isNaN(dateObj.getTime())) {
          timestamp = Utilities.formatDate(dateObj, TIMEZONE, DATE_FORMAT);
        }
      } catch (err) {
        timestamp = String(t);
      }
    }

    // กรองเฉพาะข้อความย้อนหลัง 1 วัน รวมวันนี้ = 2 วันล่าสุด
    if (FILTER_LAST_DAYS > 0 && !isWithinSyncWindow(item.timestamp || item.created_at || item.datetime || item.time || timestamp)) {
      continue;
    }

    // 2. Account (ตรวจจับบัญชีอัตโนมัติจาก Company ID, Channel ID, URL Param, หรือข้อมูลใน Payload)
    const account = resolveAccountName(item, payload, e, "Sevenfive Distributor");

    // 3. Channel / Platform (LINE, Facebook, IG, Webchat)
    const channel = item.channel || item.platform || item.source || (item.channel_type ? item.channel_type : "Chatcone");

    // 4. Sender Type (Customer หรือ Agent / Bot)
    let senderType = "Customer";
    if (item.sender_type) {
      senderType = item.sender_type;
    } else if (item.is_agent || item.agent_id || item.sender === "agent" || item.type === "agent_message") {
      senderType = "Agent";
    } else if (item.is_bot || item.sender === "bot") {
      senderType = "Bot";
    }

    // 5. Sender Name (ชื่อผู้ส่ง / ชื่อลูกค้า / ชื่อแอดมิน)
    const senderName = item.sender_name || item.customer_name || item.name || item.user_name || (item.sender ? item.sender.name : "") || (senderType === "Agent" ? (item.agent_name || "Admin") : "Customer");

    // 6. User ID / Customer ID
    const userId = item.customer_id || item.user_id || item.sender_id || item.uid || (item.sender ? (item.sender.id || item.sender.uid) : "") || "-";

    // 7. Message Type & File Extraction (รองรับ Text, Image, Sticker, File, และ Flex Message ที่แอดมินส่งใบเสนอราคา)
    let messageType = item.message_type || item.type || "text";
    let attachedFileName = item.file_name || item.fileName || (item.message && (item.message.file_name || item.message.fileName)) || "";
    let mediaUrl = item.file_path || item.filePath || item.media_url || item.image_url || item.file_url || item.file || item.download_url || item.url || "";

    // ตรวจสอบ messages_sent และ Flex Message (LINE OA Agent files เช่น ใบเสนอราคา QT)
    const sentList = Array.isArray(item.messages_sent) ? item.messages_sent : (item.message ? [item.message] : []);
    for (let sIdx = 0; sIdx < sentList.length; sIdx++) {
      const sObj = sentList[sIdx];
      if (!sObj) continue;
      if (sObj.fileName || sObj.file_name) attachedFileName = attachedFileName || sObj.fileName || sObj.file_name;
      if (sObj.file_path || sObj.filePath || sObj.file_url || sObj.url || sObj.file) {
        mediaUrl = mediaUrl || sObj.file_path || sObj.filePath || sObj.file_url || sObj.url || sObj.file;
      }
      if (sObj.type === "flex" || sObj.contents) {
        const flexStr = typeof sObj.contents === "string" ? sObj.contents : JSON.stringify(sObj.contents || sObj);
        const nameMatch = flexStr.match(/[\"']([^\"']*?\.pdf)[\"']/i) || flexStr.match(/(QT[\w-]+\.[^\"\s]+)/i);
        if (nameMatch && !attachedFileName) attachedFileName = nameMatch[1];
        const pdfUriMatch = flexStr.match(/https:\/\/[^\"\s]+?\.pdf/i);
        const actionUriMatch = flexStr.match(/\"uri\"\s*:\s*\"(https:\/\/[^\"]+)\"/i);
        if (pdfUriMatch && !mediaUrl) {
          mediaUrl = pdfUriMatch[0].replace(/[\\\"']/g, "");
        } else if (actionUriMatch && !mediaUrl) {
          mediaUrl = actionUriMatch[1].replace(/[\\\"']/g, "");
        }
      }
    }

    if (item.type === "flex" || (item.message && item.message.type === "flex")) {
      const flexStr = JSON.stringify(item.messages_sent || item.message || item);
      const nameMatch = flexStr.match(/[\"']([^\"']*?\.pdf)[\"']/i) || flexStr.match(/(QT[\w-]+\.[^\"\s]+)/i);
      if (nameMatch && !attachedFileName) attachedFileName = nameMatch[1];
      const pdfUriMatch = flexStr.match(/https:\/\/[^\"\s]+?\.pdf/i);
      const actionUriMatch = flexStr.match(/\"uri\"\s*:\s*\"(https:\/\/[^\"]+)\"/i);
      if (pdfUriMatch && !mediaUrl) {
        mediaUrl = pdfUriMatch[0].replace(/[\\\"']/g, "");
      } else if (actionUriMatch && !mediaUrl) {
        mediaUrl = actionUriMatch[1].replace(/[\\\"']/g, "");
      }
    }

    // 8. Message Content (ข้อความ)
    let messageContent = "";
    if (typeof item.message === "string") {
      messageContent = item.message;
    } else if (item.message && typeof item.message.text === "string") {
      messageContent = item.message.text;
    } else if (item.text) {
      messageContent = item.text;
    } else if (attachedFileName) {
      messageContent = attachedFileName;
    } else if (item.content) {
      messageContent = typeof item.content === "string" ? item.content : JSON.stringify(item.content);
    } else if (messageType === "image") {
      messageContent = "[Image File]";
    } else if (messageType === "sticker") {
      messageContent = `[Sticker ${item.sticker_id || (item.message ? item.message.sticker_id : "") || ""}]`;
    } else if (messageType === "file" || messageType === "pdf") {
      messageContent = attachedFileName || item.title || "[Attachment File]";
    } else {
      messageContent = JSON.stringify(item.message || item);
    }

    // หากพบว่าเป็นไฟล์แนบหรือ PDF
    if (attachedFileName && (attachedFileName.toLowerCase().endsWith(".pdf") || /QT\d+/i.test(attachedFileName))) {
      messageType = "file";
      if (!messageContent || messageContent === "Send Files" || messageContent === "Send File" || messageContent.includes("flex")) {
        messageContent = attachedFileName;
      }
    }

    // 9. Response Time (เวลาที่แอดมินใช้ตอบ)
    let responseTimeSec = "";
    let responseTimeFormatted = "-";

    const rTime = item.response_time !== undefined && item.response_time !== null ? item.response_time : (item.responseTime !== undefined ? item.responseTime : null);
    if (rTime !== null && rTime !== "" && !isNaN(Number(rTime))) {
      const sec = Math.round(Number(rTime));
      responseTimeSec = sec;
      if (sec < 60) {
        responseTimeFormatted = `${sec} วินาที`;
      } else if (sec < 3600) {
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        responseTimeFormatted = `${m} นาที ${s} วินาที`;
      } else {
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        responseTimeFormatted = `${h} ชม. ${m} นาที`;
      }
    }

    // Clean message content if it contains bracketed response time
    if (typeof messageContent === "string") {
      messageContent = messageContent.replace(/\s*\[.*?ใช้เวลาตอบ.*?\]/g, "").trim();
    }

    // 11. Media / Attachment URL (ลิงก์รูป/ไฟล์)
    if (!mediaUrl) {
      if (item.media_url || item.image_url || item.file_url || item.file || item.download_url || item.url) {
        mediaUrl = item.media_url || item.image_url || item.file_url || item.file || item.download_url || item.url;
      } else if (item.message && (item.message.url || item.message.image_url || item.message.file_url || item.message.file || item.message.download_url || item.message.media_url)) {
        mediaUrl = item.message.url || item.message.image_url || item.message.file_url || item.message.file || item.message.download_url || item.message.media_url;
      }
    }

    // 12. Conversation ID / Room ID / Session ID
    const conversationId = item.conversation_id || item.room_id || item.chat_id || item.session_id || "-";

    // 13. Message ID (เพื่อป้องกันการซ้ำ)
    const messageId = item.message_id || item.msg_id || item.id || "-";

    // 14. Raw JSON ของข้อความนี้โดยเฉพาะ (เพื่อให้แต่ละแถวมีข้อมูลของตัวเอง ไม่ปนกับแถวอื่นในชุด)
    const rawJsonStr = JSON.stringify(item).substring(0, 5000);

    // 15 & 16. Quotation No. และ Grand Total (ยอดรวมใบเสนอราคา)
    let quotationNo = item.quotation_no || item.quotationNo || item.doc_no || "";
    if (quotationNo && !isValidQuotationNo(quotationNo)) {
      quotationNo = extractQuotationNo(quotationNo);
    }

    let grandTotal = (item.grand_total !== undefined && item.grand_total !== null && item.grand_total !== "")
      ? Number(item.grand_total)
      : (item.grandTotal !== undefined && item.grandTotal !== null && item.grandTotal !== "" ? Number(item.grandTotal) : "");

    // ตรวจสอบว่าเป็นไฟล์ PDF หรือใบเสนอราคาหรือไม่
    const isPdf = messageType === "file" || messageType === "pdf" ||
      (attachedFileName && attachedFileName.toLowerCase().endsWith(".pdf")) ||
      (messageContent && messageContent.toLowerCase().endsWith(".pdf")) ||
      (mediaUrl && mediaUrl.toLowerCase().includes(".pdf")) ||
      /QT\d+/i.test(attachedFileName || messageContent);

    if (isPdf) {
      messageType = "file";
      if (!messageContent || messageContent === "Send Files" || messageContent === "Send File" || messageContent.includes("flex")) {
        messageContent = attachedFileName || "Quotation PDF";
      }
      // สกัดเลขที่เอกสารเบื้องต้นจากชื่อไฟล์หรือข้อความหรือ URL
      if (!quotationNo) {
        quotationNo = extractQuotationNo(attachedFileName) || extractQuotationNo(messageContent) || extractQuotationNo(mediaUrl);
      }

      // หากยังไม่มียอดเงิน และมีลิงก์ Media URL ให้รัน OCR สกัดยอดเงินจาก PDF
      if (grandTotal === "" && mediaUrl) {
        const ocrData = extractPdfQuotationData(mediaUrl, attachedFileName || messageContent);
        if (!quotationNo && ocrData.quotationNo) {
          quotationNo = ocrData.quotationNo;
        }
        if (ocrData.grandTotal !== "") {
          grandTotal = ocrData.grandTotal;
        }
      }
    } else {
      // หากไม่ใช่ไฟล์แนบ แต่เป็นข้อความแชทที่มีการระบุเลขที่ใบเสนอราคาชัดเจน
      if (!quotationNo) {
        quotationNo = extractQuotationNo(messageContent);
      }
    }

    // ตรวจสอบความถูกต้องรอบสุดท้าย หากไม่ใช่รูปแบบที่ถูกต้องให้เป็นค่าว่าง
    if (!isValidQuotationNo(quotationNo)) {
      quotationNo = "";
    }

    rows.push([
      timestamp,              // Col A: Timestamp
      account,                // Col B: Account (NEW!)
      channel,                // Col C: Channel
      senderType,             // Col D: Sender Type
      senderName,             // Col E: Sender Name
      String(userId),         // Col F: User / Customer ID
      messageType,            // Col G: Message Type
      messageContent,         // Col H: Message Content
      responseTimeSec,        // Col I: Response Time (วินาที)
      responseTimeFormatted,  // Col J: Response Time (อ่านง่าย)
      mediaUrl,               // Col K: Media URL
      conversationId,         // Col L: Conversation ID
      String(messageId),      // Col M: Message ID
      rawJsonStr,             // Col N: Raw JSON
      quotationNo,            // Col O: Quotation No.
      grandTotal              // Col P: Grand Total (ตัวเลข)
    ]);
  }

  return rows;
}

/**
 * หัวคอลัมน์มาตรฐาน 16 คอลัมน์ (รองรับ 2 บัญชี: Sevenfive Distributor, SevenfiveOfficial)
 */
function getStandardHeaders() {
  return [
    "Timestamp (วัน-เวลา)",
    "Account (บัญชี)",
    "Channel (ช่องทาง)",
    "Sender Type (ประเภทผู้ส่ง)",
    "Sender Name (ชื่อผู้ส่ง)",
    "Customer ID (รหัสลูกค้า)",
    "Message Type (ประเภทข้อความ)",
    "Message Content (เนื้อหาข้อความ)",
    "Response Time (วินาที)",
    "Response Time (อ่านง่าย)",
    "Media URL (ลิงก์ไฟล์/รูป)",
    "Conversation ID",
    "Message ID",
    "Raw JSON Data",
    "Quotation No. (เลขที่ใบเสนอราคา)",
    "Grand Total (ยอดรวมทั้งสิ้น)"
  ];
}

/**
 * สร้างชีตใหม่พร้อมจัดรูปแบบหัวตารางให้สวยงาม (16 คอลัมน์)
 */
function initializeSheet(ss) {
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  const headers = getStandardHeaders();

  // เขียน Header
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  // ตกแต่งสไตล์ Header (Modern Dark Slate Theme)
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setBackground("#1e293b"); // Slate 800
  headerRange.setFontColor("#ffffff");
  headerRange.setFontWeight("bold");
  headerRange.setFontFamily("Sarabun");
  headerRange.setFontSize(10);
  headerRange.setHorizontalAlignment("center");
  headerRange.setVerticalAlignment("middle");
  sheet.setRowHeight(1, 38);

  // ตรึงแถวที่ 1 (Freeze Header)
  sheet.setFrozenRows(1);

  // กำหนดความกว้างคอลัมน์ให้อ่านง่าย
  sheet.setColumnWidth(1, 160); // Col A: Timestamp
  sheet.setColumnWidth(2, 170); // Col B: Account
  sheet.setColumnWidth(3, 120); // Col C: Channel
  sheet.setColumnWidth(4, 110); // Col D: Sender Type
  sheet.setColumnWidth(5, 150); // Col E: Sender Name
  sheet.setColumnWidth(6, 140); // Col F: Customer ID
  sheet.setColumnWidth(7, 110); // Col G: Message Type
  sheet.setColumnWidth(8, 340); // Col H: Message Content
  sheet.setColumnWidth(9, 140); // Col I: Response Time (วินาที)
  sheet.setColumnWidth(10, 160); // Col J: Response Time (อ่านง่าย)
  sheet.setColumnWidth(11, 200); // Col K: Media URL
  sheet.setColumnWidth(12, 130); // Col L: Conversation ID
  sheet.setColumnWidth(13, 130); // Col M: Message ID
  sheet.setColumnWidth(14, 150); // Col N: Raw JSON
  sheet.setColumnWidth(15, 160); // Col O: Quotation No.
  sheet.setColumnWidth(16, 150); // Col P: Grand Total

  // จัดกึ่งกลางสำหรับคอลัมน์ตัวเลข Response Time และ Quotation No.
  sheet.getRange("I:J").setHorizontalAlignment("center");
  sheet.getRange("O:O").setHorizontalAlignment("center");

  // จัดชิดขวาและฟอร์แมตตัวเลขเงินสำหรับ Grand Total
  sheet.getRange("P:P").setHorizontalAlignment("right").setNumberFormat("#,##0.00");

  // เปิดใช้ Text Wrap สำหรับ Message Content
  sheet.getRange("H:H").setWrap(true);

  return sheet;
}

/**
 * 📝 สร้างหรือเตรียมชีตบันทึกประวัติการ Sync (Sync_Logs)
 */
function initializeLogSheet(ss) {
  let logSheet = ss.getSheetByName(LOG_SHEET_NAME);
  if (!logSheet) {
    logSheet = ss.insertSheet(LOG_SHEET_NAME);
  }

  const headers = [
    "Timestamp (วัน-เวลา)",
    "Action (การดำเนินการ)",
    "Status (สถานะ)",
    "Total Messages (ข้อความรวม)",
    "Sevenfive Distributor",
    "SevenfiveOfficial",
    "Filter Range (ช่วงเวลา)",
    "Details (รายละเอียด)"
  ];

  if (logSheet.getLastRow() < 1) {
    logSheet.getRange(1, 1, 1, headers.length).setValues([headers]);

    const headerRange = logSheet.getRange(1, 1, 1, headers.length);
    headerRange.setBackground("#0f172a"); // Slate 900
    headerRange.setFontColor("#ffffff");
    headerRange.setFontWeight("bold");
    headerRange.setFontFamily("Sarabun");
    headerRange.setFontSize(10);
    headerRange.setHorizontalAlignment("center");
    headerRange.setVerticalAlignment("middle");
    logSheet.setRowHeight(1, 38);
    logSheet.setFrozenRows(1);

    logSheet.setColumnWidth(1, 170); // Timestamp
    logSheet.setColumnWidth(2, 190); // Action
    logSheet.setColumnWidth(3, 110); // Status
    logSheet.setColumnWidth(4, 150); // Total Messages
    logSheet.setColumnWidth(5, 170); // Sevenfive Distributor
    logSheet.setColumnWidth(6, 170); // SevenfiveOfficial
    logSheet.setColumnWidth(7, 200); // Filter Range
    logSheet.setColumnWidth(8, 280); // Details

    logSheet.getRange("A:C").setHorizontalAlignment("center");
    logSheet.getRange("D:F").setHorizontalAlignment("right");
    logSheet.getRange("G:G").setHorizontalAlignment("center");
  }

  return logSheet;
}

/**
 * 📝 บันทึกประวัติการ Sync ลงในชีต Sync_Logs
 */
function recordSyncLog(action, status, totalCount, distributorCount, officialCount, details) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const logSheet = initializeLogSheet(ss);
    const nowStr = Utilities.formatDate(new Date(), TIMEZONE, DATE_FORMAT);
    const filterInfo = FILTER_LAST_DAYS > 0 ? (FILTER_LAST_DAYS + " วันล่าสุด") : "ไม่จำกัดวัน";

    logSheet.appendRow([
      nowStr,
      action || "Sync Messages",
      status || "✅ สำเร็จ",
      Number(totalCount) || 0,
      Number(distributorCount) || 0,
      Number(officialCount) || 0,
      filterInfo,
      details || ""
    ]);

    const lastRow = logSheet.getLastRow();
    logSheet.getRange(lastRow, 1).setNumberFormat("@");
    logSheet.getRange(lastRow, 4, 1, 3).setNumberFormat("#,##0");
  } catch (err) {
    Logger.log("ไม่สามารถบันทึก Log Sheet ได้: " + err);
  }
}

/**
 * 📋 ฟังก์ชันเปิดไปที่ชีต Sync_Logs ทันที
 */
function openSyncLogs() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSheet = initializeLogSheet(ss);
  ss.setActiveSheet(logSheet);
}

/**
 * 🌟 เพิ่มเมนู Chatcone Sync บนแถบเมนู Google Sheets อัตโนมัติเมื่อเปิดไฟล์
 */
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu("🚀 Chatcone Sync")
      .addItem("จัดระเบียบตาราง & อัปเดตบัญชีอัตโนมัติ (Fix & Auto-Detect)", "fixAndCleanColumns")
      .addItem("📋 ดูประวัติการ Sync (Open Sync Logs)", "openSyncLogs")
      .addSeparator()
      .addItem("🧪 ส่งข้อมูลจำลองทดสอบทั้ง 2 บัญชี (Mock Webhook)", "testMockChatconeWebhook")
      .addItem("Restore missing Account column", "repairAccountColumn")
      .addItem("📋 สร้าง/รีเซ็ตหัวตารางมาตรฐาน 16 คอลัมน์", "setupSheet")
      .addToUi();
  } catch (e) {}
}

function repairAccountColumn() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    initializeSheet(ss);
    return;
  }
  Logger.log(ensureAccountColumn(sheet)
    ? "Restored Account column and preserved existing rows."
    : "Account column already exists or this sheet uses another layout.");
}

/**
 * ฟังก์ชันสำหรับทดสอบสร้างตารางด้วยตัวเอง (Manual Run)
 */
function setupSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  initializeSheet(ss);
  initializeLogSheet(ss);
  Logger.log("สร้างตาราง Chat_Logs (16 คอลัมน์) และ Sync_Logs เรียบร้อยแล้ว");
}

/**
 * 🛠️ ฟังก์ชันจัดระเบียบตารางและย้ายเวลาตอบเข้า Column ถูกต้องอัตโนมัติทันที
 * รองรับการอัปเกรดเป็น 16 คอลัมน์ (มี Column Account รองรับ 2 บัญชี: Sevenfive Distributor, SevenfiveOfficial)
 */
function fixAndCleanColumns() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = initializeSheet(ss);
    return;
  }

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2) {
    initializeSheet(ss);
    return;
  }

  // ดึงข้อมูลเดิมทั้งหมดในชีต
  const allValues = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const newRows = [];

  for (let i = 0; i < allValues.length; i++) {
    const row = allValues[i];
    const timestamp = row[0];

    // กรองเฉพาะข้อความ 2 วันล่าสุด (เมื่อวานและวันนี้)
    if (FILTER_LAST_DAYS > 0 && !isWithinSyncWindow(timestamp)) {
      continue;
    }

    let account = "";
    let channel = "";
    let senderType = "";
    let senderName = "";
    let customerId = "";
    let messageType = "";
    let messageContent = "";
    let responseTimeSec = "";
    let responseTimeFormatted = "-";
    let mediaUrl = "";
    let conversationId = "-";
    let messageId = "-";
    let rawJson = "";
    let quotationNo = "";
    let grandTotal = "";

    // ตรวจสอบว่าแถวนี้เป็นแถวจากโครงสร้างเก่า (15 คอลัมน์) ที่ยังไม่ได้เลื่อนคอลัมน์ Account หรือไม่
    const isShiftedFromOld = (
      row[2] === "Customer" || row[2] === "Agent" || row[2] === "Bot" || row[2] === "System" ||
      row[1] === "Chatcone" ||
      (row[1] !== "Sevenfive Distributor" && row[1] !== "SevenfiveOfficial" && (row[1] === "LINE OA" || row[1] === "Facebook Messenger" || row[1] === "Webchat"))
    );

    if (lastCol >= 16 && !isShiftedFromOld) {
      // ตารางเวอร์ชัน 16 คอลัมน์อยู่แล้ว
      account = row[1] || "";
      channel = row[2] || "";
      senderType = row[3] || "";
      senderName = row[4] || "";
      customerId = row[5] || "";
      messageType = row[6] || "";
      messageContent = String(row[7] || "");
      if (typeof row[8] === "number" || (typeof row[8] === "string" && /^\d+$/.test(row[8]))) {
        responseTimeSec = Number(row[8]);
      }
      responseTimeFormatted = row[9] || responseTimeFormatted;
      mediaUrl = row[10] || "";
      conversationId = row[11] || "-";
      messageId = row[12] || "-";
      rawJson = row[13] || "";
      quotationNo = row[14] || "";
      if (quotationNo && !isValidQuotationNo(quotationNo)) quotationNo = extractQuotationNo(quotationNo);
      grandTotal = row[15] !== "" ? Number(row[15]) : "";
    } else {
      // ตารางเวอร์ชันเก่า (11, 13 หรือ 15 คอลัมน์ หรือแถวที่เลื่อนเพราะไม่มีคอลัมน์ Account)
      channel = row[1] || "";
      senderType = row[2] || "";
      senderName = row[3] || "";
      customerId = row[4] || "";
      messageType = row[5] || "";
      messageContent = String(row[6] || "");

      if (lastCol <= 11) {
        mediaUrl = row[7] || "";
        conversationId = row[8] || "-";
        messageId = row[9] || "-";
        rawJson = row[10] || "";
      } else {
        if (typeof row[7] === "number" || (typeof row[7] === "string" && /^\d+$/.test(row[7]))) {
          responseTimeSec = Number(row[7]);
          responseTimeFormatted = row[8] || responseTimeFormatted;
          mediaUrl = row[9] || "";
          conversationId = row[10] || "-";
          messageId = row[11] || "-";
          rawJson = row[12] || "";
          if (lastCol >= 14) {
            quotationNo = row[13] || "";
            if (quotationNo && !isValidQuotationNo(quotationNo)) quotationNo = extractQuotationNo(quotationNo);
          }
          if (lastCol >= 15) grandTotal = row[14] !== "" ? Number(row[14]) : "";
        } else {
          mediaUrl = row[7] || "";
          conversationId = row[8] || "-";
          messageId = row[9] || "-";
          rawJson = row[10] || "";
        }
      }
    }

    // ดึงตัวเลขเวลาตอบจากข้อความเดิม เช่น [⏱️ ใช้เวลาตอบ: 209 วินาที] หากยังไม่มี
    if (responseTimeSec === "") {
      const match = messageContent.match(/\[.*?ใช้เวลาตอบ:\s*(\d+)\s*วินาที.*?\]/);
      if (match) {
        const sec = parseInt(match[1], 10);
        responseTimeSec = sec;
        if (sec < 60) {
          responseTimeFormatted = sec + " วินาที";
        } else if (sec < 3600) {
          const m = Math.floor(sec / 60);
          const s = sec % 60;
          responseTimeFormatted = m + " นาที " + s + " วินาที";
        } else {
          const h = Math.floor(sec / 3600);
          const m = Math.floor((sec % 3600) / 60);
          responseTimeFormatted = h + " ชม. " + m + " นาที";
        }
        messageContent = messageContent.replace(/\s*\[.*?ใช้เวลาตอบ.*?\]/g, "").trim();
      }
    }

    // 1. ดึงข้อมูลจาก Raw JSON Data และตัวบ่งชี้ต่างๆ เพื่อระบุบัญชีที่แท้จริง
    let detectedAccount = "";

    // ก) ตรวจสอบจาก Conversation ID / Customer ID ใน KNOWN_ACCOUNTS
    const convKey = String(conversationId || "").toLowerCase();
    const custKey = String(customerId || "").toLowerCase();
    if (KNOWN_ACCOUNTS[convKey]) {
      detectedAccount = KNOWN_ACCOUNTS[convKey];
    } else if (KNOWN_ACCOUNTS[custKey]) {
      detectedAccount = KNOWN_ACCOUNTS[custKey];
    }

    // ข) ตรวจสอบจากชื่อผู้ส่ง/ลูกค้า
    if (!detectedAccount) {
      const sName = String(senderName || "").toLowerCase().trim();
      for (let n = 0; n < DISTRIBUTOR_KNOWN_NAMES.length; n++) {
        if (sName.includes(DISTRIBUTOR_KNOWN_NAMES[n])) {
          detectedAccount = "Sevenfive Distributor";
          break;
        }
      }
    }

    // ค) ตรวจสอบจาก Raw JSON ด้วย Regex (ไม่ต้องพึ่งพา JSON.parse ที่อาจ error จากความยาวข้อความ)
    if (!detectedAccount && rawJson && typeof rawJson === "string") {
      if (/x0wteloe|68819f44dd184b85876ac383|6881b04f2d07422b089ec4c8|68819f44dd184bb7f86ac384|68844b588be8b73f96d987f3/i.test(rawJson)) {
        detectedAccount = "SevenfiveOfficial";
      } else if (/g6zvti0a|68819f3edd184b81dc6ac35e|6881c67ddd184b54a06b025c|68819f3edd184bf5276ac35f/i.test(rawJson)) {
        detectedAccount = "Sevenfive Distributor";
      }
    }

    // ง) พยายามแกะ JSON หากทำได้ เพื่อดึงใบเสนอราคาและยอดเงิน
    if (rawJson && typeof rawJson === "string") {
      try {
        const parsedRaw = JSON.parse(rawJson);
        let itemData = null;
        if (Array.isArray(parsedRaw)) {
          itemData = parsedRaw[0];
        } else if (parsedRaw.events && Array.isArray(parsedRaw.events)) {
          itemData = parsedRaw.events.find(function(ev) { return ev.grand_total || ev.quotation_no || (ev.message_id && String(ev.message_id) === String(messageId)); }) || parsedRaw.events[parsedRaw.events.length - 1];
        } else {
          itemData = parsedRaw;
        }

        if (itemData) {
          if (!detectedAccount) {
            const autoDetected = resolveAccountName(itemData, parsedRaw, null, "");
            if (autoDetected) detectedAccount = autoDetected;
          }
          if (!quotationNo && (itemData.quotation_no || itemData.quotationNo || itemData.doc_no)) {
            const rawQ = itemData.quotation_no || itemData.quotationNo || itemData.doc_no;
            quotationNo = isValidQuotationNo(rawQ) ? rawQ : extractQuotationNo(rawQ);
          }
          if (grandTotal === "" && (itemData.grand_total !== undefined || itemData.grandTotal !== undefined)) {
            const gt = itemData.grand_total !== undefined ? itemData.grand_total : itemData.grandTotal;
            if (gt !== null && gt !== "" && !isNaN(Number(gt))) grandTotal = Number(gt);
          }
        }
      } catch (jsonErr) {}
    }

    // กำหนดชื่อบัญชี: หากพบชัดเจนให้ใช้ detectedAccount ทันที (แก้ปัญหาแถวที่เคยถูกใส่ผิดเป็น Distributor)
    if (detectedAccount) {
      account = detectedAccount;
    } else if (!account || account === "Chatcone") {
      account = "Sevenfive Distributor";
    }

    // 2. ตรวจสอบไฟล์แนบ / Flex Message / ใบเสนอราคา จาก Raw JSON หรือข้อความเดิม
    if (rawJson && typeof rawJson === "string") {
      // ค้นหาชื่อไฟล์ PDF จาก rawJson (เช่น QT0926-00849.ฮอตพอตแมน ประเวศ.pdf)
      const pdfNameMatch = rawJson.match(/[\"']([^\"']*?\.pdf)[\"']/i) || rawJson.match(/(QT[\w-]+\.[^\"\s]+)/i);
      if (pdfNameMatch) {
        const foundPdf = pdfNameMatch[1];
        if (!messageContent || messageContent === "Send Files" || messageContent === "Send File" || messageContent.includes("flex") || messageContent === "text") {
          messageContent = foundPdf;
        }
        messageType = "file";
      }

      // ค้นหา URL ดาวน์โหลด S3 / Chatcone จาก rawJson (เน้นไฟล์ .pdf หรือ action uri)
      if (!mediaUrl) {
        const pdfUrlMatch = rawJson.match(/https:\/\/[^\"\s]+?\.pdf/i);
        const actionUriMatch = rawJson.match(/\"uri\"\s*:\s*\"(https:\/\/[^\"]+)\"/i);
        if (pdfUrlMatch) {
          mediaUrl = pdfUrlMatch[0].replace(/[\\\"']/g, "");
        } else if (actionUriMatch) {
          mediaUrl = actionUriMatch[1].replace(/[\\\"']/g, "");
        }
      }
    }

    // 3. ตรวจสอบว่าเป็นไฟล์ PDF หรือไม่
    const isRowPdf = messageType === "file" || messageType === "pdf" ||
      (messageContent && messageContent.toLowerCase().endsWith(".pdf")) ||
      (mediaUrl && mediaUrl.toLowerCase().includes(".pdf")) ||
      /QT\d+/i.test(messageContent || quotationNo);

    if (isRowPdf) {
      messageType = "file";
    }

    // 4. ดึง Quotation No. จากชื่อไฟล์ ข้อความ หรือ mediaUrl
    if (!quotationNo) {
      quotationNo = extractQuotationNo(messageContent) || extractQuotationNo(mediaUrl);
      if (!quotationNo && rawJson && typeof rawJson === "string") {
        quotationNo = extractQuotationNo(rawJson);
      }
    }

    // 5. หากยังไม่มียอดเงิน และมี URL ไฟล์ PDF จริง ให้รัน OCR ดึงยอดเงิน
    if (grandTotal === "" && mediaUrl && typeof mediaUrl === "string" && mediaUrl.startsWith("http")) {
      const isPdfUrl = mediaUrl.toLowerCase().includes(".pdf") || (messageContent && messageContent.toLowerCase().endsWith(".pdf")) || messageType === "file";
      if (isPdfUrl) {
        const ocrData = extractPdfQuotationData(mediaUrl, messageContent);
        if (!quotationNo && ocrData.quotationNo) quotationNo = ocrData.quotationNo;
        if (ocrData.grandTotal !== "") grandTotal = ocrData.grandTotal;
      }
    }

    // ตรวจสอบความถูกต้องรอบสุดท้าย หากไม่ใช่รูปแบบที่ถูกต้องให้เป็นค่าว่าง (ล้าง QTEC, QTDACCBDTCN8A ออก)
    if (!isValidQuotationNo(quotationNo)) {
      quotationNo = "";
    }

    newRows.push([
      timestamp,
      account,
      channel,
      senderType,
      senderName,
      customerId,
      messageType,
      messageContent,
      responseTimeSec,
      responseTimeFormatted,
      mediaUrl,
      conversationId,
      messageId,
      rawJson,
      quotationNo,
      grandTotal
    ]);
  }

  // ล้างชีตเดิมแล้วเขียนหัวตาราง 16 คอลัมน์ใหม่
  sheet.clear();
  initializeSheet(ss);

  let countDistributor = 0;
  let countOfficial = 0;

  if (newRows.length > 0) {
    sheet.getRange(2, 1, newRows.length, newRows[0].length).setValues(newRows);
    sheet.getRange(2, 1, newRows.length, 1).setNumberFormat("@");
    sheet.getRange(2, 16, newRows.length, 1).setNumberFormat("#,##0.00");

    for (let r = 0; r < newRows.length; r++) {
      if (newRows[r][1] === "SevenfiveOfficial") {
        countOfficial++;
      } else {
        countDistributor++;
      }
    }
  }

  Logger.log("✅ จัดระเบียบตาราง (16 คอลัมน์) เรียบร้อยแล้ว " + newRows.length + " แถว (Distributor: " + countDistributor + ", Official: " + countOfficial + ")");

  // 📝 บันทึกประวัติการ Sync ลงในชีต Sync_Logs
  recordSyncLog(
    "จัดระเบียบตาราง & อัปเดตบัญชี",
    "✅ สำเร็จ",
    newRows.length,
    countDistributor,
    countOfficial,
    "จัดระเบียบตาราง 16 คอลัมน์ กรอง 2 วันล่าสุด"
  );
}

/**
 * ฟังก์ชันสำหรับทดสอบจำลองข้อมูลแชทเข้า Google Sheet ทันที (มีตัวอย่างไฟล์ใบเสนอราคา PDF 39,000 บาท พร้อมระบุ Account)
 */
function testMockChatconeWebhook() {
  const mockPayload = {
    events: [
      {
        timestamp: new Date().toISOString(),
        company_id: "68819f3edd184b81dc6ac35e", // Sevenfive Distributor
        channel_id: "68819f3edd184bf5276ac35f", // LINE OA
        channel: "LINE OA",
        sender_type: "Customer",
        sender_name: "สมชาย ใจดี",
        customer_id: "U1234567890abcdef",
        message_type: "text",
        message: {
          text: "สวัสดีครับ ขอใบเสนอราคาแพ็กเกจระบบหน่อยครับ"
        },
        conversation_id: "conv_line_998877",
        message_id: "msg_001"
      },
      {
        timestamp: new Date().toISOString(),
        company_id: "68819f3edd184b81dc6ac35e", // Sevenfive Distributor
        channel_id: "68819f3edd184bf5276ac35f", // LINE OA
        channel: "LINE OA",
        sender_type: "Agent",
        sender_name: "LYN NIRADA",
        customer_id: "U1234567890abcdef",
        message_type: "file",
        file_name: "QT0926-01155.ลัคกี เจแปน.pdf",
        media_url: "https://portal.chatcone.com/storage/files/QT0926-01155.pdf",
        quotation_no: "QT0926-01155",
        grand_total: 39000.00,
        response_time: 209,
        message: {
          type: "file",
          text: "QT0926-01155.ลัคกี เจแปน.pdf"
        },
        conversation_id: "conv_line_998877",
        message_id: "msg_002"
      },
      {
        timestamp: new Date().toISOString(),
        company_id: "68819f44dd184b85876ac383", // SevenfiveOfficial
        channel_id: "68819f44dd184bb7f86ac384", // Facebook Messenger
        channel: "Facebook Messenger",
        sender_type: "Customer",
        sender_name: "John Doe (SevenfiveOfficial FB)",
        customer_id: "FB_987654321",
        message_type: "image",
        media_url: "https://example.com/slip_sample.jpg",
        message: {
          type: "image",
          text: "ส่งสลิปโอนเงินเรียบร้อยแล้วครับ (จาก SevenfiveOfficial)"
        },
        conversation_id: "conv_fb_112233",
        message_id: "msg_003"
      },
      {
        timestamp: new Date().toISOString(),
        company_id: "68819f44dd184b85876ac383", // SevenfiveOfficial
        channel_id: "6881b04f2d07422b089ec4c8", // LINE OA
        channel: "LINE OA",
        sender_type: "Customer",
        sender_name: "วิภาวัลย์ (SevenfiveOfficial LINE)",
        customer_id: "LINE_OFFICIAL_8877",
        message_type: "text",
        message: {
          text: "สอบถามสินค้าของ SevenfiveOfficial ค่ะ"
        },
        conversation_id: "conv_line_official_112",
        message_id: "msg_004"
      }
    ]
  };

  const fakeEvent = {
    postData: {
      contents: JSON.stringify(mockPayload)
    }
  };

  const response = doPost(fakeEvent);
  Logger.log(response.getContent());
}

/**
 * ฟังก์ชัน Helper สำหรับส่งคืนค่า JSON Response
 */
function createJsonResponse(data, statusCode) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
