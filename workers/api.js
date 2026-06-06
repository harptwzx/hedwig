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

        // 登录入口
        if (url.pathname === '/auth/login') {
            const clientId = env.GITHUB_CLIENT_ID;
            // 动态获取当前访问的域名（重要！）
            const origin = request.headers.get('Origin') || request.headers.get('Referer') || 'https://hedwig-e85.pages.dev';
            const baseUrl = origin.split('?')[0];
            const redirectUri = `${baseUrl}/auth/callback`;

            const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user`;
            return Response.redirect(githubAuthUrl, 302);
        }

        // 回调
        if (url.pathname === '/auth/callback') {
            const code = url.searchParams.get('code');
            const clientId = env.GITHUB_CLIENT_ID;
            const clientSecret = env.GITHUB_CLIENT_SECRET;

            // 同样动态获取回调域名
            const origin = request.headers.get('Origin') || request.headers.get('Referer') || 'https://hedwig-e85.pages.dev';
            const baseUrl = origin.split('?')[0];
            const redirectUri = `${baseUrl}/auth/callback`;

            try {
                const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
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
                    return Response.redirect(`${baseUrl}/login.html?error=failed`, 302);
                }

                const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body>
    <script>
        localStorage.setItem('github_token', '${accessToken}');
        window.location.href = '/login.html?success=true';
    </script>
</body>
</html>`;

                return new Response(html, {
                    headers: { 'Content-Type': 'text/html', ...corsHeaders }
                });
            } catch (err) {
                return Response.redirect(`${baseUrl}/login.html?error=failed`, 302);
            }
        }

        return new Response('Not Found', { status: 404, headers: corsHeaders });
    }
};