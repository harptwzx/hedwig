import api from './api.js';
import hfProxy from './hf-proxy.js';
import fileShare from './file-share.js';

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        // Hugging Face 代理路由
        if (url.pathname.startsWith('/hf')) {
            return hfProxy.fetch(request, env, ctx);
        }

        // 文件传输路由
        if (url.pathname.startsWith('/share')) {
            return fileShare.fetch(request, env, ctx);
        }

        // 原有网站路由
        return api.fetch(request, env, ctx);
    },
};