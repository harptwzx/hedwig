// tscn2.js — TSCN 纯前端渲染路由
// 直接在用户浏览器里渲染 3D 场景，无需服务器截图推流。

const CONFIG = {
    owner: 'harptwzx',
    repo: 'hedwig'
};

const contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.json': 'application/json; charset=utf-8'
};

function getContentType(path) {
    for (const ext in contentTypes) {
        if (path.endsWith(ext)) return contentTypes[ext];
    }
    return 'application/octet-stream';
}

async function serveStaticFile(path) {
    const url = `https://raw.githubusercontent.com/${CONFIG.owner}/${CONFIG.repo}/main/public${path}`;
    try {
        const response = await fetch(url, {
            headers: { 'User-Agent': 'Hedwig-Worker' }
        });
        if (response.ok) {
            const content = await response.text();
            return new Response(content, {
                headers: {
                    'Content-Type': getContentType(path),
                    'Cache-Control': 'public, max-age=60'
                }
            });
        }
    } catch (error) {}
    return null;
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        let path = url.pathname;

        // /tscn2 和 /tscn2/ 都指向渲染页面
        if (path === '/tscn2' || path === '/tscn2/') {
            path = '/tscn2/index.html';
        }

        if (path.startsWith('/tscn2/')) {
            const res = await serveStaticFile(path);
            if (res) return res;
            return new Response('Not Found', { status: 404 });
        }

        return new Response('Not Found', { status: 404 });
    }
};