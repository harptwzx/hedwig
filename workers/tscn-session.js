// tscn-session.js — TSCN 3D 场景服务器端会话（Durable Object）
// 工作流程：
// 1. 浏览器查看器通过 wss://hedwig.eu.org/tscn/ws 连入本 Durable Object
// 2. 本 DO 通过 Browser Rendering 绑定启动无头 Chromium
// 3. 用 CDP 原生 WebSocket 控制浏览器：
//    - 打开 /tscn/render.html（Three.js 渲染页，解析并渲染 main.tscn）
//    - 定时 Page.captureScreenshot 抓 JPEG 帧，广播给所有查看器
//    - 收到操纵杆输入后 Runtime.evaluate 调用页面里的 window.__setInput
// 4. 所有查看器断开 30 秒后自动关闭浏览器（节省免费额度：10 分钟/天）

const RENDER_URL = 'https://hedwig.eu.org/tscn/render.html';
const FRAME_FPS = 10;
const JPEG_QUALITY = 70;
const IDLE_SHUTDOWN_MS = 30 * 1000;
const START_TIMEOUT_MS = 30 * 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function base64ToBinary(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ========== 极简 CDP 客户端（零依赖） ==========
class CDPClient {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    ws.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch (e) { return; }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result || {});
      }
    });
  }

  send(method, params = {}, sessionId = undefined) {
    const id = ++this.nextId;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('CDP timeout: ' + method));
        }
      }, 20000);
    });
  }

  close() {
    try { this.ws.close(); } catch (e) {}
    this.pending.clear();
  }
}

// ========== Durable Object ==========
export class TscnSession {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.viewers = new Set();
    this.input = { x: 0, y: 0 };
    this.cdp = null;
    this.sessionId = null;
    this.targetId = null;
    this.frameTimer = null;
    this.idleTimer = null;
    this.starting = false;
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('WebSocket only', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.state.acceptWebSocket(server);
    this.viewers.add(server);
    this.resetIdleTimer();

    server.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'input') {
          this.input = { x: data.x || 0, y: data.y || 0 };
          this._sendInputToPage();
        }
      } catch (e) {}
    });

    server.addEventListener('close', () => {
      this.viewers.delete(server);
      this.resetIdleTimer();
    });

    // 启动浏览器（如果尚未启动）
    if (!this.cdp && !this.starting) {
      this.startBrowser().catch((err) => {
        console.error('TscnSession: browser start failed:', err.message);
        for (const ws of this.viewers) {
          try { ws.send(JSON.stringify({ type: 'error', message: '浏览器启动失败：' + err.message })); } catch (e) {}
        }
      });
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  // ★ 核心修复：使用正确的 Browser Rendering API 端点
  async startBrowser() {
    this.starting = true;
    try {
      // 获取账户 ID（从环境变量或硬编码）
      const accountId = this.env.CF_ACCOUNT_ID || '1427cc87388551d7b83e6893ef16ae9e';

      // ★ 正确的 CDP WebSocket 端点
      const cdpUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/devtools/browser`;
      const ws = new WebSocket(cdpUrl);
      this.cdp = new CDPClient(ws);

      // 等待浏览器级连接就绪
      await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve);
        ws.addEventListener('error', () => reject(new Error('CDP WebSocket connection failed')));
        setTimeout(() => reject(new Error('CDP connect timeout')), START_TIMEOUT_MS);
      });

      // 创建新页面
      const { targetId } = await this.cdp.send('Target.createTarget', { url: 'about:blank' });
      this.targetId = targetId;

      // 附加到页面
      const { sessionId } = await this.cdp.send('Target.attachToTarget', { targetId, flatten: true });
      this.sessionId = sessionId;

      // 启用 Page 和 Runtime 域
      await this.cdp.send('Page.enable', {}, sessionId);
      await this.cdp.send('Runtime.enable', {}, sessionId);

      // 导航到渲染页
      await this.cdp.send('Page.navigate', { url: RENDER_URL }, sessionId);

      // 等待页面加载完成（简单轮询）
      await this.waitForPageLoad();

      // 开始截图推流
      this.startFrameStream();

    } catch (err) {
      this.cleanup();
      throw err;
    } finally {
      this.starting = false;
    }
  }

  async waitForPageLoad() {
    const start = Date.now();
    while (Date.now() - start < START_TIMEOUT_MS) {
      try {
        const result = await this.cdp.send('Runtime.evaluate', {
          expression: 'document.readyState',
          returnByValue: true,
        }, this.sessionId);
        if (result.result && result.result.value === 'complete') return;
      } catch (e) {}
      await sleep(500);
    }
    throw new Error('Page load timeout');
  }

  startFrameStream() {
    if (this.frameTimer) return;
    const interval = 1000 / FRAME_FPS;
    this.frameTimer = setInterval(async () => {
      if (this.viewers.size === 0) return;
      try {
        const { data } = await this.cdp.send('Page.captureScreenshot', {
          format: 'jpeg',
          quality: JPEG_QUALITY,
        }, this.sessionId);
        const payload = JSON.stringify({ type: 'frame', data });
        for (const ws of this.viewers) {
          try { ws.send(payload); } catch (e) { this.viewers.delete(ws); }
        }
      } catch (err) {
        console.error('Screenshot failed:', err.message);
      }
    }, interval);
  }

  _sendInputToPage() {
    if (!this.cdp || !this.sessionId) return;
    this.cdp.send('Runtime.evaluate', {
      expression: `window.__setInput && window.__setInput(${this.input.x}, ${this.input.y})`,
    }, this.sessionId).catch(() => {});
  }

  resetIdleTimer() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.viewers.size === 0) {
      this.idleTimer = setTimeout(() => this.shutdown(), IDLE_SHUTDOWN_MS);
    }
  }

  cleanup() {
    if (this.frameTimer) { clearInterval(this.frameTimer); this.frameTimer = null; }
    if (this.cdp) { this.cdp.close(); this.cdp = null; }
    this.sessionId = null;
    this.targetId = null;
  }

  async shutdown() {
    this.cleanup();
  }
}