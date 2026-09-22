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

// กำหนด Timezone สำหรับเวลาในประเทศไทย
const TIMEZONE = "Asia/Bangkok";
const DATE_FORMAT = "yyyy-MM-dd HH:mm:ss";

// กรองเฉพาะข้อความย้อนหลัง 1 วัน รวมวันนี้ = 2 วันล่าสุด (0 = เอาทั้งหมดไม่กรอง)
const FILTER_LAST_DAYS = 2;

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

    // หากมีคำสั่งรีเซ็ตชีตเพื่อจัดคอลัมน์ใหม่ทั้งหมด
    if (payload && payload.action === "reset_and_sync") {
      if (sheet) {
        sheet.clear();
      }
      sheet = initializeSheet(ss);
    } else if (!sheet) {
      sheet = initializeSheet(ss);
    } else {
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

    // แปลงข้อมูลจาก Chatcone ให้อยู่ในโครงสร้างมาตรฐาน
    const parsedRows = parseChatconePayload(payload, rawContent);

    if (parsedRows && parsedRows.length > 0) {
      // ดึงข้อมูลแถวสุดท้ายเพื่อเพิ่มข้อมูล
      const lastRow = sheet.getLastRow();
      sheet.getRange(lastRow + 1, 1, parsedRows.length, parsedRows[0].length).setValues(parsedRows);
      
      // จัดรูปแบบชิดซ้าย/กลาง และฟอร์แมตตัวเลข
      sheet.getRange(lastRow + 1, 1, parsedRows.length, 1).setNumberFormat("@"); // Timestamp เป็น text หรือ date
      if (parsedRows[0].length >= 16) {
        sheet.getRange(lastRow + 1, 16, parsedRows.length, 1).setNumberFormat("#,##0.00"); // Grand Total เป็นตัวเลขเงิน
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
    version: "1.1.0",
    features: ["chat_logging", "response_time_tracking", "pdf_quotation_ocr"],
    server_time: Utilities.formatDate(new Date(), TIMEZONE, DATE_FORMAT),
    instructions: "This endpoint receives POST requests from Chatcone Webhook."
  }, 200);
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
  const nameDocMatch = nameToCheck.match(/(?:QT|QUO|INV)[\w-]+/i);
  if (nameDocMatch) {
    result.quotationNo = nameDocMatch[0].toUpperCase();
  }

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

    // 3. ใช้ Google Drive REST API แปลง PDF เป็น Google Doc ชั่วคราวด้วย OCR
    const metadata = {
      title: "temp_ocr_" + new Date().getTime(),
      mimeType: "application/vnd.google-apps.document"
    };

    const boundary = "-------chatconeOcrBoundary" + new Date().getTime();
    const delimiter = "\r\n--" + boundary + "\r\n";
    const closeDelimiter = "\r\n--" + boundary + "--";

    const requestBody =
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter +
      'Content-Type: ' + (blob.getContentType() || 'application/pdf') + '\r\n' +
      'Content-Transfer-Encoding: base64\r\n\r\n' +
      Utilities.base64Encode(blob.getBytes()) +
      closeDelimiter;

    let docId = null;

    // ลองใช้ Drive Advanced Service ก่อนหากเปิดใช้งานไว้
    if (typeof Drive !== "undefined" && Drive.Files && Drive.Files.insert) {
      try {
        const fileObj = Drive.Files.insert(metadata, blob, { ocr: true, ocrLanguage: "th" });
        if (fileObj && fileObj.id) {
          docId = fileObj.id;
        }
      } catch (driveErr) {
        console.warn("Drive.Files.insert fallback:", driveErr);
      }
    }

    // หากยังไม่ได้ docId ให้ใช้ REST API
    if (!docId) {
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
      } else {
        console.error("OCR API error:", uploadRes.getResponseCode(), uploadRes.getContentText());
      }
    }

    if (docId) {
      const doc = DocumentApp.openById(docId);
      const text = doc.getBody().getText();

      // 4. ดึงเลขที่เอกสารจากเนื้อหาเพิ่มเติมหากในชื่อไฟล์ไม่มี
      if (!result.quotationNo) {
        const docMatch = text.match(/(?:QT|QUO|INV)[\w-]+/i);
        if (docMatch) {
          result.quotationNo = docMatch[0].toUpperCase();
        }
      }

      // 5. สกัดยอดเงิน Grand Total (เช่น GRAND TOTAL 39,000.00 หรือ ยอดรวมทั้งสิ้น 39,000.00)
      const regex = /(?:GRAND\s*TOTAL|TOTAL|ยอดรวมทั้งสิ้น|รวมทั้งสิ้น|จำนวนเงินทั้งสิ้น|ยอดรวมสุทธิ)[\s\S]{0,35}?([\d]{1,3}(?:,\d{3})*(?:\.\d{2})|\d+\.\d{2})/i;
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

    // กรองเฉพาะข้อความย้อนหลัง 1 วัน รวมวันนี้ = 2 วันล่าสุด
    if (FILTER_LAST_DAYS > 0 && !isWithinSyncWindow(item.timestamp || item.created_at || item.datetime || item.time || timestamp)) {
      continue;
    }

    // 2. Account (ชื่อบัญชี / ร้านค้า เช่น Sevenfive Distributor, SevenfiveOfficial)
    const account = item.account || item.account_name || item.company_name || item.company || (item.channel && item.channel.account) || "Sevenfive Distributor";

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

    // 7. Message Type (text, image, sticker, file, audio, video)
    let messageType = item.message_type || item.type || "text";
    if (item.message && item.message.type) {
      messageType = item.message.type;
    }

    // ชื่อไฟล์แนบ (ถ้ามี)
    const attachedFileName = item.file_name || item.fileName || (item.message && (item.message.file_name || item.message.fileName)) || "";

    // 8. Message Content (ข้อความ)
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
    } else if (messageType === "file" || messageType === "pdf") {
      messageContent = attachedFileName || item.title || "[Attachment File]";
    } else {
      messageContent = JSON.stringify(item.message || item);
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
    let mediaUrl = "";
    if (item.media_url || item.image_url || item.file_url || item.file || item.download_url || item.url) {
      mediaUrl = item.media_url || item.image_url || item.file_url || item.file || item.download_url || item.url;
    } else if (item.message && (item.message.url || item.message.image_url || item.message.file_url || item.message.file || item.message.download_url || item.message.media_url)) {
      mediaUrl = item.message.url || item.message.image_url || item.message.file_url || item.message.file || item.message.download_url || item.message.media_url;
    }

    // 12. Conversation ID / Room ID / Session ID
    const conversationId = item.conversation_id || item.room_id || item.chat_id || item.session_id || "-";

    // 13. Message ID (เพื่อป้องกันการซ้ำ)
    const messageId = item.message_id || item.msg_id || item.id || "-";

    // 14. Raw JSON (เก็บเป็น String ไม่เกิน 5000 ตัวอักษรเพื่อไม่ให้ตารางบวม)
    const rawJsonStr = (typeof rawContent === "string" ? rawContent : JSON.stringify(item)).substring(0, 5000);

    // 15 & 16. Quotation No. และ Grand Total (ยอดรวมใบเสนอราคา)
    let quotationNo = item.quotation_no || item.quotationNo || item.doc_no || "";
    let grandTotal = (item.grand_total !== undefined && item.grand_total !== null && item.grand_total !== "")
      ? Number(item.grand_total)
      : (item.grandTotal !== undefined && item.grandTotal !== null && item.grandTotal !== "" ? Number(item.grandTotal) : "");

    // ตรวจสอบว่าเป็นไฟล์ PDF หรือใบเสนอราคาหรือไม่
    const isPdf = messageType === "file" || messageType === "pdf" ||
      (attachedFileName && attachedFileName.toLowerCase().endsWith(".pdf")) ||
      (messageContent && messageContent.toLowerCase().endsWith(".pdf")) ||
      (mediaUrl && mediaUrl.toLowerCase().includes(".pdf"));

    if (isPdf) {
      if (messageType === "text" || !messageType) {
        messageType = "file";
      }
      // สกัดเลขที่เอกสารเบื้องต้นจากชื่อไฟล์หรือข้อความ
      if (!quotationNo) {
        const qMatch = (attachedFileName || messageContent || "").match(/(?:QT|QUO|INV)[\w-]+/i);
        if (qMatch) {
          quotationNo = qMatch[0].toUpperCase();
        }
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
 * ฟังก์ชันสำหรับทดสอบสร้างตารางด้วยตัวเอง (Manual Run)
 */
function setupSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  initializeSheet(ss);
  SpreadsheetApp.getUi().alert("สร้างตาราง Chat_Logs (16 คอลัมน์ รองรับ 2 บัญชี) และจัดรูปแบบเรียบร้อยแล้ว!");
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

    // กรองเฉพาะข้อความย้อนหลัง 1 วัน รวมวันนี้ = 2 วันล่าสุด
    if (FILTER_LAST_DAYS > 0 && !isWithinSyncWindow(timestamp)) {
      continue;
    }

    let account = "Sevenfive Distributor";
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

    if (lastCol >= 16) {
      // ตารางเวอร์ชัน 16 คอลัมน์อยู่แล้ว
      account = row[1] || "Sevenfive Distributor";
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
      grandTotal = row[15] !== "" ? Number(row[15]) : "";
    } else {
      // ตารางเวอร์ชันเก่า (11, 13 หรือ 15 คอลัมน์ที่ยังไม่มีคอลัมน์ Account)
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
          if (lastCol >= 14) quotationNo = row[13] || "";
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

    // 1. ดึงข้อมูลจาก Raw JSON Data หากมีระบุไว้
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
          if (itemData.account || itemData.account_name || itemData.company_name || itemData.company) {
            account = itemData.account || itemData.account_name || itemData.company_name || itemData.company;
          }
          if (!quotationNo && (itemData.quotation_no || itemData.quotationNo || itemData.doc_no)) {
            quotationNo = itemData.quotation_no || itemData.quotationNo || itemData.doc_no;
          }
          if (grandTotal === "" && (itemData.grand_total !== undefined || itemData.grandTotal !== undefined)) {
            const gt = itemData.grand_total !== undefined ? itemData.grand_total : itemData.grandTotal;
            if (gt !== null && gt !== "" && !isNaN(Number(gt))) grandTotal = Number(gt);
          }
        }
      } catch (jsonErr) {}
    }

    // 2. ดึง Quotation No. จากชื่อไฟล์หากยังไม่มี
    if (!quotationNo) {
      const qm = (messageContent || mediaUrl).match(/(?:QT|QUO|INV)[\w-]+/i);
      if (qm) quotationNo = qm[0].toUpperCase();
    }

    // 3. หากยังไม่มียอดเงิน และมี URL ไฟล์ PDF จริง ให้ลองทำ OCR ดึงยอดเงิน
    if (grandTotal === "" && mediaUrl && typeof mediaUrl === "string" && mediaUrl.startsWith("http")) {
      const isPdfUrl = mediaUrl.toLowerCase().includes(".pdf") || messageContent.toLowerCase().endsWith(".pdf") || messageType === "file";
      if (isPdfUrl) {
        const ocrData = extractPdfQuotationData(mediaUrl, messageContent);
        if (!quotationNo && ocrData.quotationNo) quotationNo = ocrData.quotationNo;
        if (ocrData.grandTotal !== "") grandTotal = ocrData.grandTotal;
      }
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

  if (newRows.length > 0) {
    sheet.getRange(2, 1, newRows.length, newRows[0].length).setValues(newRows);
    sheet.getRange(2, 1, newRows.length, 1).setNumberFormat("@");
    sheet.getRange(2, 16, newRows.length, 1).setNumberFormat("#,##0.00");
  }

  const startThai = Utilities.formatDate(getSyncStartDate(), TIMEZONE, "yyyy-MM-dd HH:mm");
  SpreadsheetApp.getUi().alert("จัดระเบียบตาราง (16 คอลัมน์ รองรับ 2 บัญชี) และกรองเฉพาะ 2 วันล่าสุด (ตั้งแต่เมื่อวาน " + startThai + " เป็นต้นมา) เรียบร้อยแล้ว " + newRows.length + " แถว!");
}

/**
 * ฟังก์ชันสำหรับทดสอบจำลองข้อมูลแชทเข้า Google Sheet ทันที (มีตัวอย่างไฟล์ใบเสนอราคา PDF 39,000 บาท พร้อมระบุ Account)
 */
function testMockChatconeWebhook() {
  const mockPayload = {
    events: [
      {
        timestamp: new Date().toISOString(),
        account: "Sevenfive Distributor",
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
        account: "Sevenfive Distributor",
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
        account: "SevenfiveOfficial",
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
