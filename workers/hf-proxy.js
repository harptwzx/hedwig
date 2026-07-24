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

        // Root path: usage guide
        if (url.pathname === '/hf' || url.pathname === '/hf/') {
            return new Response(HTML, {
                headers: { 'Content-Type': 'text/html; charset=utf-8' },
            });
        }

        // Build target URL
        const targetPath = url.pathname.replace(/^\/hf/, '') + url.search;
        const targetUrl = 'https://hf-mirror.com' + targetPath;

        // Clone headers, fix Host
        const newHeaders = new Headers(request.headers);
        newHeaders.set('Host', 'hf-mirror.com');
        newHeaders.delete('Referer');

        // Forward request
        const proxyRequest = new Request(targetUrl, {
            method: request.method,
            headers: newHeaders,
            body: request.body,
        });

        const response = await fetch(proxyRequest);

        // Build response headers
        const respHeaders = new Headers(response.headers);
        respHeaders.set('Access-Control-Allow-Origin', '*');
        respHeaders.set('X-Hedwig-Proxy', 'hf-mirror.com');

        // Rewrite Location if present
        const location = respHeaders.get('location');
        if (location) {
            respHeaders.set('location', location.replace(/https?:\/\/hf-mirror\.com/g, 'https://hedwig.eu.org/hf'));
        }

        // Rewrite body for text content
        const ct = response.headers.get('content-type') || '';
        if (ct.includes('text') || ct.includes('json') || ct.includes('javascript') || ct.includes('css')) {
            const text = await response.text();
            const body = text
                .replace(/https?:\/\/huggingface\.co/g, 'https://hedwig.eu.org/hf')
                .replace(/https?:\/\/hf-mirror\.com/g, 'https://hedwig.eu.org/hf')
                .replace(/huggingface\.co/g, 'hedwig.eu.org/hf')
                .replace(/hf-mirror\.com/g, 'hedwig.eu.org/hf');
            return new Response(body, {
                status: response.status,
                statusText: response.statusText,
                headers: respHeaders,
            });
        }

        // Binary content: stream directly
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
<title>Hedwig HF Accelerator</title>
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
.tip{background:rgba(124,140,255,0.1);border-left:3px solid #7c8cff;padding:15px 20px;border-radius:0 8px 8px 0;margin:15px 0;color:#ccc}
.tip strong{color:#7c8cff}
.footer{text-align:center;color:#666;margin-top:50px;font-size:0.9em}
.footer a{color:#7c8cff;text-decoration:none}
ul{color:#ccc;line-height:2;margin-left:20px}
h3{color:#aaa;margin:20px 0 10px}
</style>
</head>
<body>
<div class="container">
<div class="header">
<h1>Hedwig HF Accelerator</h1>
<p>Fast Hugging Face access via hf-mirror.com</p>
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