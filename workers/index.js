// workers/index.js
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        
        // Hugging Face 代理路由
        if (url.pathname.startsWith('/hf')) {
            const hfProxy = await import('./hf-proxy.js');
            return hfProxy.default.fetch(request, env, ctx);
        }
        
        // 文件传输系统路由
        if (url.pathname.startsWith('/share')) {
            const hfProxy = await import('./share/file-share.js');
            return hfProxy.default.fetch(request, env, ctx);
        }

        // 原有网站路由
        const api = await import('./api.js');
        return api.default.fetch(request, env, ctx);
    },
};
