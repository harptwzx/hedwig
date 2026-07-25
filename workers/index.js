// workers/index.js
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
             
        // 原有网站路由
        const api = await import('./hf-proxy.js');
        return api.default.fetch(request, env, ctx);
    },
};
