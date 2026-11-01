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
    '.mjs': 'application/javascript; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.json': 'application/json; charset=utf-8',
    '.glb': 'model/gltf-binary',
    '.gltf': 'model/gltf+json',
    '.bin': 'application/octet-stream'
};

function getContentType(path) {
    const dot = path.lastIndexOf('.');
    const ext = dot >= 0 ? path.slice(dot).toLowerCase() : '';
    return contentTypes[ext] || 'application/octet-stream';
}

const textExts = new Set(['.html', '.css', '.js', '.mjs', '.svg', '.json', '.gltf']);

async function serveStaticFile(path) {
    const url = `https://raw.githubusercontent.com/${CONFIG.owner}/${CONFIG.repo}/main/public${path}`;
    try {
        const response = await fetch(url, {
            headers: { 'User-Agent': 'Hedwig-Worker' }
        });
        if (response.ok) {
            const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
            const body = textExts.has(ext) ? await response.text() : await response.arrayBuffer();
            return new Response(body, {
                headers: {
                    'Content-Type': getContentType(path),
                    'Cache-Control': 'public, max-age=300'
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
