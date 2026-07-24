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

        // 判断是否是 HuggingFace 代理请求
        // 支持两种路径: /hf/xxx 和 /xxx (通过 Referer 判断)
        let targetPath;
        const referer = request.headers.get('referer') || '';

        if (url.pathname.startsWith('/hf/')) {
            targetPath = url.pathname.replace(/^\/hf/, '') + url.search;
        } else if (referer.includes('/hf/')) {
            // 从 HF 页面发起的请求，路径也应该代理
            targetPath = url.pathname + url.search;
        } else {
            // 不是 HF 相关请求，返回 404
            return new Response('Not Found', { status: 404 });
        }

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
        if (ct.includes('text/html')) {
            let text = await response.text();

            // 注入 <base> 标签，让所有相对路径以 /hf 为基准
            const baseTag = '<base href="https://hedwig.eu.org/hf/">';
            if (text.includes('<head>')) {
                text = text.replace('<head>', '<head>' + baseTag);
            } else if (text.includes('<html')) {
                text = text.replace('<html', baseTag + '<html');
            }

            // 注入路由拦截脚本
            const routeScript = `<script>
(function() {
    // 拦截所有导航到 huggingface.co 的链接
    document.addEventListener('click', function(e) {
        const el = e.target.closest('a');
        if (el && el.href) {
            const url = new URL(el.href);
            if (url.hostname === 'huggingface.co' || url.hostname === 'hf-mirror.com') {
                e.preventDefault();
                window.location.href = 'https://hedwig.eu.org/hf' + url.pathname + url.search;
            } else if (url.hostname === location.hostname && !url.pathname.startsWith('/hf/')) {
                e.preventDefault();
                window.location.href = 'https://hedwig.eu.org/hf' + url.pathname + url.search;
            }
        }
    });

    // 拦截 history.pushState / replaceState
    const originalPush = history.pushState;
    const originalReplace = history.replaceState;

    history.pushState = function(state, title, url) {
        if (url && url.startsWith('/')) url = '/hf' + url;
        return originalPush.call(this, state, title, url);
    };

    history.replaceState = function(state, title, url) {
        if (url && url.startsWith('/')) url = '/hf' + url;
        return originalReplace.call(this, state, title, url);
    };

    // 拦截 location.href 赋值
    let currentHref = location.href;
    Object.defineProperty(window.location, 'href', {
        get: function() { return currentHref; },
        set: function(url) {
            if (url.startsWith('/')) url = '/hf' + url;
            currentHref = url;
            window.location.assign(url);
        }
    });

    // 拦截 fetch API，重写 huggingface.co 的请求
    const originalFetch = window.fetch;
    window.fetch = function(url, options) {
        if (typeof url === 'string') {
            if (url.startsWith('https://huggingface.co')) {
                url = url.replace('https://huggingface.co', 'https://hedwig.eu.org/hf');
            } else if (url.startsWith('/')) {
                url = '/hf' + url;
            }
        }
        return originalFetch.call(this, url, options);
    };

    // 拦截 XMLHttpRequest
    const OriginalXHR = window.XMLHttpRequest;
    window.XMLHttpRequest = function() {
        const xhr = new OriginalXHR();
        const originalOpen = xhr.open;
        xhr.open = function(method, url, async, user, password) {
            if (typeof url === 'string') {
                if (url.startsWith('https://huggingface.co')) {
                    url = url.replace('https://huggingface.co', 'https://hedwig.eu.org/hf');
                } else if (url.startsWith('/')) {
                    url = '/hf' + url;
                }
            }
            return originalOpen.call(this, method, url, async, user, password);
        };
        return xhr;
    };
})();
</script>`;

            text = text.replace('</head>', routeScript + '</head>');

            // 替换域名引用
            text = text
                .replace(/https?:\/\/huggingface\.co/g, 'https://hedwig.eu.org/hf')
                .replace(/huggingface\.co/g, 'hedwig.eu.org/hf');

            return new Response(text, {
                status: response.status,
                statusText: response.statusText,
                headers: respHeaders,
            });
        }

        if (ct.includes('javascript')) {
            let text = await response.text();
            // JS 里的路径也需要处理
            text = text
                .replace(/"\/([^"]*?)"/g, '"/hf/$1"')
                .replace(/'\/([^']*?)'/g, "'/hf/$1'")
                .replace(/https?:\/\/huggingface\.co/g, 'https://hedwig.eu.org/hf')
                .replace(/huggingface\.co/g, 'hedwig.eu.org/hf');
            return new Response(text, {
                status: response.status,
                headers: respHeaders,
            });
        }

        if (ct.includes('json') || ct.includes('css')) {
            let text = await response.text();
            text = text
                .replace(/https?:\/\/huggingface\.co/g, 'https://hedwig.eu.org/hf')
                .replace(/huggingface\.co/g, 'hedwig.eu.org/hf');
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