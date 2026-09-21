const https = require('https');

const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiNjg4MWE1M2VjYjM3ODgwMGFiMGNjNzRkIiwiaWF0IjoxNzg5OTU0NjEyLCJleHAiOjE3OTAwNDEwMTJ9.rnmcOSAULbgQEw1WO5Psiw9fQoNrAEYUExShfNuPZ4I";

const options = {
  hostname: 'portal.chatcone.com',
  port: 443,
  path: '/api/chat/followers?skip=0&limit=10&sort=desc&chat_type=all&assignee_id=all',
  method: 'GET',
  headers: {
    'accept': 'application/json, text/plain, */*',
    'authorization': `Bearer ${token}`,
    'agent_id': '6881a53ecb378800ab0cc74d',
    'channel_id': '6881b04f2d07422b089ec4c8',
    'channel_lists': JSON.stringify(["68819f44dd184bb7f86ac384","68844b588be8b73f96d987f3","6881b04f2d07422b089ec4c8"]),
    'company_id': '68819f44dd184b85876ac383',
    'origin': 'https://portal.chatcone.com',
    'referer': 'https://portal.chatcone.com/x0Wteloe/chat',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
    'cookie': `auth.strategy=local; token=${token}; i18n_redirected=en`
  }
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Raw data:', data);
  });
});

req.on('error', (e) => {
  console.error(`problem: ${e.message}`);
});

req.end();
