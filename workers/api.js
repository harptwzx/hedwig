export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        
        // 简单的 HTML 页面
        const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Hedwig · 魔法世界</title>
    <style>
        body {
            font-family: system-ui, sans-serif;
            background: #0f172a;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            color: #e2e8f0;
        }
        .card {
            background: #1e293b;
            padding: 2rem;
            border-radius: 1rem;
            text-align: center;
        }
        h1 { color: #fbbf24; }
        .domain { 
            background: #334155; 
            padding: 0.5rem; 
            border-radius: 0.5rem;
            margin: 1rem 0;
            font-family: monospace;
        }
        button {
            background: #fbbf24;
            color: #0f172a;
            border: none;
            padding: 0.5rem 1rem;
            border-radius: 0.5rem;
            margin-top: 1rem;
            cursor: pointer;
        }
    </style>
</head>
<body>
    <div class="card">
        <h1>🦉 Hedwig</h1>
        <p>Worker 正在运行！</p>
        <div class="domain" id="domain"></div>
        <button onclick="fetchUser()">测试 API</button>
        <p id="result" style="margin-top: 1rem; font-size: 0.85rem; color: #94a3b8;"></p>
    </div>
    <script>
        document.getElementById('domain').textContent = window.location.href;
        
        async function fetchUser() {
            const result = document.getElementById('result');
            result.textContent = '请求中...';
            try {
                const resp = await fetch('/api/test');
                const data = await resp.json();
                result.textContent = JSON.stringify(data);
            } catch(e) {
                result.textContent = '错误: ' + e.message;
            }
        }
    </script>
</body>
</html>`;

        // 处理不同路径
        if (url.pathname === '/' || url.pathname === '/index.html') {
            return new Response(html, {
                headers: { 'Content-Type': 'text/html' }
            });
        }
        
        if (url.pathname === '/api/test') {
            return new Response(JSON.stringify({ 
                status: 'ok', 
                message: 'API 工作正常', 
                time: new Date().toISOString(),
                domain: url.hostname
            }), {
                headers: { 'Content-Type': 'application/json' }
            });
        }
        
        // 其他路径返回 404
        return new Response(JSON.stringify({ error: 'Not Found', path: url.pathname }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};