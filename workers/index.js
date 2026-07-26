import api from './api.js';
import hfProxy from './hf-proxy.js';
import fileShare from './file-share.js';

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        if (url.pathname.startsWith('/hf')) {
            return hfProxy.fetch(request, env, ctx);
        }

        // 文件分享路由 - 匹配 /share 和 /api/file/*
        if (url.pathname === '/share' || url.pathname.startsWith('/api/file/')) {
            return fileShare.fetch(request, env, ctx);
        }

        return api.fetch(request, env, ctx);
    },
};
