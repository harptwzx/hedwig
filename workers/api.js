// 从 GitHub 仓库获取静态文件的函数
async function serveStaticFile(path) {
    // 注意：path 应该像 /index.html 或 /css/common.css
    // 你的仓库中静态文件在 public 目录下
    const repo = 'harptwzx/hedwig';
    const branch = 'main';
    // 关键：拼接正确的路径，public 目录在仓库根目录下
    const fileUrl = `https://raw.githubusercontent.com/${repo}/${branch}/public${path}`;
    
    console.log('Fetching:', fileUrl); // 调试用
    
    try {
        const response = await fetch(fileUrl);
        if (response.ok) {
            const content = await response.text();
            // 根据文件扩展名设置正确的 Content-Type
            let contentType = 'text/html';
            if (path.endsWith('.css')) contentType = 'text/css';
            if (path.endsWith('.js')) contentType = 'application/javascript';
            
            return new Response(content, {
                headers: { 'Content-Type': contentType }
            });
        } else {
            console.log('File not found:', fileUrl, 'Status:', response.status);
        }
    } catch (e) {
        console.error('Fetch error:', e);
    }
    return null;
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        
        // 调试：打印请求的路径
        console.log('Request path:', url.pathname);
        
        // 静态文件路由
        // 首页
        if (url.pathname === '/' || url.pathname === '/index.html') {
            const response = await serveStaticFile('/index.html');
            if (response) return response;
            return new Response('Index not found', { status: 404 });
        }
        
        // 登录页
        if (url.pathname === '/login.html') {
            const response = await serveStaticFile('/login.html');
            if (response) return response;
            return new Response('Login page not found', { status: 404 });
        }
        
        // CSS 文件
        if (url.pathname === '/css/common.css') {
            const response = await serveStaticFile('/css/common.css');
            if (response) return response;
            return new Response('CSS not found', { status: 404 });
        }
        
        // JS 文件
        if (url.pathname === '/js/common.js') {
            const response = await serveStaticFile('/js/common.js');
            if (response) return response;
            return new Response('JS not found', { status: 404 });
        }
        
        // 其他路径返回 404
        return new Response('Not Found', { status: 404 });
    }
};