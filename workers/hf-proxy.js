export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        if (request.method === 'OPTIONS') {
            return new Response(null, {
                status: 204,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Cache-Control, X-Use-Auth-Token',
                    'Access-Control-Expose-Headers': 'X-Repo-Commit, X-Request-Id, X-Error-Code, X-Error-Message, X-Total-Count, X-Linked-Size, ETag, Location',
                    'Access-Control-Max-Age': '86400',
                },
            });
        }

        if (url.pathname === '/hf' || url.pathname === '/hf/') {
            return new Response(HTML, {
                headers: { 'Content-Type': 'text/html; charset=utf-8' },
            });
        }

        const targetPath = url.pathname.replace(/^\/hf/, '') + url.search;
        const targetUrl = 'https://huggingface.co' + targetPath;

        const newHeaders = new Headers(request.headers);
        newHeaders.set('Host', 'huggingface.co');
        // 伪装来源，避免被识别为代理
        newHeaders.set('Referer', 'https://huggingface.co' + targetPath);

        const proxyRequest = new Request(targetUrl, {
            method: request.method,
            headers: newHeaders,
            body: request.body,
        });

        const response = await fetch(proxyRequest);

        const respHeaders = new Headers(response.headers);
        respHeaders.set('Access-Control-Allow-Origin', '*');
        respHeaders.set('X-Hedwig-Proxy', 'huggingface.co');

        // 替换所有头中的域名
        for (const [key, value] of respHeaders.entries()) {
            if (typeof value === 'string' && (value.includes('huggingface.co') || value.includes('hf.co'))) {
                respHeaders.set(key, value
                    .replace(/https?:\/\/huggingface\.co/g, 'https://hedwig.eu.org/hf')
                    .replace(/https?:\/\/hf\.co/g, 'https://hedwig.eu.org/hf'));
            }
        }

        const ct = response.headers.get('content-type') || '';

        if (ct.includes('text/html')) {
            let text = await response.text();

            // 替换所有域名引用
            text = text.replace(/https?:\/\/huggingface\.co/g, 'https://hedwig.eu.org/hf');
            text = text.replace(/https?:\/\/hf\.co/g, 'https://hedwig.eu.org/hf');
            text = text.replace(/huggingface\.co/g, 'hedwig.eu.org/hf');

            // 关键: 替换相对路径，但要排除已经是 /hf/ 开头的路径
            // 使用更精确的正则，避免替换 data URI 等
            text = text.replace(/href="(\/[^"]*)"/g, (match, p1) => {
                if (p1.startsWith('/hf/') || p1.startsWith('//')) return match;
                return `href="/hf${p1}"`;
            });
            text = text.replace(/href='(\/[^']*)'/g, (match, p1) => {
                if (p1.startsWith('/hf/') || p1.startsWith('//')) return match;
                return `href='/hf${p1}'`;
            });
            text = text.replace(/src="(\/[^"]*)"/g, (match, p1) => {
                if (p1.startsWith('/hf/') || p1.startsWith('//')) return match;
                return `src="/hf${p1}"`;
            });
            text = text.replace(/src='(\/[^']*)'/g, (match, p1) => {
                if (p1.startsWith('/hf/') || p1.startsWith('//')) return match;
                return `src='/hf${p1}'`;
            });
            text = text.replace(/action="(\/[^"]*)"/g, (match, p1) => {
                if (p1.startsWith('/hf/') || p1.startsWith('//')) return match;
                return `action="/hf${p1}"`;
            });
            text = text.replace(/action='(\/[^']*)'/g, (match, p1) => {
                if (p1.startsWith('/hf/') || p1.startsWith('//')) return match;
                return `action='/hf${p1}'`;
            });

            // 注入全局拦截脚本
            const injectScript = `<script>
(function() {
    'use strict';
    const PROXY_PREFIX = '/hf';
    const PROXY_DOMAIN = 'https://hedwig.eu.org';

    function toProxy(url) {
        if (!url) return url;
        if (url.startsWith('/hf/') || url.startsWith('https://hedwig.eu.org/hf')) return url;
        if (url.startsWith('https://huggingface.co')) return url.replace('https://huggingface.co', 'https://hedwig.eu.org/hf');
        if (url.startsWith('http://huggingface.co')) return url.replace('http://huggingface.co', 'https://hedwig.eu.org/hf');
        if (url.startsWith('//huggingface.co')) return url.replace('//huggingface.co', '//hedwig.eu.org/hf');
        if (url.startsWith('/') && !url.startsWith('//')) return '/hf' + url;
        return url;
    }

    // 拦截所有链接点击
    document.addEventListener('click', function(e) {
        const a = e.target.closest('a');
        if (!a) return;
        const href = a.getAttribute('href');
        if (href && (href.startsWith('/') || href.includes('huggingface.co'))) {
            e.preventDefault();
            window.location.href = toProxy(href);
        }
    }, true);

    // 拦截 history - 使用正确的方式
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function(s, t, u) { 
        return origPush.call(this, s, t, toProxy(u)); 
    };
    history.replaceState = function(s, t, u) { 
        return origReplace.call(this, s, t, toProxy(u)); 
    };

    // 拦截 location - 修复递归问题
    const loc = window.location;
    
    // 保存原始方法
    const origAssign = loc.assign.bind(loc);
    const origReplace = loc.replace.bind(loc);
    
    Object.defineProperty(window, 'location', {
        get: function() { return loc; },
        set: function(url) { loc.href = toProxy(url); }
    });
    
    // href setter 直接操作底层，避免递归
    Object.defineProperty(loc, 'href', {
        get: function() { return loc.href; },
        set: function(url) { 
            // 使用原始赋值，绕过自定义 setter
            Object.getOwnPropertyDescriptor(window.Location.prototype, 'href').set.call(loc, toProxy(url));
        }
    });
    
    loc.assign = function(url) { return origAssign(toProxy(url)); };
    loc.replace = function(url) { return origReplace(toProxy(url)); };

    // 拦截 fetch
    const origFetch = window.fetch;
    window.fetch = function(url, opts) {
        if (typeof url === 'string') url = toProxy(url);
        else if (url && url.url) url = new Request(toProxy(url.url), url);
        return origFetch.call(this, url, opts);
    };

    // 拦截 XMLHttpRequest
    const OrigXHR = window.XMLHttpRequest;
    window.XMLHttpRequest = function() {
        const xhr = new OrigXHR();
        const origOpen = xhr.open;
        xhr.open = function(m, u, a, user, pass) {
            return origOpen.call(this, m, toProxy(u), a, user, pass);
        };
        return xhr;
    };

    // 拦截 WebSocket
    const OrigWS = window.WebSocket;
    window.WebSocket = function(url, protocols) {
        if (typeof url === 'string' && url.startsWith('wss://huggingface.co')) {
            url = url.replace('wss://huggingface.co', 'wss://hedwig.eu.org/hf');
        }
        return new OrigWS(url, protocols);
    };

    // 拦截 window.open
    const origOpen = window.open;
    window.open = function(url, target, features) {
        if (typeof url === 'string') url = toProxy(url);
        return origOpen.call(this, url, target, features);
    };

    // 拦截 Form submit
    document.addEventListener('submit', function(e) {
        const form = e.target;
        if (form && form.action) {
            const newAction = toProxy(form.action);
            if (newAction !== form.action) {
                form.action = newAction;
            }
        }
    }, true);

    // 拦截动态创建的 a 标签
    const origCreateElement = Document.prototype.createElement;
    Document.prototype.createElement = function(tag) {
        const el = origCreateElement.call(this, tag);
        if (tag.toLowerCase() === 'a') {
            const origSetAttr = el.setAttribute;
            el.setAttribute = function(name, value) {
                if (name === 'href') value = toProxy(value);
                return origSetAttr.call(this, name, value);
            };
        }
        return el;
    };
})();
</script>`;

            if (text.includes('<head>')) {
                text = text.replace('<head>', '<head>' + injectScript);
            } else if (text.includes('<html')) {
                text = text.replace('<html>', '<html>' + injectScript);
            } else {
                text = injectScript + text;
            }

            return new Response(text, {
                status: response.status,
                statusText: response.statusText,
                headers: respHeaders,
            });
        }

        if (ct.includes('javascript') || ct.includes('json') || ct.includes('css')) {
            let text = await response.text();
            text = text.replace(/https?:\/\/huggingface\.co/g, 'https://hedwig.eu.org/hf');
            text = text.replace(/https?:\/\/hf\.co/g, 'https://hedwig.eu.org/hf');
            text = text.replace(/huggingface\.co/g, 'hedwig.eu.org/hf');
            return new Response(text, {
                status: response.status,
                headers: respHeaders,
            });
        }

        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: respHeaders,
        });
    },
};

const HTML = `...`; // 保持不变
