const https = require('https');

const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiNjg4MWE1M2VjYjM3ODgwMGFiMGNjNzRkIiwiaWF0IjoxNzg5OTU0NjEyLCJleHAiOjE3OTAwNDEwMTJ9.rnmcOSAULbgQEw1WO5Psiw9fQoNrAEYUExShfNuPZ4I';
const AGENT_ID = '6881a53ecb378800ab0cc74d';
const CHANNEL_ID = '6881b04f2d07422b089ec4c8';
const CHANNEL_LISTS = JSON.stringify(["68819f44dd184bb7f86ac384","68844b588be8b73f96d987f3","6881b04f2d07422b089ec4c8"]);
const COMPANY_ID = '68819f44dd184b85876ac383';

function chatconeRequest(reqPath, method, body) {
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
        'channel_id': CHANNEL_ID,
        'channel_lists': CHANNEL_LISTS,
        'company_id': COMPANY_ID,
        'content-type': 'application/json;charset=UTF-8',
        'cookie': `auth.strategy=local; token=${TOKEN}; i18n_redirected=en`
      }
    };
    if (postData) options.headers['Content-Length'] = Buffer.byteLength(postData);

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(data); }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
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

async function main() {
  const followersRes = await chatconeRequest('/api/chat/followers?skip=0&limit=15&sort=desc&chat_type=all&assignee_id=all', 'GET');
  const followers = followersRes.response.chat.data;
  
  let allTimes = [];

  for (const f of followers) {
    const msgsRes = await chatconeRequest('/api/chat/messages', 'POST', {
      follower_id: f._id,
      skip: 0,
      limit: 20,
      hide: false
    });
    const msgs = msgsRes.response && msgsRes.response.data ? msgsRes.response.data : [];
    for (const m of msgs) {
      let rawTime = m.timestamp;
      if (m.sending && (m.sending.sent_at || m.sending.send_at)) {
        rawTime = m.sending.sent_at || m.sending.send_at;
      }
      const d = new Date(typeof rawTime === 'number' && rawTime < 10000000000 ? rawTime * 1000 : rawTime);
      if (!isNaN(d.getTime())) {
        allTimes.push(d);
      }
    }
  }

  allTimes.sort((a, b) => a.getTime() - b.getTime());
  const earliest = allTimes[0];
  const latest = allTimes[allTimes.length - 1];

  console.log('Earliest:', formatThaiTime(earliest));
  console.log('Latest:', formatThaiTime(latest));
  console.log('Total counted:', allTimes.length);
}

main().catch(console.error);
