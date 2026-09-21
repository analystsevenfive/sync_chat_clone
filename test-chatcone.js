const https = require('https');

const postData = JSON.stringify({
  follower_id: "6aafa6209c044f50b259f0d9",
  skip: 0,
  limit: 10,
  hide: false
});

const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiNjg4MWE1M2VjYjM3ODgwMGFiMGNjNzRkIiwiaWF0IjoxNzg5OTU0NjEyLCJleHAiOjE3OTAwNDEwMTJ9.rnmcOSAULbgQEw1WO5Psiw9fQoNrAEYUExShfNuPZ4I";

const options = {
  hostname: 'portal.chatcone.com',
  port: 443,
  path: '/api/chat/messages',
  method: 'POST',
  headers: {
    'accept': 'application/json, text/plain, */*',
    'accept-language': 'th,en;q=0.9',
    'authorization': `Bearer ${token}`,
    'agent_id': '6881a53ecb378800ab0cc74d',
    'cache-control': 'no-store',
    'channel_id': '6881b04f2d07422b089ec4c8',
    'channel_lists': JSON.stringify(["68819f44dd184bb7f86ac384","68844b588be8b73f96d987f3","6881b04f2d07422b089ec4c8"]),
    'company_id': '68819f44dd184b85876ac383',
    'content-type': 'application/json;charset=UTF-8',
    'device': 'web',
    'origin': 'https://portal.chatcone.com',
    'platform': 'chrome',
    'referer': 'https://portal.chatcone.com/x0Wteloe/chat',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
    'cookie': `auth.strategy=local; token=${token}; i18n_redirected=en`,
    'Content-Length': Buffer.byteLength(postData)
  }
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Headers:', res.headers);
    console.log('Response:', data);
  });
});

req.on('error', (e) => {
  console.error(`problem with request: ${e.message}`);
});

req.write(postData);
req.end();
