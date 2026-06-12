export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const GITHUB_CLIENT_ID = env.GITHUB_CLIENT_ID;
        const GITHUB_CLIENT_SECRET = env.GITHUB_CLIENT_SECRET;

        // 注册入口
        if (url.pathname === '/auth/register') {
            const username = url.searchParams.get('username');
            const password = url.searchParams.get('password');
            if (!username || !password) {
                return Response.redirect('https://hedwig.eu.org/register.html?result=error', 302);
            }
            const state = btoa(JSON.stringify({ username, password }));
            const redirectUri = 'https://hedwig.eu.org/auth/github/callback';
            const githubUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user&state=${state}`;
            return Response.redirect(githubUrl, 302);
        }

        // GitHub 回调
        if (url.pathname === '/auth/github/callback') {
            const code = url.searchParams.get('code');
            const redirectUri = 'https://hedwig.eu.org/auth/github/callback';

            // 先显示请求参数，方便调试
            const debugInfo = `请求参数: code=${code}, redirectUri=${redirectUri}, clientId=${GITHUB_CLIENT_ID}\n\n`;

            const tokenResp = await fetch('https://github.com/login/oauth/access_token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    client_id: GITHUB_CLIENT_ID,
                    client_secret: GITHUB_CLIENT_SECRET,
                    code: code,
                    redirect_uri: redirectUri
                })
            });

            const rawText = await tokenResp.text();
            // 返回原始响应，让你看到具体错误
            return new Response(debugInfo + 'GitHub 原始响应:\n' + rawText, {
                headers: { 'Content-Type': 'text/plain' }
            });
        }

        return new Response('Not Found', { status: 404 });
    }
};