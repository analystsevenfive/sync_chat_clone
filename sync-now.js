const https = require('https');
const fs = require('fs');
const path = require('path');

const GOOGLE_WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbzH7Ip9zBoa58KgEGEjhwEK6rKfPezsiTUVguYPDVnF27RONxOGFRWK2zeExou6KyYFOg/exec';
const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiNjg4MWE1M2VjYjM3ODgwMGFiMGNjNzRkIiwiaWF0IjoxNzg5OTU0NjEyLCJleHAiOjE3OTAwNDEwMTJ9.rnmcOSAULbgQEw1WO5Psiw9fQoNrAEYUExShfNuPZ4I';
const AGENT_ID = '6881a53ecb378800ab0cc74d';

// รายการช่องทางทั้งหมดที่ต้องการดึง (LINE OA + Facebook Messenger)
const CHANNELS = [
  {
    name: 'LINE OA',
    company_id: '68819f44dd184b85876ac383',
    channel_id: '6881b04f2d07422b089ec4c8',
    channel_lists: JSON.stringify(["68819f44dd184bb7f86ac384","68844b588be8b73f96d987f3","6881b04f2d07422b089ec4c8"]),
    referer: 'https://portal.chatcone.com/x0Wteloe/chat'
  },
  {
    name: 'Facebook Messenger',
    company_id: '68819f3edd184b81dc6ac35e',
    channel_id: '6881c67ddd184b54a06b025c',
    channel_lists: JSON.stringify(["68819f3edd184bf5276ac35f","6881c67ddd184b54a06b025c"]),
    referer: 'https://portal.chatcone.com/G6zVti0a/chat'
  }
];

const SYNCED_IDS_FILE = path.join(__dirname, 'synced_messages.json');

function loadSyncedIds() {
  try {
    if (fs.existsSync(SYNCED_IDS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SYNCED_IDS_FILE, 'utf8'));
      return new Set(data);
    }
  } catch (e) {}
  return new Set();
}

function saveSyncedIds(set) {
  try {
    const arr = Array.from(set).slice(-10000);
    fs.writeFileSync(SYNCED_IDS_FILE, JSON.stringify(arr), 'utf8');
  } catch (e) {}
}

function chatconeRequest(channelConfig, reqPath, method, body) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'portal.chatcone.com',
      port: 443,
      path: reqPath,
      method: method,
      headers: {
        'accept': 'application/json, text/plain, */*',
        'authorization': `Bearer ${TOKEN}`,
        'agent_id': AGENT_ID,
        'channel_id': channelConfig.channel_id,
        'channel_lists': channelConfig.channel_lists,
        'company_id': channelConfig.company_id,
        'content-type': 'application/json;charset=UTF-8',
        'origin': 'https://portal.chatcone.com',
        'referer': channelConfig.referer,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
        'cookie': `auth.strategy=local; token=${TOKEN}; i18n_redirected=en`
      }
    };
    if (postData) {
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function postToGoogleSheets(events, action) {
  const postData = JSON.stringify({ action: action || 'sync', events: events });
  const res = await fetch(GOOGLE_WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8'
    },
    body: postData
  });
  const text = await res.text();
  return { status: res.status, data: text };
}

function formatThaiTime(timestamp) {
  try {
    const d = new Date(typeof timestamp === 'number' && timestamp < 10000000000 ? timestamp * 1000 : timestamp);
    if (!isNaN(d.getTime())) {
      const options = { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
      const parts = new Intl.DateTimeFormat('en-GB', options).formatToParts(d);
      const val = {};
      parts.forEach(p => val[p.type] = p.value);
      return `${val.year}-${val.month}-${val.day} ${val.hour}:${val.minute}:${val.second}`;
    }
  } catch (e) {}
  return String(timestamp);
}

async function run() {
  const isReset = process.argv.includes('--reset');
  if (isReset) {
    console.log('🔄 โหมดรีเซ็ตตาราง: กำลังล้างข้อมูลเก่าและจัดคอลัมน์ใหม่ทั้งหมด...');
  }
  const syncedIds = isReset ? new Set() : loadSyncedIds();

  const allNewEvents = [];

  for (const channel of CHANNELS) {
    console.log(`\n==================================================`);
    console.log(`📡 กำลังดึงข้อมูลจากช่องทาง: 【 ${channel.name} 】`);
    console.log(`==================================================`);

    const followersRes = await chatconeRequest(
      channel,
      '/api/chat/followers?skip=0&limit=15&sort=desc&chat_type=all&assignee_id=all',
      'GET'
    );

    const chatData = followersRes.data && followersRes.data.response && followersRes.data.response.chat;
    const followers = chatData && Array.isArray(chatData.data) ? chatData.data : [];

    if (!followers || followers.length === 0) {
      console.log(`⚠️ ไม่พบรายการแชทในช่องทาง ${channel.name}`);
      continue;
    }

    console.log(`💬 ตรวจพบ ${followers.length} ห้องสนทนาล่าสุด\n`);

    for (const follower of followers) {
      const p = follower.profile || {};
      const customerName = p.facebook_name || p.line_name || p.name || 'Customer';
      const customerId = follower.social_id || follower._id;

      const messagesRes = await chatconeRequest(channel, '/api/chat/messages', 'POST', {
        follower_id: follower._id,
        skip: 0,
        limit: 20,
        hide: false
      });

      const msgs = messagesRes.data && messagesRes.data.response && (
        Array.isArray(messagesRes.data.response.data) 
          ? messagesRes.data.response.data 
          : (Array.isArray(messagesRes.data.response) ? messagesRes.data.response : [])
      );

      if (msgs && msgs.length > 0) {
        // Sort oldest to newest
        msgs.reverse();

        let newCount = 0;
        for (const m of msgs) {
          const msgId = String(m._id || m.temp_id || '');
          if (msgId && syncedIds.has(msgId)) {
            continue; // ข้ามข้อความที่เคยซิงค์แล้ว
          }

          let senderType = 'Customer';
          if (m.from_type === 'user') {
            senderType = 'Agent';
          } else if (m.from_type === 'bot') {
            senderType = 'Bot';
          } else if (m.from_type === 'webhook') {
            senderType = 'System';
          }

          let senderName = customerName;
          if (senderType === 'Agent' && m.user_info) {
            senderName = `${m.user_info.firstname || ''} ${m.user_info.lastname || ''}`.trim() || 'Admin';
          } else if (senderType === 'Bot') {
            senderName = 'Chatbot';
          }

          let text = '';
          let mediaUrl = '';
          let msgType = m.type || 'text';

          if (m.messages_sent && m.messages_sent.length > 0) {
            const sent = m.messages_sent[0];
            text = sent.text || sent.message || '';
            msgType = sent.type || msgType;
            if (sent.image || sent.url || sent.media_url) {
              mediaUrl = sent.image || sent.url || sent.media_url;
            }
          }
          if (!text && m.message_title) {
            text = m.message_title;
          }

          let rawTime = m.timestamp;
          if (m.sending && (m.sending.sent_at || m.sending.send_at)) {
            rawTime = m.sending.sent_at || m.sending.send_at;
          }
          const timeFormatted = formatThaiTime(rawTime);

          // Response time (แยกฟิลด์ต่างหาก ไม่ปนในข้อความ)
          const responseTime = (senderType === 'Agent' && m.response_time !== undefined && m.response_time !== null) ? m.response_time : null;

          allNewEvents.push({
            timestamp: timeFormatted,
            channel: channel.name,
            sender_type: senderType,
            sender_name: senderName,
            customer_id: customerId,
            message_type: msgType,
            message: text,
            response_time: responseTime,
            media_url: mediaUrl,
            conversation_id: follower._id,
            message_id: msgId
          });

          if (msgId) {
            syncedIds.add(msgId);
          }
          newCount++;
        }

        console.log(`- [${channel.name}] ${customerName}: ดึงข้อความใหม่ ${newCount} ข้อความ`);
      }
    }
  }

  if (allNewEvents.length > 0) {
    console.log(`\n==================================================`);
    console.log(`📤 กำลังบันทึกข้อความใหม่ทั้งหมด ${allNewEvents.length} ข้อความลง Google Sheets...`);
    const res = await postToGoogleSheets(allNewEvents, isReset ? 'reset_and_sync' : 'sync');
    saveSyncedIds(syncedIds);
    console.log('✅ บันทึกสำเร็จเรียบร้อย! ผลตอบกลับ:', res.data);
  } else {
    console.log('\n✨ ข้อมูลทุกช่องทางเป็นปัจจุบันแล้ว ไม่มีข้อความใหม่ที่ต้องซิงค์');
  }
}

run().catch(console.error);
