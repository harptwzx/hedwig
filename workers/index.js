import api from './api.js';
import hfProxy from './hf-proxy.js';
import fileShare from './file-share.js';
import tscn from './tscn.js';

export { TscnSession } from './tscn-session.js';

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        if (url.pathname.startsWith('/hf')) {
            return hfProxy.fetch(request, env, ctx);
        }

        // TSCN 3D 场景查看器 - WebSocket 升级到 Durable Object 会话
        if (url.pathname === '/tscn/ws') {
            const id = env.TSCN_SESSION.idFromName('main');
            const stub = env.TSCN_SESSION.get(id);
            return stub.fetch(request);
        }

        // TSCN 3D 场景查看器 - 匹配 /tscn 和 /tscn/*
        if (url.pathname === '/tscn' || url.pathname === '/tscn/' || url.pathname.startsWith('/tscn/')) {
            return tscn.fetch(request, env, ctx);
        }

        // 文件分享路由 - 匹配 /share 和 /api/file/*
        if (url.pathname === '/share' || url.pathname.startsWith('/api/file/')) {
            return fileShare.fetch(request, env, ctx);
        }

        return api.fetch(request, env, ctx);
    },
};
