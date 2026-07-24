export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        if (url.pathname === '/hf' || url.pathname === '/hf/') {
            return new Response(`
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>HF Debug</title></head>
<body style="background:#0a0a1a;color:#eee;font-family:monospace;padding:20px">
<h2 style="color:#7c8cff">Hedwig HF Proxy - Debug Mode</h2>
<p>Test URLs:</p>
<ul>
<li><a href="/hf/models/bert-base-uncased" style="color:#4CAF50">/hf/models/bert-base-uncased</a></li>
<li><a href="/hf/api/models/bert-base-uncased" style="color:#4CAF50">/hf/api/models/bert-base-uncased</a></li>
<li><a href="/hf/bert-base-uncased/resolve/main/config.json" style="color:#4CAF50">/hf/bert-base-uncased/resolve/main/config.json</a></li>
</ul>
<p style="color:#888">Check browser dev tools (F12) for request details</p>
</body>
</html>`, { headers: { 'Content-Type': 'text/html' } });
        }

        const targetPath = url.pathname.replace(/^\/hf/, '') + url.search;
        const targetUrl = 'https://huggingface.co' + targetPath;

        // 精确复制原始请求头
        const newHeaders = new Headers(request.headers);
        newHeaders.set('Host', 'huggingface.co');

        const proxyRequest = new Request(targetUrl, {
            method: request.method,
            headers: newHeaders,
            body: request.body,
            redirect: 'manual',  // 手动处理重定向，方便调试
        });

        const response = await fetch(proxyRequest);

        // 收集调试信息
        const debugInfo = {
            request: {
                url: request.url,
                method: request.method,
                targetUrl: targetUrl,
            },
            response: {
                status: response.status,
                statusText: response.statusText,
                headers: Object.fromEntries(response.headers.entries()),
            },
        };

        // 如果是重定向，返回调试信息而不是跟随
        if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get('location') || '';
            return new Response(JSON.stringify({
                ...debugInfo,
                type: 'REDIRECT',
                location: location,
                note: 'HuggingFace returned redirect. Check if location needs rewriting.',
            }, null, 2), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // 正常响应，添加调试头
        const respHeaders = new Headers(response.headers);
        respHeaders.set('X-Hedwig-Debug', JSON.stringify({
            status: response.status,
            target: targetUrl,
        }));

        // 文本内容添加调试注释
        const ct = response.headers.get('content-type') || '';
        if (ct.includes('text/html')) {
            const text = await response.text();
            const debugScript = `<script>console.log('[Hedwig Proxy]', ${JSON.stringify(debugInfo)});</script>`;
            const body = text.replace('</head>', debugScript + '</head>');
            return new Response(body, {
                status: response.status,
                headers: respHeaders,
            });
        }

        return new Response(response.body, {
            status: response.status,
            headers: respHeaders,
        });
    },
};