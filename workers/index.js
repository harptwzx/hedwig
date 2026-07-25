import api from './api.js';
import hfProxy from './hf-proxy.js';
import fileShare from './file-share.js';

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        if (url.pathname.startsWith('/hf')) {
            return hfProxy.fetch(request, env, ctx);
        }

        if (url.pathname.startsWith('/share')) {
            return fileShare.fetch(request, env, ctx);
        }

        return api.fetch(request, env, ctx);
    },
};