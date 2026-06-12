export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        
        // 测试首页
        if (url.pathname === '/') {
            return new Response(`
                <!DOCTYPE html>
                <html>
                <head><meta charset="UTF-8"></head>
                <body>
                    <h1>GitHub OAuth 测试</h1>
                    <p>Client ID: ${env.GITHUB_CLIENT_ID ? '已配置 (' + env.GITHUB_CLIENT_ID.substring(0, 10) + '...)' : '未配置'}</p>
                    <p>Client Secret: ${env.GITHUB_CLIENT_SECRET ? '已配置' : '未配置'}</p>
                    <a href="/auth/github">点击测试 GitHub 登录</a>
                </body>
                </html>
            `, { headers: { 'Content-Type': 'text/html' } });
        }
        
        // 跳转 GitHub
        if (url.pathname === '/auth/github') {
            const redirectUri = 'https://hedwig.eu.org/auth/github/callback';
            const githubUrl = `https://github.com/login/oauth/authorize?client_id=${env.GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user`;
            console.log('Redirect URL:', githubUrl);
            return Response.redirect(githubUrl, 302);
        }
        
        // GitHub 回调
        if (url.pathname === '/auth/github/callback') {
            const code = url.searchParams.get('code');
            const error = url.searchParams.get('error');
            
            if (error) {
                return new Response(`GitHub 返回错误: ${error}`, { status: 400 });
            }
            
            if (!code) {
                return new Response('缺少 code 参数', { status: 400 });
            }
            
            const redirectUri = 'https://hedwig.eu.org/auth/github/callback';
            
            try {
                const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                    body: JSON.stringify({
                        client_id: env.GITHUB_CLIENT_ID,
                        client_secret: env.GITHUB_CLIENT_SECRET,
                        code,
                        redirect_uri: redirectUri
                    })
                });
                const tokenData = await tokenRes.json();
                
                // 获取用户信息
                const userRes = await fetch('https://api.github.com/user', {
                    headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
                });
                const githubUser = await userRes.json();
                
                return new Response(JSON.stringify({
                    success: true,
                    user: githubUser,
                    token_data: tokenData
                }, null, 2), {
                    headers: { 'Content-Type': 'application/json' }
                });
            } catch (err) {
                return new Response(`错误: ${err.message}`, { status: 500 });
            }
        }
        
        return new Response('Not Found', { status: 404 });
    }
};