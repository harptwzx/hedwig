// tscn-session.js — TSCN 3D 场景服务器端会话（Durable Object）
//
// 工作流程：
//   1. 浏览器查看器通过 wss://hedwig.eu.org/tscn/ws 连入本 Durable Object
//   2. 本 DO 通过 Browser Rendering 绑定启动无头 Chromium（Cloudflare 机房内）
//   3. 用 CDP (Chrome DevTools Protocol) 原生 WebSocket 控制浏览器：
//      - 打开 /tscn/render.html（Three.js 渲染页，解析并渲染 main.tscn）
//      - 定时 Page.captureScreenshot 抓 JPEG 帧，广播给所有查看器
//      - 收到操纵杆输入后 Runtime.evaluate 调用页面里的 window.__setInput
//   4. 所有查看器断开 30 秒后自动关闭浏览器（节省免费额度：10 分钟/天）
//
// 不依赖 puppeteer 等任何 npm 包，Cloudflare 直接从 GitHub 拉取即可部署。

const RENDER_URL = 'https://hedwig.eu.org/tscn/render.html';
const FRAME_FPS = 10;            // 推流帧率
const JPEG_QUALITY = 70;         // JPEG 质量 1-100
const IDLE_SHUTDOWN_MS = 30 * 1000;  // 无人观看 30 秒后关闭浏览器
const START_TIMEOUT_MS = 30 * 1000;  // 浏览器启动超时

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
            // 事件消息（如 Target.targetDestroyed）此处忽略
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
        this.viewers = new Set();   // 所有已连接的查看器 WebSocket
        this.input = { x: 0, y: 0 };// 当前移动输入
        this.cdp = null;            // CDPClient（浏览器级连接）
        this.sessionId = null;      // 页面级 CDP session
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
        server.accept();

        this.viewers.add(server);
        this._cancelIdleTimer();
        this._ensureBrowser();

        server.addEventListener('message', (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'input') {
                    this.input.x = Math.max(-1, Math.min(1, Number(msg.x) || 0));
                    this.input.y = Math.max(-1, Math.min(1, Number(msg.y) || 0));
                    this._applyInput();
                }
            } catch (e) {}
        });

        const onLeave = () => {
            this.viewers.delete(server);
            if (this.viewers.size === 0) this._scheduleIdleShutdown();
        };
        server.addEventListener('close', onLeave);
        server.addEventListener('error', onLeave);

        return new Response(null, { status: 101, webSocket: client });
    }

    // ---------- 浏览器生命周期 ----------

    async _ensureBrowser() {
        if (this.cdp || this.starting) return;
        this.starting = true;
        try {
            // 1. 从 Browser 绑定拿到 CDP 浏览器端点
            const verRes = await this.env.BROWSER.fetch('https://browser.rendering.cloudflare.com/json/version');
            if (!verRes.ok) throw new Error('json/version failed: ' + verRes.status);
            const version = await verRes.json();
            if (!version.webSocketDebuggerUrl) throw new Error('no webSocketDebuggerUrl');

            // 2. 连接浏览器级 WebSocket
            const ws = new WebSocket(version.webSocketDebuggerUrl);
            await Promise.race([
                new Promise((res, rej) => {
                    ws.addEventListener('open', res);
                    ws.addEventListener('error', () => rej(new Error('CDP ws error')));
                }),
                sleep(START_TIMEOUT_MS).then(() => { throw new Error('CDP ws open timeout'); })
            ]);
            this.cdp = new CDPClient(ws);
            ws.addEventListener('close', () => { this._onBrowserGone(); });

            // 3. 新建页面并附加（flatten 模式，页面命令带 sessionId）
            const target = await this.cdp.send('Target.createTarget', { url: 'about:blank' });
            this.targetId = target.targetId;
            const attached = await this.cdp.send('Target.attachToTarget', { targetId: this.targetId, flatten: true });
            this.sessionId = attached.sessionId;

            await this.cdp.send('Page.enable', {}, this.sessionId);
            await this.cdp.send('Runtime.enable', {}, this.sessionId);
            await this.cdp.send('Emulation.setDeviceMetricsOverride', {
                width: 960, height: 540, deviceScaleFactor: 1, mobile: false
            }, this.sessionId);

            // 4. 打开渲染页并等待场景就绪
            await this.cdp.send('Page.navigate', { url: RENDER_URL }, this.sessionId);
            let ready = false;
            for (let i = 0; i < 60; i++) {
                await sleep(500);
                try {
                    const r = await this.cdp.send('Runtime.evaluate', {
                        expression: '!!window.__ready', returnByValue: true
                    }, this.sessionId);
                    if (r.result && r.result.value === true) { ready = true; break; }
                } catch (e) {}
            }
            if (!ready) throw new Error('render page not ready');

            this._applyInput();
            this._startFrameLoop();
        } catch (e) {
            console.error('TscnSession: browser start failed:', e.message || e);
            this._closeBrowser();
            this._broadcast(JSON.stringify({ type: 'error', message: '渲染服务器启动失败，请稍后重试' }));
        }
        this.starting = false;
    }

    _closeBrowser() {
        this._stopFrameLoop();
        const cdp = this.cdp;
        this.cdp = null;
        this.sessionId = null;
        const targetId = this.targetId;
        this.targetId = null;
        if (cdp && targetId) {
            try { cdp.send('Target.closeTarget', { targetId }); } catch (e) {}
        }
        if (cdp) cdp.close();
    }

    _onBrowserGone() {
        // 浏览器被回收或异常关闭：清状态，等下一个查看器进来再启动
        this._stopFrameLoop();
        this.cdp = null;
        this.sessionId = null;
        this.targetId = null;
    }

    _scheduleIdleShutdown() {
        this._cancelIdleTimer();
        this.idleTimer = setTimeout(() => {
            if (this.viewers.size === 0) this._closeBrowser();
        }, IDLE_SHUTDOWN_MS);
        this.state.waitUntil(Promise.resolve());
    }

    _cancelIdleTimer() {
        if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    }

    // ---------- 输入与画面 ----------

    async _applyInput() {
        if (!this.cdp || !this.sessionId) return;
        try {
            await this.cdp.send('Runtime.evaluate', {
                expression: 'window.__setInput && window.__setInput(' + this.input.x + ',' + this.input.y + ')'
            }, this.sessionId);
        } catch (e) {}
    }

    _startFrameLoop() {
        if (this.frameTimer) return;
        this.frameTimer = setInterval(async () => {
            if (!this.cdp || !this.sessionId || this.viewers.size === 0) return;
            try {
                const shot = await this.cdp.send('Page.captureScreenshot', {
                    format: 'jpeg', quality: JPEG_QUALITY
                }, this.sessionId);
                this._broadcast(base64ToBinary(shot.data));
            } catch (e) {
                this._closeBrowser();
            }
        }, 1000 / FRAME_FPS);
    }

    _stopFrameLoop() {
        if (this.frameTimer) { clearInterval(this.frameTimer); this.frameTimer = null; }
    }

    _broadcast(data) {
        for (const v of this.viewers) {
            try { v.send(data); } catch (e) {}
        }
    }
}
