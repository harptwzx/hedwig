/**
 * Hedwig Hugging Face Accelerator (Hidden Feature)
 * 
 * Routes: /hf/* -> Proxy to hf-mirror.com
 * Usage: Replace huggingface.co with hedwig.eu.org/hf
 */

const MIRRORS = [
    'https://hf-mirror.com',
    'https://huggingface.modelscope.cn',
];

function corsHeaders(origin) {
    return {
        'Access-Control-Allow-Origin': origin || '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Cache-Control',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Max-Age': '86400',
    };
}

function generateRequestId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

function cloneHeaders(headers, targetHost) {
    const newHeaders = new Headers();
    for (const [key, value] of headers.entries()) {
        const lowerKey = key.toLowerCase();
        if (lowerKey === 'host') continue;
        if (lowerKey === 'referer') {
            newHeaders.set(key, value.replace(/hedwig\.eu\.org/g, targetHost));
            continue;
        }
        newHeaders.set(key, value);
    }
    return newHeaders;
}

function rewriteHeaders(headers, proxyHost) {
    const newHeaders = new Headers();
    for (const [key, value] of headers.entries()) {
        let newValue = value;
        const lowerKey = key.toLowerCase();
        if (lowerKey === 'location') {
            newValue = value
                .replace(/https?:\/\/huggingface\.co/gi, proxyHost)
                .replace(/https?:\/\/hf-mirror\.com/gi, proxyHost)
                .replace(/https?:\/\/huggingface\.modelscope\.cn/gi, proxyHost);
        }
        if (lowerKey === 'set-cookie') {
            newValue = value.replace(/domain=[^;]+/gi, 'Domain=hedwig.eu.org');
        }
        if (lowerKey === 'content-security-policy') {
            newValue = value
                .replace(/huggingface\.co/g, 'hedwig.eu.org/hf')
                .replace(/hf-mirror\.com/g, 'hedwig.eu.org/hf');
        }
        newHeaders.set(key, newValue);
    }
    return newHeaders;
}

async function rewriteBody(response, proxyHost) {
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text') && 
        !contentType.includes('json') && 
        !contentType.includes('javascript') &&
        !contentType.includes('xml') &&
        !contentType.includes('css')) {
        return response.body;
    }

    const text = await response.text();
    return text
        .replace(/https?:\/\/huggingface\.co/gi, proxyHost)
        .replace(/huggingface\.co/gi, 'hedwig.eu.org/hf')
        .replace(/https?:\/\/hf-mirror\.com/gi, proxyHost)
        .replace(/hf-mirror\.com/gi, 'hedwig.eu.org/hf')
        .replace(/https?:\/\/huggingface\.modelscope\.cn/gi, proxyHost)
        .replace(/huggingface\.modelscope\.cn/gi, 'hedwig.eu.org/hf')
        .replace(/cdn\.huggingface\.co/gi, 'cdn.hf-mirror.com');
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const requestId = generateRequestId();

        if (request.method === 'OPTIONS') {
            return new Response(null, {
                status: 204,
                headers: corsHeaders(request.headers.get('origin')),
            });
        }

        // Root path shows usage guide
        if (url.pathname === '/hf' || url.pathname === '/hf/') {
            return new Response(HF_PROXY_HTML, {
                headers: {
                    'Content-Type': 'text/html; charset=utf-8',
                    ...corsHeaders(),
                },
            });
        }

        const targetPath = url.pathname.replace(/^\/hf/, '') || '/';
        const targetQuery = url.search;

        let lastError = null;
        for (const mirror of MIRRORS) {
            try {
                const targetUrl = mirror + targetPath + targetQuery;
                const newHeaders = cloneHeaders(request.headers, mirror.replace('https://', ''));
                newHeaders.set('Host', mirror.replace('https://', ''));

                const proxyRequest = new Request(targetUrl, {
                    method: request.method,
                    headers: newHeaders,
                    body: request.body,
                    redirect: 'manual',
                });

                const response = await fetch(proxyRequest, {
                    cf: { cacheTtl: 300, cacheEverything: true },
                });

                const rewrittenHeaders = rewriteHeaders(response.headers, 'https://hedwig.eu.org/hf');
                rewrittenHeaders.set('X-Hedwig-HF-Proxy', 'true');
                rewrittenHeaders.set('X-Hedwig-Request-Id', requestId);
                rewrittenHeaders.set('X-Hedwig-Mirror', mirror);

                if ([301, 302, 303, 307, 308].includes(response.status)) {
                    return new Response(null, {
                        status: response.status,
                        headers: { ...rewrittenHeaders, ...corsHeaders() },
                    });
                }

                const body = await rewriteBody(response, 'https://hedwig.eu.org/hf');

                return new Response(body, {
                    status: response.status,
                    statusText: response.statusText,
                    headers: { ...rewrittenHeaders, ...corsHeaders() },
                });

            } catch (error) {
                lastError = error;
                console.error(`Mirror ${mirror} failed:`, error);
                continue;
            }
        }

        return new Response(JSON.stringify({
            error: 'All mirrors unavailable',
            requestId,
            mirrors: MIRRORS,
            lastError: lastError ? lastError.message : null,
        }), {
            status: 502,
            headers: { 'Content-Type': 'application/json', ...corsHeaders() },
        });
    },
};

const HF_PROXY_HTML = `<!DOCTYPE html>
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
.mirror-status{display:flex;gap:15px;flex-wrap:wrap;margin-top:15px}
.mirror-item{background:#0a0a1a;padding:10px 20px;border-radius:8px;display:flex;align-items:center;gap:8px;color:#ccc}
.status-dot{width:8px;height:8px;border-radius:50%;background:#4CAF50}
.footer{text-align:center;color:#666;margin-top:50px;font-size:0.9em}
.footer a{color:#7c8cff;text-decoration:none}
ul{color:#ccc;line-height:2;margin-left:20px}
h3{color:#aaa;margin:20px 0 10px}
</style>
</head>
<body>
<div class="container">
<div class="header">
<div style="font-size:64px;margin-bottom:15px">🤗</div>
<h1>Hedwig Hugging Face Accelerator</h1>
<p>Fast and stable Hugging Face access for China users</p>
</div>

<div class="card">
<h2>📖 How It Works</h2>
<p>This proxy forwards all <code>huggingface.co</code> requests to domestic mirrors.</p>
<div class="tip">
<strong>Core:</strong> Replace <code>huggingface.co</code> with <code>hedwig.eu.org/hf</code> to accelerate all Hugging Face resources.
</div>
</div>

<div class="card">
<h2>⚡ Quick Start</h2>
<h3>Method 1: Environment Variable (Recommended)</h3>
<pre><code># Linux / macOS
export HF_ENDPOINT=https://hedwig.eu.org/hf

# Windows PowerShell
$env:HF_ENDPOINT = "https://hedwig.eu.org/hf"

# Then use huggingface-cli normally
huggingface-cli download meta-llama/Llama-3-8B</code></pre>

<h3>Method 2: Python Code</h3>
<pre><code>import os
os.environ['HF_ENDPOINT'] = 'https://hedwig.eu.org/hf'

from transformers import AutoModel, AutoTokenizer
model = AutoModel.from_pretrained('bert-base-uncased')</code></pre>

<h3>Method 3: Direct Web Access</h3>
<p>Visit directly: <code>https://hedwig.eu.org/hf/models/bert-base-uncased</code></p>
</div>

<div class="card">
<h2>🌐 Mirror Status</h2>
<div class="mirror-status">
<div class="mirror-item"><span class="status-dot"></span><span>hf-mirror.com (Primary)</span></div>
<div class="mirror-item"><span class="status-dot"></span><span>huggingface.modelscope.cn (Backup)</span></div>
</div>
<p style="color:#888;margin-top:15px;font-size:0.9em">Auto-selects optimal mirror. Falls back automatically.</p>
</div>

<div class="card">
<h2>📦 Supported Resources</h2>
<ul>
<li>🤖 <strong>Models</strong> - All public model repos</li>
<li>📊 <strong>Datasets</strong> - All public datasets</li>
<li>🚀 <strong>Spaces</strong> - Hugging Face Spaces</li>
<li>📄 <strong>Model Cards & Docs</strong> - Full web interface</li>
<li>📥 <strong>File Downloads</strong> - LFS large files</li>
<li>🔍 <strong>Search & API</strong> - Hub API calls</li>
</ul>
</div>

<div class="card">
<h2>⚠️ Notes</h2>
<ul>
<li>Only proxies public resources. <strong>Gated models requiring login are not supported.</strong></li>
<li>For large files, use <code>huggingface-cli</code> or <code>hf_transfer</code></li>
<li>Mirror sync may have delays</li>
<li>Please use responsibly</li>
</ul>
</div>

<div class="footer">
<p>Powered by <a href="https://hedwig.eu.org">Hedwig</a> | Accelerated by Cloudflare Workers</p>
<p style="font-size:0.8em;margin-top:10px">For educational and research purposes only</p>
</div>
</div>
</body>
</html>`;