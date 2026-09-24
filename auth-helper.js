/**
 * auth-helper.js
 * ระบบดึงและต่ออายุ Chatcone Bearer Token อัตโนมัติ (Auto Get Token)
 * ใช้ Chrome / Edge Headless ผ่าน Chrome DevTools Protocol (CDP) โดยไม่ต้องติดตั้ง dependency เพิ่ม
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');

const TOKEN_CACHE_FILE = path.join(__dirname, '.chatcone_token');

// ค้นหาตำแหน่ง Browser บนเครื่อง (รองรับ Windows, Linux / GitHub Actions, macOS)
function getBrowserPath() {
  const candidates = [
    // Windows
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    // Linux / Ubuntu (GitHub Actions Runner)
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium',
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('ไม่พบ Google Chrome หรือ Microsoft Edge บนเครื่อง กรุณาติดตั้ง Chrome หรือ Edge');
}

// รอให้ Chrome Debugger Port พร้อมใช้งาน
async function getWsDebuggerUrl(port, maxAttempts = 20) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const data = await new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => {
            try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
          });
        });
        req.on('error', reject);
        req.setTimeout(2000, () => { req.destroy(); reject(new Error('timeout')); });
      });
      if (data && data.webSocketDebuggerUrl) {
        return data.webSocketDebuggerUrl;
      }
    } catch (e) {
      await new Promise(r => setTimeout(r, 400));
    }
  }
  throw new Error(`Chrome Debugger ไม่ตอบสนองที่พอร์ต ${port}`);
}

// ตรวจสอบว่า Token ยังใช้งานได้หรือไม่ (exp date)
function isTokenValid(token, bufferSeconds = 300) {
  if (!token || typeof token !== 'string') return false;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    if (!payload.exp) return true;
    const nowSec = Math.floor(Date.now() / 1000);
    return (payload.exp - bufferSeconds) > nowSec;
  } catch (e) {
    return false;
  }
}

// ดึง Token ที่บันทึกไว้ในแคช
function getCachedToken() {
  try {
    if (fs.existsSync(TOKEN_CACHE_FILE)) {
      const token = fs.readFileSync(TOKEN_CACHE_FILE, 'utf8').trim();
      if (isTokenValid(token)) {
        return token;
      }
    }
  } catch (e) {}
  return null;
}

// บันทึก Token ลงไฟล์แคช
function saveCachedToken(token) {
  try {
    fs.writeFileSync(TOKEN_CACHE_FILE, token.trim(), 'utf8');
  } catch (e) {}
}

/**
 * ดึง Chatcone Bearer Token ใหม่ผ่าน Browser Headless อัตโนมัติ
 * @param {string} username - อีเมลผู้ใช้ Chatcone
 * @param {string} password - รหัสผ่าน Chatcone
 * @returns {Promise<string>} Bearer token ใหม่
 */
async function fetchChatconeToken(username, password) {
  const email = username || process.env.CHATCONE_USERNAME || 'it@sevenfive.co.th';
  const pwd = password || process.env.CHATCONE_PASSWORD || 'Pass@7575.';

  console.log(`🤖 กำลังเชื่อมต่อเข้าสู่ระบบ Chatcone แบบอัตโนมัติ (${email})...`);

  const browserPath = getBrowserPath();
  const port = 9333 + Math.floor(Math.random() * 500);
  const tempProfile = path.join(os.tmpdir(), `chatcone_auth_${Date.now()}`);

  const browserProc = spawn(browserPath, [
    `--remote-debugging-port=${port}`,
    '--headless=new',
    `--user-data-dir=${tempProfile}`,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    'about:blank'
  ]);

  let targetWs = null;
  let browserWs = null;

  try {
    const wsUrl = await getWsDebuggerUrl(port);
    browserWs = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      browserWs.onopen = resolve;
      browserWs.onerror = reject;
    });

    let browserMsgId = 1;
    function sendBrowser(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = browserMsgId++;
        const onMsg = (evt) => {
          const res = JSON.parse(evt.data);
          if (res.id === id) {
            browserWs.removeEventListener('message', onMsg);
            if (res.error) reject(new Error(res.error.message || JSON.stringify(res.error)));
            else resolve(res.result);
          }
        };
        browserWs.addEventListener('message', onMsg);
        browserWs.send(JSON.stringify({ id, method, params }));
      });
    }

    // สร้าง Page Target สำหรับ Login
    const target = await sendBrowser('Target.createTarget', { url: 'https://portal.chatcone.com/' });
    targetWs = new WebSocket(`ws://127.0.0.1:${port}/devtools/page/${target.targetId}`);
    await new Promise((resolve, reject) => {
      targetWs.onopen = resolve;
      targetWs.onerror = reject;
    });

    let targetMsgId = 1;
    function sendTarget(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = targetMsgId++;
        const onMsg = (evt) => {
          const res = JSON.parse(evt.data);
          if (res.id === id) {
            targetWs.removeEventListener('message', onMsg);
            if (res.error) reject(new Error(res.error.message || JSON.stringify(res.error)));
            else resolve(res.result);
          }
        };
        targetWs.addEventListener('message', onMsg);
        targetWs.send(JSON.stringify({ id, method, params }));
      });
    }

    await sendTarget('Page.enable');
    await sendTarget('Network.enable');
    await sendTarget('Runtime.enable');

    console.log('   กำลังโหลดหน้า Login portal.chatcone.com...');
    await sendTarget('Page.navigate', { url: 'https://portal.chatcone.com/' });

    // รอให้ Nuxt SSR / Vue Component Hydrate เสร็จสมบูรณ์
    await new Promise(r => setTimeout(r, 3500));

    // กรอกข้อมูล Email, Password และกดปุ่ม Login
    console.log('   กำลังกรอกข้อมูลและเข้าสู่ระบบ...');
    const fillScript = `
      (function() {
        const u = document.getElementById('username') || document.querySelector('input[type="text"]') || document.querySelector('input[name="email"]');
        const p = document.getElementById('password') || document.querySelector('input[type="password"]');
        const btn = document.querySelector('button.btn--primary-100') || document.querySelector('button[type="submit"]') || document.querySelector('button');
        if (!u || !p || !btn) return false;
        u.value = ${JSON.stringify(email)};
        u.dispatchEvent(new Event('input', { bubbles: true }));
        u.dispatchEvent(new Event('change', { bubbles: true }));
        p.value = ${JSON.stringify(pwd)};
        p.dispatchEvent(new Event('input', { bubbles: true }));
        p.dispatchEvent(new Event('change', { bubbles: true }));
        btn.click();
        return true;
      })()
    `;
    const fillRes = await sendTarget('Runtime.evaluate', { expression: fillScript, returnByValue: true });
    if (!fillRes.result || !fillRes.result.value) {
      throw new Error('ไม่พบฟิลด์กรอกข้อมูล Login บนหน้าเว็บ');
    }

    // รอรับ Token จากคุกกี้หลัง Login สำเร็จ
    let extractedToken = null;
    for (let i = 0; i < 12; i++) {
      await new Promise(r => setTimeout(r, 800));

      const cookieData = await sendTarget('Network.getCookies');
      if (cookieData && cookieData.cookies) {
        const tokenCookie = cookieData.cookies.find(c => c.name === 'token' && c.value && c.value.length > 30);
        if (tokenCookie) {
          extractedToken = tokenCookie.value;
          break;
        }
      }

      // ตรวจสอบจาก localStorage
      const lsData = await sendTarget('Runtime.evaluate', {
        expression: 'localStorage.getItem("token") || localStorage.getItem("access_token") || ""',
        returnByValue: true
      });
      if (lsData.result && lsData.result.value && lsData.result.value.length > 30) {
        extractedToken = lsData.result.value;
        break;
      }
    }

    if (!extractedToken) {
      const errText = await sendTarget('Runtime.evaluate', {
        expression: 'document.querySelector(".invalid-feedback, .error, .text-danger")?.innerText || ""',
        returnByValue: true
      });
      const reason = errText.result && errText.result.value ? ` (${errText.result.value})` : '';
      throw new Error(`ไม่สามารถดึง Token หลัง Login ได้ ตรวจสอบอีเมลและรหัสผ่าน${reason}`);
    }

    console.log('✅ เข้าสู่ระบบสำเร็จและได้รับ Chatcone Token ใหม่เรียบร้อย!');
    saveCachedToken(extractedToken);
    return extractedToken;
  } finally {
    if (targetWs) try { targetWs.close(); } catch (e) {}
    if (browserWs) try { browserWs.close(); } catch (e) {}
    try { browserProc.kill(); } catch (e) {}
    try { fs.rmSync(tempProfile, { recursive: true, force: true }); } catch (e) {}
  }
}

/**
 * ดึง Token ที่พร้อมใช้งาน (ดึงจากแคช หรือดึงใหม่ถ้าหมดอายุ)
 */
async function getOrRefreshToken(username, password) {
  const cached = getCachedToken();
  if (cached) {
    return cached;
  }
  return await fetchChatconeToken(username, password);
}

module.exports = {
  fetchChatconeToken,
  getOrRefreshToken,
  isTokenValid,
  getCachedToken,
  saveCachedToken
};
