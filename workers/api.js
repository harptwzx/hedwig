// 读取 GitHub 仓库中的静态文件
async function serveStaticFile(path) {
    // 从你的 GitHub 仓库获取 HTML/CSS/JS 文件
    const response = await fetch(`https://raw.githubusercontent.com/harptwzx/hedwig/main/public${path}`);
    if (response.ok) {
        return response;
    }
    return null;
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        
        // API 路由
        if (url.pathname === '/auth/login') {
            // GitHub OAuth 逻辑
        }
        
        // 静态文件路由
        let staticFile = await serveStaticFile(url.pathname);
        if (staticFile) {
            return staticFile;
        }
        
        // 默认返回 index.html
        return serveStaticFile('/index.html');
    }
};