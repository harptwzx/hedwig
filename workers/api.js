// 静态文件服务 - 简单版本
const GITHUB_OWNER = 'harptwzx';
const GITHUB_REPO = 'hedwig';

async function serveStaticFile(path) {
    const url = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/public${path}`;
    try {
        const resp = await fetch(url);
        if (resp.ok) {
            const content = await resp.text();
            let contentType = 'text/html';
            if (path.endsWith('.css')) contentType = 'text/css';
            if (path.endsWith('.js')) contentType = 'application/javascript';
            return new Response(content, { headers: { 'Content-Type': contentType } });
        }
    } catch (e) {}
    return null;
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;

        // 静态文件路由
        if (path === '/' || path === '/index.html') {
            const res = await serveStaticFile('/index.html');
            if (res) return res;
            return new Response('Index not found', { status: 404 });
        }
        if (path === '/login.html') {
            const res = await serveStaticFile('/login.html');
            if (res) return res;
            return new Response('Login not found', { status: 404 });
        }
        if (path === '/register.html') {
            const res = await serveStaticFile('/register.html');
            if (res) return res;
            return new Response('Register not found', { status: 404 });
        }
        if (path === '/css/common.css') {
            const res = await serveStaticFile('/css/common.css');
            if (res) return res;
            return new Response('CSS not found', { status: 404 });
        }
        if (path === '/js/common.js') {
            const res = await serveStaticFile('/js/common.js');
            if (res) return res;
            return new Response('JS not found', { status: 404 });
        }

        return new Response('Not Found', { status: 404 });
    }
};