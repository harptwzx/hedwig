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
        
        // GitHub OAuth 登录入口
        if (url.pathname === '/auth/login') {
            const redirect = url.searchParams.get('redirect') || '/';
            const clientId = env.GITHUB_CLIENT_ID;
            // 回调地址必须是你 Pages 项目的地址
            const redirectUri = 'https://hedwig-e85.pages.dev/auth/callback';
            const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user`;
            return Response.redirect(githubAuthUrl, 302);
        }
        
        // GitHub OAuth 回调
        if (url.pathname === '/auth/callback') {
            const code = url.searchParams.get('code');
            const clientId = env.GITHUB_CLIENT_ID;
            const clientSecret = env.GITHUB_CLIENT_SECRET;
            const redirectUri = 'https://hedwig-e85.pages.dev/auth/callback';
            
            try {
                // 用 code 换 token
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
                    return new Response('GitHub 授权失败，请重试', { status: 400 });
                }
                
                // 返回 HTML，保存 token 后跳转到首页（不自动跳转登录）
                const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body>
    <script>
        localStorage.setItem('github_token', '${accessToken}');
        localStorage.setItem('github_user', JSON.stringify({ login: 'user' }));
        window.location.href = '/';
    </script>
</body>
</html>`;
                
                return new Response(html, {
                    headers: { 'Content-Type': 'text/html', ...corsHeaders }
                });
            } catch (err) {
                return new Response('授权处理失败: ' + err.message, { status: 500 });
            }
        }
        
        // 其他请求返回 404
        return new Response('Not Found', { status: 404, headers: corsHeaders });
    }
};