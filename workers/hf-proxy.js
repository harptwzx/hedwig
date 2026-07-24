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

        // 所有 /hf/* 请求都代理到 huggingface.co
        const targetPath = url.pathname.replace(/^\/hf/, '') + url.search;
        const targetUrl = 'https://huggingface.co' + targetPath;

        const newHeaders = new Headers(request.headers);
        newHeaders.set('Host', 'huggingface.co');

        const proxyRequest = new Request(targetUrl, {
            method: request.method,
            headers: newHeaders,
            body: request.body,
        });

        const response = await fetch(proxyRequest);

        const respHeaders = new Headers(response.headers);
        respHeaders.set('Access-Control-Allow-Origin', '*');
        respHeaders.set('X-Hedwig-Proxy', 'huggingface.co');

        const location = respHeaders.get('location');
        if (location) {
            respHeaders.set('location', location.replace(/https?:\/\/huggingface\.co/g, 'https://hedwig.eu.org/hf'));
        }

        const ct = response.headers.get('content-type') || '';

        // HTML: 注入代理脚本，替换路径
        if (ct.includes('text/html')) {
            let text = await response.text();

            // 替换所有域名引用
            text = text.replace(/https?:\/\/huggingface\.co/g, 'https://hedwig.eu.org/hf');

            // 关键: 替换相对路径的 href/src/action
            // 但要排除已经是 /hf/ 开头的路径
            text = text.replace(/href="\/([a-zA-Z][^"]*)"/g, 'href="/hf/$1"');
            text = text.replace(/href='\/([a-zA-Z][^']*)'/g, "href='/hf/$1'");
            text = text.replace(/src="\/([a-zA-Z][^"]*)"/g, 'src="/hf/$1"');
            text = text.replace(/src='\/([a-zA-Z][^']*)'/g, "src='/hf/$1'");
            text = text.replace(/action="\/([a-zA-Z][^"]*)"/g, 'action="/hf/$1"');
            text = text.replace(/action='\/([a-zA-Z][^']*)'/g, "action='/hf/$1'");

            // 注入全局拦截脚本 (放在最前面，确保最先执行)
            const injectScript = `<script>
(function() {
    'use strict';
    const PROXY_PREFIX = '/hf';

    function toProxy(url) {
        if (!url) return url;
        if (url.startsWith('https://huggingface.co')) {
            return url.replace('https://huggingface.co', 'https://hedwig.eu.org/hf');
        }
        if (url.startsWith('http://huggingface.co')) {
            return url.replace('http://huggingface.co', 'https://hedwig.eu.org/hf');
        }
        if (url.startsWith('/') && !url.startsWith('/hf/') && !url.startsWith('//')) {
            return '/hf' + url;
        }
        return url;
    }

    // 拦截所有链接点击
    document.addEventListener('click', function(e) {
        const a = e.target.closest('a');
        if (!a) return;
        const href = a.getAttribute('href');
        if (href && (href.startsWith('/') || href.includes('huggingface.co'))) {
            e.preventDefault();
            window.location.href = toProxy(href);
        }
    }, true);

    // 拦截 history
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function(s, t, u) { return origPush.call(this, s, t, toProxy(u)); };
    history.replaceState = function(s, t, u) { return origReplace.call(this, s, t, toProxy(u)); };

    // 拦截 location
    const loc = window.location;
    let currentHref = loc.href;
    Object.defineProperty(window, 'location', {
        get: function() { return loc; },
        set: function(url) { loc.href = toProxy(url); }
    });
    Object.defineProperty(window.location, 'href', {
        get: function() { return currentHref; },
        set: function(url) { currentHref = toProxy(url); loc.href = currentHref; }
    });
    ['assign', 'replace'].forEach(function(m) {
        var orig = loc[m];
        loc[m] = function(url) { return orig.call(this, toProxy(url)); };
    });

    // 拦截 fetch
    const origFetch = window.fetch;
    window.fetch = function(url, opts) {
        if (typeof url === 'string') url = toProxy(url);
        else if (url && url.url) url = new Request(toProxy(url.url), url);
        return origFetch.call(this, url, opts);
    };

    // 拦截 XMLHttpRequest
    const OrigXHR = window.XMLHttpRequest;
    window.XMLHttpRequest = function() {
        const xhr = new OrigXHR();
        const origOpen = xhr.open;
        xhr.open = function(m, u, a, user, pass) {
            return origOpen.call(this, m, toProxy(u), a, user, pass);
        };
        return xhr;
    };

    // 拦截 WebSocket (HuggingFace 可能用)
    const OrigWS = window.WebSocket;
    window.WebSocket = function(url, protocols) {
        if (typeof url === 'string' && url.startsWith('wss://huggingface.co')) {
            url = url.replace('wss://huggingface.co', 'wss://hedwig.eu.org/hf');
        }
        return new OrigWS(url, protocols);
    };

    // 拦截 Form submit
    document.addEventListener('submit', function(e) {
        const form = e.target;
        if (form && form.action) {
            const newAction = toProxy(form.action);
            if (newAction !== form.action) {
                form.action = newAction;
            }
        }
    }, true);

    // 拦截动态创建的 a 标签
    const origCreateElement = Document.prototype.createElement;
    Document.prototype.createElement = function(tag) {
        const el = origCreateElement.call(this, tag);
        if (tag.toLowerCase() === 'a') {
            const origSetAttr = el.setAttribute;
            el.setAttribute = function(name, value) {
                if (name === 'href') value = toProxy(value);
                return origSetAttr.call(this, name, value);
            };
        }
        return el;
    };
})();
</script>`;

            // 注入到 <head> 最前面
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

        // JS/CSS/JSON: 替换域名
        if (ct.includes('javascript') || ct.includes('json') || ct.includes('css')) {
            let text = await response.text();
            text = text.replace(/https?:\/\/huggingface\.co/g, 'https://hedwig.eu.org/hf');
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