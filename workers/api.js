// 从 GitHub 仓库获取静态文件
async function serveStaticFile(path) {
    // 你的仓库路径
    const repo = 'harptwzx/hedwig';
    const branch = 'main';
    const fileUrl = `https://raw.githubusercontent.com/${repo}/${branch}/public${path}`;
    
    try {
        const response = await fetch(fileUrl);
        if (response.ok) {
            const content = await response.text();
            let contentType = 'text/html';
            if (path.endsWith('.css')) contentType = 'text/css';
            if (path.endsWith('.js')) contentType = 'application/javascript';
            return new Response(content, {
                headers: { 'Content-Type': contentType }
            });
        }
    } catch (e) {
        console.error('Fetch error:', e);
    }
    return null;
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        // 静态文件路由
        if (url.pathname === '/' || url.pathname === '/index.html') {
            const response = await serveStaticFile('/index.html');
            if (response) return response;
            return new Response('Index not found', { status: 404 });
        }

        if (url.pathname === '/login.html') {
            const response = await serveStaticFile('/login.html');
            if (response) return response;
            return new Response('Login not found', { status: 404 });
        }

        if (url.pathname === '/css/common.css') {
            const response = await serveStaticFile('/css/common.css');
            if (response) return response;
            return new Response('CSS not found', { status: 404 });
        }

        if (url.pathname === '/js/common.js') {
            const response = await serveStaticFile('/js/common.js');
            if (response) return response;
            return new Response('JS not found', { status: 404 });
        }

        // 登录 API
        if (url.pathname === '/auth/login') {
            const clientId = env.GITHUB_CLIENT_ID;
            const redirectUri = 'https://hedwig.eu.org/auth/callback';
            const githubUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user`;
            return Response.redirect(githubUrl, 302);
        }

        // 回调 API
        if (url.pathname === '/auth/callback') {
            const code = url.searchParams.get('code');
            const clientId = env.GITHUB_CLIENT_ID;
            const clientSecret = env.GITHUB_CLIENT_SECRET;
            const redirectUri = 'https://hedwig.eu.org/auth/callback';

            try {
                const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                    body: JSON.stringify({
                        client_id: clientId,
                        client_secret: clientSecret,
                        code,
                        redirect_uri: redirectUri
                    })
                });
                const tokenData = await tokenRes.json();
                const accessToken = tokenData.access_token;

                if (!accessToken) {
                    return Response.redirect('https://hedwig.eu.org/login.html?error=failed', 302);
                }

                const html = `<!DOCTYPE html>
                <html>
                <body>
                    <script>
                        localStorage.setItem('github_token', '${accessToken}');
                        window.location.href = '/';
                    </script>
                </body>
                </html>`;
                return new Response(html, { headers: { 'Content-Type': 'text/html' } });
            } catch (err) {
                return Response.redirect('https://hedwig.eu.org/login.html?error=failed', 302);
            }
        }

        return new Response('Not Found', { status: 404, headers: corsHeaders });
    }
};
