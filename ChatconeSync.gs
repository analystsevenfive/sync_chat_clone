/**
 * =========================================================================
 * Chatcone (portal.chatcone.com) to Google Sheets Webhook Sync Script
 * =========================================================================
 * สคริปต์นี้ใช้สำหรับรับ Webhook จาก Chatcone และบันทึกประวัติแชทลง Google Sheets อัตโนมัติ
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

// กำหนด Timezone สำหรับเวลาในประเทศไทย
const TIMEZONE = "Asia/Bangkok";
const DATE_FORMAT = "yyyy-MM-dd HH:mm:ss";

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
    
    // หากมีคำสั่งรีเซ็ตชีตเพื่อจัดคอลัมน์ใหม่ทั้งหมด
    if (payload && payload.action === "reset_and_sync") {
      if (sheet) {
        sheet.clear();
      }
      sheet = initializeSheet(ss);
    } else if (!sheet) {
      sheet = initializeSheet(ss);
    } else {
      // ตรวจสอบว่าคอลัมน์หัวตารางเป็นเวอร์ชันล่าสุด 13 คอลัมน์หรือยัง
      const headers = getStandardHeaders();
      if (sheet.getLastColumn() < headers.length) {
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      }
    }

    // แปลงข้อมูลจาก Chatcone ให้อยู่ในโครงสร้างมาตรฐาน
    const parsedRows = parseChatconePayload(payload, rawContent);

    if (parsedRows && parsedRows.length > 0) {
      // ดึงข้อมูลแถวสุดท้ายเพื่อเพิ่มข้อมูล
      const lastRow = sheet.getLastRow();
      sheet.getRange(lastRow + 1, 1, parsedRows.length, parsedRows[0].length).setValues(parsedRows);
      
      // จัดรูปแบบชิดซ้าย/กลาง และฟอร์แมตตัวเลข
      sheet.getRange(lastRow + 1, 1, parsedRows.length, 1).setNumberFormat("@"); // Timestamp เป็น text หรือ date
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
    version: "1.0.0",
    server_time: Utilities.formatDate(new Date(), TIMEZONE, DATE_FORMAT),
    instructions: "This endpoint receives POST requests from Chatcone Webhook."
  }, 200);
}

/**
 * ฟังก์ชันแปลง Payload จาก Chatcone ให้อยู่ในโครงสร้าง Column ของ Google Sheets
 */
function parseChatconePayload(payload, rawContent) {
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

    // 2. Channel / Platform (LINE, Facebook, IG, Webchat)
    const channel = item.channel || item.platform || item.source || (item.channel_type ? item.channel_type : "Chatcone");

    // 3. Sender Type (Customer หรือ Agent / Bot)
    let senderType = "Customer";
    if (item.sender_type) {
      senderType = item.sender_type;
    } else if (item.is_agent || item.agent_id || item.sender === "agent" || item.type === "agent_message") {
      senderType = "Agent";
    } else if (item.is_bot || item.sender === "bot") {
      senderType = "Bot";
    }

    // 4. Sender Name (ชื่อผู้ส่ง / ชื่อลูกค้า / ชื่อแอดมิน)
    const senderName = item.sender_name || item.customer_name || item.name || item.user_name || (item.sender ? item.sender.name : "") || (senderType === "Agent" ? (item.agent_name || "Admin") : "Customer");

    // 5. User ID / Customer ID
    const userId = item.customer_id || item.user_id || item.sender_id || item.uid || (item.sender ? (item.sender.id || item.sender.uid) : "") || "-";

    // 6. Message Type (text, image, sticker, file, audio, video)
    let messageType = item.message_type || item.type || "text";
    if (item.message && item.message.type) {
      messageType = item.message.type;
    }

    // 7. Message Content (ข้อความ)
    let messageContent = "";
    if (typeof item.message === "string") {
      messageContent = item.message;
    } else if (item.message && typeof item.message.text === "string") {
      messageContent = item.message.text;
    } else if (item.text) {
      messageContent = item.text;
    } else if (item.content) {
      messageContent = typeof item.content === "string" ? item.content : JSON.stringify(item.content);
    } else if (messageType === "image") {
      messageContent = "[Image File]";
    } else if (messageType === "sticker") {
      messageContent = `[Sticker ${item.sticker_id || (item.message ? item.message.sticker_id : "") || ""}]`;
    } else if (messageType === "file") {
      messageContent = item.file_name || "[Attachment File]";
    } else {
      messageContent = JSON.stringify(item.message || item);
    }

    // 8. Response Time (เวลาที่แอดมินใช้ตอบ)
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

    // 9. Media / Attachment URL (ลิงก์รูป/ไฟล์)
    let mediaUrl = "";
    if (item.media_url || item.image_url || item.file_url || item.url) {
      mediaUrl = item.media_url || item.image_url || item.file_url || item.url;
    } else if (item.message && (item.message.url || item.message.image_url || item.message.file_url || item.message.media_url)) {
      mediaUrl = item.message.url || item.message.image_url || item.message.file_url || item.message.media_url;
    }

    // 10. Conversation ID / Room ID / Session ID
    const conversationId = item.conversation_id || item.room_id || item.chat_id || item.session_id || "-";

    // 11. Message ID (เพื่อป้องกันการซ้ำ)
    const messageId = item.message_id || item.msg_id || item.id || "-";

    // 12. Raw JSON (เก็บเป็น String ไม่เกิน 5000 ตัวอักษรเพื่อไม่ให้ตารางบวม)
    const rawJsonStr = (typeof rawContent === "string" ? rawContent : JSON.stringify(item)).substring(0, 5000);

    rows.push([
      timestamp,              // Col A: Timestamp
      channel,                // Col B: Channel
      senderType,             // Col C: Sender Type
      senderName,             // Col D: Sender Name
      String(userId),         // Col E: User / Customer ID
      messageType,            // Col F: Message Type
      messageContent,         // Col G: Message Content
      responseTimeSec,        // Col H: Response Time (วินาที)
      responseTimeFormatted,  // Col I: Response Time (อ่านง่าย)
      mediaUrl,               // Col J: Media URL
      conversationId,         // Col K: Conversation ID
      String(messageId),      // Col L: Message ID
      rawJsonStr              // Col M: Raw JSON
    ]);
  }

  return rows;
}

/**
 * หัวคอลัมน์มาตรฐาน
 */
function getStandardHeaders() {
  return [
    "Timestamp (วัน-เวลา)",
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
    "Raw JSON Data"
  ];
}

/**
 * สร้างชีตใหม่พร้อมจัดรูปแบบหัวตารางให้สวยงาม
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
  sheet.setColumnWidth(1, 160); // Timestamp
  sheet.setColumnWidth(2, 120); // Channel
  sheet.setColumnWidth(3, 110); // Sender Type
  sheet.setColumnWidth(4, 150); // Sender Name
  sheet.setColumnWidth(5, 140); // Customer ID
  sheet.setColumnWidth(6, 110); // Message Type
  sheet.setColumnWidth(7, 340); // Message Content
  sheet.setColumnWidth(8, 140); // Response Time (วินาที)
  sheet.setColumnWidth(9, 160); // Response Time (อ่านง่าย)
  sheet.setColumnWidth(10, 200); // Media URL
  sheet.setColumnWidth(11, 130); // Conversation ID
  sheet.setColumnWidth(12, 130); // Message ID
  sheet.setColumnWidth(13, 150); // Raw JSON

  // จัดกึ่งกลางสำหรับคอลัมน์ตัวเลข Response Time
  sheet.getRange("H:I").setHorizontalAlignment("center");

  // เปิดใช้ Text Wrap สำหรับ Message Content
  sheet.getRange("G:G").setWrap(true);

  return sheet;
}

/**
 * ฟังก์ชันสำหรับทดสอบสร้างตารางด้วยตัวเอง (Manual Run)
 */
function setupSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  initializeSheet(ss);
  SpreadsheetApp.getUi().alert("สร้างตาราง Chat_Logs และจัดรูปแบบเรียบร้อยแล้ว!");
}

/**
 * 🛠️ ฟังก์ชันจัดระเบียบตารางและย้ายเวลาตอบเข้า Column ถูกต้องอัตโนมัติทันที
 * (เลือกฟังก์ชันนี้ใน Dropdown แล้วกด 'เรียกใช้' (Run) ข้อมูลทุกแถวจะถูกจัดระเบียบทันที!)
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
    const channel = row[1];
    const senderType = row[2];
    const senderName = row[3];
    const customerId = row[4];
    const messageType = row[5];
    let messageContent = String(row[6] || "");

    let responseTimeSec = "";
    let responseTimeFormatted = "-";

    // ดึงตัวเลขเวลาตอบจากข้อความเดิม เช่น [⏱️ ใช้เวลาตอบ: 209 วินาที]
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
      // ลบข้อความวงเล็บออกจากเนื้อหาแชท ให้เหลือเฉพาะข้อความล้วนๆ
      messageContent = messageContent.replace(/\s*\[.*?ใช้เวลาตอบ.*?\]/g, "").trim();
    }

    let mediaUrl = "";
    let conversationId = "-";
    let messageId = "-";
    let rawJson = "";

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
      } else {
        mediaUrl = row[7] || "";
        conversationId = row[8] || "-";
        messageId = row[9] || "-";
        rawJson = row[10] || "";
      }
    }

    newRows.push([
      timestamp,
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
      rawJson
    ]);
  }

  // ล้างชีตเดิมแล้วเขียนหัวตาราง 13 คอลัมน์ใหม่
  sheet.clear();
  initializeSheet(ss);

  if (newRows.length > 0) {
    sheet.getRange(2, 1, newRows.length, newRows[0].length).setValues(newRows);
    sheet.getRange(2, 1, newRows.length, 1).setNumberFormat("@");
  }

  SpreadsheetApp.getUi().alert("จัดระเบียบตารางและย้ายเวลาตอบเข้า Column H และ I เรียบร้อยแล้ว " + newRows.length + " แถว!");
}

/**
 * ฟังก์ชันสำหรับทดสอบจำลองข้อมูลแชทเข้า Google Sheet ทันที (ไม่ต้องพึ่ง Chatcone)
 */
function testMockChatconeWebhook() {
  const mockPayload = {
    events: [
      {
        timestamp: new Date().toISOString(),
        channel: "LINE OA",
        sender_type: "Customer",
        sender_name: "สมชาย ใจดี",
        customer_id: "U1234567890abcdef",
        message_type: "text",
        message: {
          text: "สวัสดีครับ สนใจสอบถามรายละเอียดแพ็กเกจราคาครับ"
        },
        conversation_id: "conv_line_998877",
        message_id: "msg_001"
      },
      {
        timestamp: new Date().toISOString(),
        channel: "LINE OA",
        sender_type: "Agent",
        sender_name: "Admin แนน",
        customer_id: "U1234567890abcdef",
        message_type: "text",
        message: {
          text: "ยินดีต้อนรับค่ะคุณสมชาย ทางเรามีแพ็กเกจแนะนำดังนี้ค่ะ..."
        },
        conversation_id: "conv_line_998877",
        message_id: "msg_002"
      },
      {
        timestamp: new Date().toISOString(),
        channel: "Facebook Messenger",
        sender_type: "Customer",
        sender_name: "John Doe",
        customer_id: "FB_987654321",
        message_type: "image",
        media_url: "https://example.com/slip_sample.jpg",
        message: {
          type: "image",
          text: "ส่งสลิปโอนเงินเรียบร้อยแล้วครับ"
        },
        conversation_id: "conv_fb_112233",
        message_id: "msg_003"
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
