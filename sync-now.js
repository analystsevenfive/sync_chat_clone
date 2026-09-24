const https = require('https');
const fs = require('fs');
const path = require('path');

const GOOGLE_WEBHOOK_URL = process.env.GOOGLE_WEBHOOK_URL || 'https://script.google.com/macros/s/AKfycbzH7Ip9zBoa58KgEGEjhwEK6rKfPezsiTUVguYPDVnF27RONxOGFRWK2zeExou6KyYFOg/exec';
const TOKEN = process.env.CHATCONE_TOKEN || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiNjg4MWE1M2VjYjM3ODgwMGFiMGNjNzRkIiwiaWF0IjoxNzkwMDg4NzkxLCJleHAiOjE3OTAxNzUxOTF9._ouiRgvu9tG6wZ9wPRgCZTldgyPdreBejtTKtsHeJyU';
const AGENT_ID = process.env.CHATCONE_AGENT_ID || '6881a53ecb378800ab0cc74d';

// รายชื่อ 2 บัญชีของ Chatcone (Sevenfive Distributor และ SevenfiveOfficial)
const ACCOUNTS = [
  {
    name: 'Sevenfive Distributor',
    company_id: '68819f44dd184b85876ac383',
    slug: 'x0Wteloe',
    referer: 'https://portal.chatcone.com/x0Wteloe/chat',
    channel_lists: JSON.stringify(["68819f44dd184bb7f86ac384","68844b588be8b73f96d987f3","6881b04f2d07422b089ec4c8"]),
    channels: [
      { id: '6881b04f2d07422b089ec4c8', name: 'LINE OA' },
      { id: '68819f44dd184bb7f86ac384', name: 'Facebook Messenger' },
      { id: '68844b588be8b73f96d987f3', name: 'Webchat / Other' }
    ]
  },
  {
    name: 'SevenfiveOfficial',
    company_id: '68819f3edd184b81dc6ac35e',
    slug: 'G6zVti0a',
    referer: 'https://portal.chatcone.com/G6zVti0a/chat',
    channel_lists: JSON.stringify(["68819f3edd184bf5276ac35f","6881c67ddd184b54a06b025c"]),
    channels: [
      { id: '6881c67ddd184b54a06b025c', name: 'Facebook Messenger' },
      { id: '68819f3edd184bf5276ac35f', name: 'LINE OA' }
    ]
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

function chatconeRequest(accountConfig, channelId, reqPath, method, body) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : null;
    const effectiveChannelId = channelId || (accountConfig.channels && accountConfig.channels[0] ? accountConfig.channels[0].id : '');
    const options = {
      hostname: 'portal.chatcone.com',
      port: 443,
      path: reqPath,
      method: method,
      headers: {
        'accept': 'application/json, text/plain, */*',
        'authorization': `Bearer ${TOKEN}`,
        'agent_id': AGENT_ID,
        'channel_id': effectiveChannelId,
        'channel_lists': accountConfig.channel_lists,
        'company_id': accountConfig.company_id,
        'content-type': 'application/json;charset=UTF-8',
        'origin': 'https://portal.chatcone.com',
        'referer': accountConfig.referer,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
        'cookie': `auth.strategy=local; token=${TOKEN}; i18n_redirected=en`
      }
    };
    if (postData) {
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    options.timeout = 10000;

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
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 408, error: 'Request timeout' });
    });
    req.on('error', (e) => {
      resolve({ status: 500, error: e.message });
    });
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

// กำหนดจำนวนวันย้อนหลัง: 2 วันล่าสุด (เมื่อวานและวันนี้)
const customDaysArg = process.argv.find(arg => arg.startsWith('--days='));
const SYNC_DAYS = customDaysArg ? parseInt(customDaysArg.split('=')[1], 10) : 2;

function getSyncStartDate() {
  const now = new Date();
  const options = { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' };
  const parts = new Intl.DateTimeFormat('en-CA', options).formatToParts(now);
  const val = {};
  parts.forEach(p => val[p.type] = p.value);
  const todayMidnightBkk = new Date(`${val.year}-${val.month}-${val.day}T00:00:00+07:00`);
  const startDate = new Date(todayMidnightBkk.getTime() - (SYNC_DAYS - 1) * 24 * 60 * 60 * 1000);
  return startDate;
}

function isWithinSyncWindow(timestamp) {
  if (!timestamp) return true;
  try {
    const d = new Date(typeof timestamp === 'number' && timestamp < 10000000000 ? timestamp * 1000 : timestamp);
    if (isNaN(d.getTime())) return true;
    return d.getTime() >= getSyncStartDate().getTime();
  } catch (e) {
    return true;
  }
}

function getFollowerLastAct(follower) {
  if (!follower) return null;
  if (follower.last_livechat) {
    const lc = follower.last_livechat;
    if (lc.last_chat_message && lc.last_chat_message.timestamp) {
      return lc.last_chat_message.timestamp;
    }
    if (lc.updated_at) return lc.updated_at;
    if (lc.switch_mode_at) return lc.switch_mode_at;
  }
  if (follower.last_message) {
    return follower.last_message.timestamp || follower.last_message.sent_at || follower.last_message.created_at;
  }
  return follower.updated_at || null;
}

/**
 * ฟังก์ชันตรวจสอบและดึงเลขที่ใบเสนอราคา (Quotation No.) ให้ถูกต้องตามรูปแบบ
 * ป้องกันคำที่ไม่ใช่เลขที่เอกสาร เช่น QTEC, QTDACCBDTCN8A, QUOTATION, INVOICE ฯลฯ
 * รูปแบบมาตรฐาน Sevenfive เช่น QT0926-01181, QT0826-00767, QT0926-01155
 */
function extractQuotationNo(text) {
  if (!text || typeof text !== 'string') return '';
  const match = text.match(/(?:QT|QUO|INV)[-_]?(?:\d{3,6}[-_/]\d{2,6}|\d{5,10})(?:[-_]?(?:REV|R)?\d+)?(?![a-zA-Z\d])/i);
  return match ? match[0].toUpperCase() : '';
}

/**
 * ตรวจสอบว่าสตริงเป็นเลขที่ใบเสนอราคาที่ถูกต้องสมบูรณ์หรือไม่
 */
function isValidQuotationNo(val) {
  if (!val || typeof val !== 'string') return false;
  return /^(?:QT|QUO|INV)[-_]?(?:\d{3,6}[-_/]\d{2,6}|\d{5,10})(?:[-_]?(?:REV|R)?\d+)?$/i.test(val.trim());
}

async function run() {
  const isReset = process.argv.includes('--reset');
  let syncedIds = new Set();

  if (isReset) {
    console.log('🔄 โหมดรีเซ็ตตาราง: กำลังล้างข้อมูลเก่าและดึงข้อมูล 2 วันล่าสุดใหม่ทั้งหมด...');
    saveSyncedIds(new Set());
  } else {
    // ตรวจสอบ Message ID ที่มีอยู่ใน Google Sheets แล้วเพื่อไม่ให้บันทึกซ้ำ
    console.log('🔍 กำลังตรวจสอบข้อความที่มีอยู่ใน Google Sheets...');
    try {
      const checkRes = await postToGoogleSheets([], 'get_existing_ids');
      if (checkRes && checkRes.data) {
        const parsed = typeof checkRes.data === 'string' ? JSON.parse(checkRes.data) : checkRes.data;
        if (parsed.status === 'success' && Array.isArray(parsed.ids)) {
          syncedIds = new Set(parsed.ids);
          console.log(`📋 พบข้อความเดิมใน Google Sheets แล้ว ${syncedIds.size} ข้อความ`);
        }
      }
    } catch (e) {
      console.log('⚠️ ไม่สามารถดึง ID จาก Google Sheets ได้ จะใช้ Local Cache แทน');
      syncedIds = loadSyncedIds();
    }
  }

  const allNewEvents = [];
  const syncStartTime = getSyncStartDate();

  for (const account of ACCOUNTS) {
    console.log(`\n===============================================================`);
    console.log(`🏢 กำลังดึงข้อมูลจากบัญชี: 【 ${account.name} 】 (Slug: ${account.slug})`);
    console.log(`📅 ดึงย้อนหลัง 1 วัน รวมวันนี้: ตั้งแต่ ${formatThaiTime(syncStartTime)} เป็นต้นมา`);
    console.log(`===============================================================`);

    for (const channel of account.channels) {
      console.log(`\n📡 กำลังตรวจสอบช่องทาง: 【 ${channel.name} 】 (ID: ${channel.id})`);

      let allFollowers = [];
      let skipFollowers = 0;
      const limitFollowers = 50;

      // ดึงห้องสนทนาทั้งหมดแบบ Pagination
      while (skipFollowers < 500) {
        const followersRes = await chatconeRequest(
          account,
          channel.id,
          `/api/chat/followers?skip=${skipFollowers}&limit=${limitFollowers}&sort=desc&chat_type=all&assignee_id=all`,
          'GET'
        );

        if (followersRes.status === 401) {
          console.error(`\n❌ Token ของ Chatcone หมดอายุแล้ว (401 Unauthorized)!`);
          console.error(`👉 กรุณาเปิด portal.chatcone.com > F12 > Network แล้วคัดลอก Bearer Token ใหม่มาวางที่ตัวแปร TOKEN ใน sync-now.js`);
          process.exit(1);
        }

        const chatData = followersRes.data && followersRes.data.response && followersRes.data.response.chat;
        const batch = chatData && Array.isArray(chatData.data) ? chatData.data : [];

        if (!batch || batch.length === 0) {
          break;
        }

        allFollowers = allFollowers.concat(batch);

        // ตรวจสอบว่ามีห้องไหนในหน้านี้ที่มีการคุยอยู่ในช่วง 2 วันล่าสุดบ้าง
        const anyRecent = batch.some(item => {
          const act = getFollowerLastAct(item);
          return !act || isWithinSyncWindow(act);
        });

        if (!anyRecent) {
          break; // ถ้าทุกห้องในหน้านี้เก่ากว่า 2 วันทั้งหมด แสดงว่าพ้นช่วง 2 วันแล้ว
        }

        if (batch.length < limitFollowers) {
          break;
        }
        skipFollowers += limitFollowers;
      }

      if (allFollowers.length === 0) {
        console.log(`   ℹ️ ไม่พบรายการแชทในช่องทาง ${channel.name}`);
        continue;
      }

      console.log(`   💬 ตรวจพบทั้งหมด ${allFollowers.length} ห้องสนทนาในช่วง 2 วันนี้`);

      for (const follower of allFollowers) {
        const p = follower.profile || {};
        const customerName = p.facebook_name || p.line_name || p.name || 'Customer';
        const customerId = follower.social_id || follower._id;

        // ถ้าห้องนี้ไม่มีการคุยใน 2 วันล่าสุดเลย สามารถข้ามได้ทันที
        const lastAct = getFollowerLastAct(follower);
        if (lastAct && !isWithinSyncWindow(lastAct)) {
          continue;
        }

        let followerMsgs = [];
        let skipMsgs = 0;
        const limitMsgs = 50;

        // ดึงข้อความในห้องนี้ด้วย Pagination จนครบ 2 วัน
        while (skipMsgs < 300) {
          const messagesRes = await chatconeRequest(account, channel.id, '/api/chat/messages', 'POST', {
            follower_id: follower._id,
            skip: skipMsgs,
            limit: limitMsgs,
            hide: false
          });

          const msgs = messagesRes.data && messagesRes.data.response && (
            Array.isArray(messagesRes.data.response.data) 
              ? messagesRes.data.response.data 
              : (Array.isArray(messagesRes.data.response) ? messagesRes.data.response : [])
          );

          if (!msgs || msgs.length === 0) {
            break;
          }

          let reachedOld = false;
          for (const m of msgs) {
            let rawTime = m.timestamp;
            if (m.sending && (m.sending.sent_at || m.sending.send_at)) {
              rawTime = m.sending.sent_at || m.sending.send_at;
            }

            if (isWithinSyncWindow(rawTime)) {
              followerMsgs.push(m);
            } else {
              reachedOld = true;
            }
          }

          if (reachedOld || msgs.length < limitMsgs) {
            break;
          }
          skipMsgs += limitMsgs;
        }

        if (followerMsgs.length > 0) {
          // Sort oldest to newest
          followerMsgs.reverse();

          let newCount = 0;
          for (const m of followerMsgs) {
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
            let fileName = '';

            // ตรวจสอบ messages_sent
            if (m.messages_sent && m.messages_sent.length > 0) {
              const sent = m.messages_sent[0];
              text = sent.text || sent.message || '';
              msgType = sent.type || msgType;
              fileName = sent.file_name || sent.fileName || sent.name || sent.title || '';
              mediaUrl = sent.file_path || sent.filePath || sent.file_url || sent.file || sent.download_url || sent.media_url || sent.url || sent.image || '';

              // ตรวจสอบ LINE Flex Message (กรณีแอดมินส่งใบเสนอราคา QT จาก Chatcone ไป LINE OA)
              if (sent.type === 'flex' || sent.contents) {
                const flexStr = typeof sent.contents === 'string' ? sent.contents : JSON.stringify(sent.contents || sent);
                const nameMatch = flexStr.match(/[\"']([^\"']*?\.pdf)[\"']/i) || flexStr.match(/(QT[\w-]+\.[^\"\s]+)/i);
                if (nameMatch) fileName = nameMatch[1];
                const pdfUriMatch = flexStr.match(/https:\/\/[^\"\s]+?\.pdf/i);
                const actionUriMatch = flexStr.match(/\"uri\"\s*:\s*\"(https:\/\/[^\"]+)\"/i);
                if (pdfUriMatch) {
                  mediaUrl = pdfUriMatch[0].replace(/[\\\"']/g, '');
                } else if (actionUriMatch) {
                  mediaUrl = actionUriMatch[1].replace(/[\\\"']/g, '');
                }
                if (fileName || (mediaUrl && mediaUrl.includes('.pdf'))) {
                  msgType = 'file';
                  if (!text || text === 'Send Files' || text === 'Send File') {
                    text = fileName || 'Quotation PDF';
                  }
                }
              }
            }

            // ตรวจสอบฟิลด์ตรงของข้อความ
            if (!mediaUrl && (m.file_path || m.filePath || m.file_url || m.file || m.url || m.media_url)) {
              mediaUrl = m.file_path || m.filePath || m.file_url || m.file || m.url || m.media_url;
            }
            if (!fileName && (m.fileName || m.file_name || m.message_title)) {
              fileName = m.fileName || m.file_name || m.message_title;
            }
            if (!text && fileName) {
              text = fileName;
            }

            // ตรวจสอบว่าเป็นไฟล์ PDF หรือเอกสาร QT
            let quotationNo = '';
            let grandTotal = '';
            const isPdf = msgType === 'file' || msgType === 'pdf' ||
              (fileName && fileName.toLowerCase().endsWith('.pdf')) ||
              (text && text.toLowerCase().endsWith('.pdf')) ||
              (mediaUrl && mediaUrl.toLowerCase().includes('.pdf')) ||
              /QT\d+/i.test(fileName || text);

            if (isPdf) {
              msgType = 'file';
              if (!text || text === 'Send Files' || text === 'Send File') {
                text = fileName || 'Quotation PDF';
              }
              quotationNo = extractQuotationNo(fileName) || extractQuotationNo(text) || extractQuotationNo(mediaUrl);
            } else {
              quotationNo = extractQuotationNo(text);
            }

            if (!isValidQuotationNo(quotationNo)) {
              quotationNo = '';
            }

            let rawTime = m.timestamp;
            if (m.sending && (m.sending.sent_at || m.sending.send_at)) {
              rawTime = m.sending.sent_at || m.sending.send_at;
            }

            const timeFormatted = formatThaiTime(rawTime);

            // Response time (แยกฟิลด์ต่างหาก ไม่ปนในข้อความ)
            const responseTime = (senderType === 'Agent' && m.response_time !== undefined && m.response_time !== null) ? m.response_time : null;

            let channelDisplayName = channel.name;
            if (follower.channel_type) {
              channelDisplayName = follower.channel_type === 'line' ? 'LINE OA' : (follower.channel_type === 'facebook' ? 'Facebook Messenger' : follower.channel_type.toUpperCase());
            }

            allNewEvents.push({
              timestamp: timeFormatted,
              account: account.name,
              company_id: account.company_id,
              channel_id: channel.id,
              slug: account.slug,
              channel: channelDisplayName,
              sender_type: senderType,
              sender_name: senderName,
              customer_id: customerId,
              message_type: msgType,
              file_name: fileName,
              message: text,
              response_time: responseTime,
              media_url: mediaUrl,
              conversation_id: follower._id,
              message_id: msgId,
              quotation_no: quotationNo,
              grand_total: grandTotal
            });

            if (msgId) {
              syncedIds.add(msgId);
            }
            newCount++;
          }

          if (newCount > 0) {
            console.log(`   - [${channel.name}] ${customerName}: ดึงข้อความใหม่ ${newCount} ข้อความ`);
          }
        }
      }
    }
  }

  if (allNewEvents.length > 0) {
    console.log(`\n==================================================`);
    console.log(`📤 กำลังบันทึกข้อความใหม่ทั้งหมด ${allNewEvents.length} ข้อความลง Google Sheets...`);
    
    // แบ่งส่งเป็นชุดละ 100 ข้อความ เพื่อป้องกัน timeout
    const CHUNK_SIZE = 100;
    for (let i = 0; i < allNewEvents.length; i += CHUNK_SIZE) {
      const chunk = allNewEvents.slice(i, i + CHUNK_SIZE);
      const action = (i === 0 && isReset) ? 'reset_and_sync' : 'sync';
      console.log(`⏳ กำลังส่งข้อมูลชุดที่ ${Math.floor(i / CHUNK_SIZE) + 1} (${chunk.length} ข้อความ)...`);
      const res = await postToGoogleSheets(chunk, action);
      console.log('   ผลตอบกลับ:', res.data);
    }

    saveSyncedIds(syncedIds);
    console.log('\n✅ บันทึกข้อความทั้งหมดลง Google Sheets สำเร็จเรียบร้อย!');
  } else {
    console.log('\n✨ ข้อมูลทุกช่องทางเป็นปัจจุบันแล้ว ไม่มีข้อความใหม่ที่ต้องซิงค์');
  }
}

run().catch(console.error);
