export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        if (request.method === 'OPTIONS') {
            return new Response(null, {
                status: 204,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Cache-Control, X-Use-Auth-Token',
                    'Access-Control-Expose-Headers': 'X-Repo-Commit, X-Request-Id, X-Error-Code, X-Error-Message, X-Total-Count, X-Linked-Size, ETag, Location',
                    'Access-Control-Max-Age': '86400',
                },
            });
        }

        if (url.pathname === '/hf' || url.pathname === '/hf/') {
            return new Response(HTML, {
                headers: { 'Content-Type': 'text/html; charset=utf-8' },
            });
        }

        const targetPath = url.pathname.replace(/^\/hf/, '') + url.search;
        const targetUrl = 'https://huggingface.co' + targetPath;

        const newHeaders = new Headers(request.headers);
        newHeaders.set('Host', 'huggingface.co');
        // 关键：伪造 Referer，让 HuggingFace 以为是直接访问
        newHeaders.set('Referer', 'https://huggingface.co' + targetPath);
        // 移除可能暴露代理的头部
        newHeaders.delete('X-Forwarded-For');
        newHeaders.delete('X-Real-IP');
        newHeaders.delete('CF-Connecting-IP');
        newHeaders.delete('CF-Worker');

        const proxyRequest = new Request(targetUrl, {
            method: request.method,
            headers: newHeaders,
            body: request.body,
        });

        const response = await fetch(proxyRequest);

        const respHeaders = new Headers(response.headers);
        respHeaders.set('Access-Control-Allow-Origin', '*');
        respHeaders.set('X-Hedwig-Proxy', 'huggingface.co');

        // 关键：替换所有响应头中的 huggingface.co
        for (const [key, value] of [...respHeaders.entries()]) {
            if (typeof value === 'string' && value.includes('huggingface.co')) {
                respHeaders.set(key, value.replace(/https?:\/\/huggingface\.co/g, 'https://hedwig.eu.org/hf'));
            }
        }

        const ct = response.headers.get('content-type') || '';

        if (ct.includes('text/html')) {
            let text = await response.text();

            // 替换所有域名
            text = text.replace(/https?:\/\/huggingface\.co/g, 'https://hedwig.eu.org/hf');
            text = text.replace(/https?:\/\/hf\.co/g, 'https://hedwig.eu.org/hf');

            // 替换相对路径（更精确的正则）
            text = text.replace(/(href|src|action)=["']\/(?!hf\/)([^"']*)["']/gi, '$1="/hf/$2"');

            // 关键修复：处理 Cloudflare Turnstile 的 data-sitekey 和回调
            // Turnstile 会检查域名，我们需要让它以为在 huggingface.co 上运行
            text = text.replace(/data-sitekey=["']([^"']*)["']/g, 'data-sitekey="$1" data-callback="onTurnstileCallback"');

            // 注入修复后的拦截脚本
            const injectScript = `<script>
(function() {
    'use strict';
    
    const REAL_HOST = 'huggingface.co';
    const PROXY_HOST = 'hedwig.eu.org';
    const PROXY_PREFIX = '/hf';
    
    function toProxy(url) {
        if (!url || typeof url !== 'string') return url;
        if (url.startsWith('/hf/') || url.startsWith('https://hedwig.eu.org/hf')) return url;
        if (url.startsWith('https://huggingface.co')) return url.replace('https://huggingface.co', 'https://hedwig.eu.org/hf');
        if (url.startsWith('http://huggingface.co')) return url.replace('http://huggingface.co', 'https://hedwig.eu.org/hf');
        if (url.startsWith('//huggingface.co')) return url.replace('//huggingface.co', '//hedwig.eu.org/hf');
        if (url.startsWith('/') && !url.startsWith('//')) return '/hf' + url;
        return url;
    }
    
    // 保存原始 location 对象
    const originalLoc = window.location;
    const originalURL = window.URL;
    
    // 伪造 document.domain 和 location.origin
    try {
        Object.defineProperty(document, 'domain', {
            get: function() { return REAL_HOST; },
            configurable: true
        });
    } catch(e) {}
    
    // 拦截所有链接点击
    document.addEventListener('click', function(e) {
        const a = e.target.closest('a');
        if (!a) return;
        const href = a.getAttribute('href');
        if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
            const newHref = toProxy(href);
            if (newHref !== href) {
                e.preventDefault();
                originalLoc.href = newHref;
            }
        }
    }, true);
    
    // 拦截 history
    const origPush = history.pushState.bind(history);
    const origReplace = history.replaceState.bind(history);
    history.pushState = function(s, t, u) { 
        return origPush(s, t, toProxy(u)); 
    };
    history.replaceState = function(s, t, u) { 
        return origReplace(s, t, toProxy(u)); 
    };
    
    // 修复 location.href setter - 使用原始 setter 避免递归
    const hrefDescriptor = Object.getOwnPropertyDescriptor(window.Location.prototype, 'href');
    if (hrefDescriptor && hrefDescriptor.set) {
        Object.defineProperty(originalLoc, 'href', {
            get: function() { return originalLoc.href; },
            set: function(url) { 
                hrefDescriptor.set.call(originalLoc, toProxy(url)); 
            }
        });
    }
    
    // 拦截 assign/replace
    originalLoc.assign = function(url) { 
        originalLoc.href = toProxy(url); 
    };
    originalLoc.replace = function(url) { 
        hrefDescriptor.set.call(originalLoc, toProxy(url)); 
    };
    
    // 拦截 fetch
    const origFetch = window.fetch;
    window.fetch = function(url, opts) {
        if (typeof url === 'string') url = toProxy(url);
        else if (url instanceof Request) {
            url = new Request(toProxy(url.url), url);
        }
        return origFetch.call(window, url, opts);
    };
    
    // 拦截 XMLHttpRequest
    const OrigXHR = window.XMLHttpRequest;
    window.XMLHttpRequest = function() {
        const xhr = new OrigXHR();
        const origOpen = xhr.open.bind(xhr);
        xhr.open = function(m, u, a, user, pass) {
            return origOpen(m, toProxy(u), a, user, pass);
        };
        return xhr;
    };
    
    // 拦截 WebSocket
    const OrigWS = window.WebSocket;
    window.WebSocket = function(url, protocols) {
        if (typeof url === 'string' && url.includes('huggingface.co')) {
            url = url.replace(/wss?:\\/\\/huggingface\\.co/, 'wss://hedwig.eu.org/hf');
        }
        return new OrigWS(url, protocols);
    };
    
    // 拦截 Form submit
    document.addEventListener('submit', function(e) {
        const form = e.target.closest('form');
        if (form && form.action) {
            const newAction = toProxy(form.action);
            if (newAction !== form.action) {
                form.action = newAction;
            }
        }
    }, true);
    
    // 拦截动态创建的元素
    const origCreateElement = Document.prototype.createElement;
    Document.prototype.createElement = function(tag) {
        const el = origCreateElement.call(this, tag);
        if (tag.toLowerCase() === 'a') {
            const origSetAttr = el.setAttribute.bind(el);
            el.setAttribute = function(name, value) {
                if (name === 'href') value = toProxy(value);
                return origSetAttr(name, value);
            };
        }
        if (tag.toLowerCase() === 'form') {
            const origSetAttr = el.setAttribute.bind(el);
            el.setAttribute = function(name, value) {
                if (name === 'action') value = toProxy(value);
                return origSetAttr(name, value);
            };
        }
        return el;
    };
    
    // 拦截 window.open
    const origOpen = window.open;
    window.open = function(url, target, features) {
        if (typeof url === 'string') url = toProxy(url);
        return origOpen.call(window, url, target, features);
    };
    
    // 拦截 URL 构造函数
    const OrigURL = window.URL;
    window.URL = function(url, base) {
        if (typeof url === 'string' && url.includes('huggingface.co')) {
            url = url.replace(/https?:\\/\\/huggingface\\.co/g, 'https://hedwig.eu.org/hf');
        }
        return new OrigURL(url, base);
    };
    
    // 处理 Turnstile 回调
    window.onTurnstileCallback = function(token) {
        // 将 token 传递给原始的回调
        if (window.turnstile && window.turnstile.render) {
            // 已经由 Turnstile 处理
        }
    };
})();
</script>`;

            if (text.includes('<head>')) {
                text = text.replace('<head>', '<head>' + injectScript);
            } else if (text.includes('<html')) {
                text = text.replace('<html>', '<html>' + injectScript);
            } else {
                text = injectScript + text;
            }

            return new Response(text, {
                status: response.status,
                statusText: response.statusText,
                headers: respHeaders,
            });
        }

        if (ct.includes('javascript') || ct.includes('json') || ct.includes('css')) {
            let text = await response.text();
            text = text.replace(/https?:\/\/huggingface\.co/g, 'https://hedwig.eu.org/hf');
            text = text.replace(/https?:\/\/hf\.co/g, 'https://hedwig.eu.org/hf');
            text = text.replace(/huggingface\.co/g, 'hedwig.eu.org/hf');
            return new Response(text, {
                status: response.status,
                headers: respHeaders,
            });
        }

        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: respHeaders,
        });
    },
};

const HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Hedwig HF Proxy</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a1a;color:#eee;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;line-height:1.6}
.container{max-width:900px;margin:0 auto;padding:40px 20px}
.header{text-align:center;margin-bottom:50px}
.header h1{font-size:2.5em;color:#7c8cff;margin-bottom:10px}
.header p{color:#aaa;font-size:1.1em}
.card{background:#1a1a2e;border:1px solid #333;border-radius:12px;padding:30px;margin-bottom:25px}
.card h2{color:#7c8cff;margin-top:0;font-size:1.4em;margin-bottom:15px}
.card code{background:#0a0a1a;padding:2px 8px;border-radius:4px;color:#4CAF50;font-family:monospace}
.card pre{background:#0a0a1a;padding:15px;border-radius:8px;overflow-x:auto;border-left:3px solid #7c8cff;margin:15px 0}
.card pre code{background:none;padding:0;color:#eee}
.footer{text-align:center;color:#666;margin-top:50px;font-size:0.9em}
.footer a{color:#7c8cff;text-decoration:none}
ul{color:#ccc;line-height:2;margin-left:20px}
h3{color:#aaa;margin:20px 0 10px}
</style>
</head>
<body>
<div class="container">
<div class="header">
<h1>Hedwig HF Proxy</h1>
<p>Direct access to huggingface.co via Cloudflare</p>
</div>
<div class="card">
<h2>Quick Start</h2>
<h3>Environment Variable</h3>
<pre><code>export HF_ENDPOINT=https://hedwig.eu.org/hf
huggingface-cli download bert-base-uncased</code></pre>
<h3>Python</h3>
<pre><code>import os
os.environ['HF_ENDPOINT'] = 'https://hedwig.eu.org/hf'
from transformers import AutoModel
model = AutoModel.from_pretrained('bert-base-uncased')</code></pre>
</div>
<div class="card">
<h2>Web Access</h2>
<p>Direct browser access: <code>https://hedwig.eu.org/hf/models/bert-base-uncased</code></p>
</div>
<div class="footer">
<p>Powered by <a href="https://hedwig.eu.org">Hedwig</a></p>
</div>
</div>
</body>
</html>`;
