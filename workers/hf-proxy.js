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

        // 构建更真实的浏览器请求头，绕过 WAF
        const newHeaders = new Headers();

        // 复制原始请求头
        for (const [key, value] of request.headers.entries()) {
            newHeaders.set(key, value);
        }

        // 强制设置关键头，模拟真实浏览器
        newHeaders.set('Host', 'huggingface.co');
        newHeaders.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');
        newHeaders.set('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8');
        newHeaders.set('Accept-Language', 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7');
        newHeaders.set('Accept-Encoding', 'gzip, deflate, br');
        newHeaders.set('Sec-Ch-Ua', '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"');
        newHeaders.set('Sec-Ch-Ua-Mobile', '?0');
        newHeaders.set('Sec-Ch-Ua-Platform', '"Windows"');
        newHeaders.set('Sec-Fetch-Dest', 'document');
        newHeaders.set('Sec-Fetch-Mode', 'navigate');
        newHeaders.set('Sec-Fetch-Site', 'none');
        newHeaders.set('Sec-Fetch-User', '?1');
        newHeaders.set('Upgrade-Insecure-Requests', '1');
        newHeaders.set('Cache-Control', 'max-age=0');

        // 删除可能暴露代理的头
        newHeaders.delete('Referer');
        newHeaders.delete('X-Forwarded-For');
        newHeaders.delete('X-Forwarded-Proto');
        newHeaders.delete('X-Forwarded-Host');
        newHeaders.delete('X-Real-Ip');
        newHeaders.delete('Cf-Connecting-Ip');
        newHeaders.delete('Cf-Visitor');
        newHeaders.delete('Cf-Ray');
        newHeaders.delete('X-Hedwig-Proxy');

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

        // 如果返回 202 (WAF challenge)，尝试返回一个提示页面
        if (response.status === 202) {
            const body = await response.text();
            // 检查是否是 challenge 页面
            if (body.includes('challenge') || body.includes('waf') || body.includes('cf-challenge')) {
                return new Response(CHALLENGE_HTML, {
                    status: 200,
                    headers: { 'Content-Type': 'text/html; charset=utf-8' },
                });
            }
        }

        if (ct.includes('text/html')) {
            let text = await response.text();

            // 删除 WAF challenge 相关脚本
            text = text.replace(/<script[^>]*src="[^"]*challenge[^"]*"[^>]*><\/script>/gi, '');
            text = text.replace(/<script[^>]*>[^<]*challenge[^<]*<\/script>/gi, '');
            text = text.replace(/<script[^>]*>[^<]*turnstile[^<]*<\/script>/gi, '');
            text = text.replace(/<div[^>]*class="[^"]*challenge[^"]*"[^>]*>.*?<\/div>/gis, '');
            text = text.replace(/<form[^>]*id="[^"]*challenge[^"]*"[^>]*>.*?<\/form>/gis, '');

            // 替换域名
            text = text.replace(/https?:\/\/huggingface\.co/g, 'https://hedwig.eu.org/hf');

            // 替换相对路径
            text = text.replace(/href="\/([a-zA-Z][^"]*)"/g, 'href="/hf/$1"');
            text = text.replace(/href='\/([a-zA-Z][^']*)'/g, "href='/hf/$1'");
            text = text.replace(/src="\/([a-zA-Z][^"]*)"/g, 'src="/hf/$1"');
            text = text.replace(/src='\/([a-zA-Z][^']*)'/g, "src='/hf/$1'");
            text = text.replace(/action="\/([a-zA-Z][^"]*)"/g, 'action="/hf/$1"');
            text = text.replace(/action='\/([a-zA-Z][^']*)'/g, "action='/hf/$1'");

            // 注入路由拦截
            const injectScript = `<script>
(function() {
    const PROXY_PREFIX = '/hf';
    function toProxy(url) {
        if (!url) return url;
        if (url.startsWith('https://huggingface.co')) return url.replace('https://huggingface.co', 'https://hedwig.eu.org/hf');
        if (url.startsWith('http://huggingface.co')) return url.replace('http://huggingface.co', 'https://hedwig.eu.org/hf');
        if (url.startsWith('/') && !url.startsWith('/hf/') && !url.startsWith('//')) return '/hf' + url;
        return url;
    }
    document.addEventListener('click', function(e) {
        const a = e.target.closest('a');
        if (!a) return;
        const href = a.getAttribute('href');
        if (href && (href.startsWith('/') || href.includes('huggingface.co'))) {
            e.preventDefault();
            window.location.href = toProxy(href);
        }
    }, true);
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function(s, t, u) { return origPush.call(this, s, t, toProxy(u)); };
    history.replaceState = function(s, t, u) { return origReplace.call(this, s, t, toProxy(u)); };
    const origFetch = window.fetch;
    window.fetch = function(url, opts) {
        if (typeof url === 'string') url = toProxy(url);
        return origFetch.call(this, url, opts);
    };
})();
</script>`;

            if (text.includes('<head>')) {
                text = text.replace('<head>', '<head>' + injectScript);
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

const CHALLENGE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>访问受限 - Hedwig HF Proxy</title>
<style>
body{background:#0a0a1a;color:#eee;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.box{background:#1a1a2e;border:1px solid #333;border-radius:12px;padding:40px;max-width:500px;text-align:center}
h1{color:#7c8cff;margin-bottom:15px}
p{color:#aaa;line-height:1.8}
.code{background:#0a0a1a;padding:15px;border-radius:8px;margin:20px 0;font-family:monospace;color:#4CAF50;text-align:left}
</style>
</head>
<body>
<div class="box">
<h1>访问受限</h1>
<p>Hugging Face 检测到异常流量，触发了安全验证。</p>
<p>网页版代理暂时无法使用，请使用以下方式访问：</p>
<div class="code">export HF_ENDPOINT=https://hedwig.eu.org/hf
huggingface-cli download bert-base-uncased</div>
<p>或使用 Python API 直接下载模型文件。</p>
</div>
</body>
</html>`;