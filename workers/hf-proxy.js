export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        // CORS preflight
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

        // Login page: set cookie
        if (url.pathname === '/hf/login') {
            if (request.method === 'POST') {
                const formData = await request.formData();
                const cookie = formData.get('cookie') || '';

                return new Response(LOGIN_SUCCESS_HTML, {
                    status: 200,
                    headers: {
                        'Content-Type': 'text/html; charset=utf-8',
                        'Set-Cookie': `hf_session=${encodeURIComponent(cookie)}; Path=/hf; Max-Age=2592000; HttpOnly; Secure; SameSite=None`,
                    },
                });
            }
            return new Response(LOGIN_HTML, {
                headers: { 'Content-Type': 'text/html; charset=utf-8' },
            });
        }

        // Root page
        if (url.pathname === '/hf' || url.pathname === '/hf/') {
            return new Response(HTML, {
                headers: { 'Content-Type': 'text/html; charset=utf-8' },
            });
        }

        // Extract target path
        const targetPath = url.pathname.replace(/^\/hf/, '') + url.search;
        const targetUrl = 'https://huggingface.co' + targetPath;

        // Build headers
        const newHeaders = new Headers();

        // Copy original headers
        for (const [key, value] of request.headers.entries()) {
            newHeaders.set(key, value);
        }

        // Set browser-like headers
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

        // Delete proxy-revealing headers
        newHeaders.delete('Referer');
        newHeaders.delete('X-Forwarded-For');
        newHeaders.delete('X-Forwarded-Proto');
        newHeaders.delete('X-Forwarded-Host');
        newHeaders.delete('X-Real-Ip');
        newHeaders.delete('Cf-Connecting-Ip');
        newHeaders.delete('Cf-Visitor');
        newHeaders.delete('Cf-Ray');
        newHeaders.delete('X-Hedwig-Proxy');

        // Inject user's HuggingFace cookie
        const cookieHeader = request.headers.get('Cookie') || '';
        const hfSessionMatch = cookieHeader.match(/hf_session=([^;]+)/);
        if (hfSessionMatch) {
            const hfCookie = decodeURIComponent(hfSessionMatch[1]);
            // Merge with existing Cookie header
            const existingCookie = newHeaders.get('Cookie') || '';
            if (existingCookie) {
                newHeaders.set('Cookie', existingCookie + '; ' + hfCookie);
            } else {
                newHeaders.set('Cookie', hfCookie);
            }
        }

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

        // WAF challenge handling
        if (response.status === 202) {
            const body = await response.text();
            if (body.includes('challenge') || body.includes('waf') || body.includes('cf-challenge')) {
                return new Response(CHALLENGE_HTML, {
                    status: 200,
                    headers: { 'Content-Type': 'text/html; charset=utf-8' },
                });
            }
        }

        if (ct.includes('text/html')) {
            let text = await response.text();

            // Remove challenge scripts
            text = text.replace(/<script[^>]*src="[^"]*challenge[^"]*"[^>]*><\/script>/gi, '');
            text = text.replace(/<script[^>]*>[^<]*challenge[^<]*<\/script>/gi, '');
            text = text.replace(/<script[^>]*>[^<]*turnstile[^<]*<\/script>/gi, '');
            text = text.replace(/<div[^>]*class="[^"]*challenge[^"]*"[^>]*>.*?<\/div>/gis, '');
            text = text.replace(/<form[^>]*id="[^"]*challenge[^"]*"[^>]*>.*?<\/form>/gis, '');

            // Replace domain
            text = text.replace(/https?:\/\/huggingface\.co/g, 'https://hedwig.eu.org/hf');

            // Replace relative paths
            text = text.replace(/href="\/([a-zA-Z][^"]*)"/g, 'href="/hf/$1"');
            text = text.replace(/href='\/([a-zA-Z][^']*)'/g, "href='/hf/$1'");
            text = text.replace(/src="\/([a-zA-Z][^"]*)"/g, 'src="/hf/$1"');
            text = text.replace(/src='\/([a-zA-Z][^']*)'/g, "src='/hf/$1'");
            text = text.replace(/action="\/([a-zA-Z][^"]*)"/g, 'action="/hf/$1"');
            text = text.replace(/action='\/([a-zA-Z][^']*)'/g, "action='/hf/$1'");

            // Inject route interceptor
            const injectScript = `<script>
(function(){
function toProxy(u){if(!u)return u;if(u.startsWith('https://huggingface.co'))return u.replace('https://huggingface.co','https://hedwig.eu.org/hf');if(u.startsWith('http://huggingface.co'))return u.replace('http://huggingface.co','https://hedwig.eu.org/hf');if(u.startsWith('/')&&!u.startsWith('/hf/')&&!u.startsWith('//'))return'/hf'+u;return u;}
document.addEventListener('click',function(e){var a=e.target.closest('a');if(!a)return;var h=a.getAttribute('href');if(h&&(h.startsWith('/')||h.includes('huggingface.co'))){e.preventDefault();window.location.href=toProxy(h);}},true);
var op=history.pushState,or=history.replaceState;
history.pushState=function(s,t,u){return op.call(this,s,t,toProxy(u));};
history.replaceState=function(s,t,u){return or.call(this,s,t,toProxy(u));};
var of=window.fetch;
window.fetch=function(u,o){if(typeof u==='string')u=toProxy(u);return of.call(this,u,o);};
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

const LOGIN_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>HuggingFace Cookie Login - Hedwig</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a1a;color:#eee;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
.box{background:#1a1a2e;border:1px solid #333;border-radius:16px;padding:40px;max-width:500px;width:100%}
h1{color:#7c8cff;margin-bottom:10px;font-size:1.8em}
p{color:#aaa;margin-bottom:20px;line-height:1.6}
ol{color:#ccc;margin:0 0 20px 20px;line-height:2}
ol li{margin-bottom:8px}
textarea{width:100%;background:#0a0a1a;border:1px solid #333;border-radius:8px;padding:12px;color:#eee;font-family:monospace;font-size:13px;resize:vertical;min-height:120px;margin-bottom:15px}
textarea:focus{outline:none;border-color:#7c8cff}
button{width:100%;background:#4CAF50;color:#fff;border:none;border-radius:8px;padding:12px;font-size:16px;cursor:pointer}
button:hover{background:#45a049}
.tip{background:rgba(124,140,255,0.1);border-left:3px solid #7c8cff;padding:12px 15px;border-radius:0 8px 8px 0;margin:15px 0;color:#ccc;font-size:13px}
</style>
</head>
<body>
<div class="box">
<h1>HuggingFace Cookie Login</h1>
<p>通过 Cookie 登录 HuggingFace，绕过 WAF 验证。</p>
<ol>
<li>在能访问 HuggingFace 的浏览器中登录 <a href="https://huggingface.co/login" target="_blank" style="color:#7c8cff">huggingface.co</a></li>
<li>安装 <a href="https://chromewebstore.google.com/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm" target="_blank" style="color:#7c8cff">Cookie Editor</a> 扩展</li>
<li>导出 huggingface.co 的所有 Cookie</li>
<li>粘贴到下方文本框，点击登录</li>
</ol>
<form method="POST" action="/hf/login">
<textarea name="cookie" placeholder="粘贴 Cookie 内容...&#10;格式: token=xxx; session=xxx; ..."></textarea>
<button type="submit">登录</button>
</form>
<div class="tip">Cookie 将保存在浏览器中，30天内有效。仅用于代理请求，不会上传至服务器。</div>
</div>
</body>
</html>`;

const LOGIN_SUCCESS_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>登录成功 - Hedwig HF</title>
<style>
body{background:#0a0a1a;color:#eee;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.box{background:#1a1a2e;border:1px solid #333;border-radius:16px;padding:40px;text-align:center;max-width:400px}
h1{color:#4CAF50;margin-bottom:15px}
p{color:#aaa;margin-bottom:20px}
a{color:#7c8cff;text-decoration:none}
a:hover{text-decoration:underline}
</style>
</head>
<body>
<div class="box">
<h1>Cookie 设置成功！</h1>
<p>您现在可以通过代理访问 HuggingFace 了。</p>
<p><a href="/hf/models">访问模型页面</a> | <a href="/hf">返回首页</a></p>
</div>
</body>
</html>`;

const CHALLENGE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>需要登录 - Hedwig HF</title>
<style>
body{background:#0a0a1a;color:#eee;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.box{background:#1a1a2e;border:1px solid #333;border-radius:16px;padding:40px;text-align:center;max-width:450px}
h1{color:#7c8cff;margin-bottom:15px}
p{color:#aaa;margin-bottom:20px;line-height:1.8}
a{color:#4CAF50;text-decoration:none;font-size:16px}
a:hover{text-decoration:underline}
</style>
</head>
<body>
<div class="box">
<h1>需要登录</h1>
<p>HuggingFace 检测到需要验证。<br>请先通过 Cookie 登录以继续访问。</p>
<p><a href="/hf/login">前往登录页面</a></p>
</div>
</body>
</html>`;

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
.login-btn{display:inline-block;background:#4CAF50;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;margin-top:10px}
.login-btn:hover{background:#45a049}
</style>
</head>
<body>
<div class="container">
<div class="header">
<h1>Hedwig HF Proxy</h1>
<p>Direct access to huggingface.co via Cloudflare</p>
</div>
<div class="card">
<h2>登录状态</h2>
<p>网页版访问需要 <a href="/hf/login" class="login-btn">Cookie 登录</a> 以通过 HuggingFace 安全验证。</p>
</div>
<div class="card">
<h2>Quick Start</h2>
<h3>Environment Variable (无需登录)</h3>
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