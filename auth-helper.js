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
const crypto = require('crypto');

const TOKEN_CACHE_FILE = path.join(__dirname, '.chatcone_token');

function loadLocalEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;

    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    process.env[match[1]] = value;
  }
}

loadLocalEnv();

// Polyfill WebSocket สำหรับ Node.js เวอร์ชันเก่า (เช่น Node 18, 20) หาก global.WebSocket ไม่มีอยู่
function createFallbackWebSocket() {
  return class SimpleWebSocket {
    constructor(url) {
      this.url = new URL(url);
      this.listeners = {};
      this.readyState = 0; // CONNECTING
      this.onopen = null;
      this.onerror = null;
      this.onmessage = null;
      this.onclose = null;
      this._connect();
    }

    addEventListener(type, cb) {
      if (!this.listeners[type]) this.listeners[type] = [];
      this.listeners[type].push(cb);
    }

    removeEventListener(type, cb) {
      if (this.listeners[type]) {
        this.listeners[type] = this.listeners[type].filter(fn => fn !== cb);
      }
    }

    _emit(type, evt) {
      if (this['on' + type]) {
        try { this['on' + type](evt); } catch (e) {}
      }
      if (this.listeners[type]) {
        this.listeners[type].forEach(fn => {
          try { fn(evt); } catch (e) {}
        });
      }
    }

    _connect() {
      const key = crypto.randomBytes(16).toString('base64');
      const req = http.request({
        hostname: this.url.hostname,
        port: this.url.port || (this.url.protocol === 'wss:' ? 443 : 80),
        path: this.url.pathname + this.url.search,
        headers: {
          'Connection': 'Upgrade',
          'Upgrade': 'websocket',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': key
        }
      });

      req.on('error', (err) => {
        this._emit('error', err);
      });

      req.on('upgrade', (res, socket) => {
        this.socket = socket;
        this.readyState = 1; // OPEN
        this._emit('open', {});

        let buffer = Buffer.alloc(0);

        socket.on('data', (chunk) => {
          buffer = Buffer.concat([buffer, chunk]);
          while (buffer.length >= 2) {
            const firstByte = buffer[0];
            const secondByte = buffer[1];
            const opcode = firstByte & 0x0f;
            let payloadLength = secondByte & 0x7f;
            let offset = 2;

            if (payloadLength === 126) {
              if (buffer.length < 4) break;
              payloadLength = buffer.readUInt16BE(2);
              offset = 4;
            } else if (payloadLength === 127) {
              if (buffer.length < 10) break;
              payloadLength = Number(buffer.readBigUInt64BE(2));
              offset = 10;
            }

            const isMasked = (secondByte & 0x80) !== 0;
            let maskKey = null;
            if (isMasked) {
              if (buffer.length < offset + 4) break;
              maskKey = buffer.slice(offset, offset + 4);
              offset += 4;
            }

            if (buffer.length < offset + payloadLength) break;

            let payload = buffer.slice(offset, offset + payloadLength);
            buffer = buffer.slice(offset + payloadLength);

            if (isMasked && maskKey) {
              for (let i = 0; i < payload.length; i++) {
                payload[i] ^= maskKey[i % 4];
              }
            }

            if (opcode === 1) { // Text frame
              const text = payload.toString('utf8');
              this._emit('message', { data: text });
            } else if (opcode === 8) { // Close frame
              this.close();
            } else if (opcode === 9) { // Ping frame
              const pong = Buffer.from([0x8a, 0x00]);
              socket.write(pong);
            }
          }
        });

        socket.on('close', () => {
          this.readyState = 3;
          this._emit('close', {});
        });

        socket.on('error', (err) => {
          this._emit('error', err);
        });
      });

      req.end();
    }

    send(data) {
      if (!this.socket || this.readyState !== 1) return;
      const payload = Buffer.from(data, 'utf8');
      const maskKey = crypto.randomBytes(4);
      let header;

      if (payload.length < 126) {
        header = Buffer.alloc(6);
        header[0] = 0x81;
        header[1] = 0x80 | payload.length;
        maskKey.copy(header, 2);
      } else if (payload.length <= 65535) {
        header = Buffer.alloc(8);
        header[0] = 0x81;
        header[1] = 0x80 | 126;
        header.writeUInt16BE(payload.length, 2);
        maskKey.copy(header, 4);
      } else {
        header = Buffer.alloc(14);
        header[0] = 0x81;
        header[1] = 0x80 | 127;
        header.writeBigUInt64BE(BigInt(payload.length), 2);
        maskKey.copy(header, 10);
      }

      const maskedPayload = Buffer.alloc(payload.length);
      for (let i = 0; i < payload.length; i++) {
        maskedPayload[i] = payload[i] ^ maskKey[i % 4];
      }

      this.socket.write(Buffer.concat([header, maskedPayload]));
    }

    close() {
      this.readyState = 2; // CLOSING
      if (this.socket) {
        try {
          this.socket.write(Buffer.from([0x88, 0x80, 0x00, 0x00, 0x00, 0x00]));
          this.socket.end();
        } catch (e) {}
      }
      this.readyState = 3; // CLOSED
    }
  };
}

const WebSocketClient = (typeof globalThis.WebSocket !== 'undefined') ? globalThis.WebSocket : createFallbackWebSocket();

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

// รอให้ Chrome/Edge สร้าง DevToolsActivePort และเปิด Debugger endpoint
async function getWsDebuggerInfo(profilePath, browserProc, maxAttempts = 40) {
  let lastError = 'DevToolsActivePort has not been created';

  for (let i = 0; i < maxAttempts; i++) {
    if (browserProc.launchError) {
      throw new Error(`Chrome/Edge launch failed: ${browserProc.launchError}`);
    }
    if (browserProc.exitCode !== null) {
      const stderr = browserProc.stderrOutput.trim();
      throw new Error(`Chrome/Edge exited before Debugger became ready (code ${browserProc.exitCode}, signal ${browserProc.signalCode || 'none'})${stderr ? `: ${stderr}` : ''}`);
    }

    const announcedEndpoint = browserProc.stderrOutput.match(/DevTools listening on (ws:\/\/(?:127\.0\.0\.1|localhost):(\d+)\/devtools\/browser\/[^\s]+)/);
    if (announcedEndpoint) {
      return {
        port: Number(announcedEndpoint[2]),
        webSocketDebuggerUrl: announcedEndpoint[1]
      };
    }

    let port = 0;
    try {
      const portFile = fs.readFileSync(path.join(profilePath, 'DevToolsActivePort'), 'utf8');
      port = Number(portFile.split(/\r?\n/)[0]);
    } catch (e) {}

    if (Number.isInteger(port) && port > 0 && port <= 65535) {
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
          req.setTimeout(1500, () => { req.destroy(); reject(new Error('Debugger endpoint timeout')); });
        });
        if (data && data.webSocketDebuggerUrl) {
          return { port, webSocketDebuggerUrl: data.webSocketDebuggerUrl };
        }
        lastError = 'Debugger endpoint did not return a WebSocket URL';
      } catch (e) {
        lastError = e.message;
      }
    }

    await new Promise(r => setTimeout(r, 400));
  }

  const stderr = browserProc.stderrOutput.trim();
  throw new Error(`Chrome Debugger did not become available after ${maxAttempts} attempts (${lastError})${stderr ? `. Browser output: ${stderr}` : ''}`);
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
  const email = String(username || process.env.CHATCONE_USERNAME || '').trim();
  const pwd = String(password || process.env.CHATCONE_PASSWORD || '').trim();
  if (!email || !pwd) {
    throw new Error('Missing CHATCONE_USERNAME or CHATCONE_PASSWORD. Set them in .env or the process environment.');
  }

  const maskedEmail = email.replace(/(.{2})(.*)(@.*)/, '$1***$3');
  console.log(`🤖 กำลังเชื่อมต่อเข้าสู่ระบบ Chatcone แบบอัตโนมัติ (${maskedEmail})...`);

  const browserPath = getBrowserPath();
  const tempProfile = path.join(os.tmpdir(), `chatcone_auth_${Date.now()}`);

  const browserProc = spawn(browserPath, [
    '--remote-debugging-port=0',
    '--headless=new',
    '--window-size=1920,1080',
    '--start-maximized',
    `--user-data-dir=${tempProfile}`,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
    'about:blank'
  ]);
  browserProc.launchError = null;
  browserProc.stderrOutput = '';
  browserProc.on('error', err => { browserProc.launchError = err.message; });
  browserProc.on('exit', (code, signal) => { browserProc.signalCode = signal; });
  browserProc.stderr.on('data', chunk => {
    browserProc.stderrOutput = (browserProc.stderrOutput + chunk.toString()).slice(-4000);
  });

  let targetWs = null;
  let browserWs = null;

  try {
    const debuggerInfo = await getWsDebuggerInfo(tempProfile, browserProc);
    browserWs = new WebSocketClient(debuggerInfo.webSocketDebuggerUrl);
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
    targetWs = new WebSocketClient(`ws://127.0.0.1:${debuggerInfo.port}/devtools/page/${target.targetId}`);
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

    // ดักฟัง Response จาก Network เพื่อดึง Token หรือตรวจจับข้อผิดพลาดจาก API โดยตรง
    let authRequestId = null;
    let authApiResponse = null;
    targetWs.addEventListener('message', (evt) => {
      try {
        const d = JSON.parse(evt.data);
        if (d.method === 'Network.responseReceived') {
          const resp = d.params.response;
          const url = resp.url || '';
          if (url.includes('/login') || url.includes('/auth') || url.includes('/token') || url.includes('/user')) {
            authApiResponse = resp;
            authRequestId = d.params.requestId;
          }
        }
      } catch (e) {}
    });

    await sendTarget('Page.enable');
    await sendTarget('Network.enable');
    await sendTarget('Runtime.enable');

    console.log('   กำลังโหลดหน้า Login portal.chatcone.com...');
    await sendTarget('Page.navigate', { url: 'https://portal.chatcone.com/' });

    // รอให้ Nuxt SSR / Vue Component Hydrate เสร็จสมบูรณ์
    await new Promise(r => setTimeout(r, 4000));

    // กรอกข้อมูล Email, Password และกดปุ่ม Login ด้วย Native Prototype Value Setter
    console.log('   กำลังกรอกข้อมูลและเข้าสู่ระบบ...');
    const fillScript = `
      (function() {
        const u = document.getElementById('username') || document.querySelector('input[type="text"]') || document.querySelector('input[name="email"]') || document.querySelector('input[placeholder*="Email" i]') || document.querySelector('input[placeholder*="อีเมล" i]');
        const p = document.getElementById('password') || document.querySelector('input[type="password"]');
        const btn = document.querySelector('button.btn--primary-100') || document.querySelector('button[type="submit"]') || document.querySelector('form button') || document.querySelector('button');
        if (!u || !p) return { ok: false, err: 'inputs not found' };

        function setNativeValue(element, value) {
          element.focus();
          const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set;
          const prototype = Object.getPrototypeOf(element);
          const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
          if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
            prototypeValueSetter.call(element, value);
          } else if (valueSetter) {
            valueSetter.call(element, value);
          } else {
            element.value = value;
          }
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
        }

        setNativeValue(u, ${JSON.stringify(email)});
        setNativeValue(p, ${JSON.stringify(pwd)});

        if (btn) {
          btn.focus();
          btn.click();
        }

        const form = (btn && btn.form) || u.closest('form');
        if (form) {
          try { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); } catch(e){}
        }

        return { ok: true, foundBtn: !!btn };
      })()
    `;
    const fillRes = await sendTarget('Runtime.evaluate', { expression: fillScript, returnByValue: true });
    if (!fillRes.result || !fillRes.result.value || !fillRes.result.value.ok) {
      throw new Error('ไม่พบฟิลด์กรอกข้อมูล Login บนหน้าเว็บ');
    }

    // รอรับ Token จากคุกกี้ / localStorage / Network Response
    let extractedToken = null;
    let apiErrorMessage = '';

    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 800));

      // 1. ตรวจสอบจากคุกกี้
      const cookieData = await sendTarget('Network.getCookies');
      if (cookieData && cookieData.cookies) {
        const tokenCookie = cookieData.cookies.find(c => (c.name === 'token' || c.name === 'auth._token.local') && c.value && c.value.length > 30);
        if (tokenCookie) {
          extractedToken = tokenCookie.value.replace(/^Bearer\s+/i, '');
          break;
        }
      }

      // 2. ตรวจสอบจาก localStorage / sessionStorage
      const lsData = await sendTarget('Runtime.evaluate', {
        expression: 'localStorage.getItem("token") || localStorage.getItem("auth._token.local") || localStorage.getItem("access_token") || sessionStorage.getItem("token") || ""',
        returnByValue: true
      });
      if (lsData.result && lsData.result.value && lsData.result.value.length > 30) {
        extractedToken = lsData.result.value.replace(/^Bearer\s+/i, '');
        break;
      }

      // 3. ตรวจสอบจาก Network Response Body
      if (authRequestId && !extractedToken) {
        try {
          const bodyData = await sendTarget('Network.getResponseBody', { requestId: authRequestId });
          if (bodyData && bodyData.body) {
            const parsed = JSON.parse(bodyData.body);
            const token = parsed.token || parsed.access_token || (parsed.response && (parsed.response.token || parsed.response.access_token)) || (parsed.data && parsed.data.token);
            if (token && typeof token === 'string' && token.length > 30) {
              extractedToken = token.replace(/^Bearer\s+/i, '');
              break;
            }
            if (parsed.message || parsed.statusMessage) {
              apiErrorMessage = parsed.message || parsed.statusMessage;
            }
          }
        } catch (e) {}
      }
    }

    if (!extractedToken) {
      const pageInfo = await sendTarget('Runtime.evaluate', {
        expression: `({
          url: window.location.href,
          error: document.querySelector('.invalid-feedback, .error, .text-danger, .toast, .swal2-content, .alert, .notification')?.innerText || '',
          bodySnippet: (document.body ? document.body.innerText : '').substring(0, 300)
        })`,
        returnByValue: true
      });
      const info = pageInfo.result && pageInfo.result.value ? pageInfo.result.value : {};
      const reason = apiErrorMessage || info.error || (info.url && !info.url.includes('chat') ? `ยังอยู่ที่หน้า ${info.url}` : '');
      const detailMsg = reason ? ` (${reason})` : '';
      throw new Error(`ไม่สามารถดึง Token หลัง Login ได้${detailMsg} กรุณาตรวจสอบว่าอีเมล/รหัสผ่านใน GitHub Secrets ถูกต้องหรือไม่`);
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
