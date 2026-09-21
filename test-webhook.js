/**
 * Chatcone Webhook Node.js Test Script
 * รันด้วยคำสั่ง: node test-webhook.js <WEBHOOK_URL>
 */

const https = require('https');
const http = require('http');

const WEBHOOK_URL = process.argv[2] || process.env.WEBHOOK_URL;

if (!WEBHOOK_URL) {
  console.log('\n======================================================');
  console.log('📌 Chatcone Webhook Test Script');
  console.log('======================================================');
  console.log('วิธีใช้:');
  console.log('  node test-webhook.js <YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL>\n');
  console.log('ตัวอย่าง:');
  console.log('  node test-webhook.js https://script.google.com/macros/s/AKfycb.../exec\n');
  process.exit(1);
}

const samplePayload = {
  events: [
    {
      timestamp: new Date().toISOString(),
      channel: "LINE OA",
      sender_type: "Customer",
      sender_name: "สมชาย ทดสอบระบบ",
      customer_id: "U998877665544",
      message_type: "text",
      message: {
        text: "สวัสดีครับ ทดสอบส่งข้อความจาก Chatcone Webhook Sync"
      },
      conversation_id: "conv_test_12345",
      message_id: "msg_cli_" + Date.now()
    },
    {
      timestamp: new Date().toISOString(),
      channel: "LINE OA",
      sender_type: "Agent",
      sender_name: "Admin แนน",
      customer_id: "U998877665544",
      message_type: "text",
      message: {
        text: "ยินดีต้อนรับค่ะ ได้รับข้อความเรียบร้อยแล้วนะคะ"
      },
      conversation_id: "conv_test_12345",
      message_id: "msg_cli_" + (Date.now() + 1)
    }
  ]
};

const payloadString = JSON.stringify(samplePayload);

console.log(`\n⏳ กำลังส่งข้อมูลทดสอบไปยัง:\n${WEBHOOK_URL} ...\n`);

const urlObj = new URL(WEBHOOK_URL);
const client = urlObj.protocol === 'https:' ? https : http;

const options = {
  hostname: urlObj.hostname,
  path: urlObj.pathname + urlObj.search,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payloadString)
  }
};

const req = client.request(options, (res) => {
  let data = '';

  // กรณี Google Apps Script ส่ง Redirect 302
  if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
    console.log(`↪️ Redirected to: ${res.headers.location}`);
    https.get(res.headers.location, (redRes) => {
      let redData = '';
      redRes.on('data', chunk => redData += chunk);
      redRes.on('end', () => {
        console.log('✅ ผลลัพธ์:', redData);
        console.log('👉 ตรวจสอบใน Google Sheet ของคุณได้ทันที!');
      });
    });
    return;
  }

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log(`Status Code: ${res.statusCode}`);
    console.log('Response Body:', data);
    console.log('👉 ตรวจสอบใน Google Sheet ของคุณได้ทันที!');
  });
});

req.on('error', (e) => {
  console.error(`❌ เกิดข้อผิดพลาด: ${e.message}`);
});

req.write(payloadString);
req.end();
