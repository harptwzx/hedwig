// tscn-session.js — TSCN 3D 场景服务器端会话（Durable Object）
// 使用 @cloudflare/puppeteer 驱动 Browser Rendering，定时截图推流给前端。

import puppeteer from '@cloudflare/puppeteer';

const RENDER_URL = 'https://hedwig.eu.org/tscn/render.html';
const FRAME_FPS = 10;
const JPEG_QUALITY = 70;
const IDLE_SHUTDOWN_MS = 5 * 60 * 1000;  // 5分钟无观众才关闭（减少频繁启停）
const RESTART_COOLDOWN_MS = 5 * 60 * 1000; // 启动失败后5分钟内不再尝试
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
    this.browser = null;
    this.page = null;
    this.frameTimer = null;
    this.idleTimer = null;
    this.starting = null;
    this.lastStartAttempt = 0;  // 上次尝试启动的时间戳
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

    server.addEventListener('close', () => {
      this.viewers.delete(server);
      this.resetIdleTimer();
    });

    // 启动浏览器（带冷却时间防止429）
    await this.ensureBrowser();

    return new Response(null, { status: 101, webSocket: client });
  }

  async ensureBrowser() {
    const now = Date.now();
    
    // 如果正在启动或已经有浏览器，直接返回
    if (this.starting || this.page) return;
    
    // 检查冷却时间：上次启动失败不到5分钟，不再尝试
    if (now - this.lastStartAttempt < RESTART_COOLDOWN_MS) {
      const waitSec = Math.ceil((RESTART_COOLDOWN_MS - (now - this.lastStartAttempt)) / 1000);
      this.broadcastError(`浏览器启动冷却中，请 ${waitSec} 秒后再试`);
      return;
    }

    this.lastStartAttempt = now;
    this.starting = this.startBrowser()
      .catch((err) => {
        const msg = (err && err.message) || String(err);
        console.error('TscnSession: browser start failed:', msg);
        this.broadcastError('浏览器启动失败：' + msg);
      })
      .finally(() => {
        this.starting = null;
      });
    
    // 等待启动完成（可选，不等待也可以让fetch先返回）
    // await this.starting;
  }

  broadcastError(message) {
    const payload = JSON.stringify({ type: 'error', message });
    for (const ws of this.viewers) {
      try {
        ws.send(payload);
      } catch (e) {
        this.viewers.delete(ws);
      }
    }
  }

  async startBrowser() {
    this.browser = await puppeteer.launch(this.env.BROWSER);
    this.page = await this.browser.newPage();
    await this.page.setViewport(VIEWPORT);

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