// tscn.js — TSCN 3D 场景查看器路由
// 负责把 public/tscn/ 目录下的查看器页面分发给用户。
// 真正的 3D 渲染在独立的 Godot 推流服务器上完成，本模块只做页面分发。

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

        // /tscn 和 /tscn/ 都指向查看器首页
        if (path === '/tscn' || path === '/tscn/') {
            path = '/tscn/index.html';
        }

        if (path.startsWith('/tscn/')) {
            const res = await serveStaticFile(path);
            if (res) return res;
            return new Response('Not Found', { status: 404 });
        }

        return new Response('Not Found', { status: 404 });
    }
};
