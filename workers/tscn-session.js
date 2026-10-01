// tscn-session.js — TSCN 3D 场景服务器端会话（Durable Object）
// 使用 @cloudflare/puppeteer 驱动 Browser Rendering，定时截图推流给前端。

import puppeteer from '@cloudflare/puppeteer';

const RENDER_URL = 'https://hedwig.eu.org/tscn/render.html';
const FRAME_FPS = 10;
const JPEG_QUALITY = 70;
const IDLE_SHUTDOWN_MS = 30 * 1000;
const VIEWPORT = { width: 960, height: 540 };

function toBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export class TscnSession {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.viewers = new Set();
    this.input = { x: 0, y: 0 };
    this.browser = null;
    this.page = null;
    this.frameTimer = null;
    this.idleTimer = null;
    this.starting = null;
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
          this.input.x = typeof data.x === 'number' ? data.x : 0;
          this.input.y = typeof data.y === 'number' ? data.y : 0;
          this.sendInputToPage();
        }
      } catch (e) { /* 忽略非法消息 */ }
    });

    server.addEventListener('close', () => {
      this.viewers.delete(server);
      this.resetIdleTimer();
    });

    // 启动浏览器（并发去重：只允许一个启动过程）
    if (!this.page && !this.starting) {
      this.starting = this.startBrowser().catch((err) => {
        const msg = (err && err.message) || String(err);
        console.error('TscnSession: browser start failed:', msg);
        for (const ws of this.viewers) {
          try {
            ws.send(JSON.stringify({ type: 'error', message: '浏览器启动失败：' + msg }));
          } catch (e) {}
        }
        this.starting = null;
      });
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async startBrowser() {
    this.browser = await puppeteer.launch(this.env.BROWSER);
    this.page = await this.browser.newPage();
    await this.page.setViewport(VIEWPORT);

    // 打开 render.html 并等待 window.__ready 变为 true
    await this.page.goto(RENDER_URL, {
      waitUntil: 'networkidle0',
      timeout: 30000,
    });
    await this.page.waitForFunction('window.__ready === true', { timeout: 30000 });

    this.startFrameStream();
  }

  startFrameStream() {
    if (this.frameTimer) return;
    const interval = 1000 / FRAME_FPS;

    this.frameTimer = setInterval(async () => {
      if (!this.page || this.viewers.size === 0) return;
      try {
        const buffer = await this.page.screenshot({
          type: 'jpeg',
          quality: JPEG_QUALITY,
          encoding: 'binary',
        });
        const payload = JSON.stringify({
          type: 'frame',
          data: toBase64(buffer),
        });
        for (const ws of this.viewers) {
          try {
            ws.send(payload);
          } catch (e) {
            this.viewers.delete(ws);
          }
        }
      } catch (err) {
        console.error('Screenshot failed:', (err && err.message) || String(err));
      }
    }, interval);
  }

  async sendInputToPage() {
    if (!this.page) return;
    try {
      await this.page.evaluate(
        (x, y) => { if (window.__setInput) window.__setInput(x, y); },
        this.input.x,
        this.input.y
      );
    } catch (e) { /* 页面可能正忙，忽略 */ }
  }

  resetIdleTimer() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.viewers.size === 0) {
      this.idleTimer = setTimeout(() => this.shutdown(), IDLE_SHUTDOWN_MS);
    }
  }

  async shutdown() {
    if (this.frameTimer) {
      clearInterval(this.frameTimer);
      this.frameTimer = null;
    }
    if (this.browser) {
      try { await this.browser.close(); } catch (e) {}
      this.browser = null;
      this.page = null;
    }
    this.starting = null;
  }
}