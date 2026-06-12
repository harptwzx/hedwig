export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        
        if (url.pathname === '/') {
            return new Response(`
                <!DOCTYPE html>
                <html>
                <head><meta charset="UTF-8"></head>
                <body>
                    <h1>GitHub OAuth 测试</h1>
                    <p>Client ID: ${env.GITHUB_CLIENT_ID ? '已配置' : '未配置'}</p>
                    <a href="/auth/github">点击测试 GitHub 登录</a>
                </body>
                </html>
            `, { headers: { 'Content-Type': 'text/html' } });
        }
        
        if (url.pathname === '/auth/github') {
            const redirectUri = 'https://hedwig.eu.org/auth/github/callback';
            const githubUrl = `https://github.com/login/oauth/authorize?client_id=${env.GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user`;
            return Response.redirect(githubUrl, 302);
        }
        
        if (url.pathname === '/auth/github/callback') {
            const code = url.searchParams.get('code');
            const error = url.searchParams.get('error');
            const errorDescription = url.searchParams.get('error_description');
            
            if (error) {
                return new Response(`GitHub 错误: ${error}<br>描述: ${errorDescription || '无'}`, {
                    status: 400,
                    headers: { 'Content-Type': 'text/html' }
                });
            }
            
            if (!code) {
                return new Response('缺少 code 参数', { status: 400 });
            }
            
            const redirectUri = 'https://hedwig.eu.org/auth/github/callback';
            
            try {
                console.log('Exchanging code for token...');
                console.log('Client ID:', env.GITHUB_CLIENT_ID);
                console.log('Redirect URI:', redirectUri);
                
                const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json', 
                        'Accept': 'application/json',
                        'User-Agent': 'Hedwig-Worker'
                    },
                    body: JSON.stringify({
                        client_id: env.GITHUB_CLIENT_ID,
                        client_secret: env.GITHUB_CLIENT_SECRET,
                        code: code,
                        redirect_uri: redirectUri
                    })
                });
                
                // 先获取响应文本，再尝试解析 JSON
                const responseText = await tokenRes.text();
                console.log('Response text:', responseText);
                
                let tokenData;
                try {
                    tokenData = JSON.parse(responseText);
                } catch (e) {
                    return new Response(`GitHub 返回非 JSON: ${responseText.substring(0, 500)}`, {
                        status: 500,
                        headers: { 'Content-Type': 'text/plain' }
                    });
                }
                
                if (tokenData.error) {
                    return new Response(`Token 错误: ${tokenData.error}<br>描述: ${tokenData.error_description || '无'}`, {
                        status: 400,
                        headers: { 'Content-Type': 'text/html' }
                    });
                }
                
                const accessToken = tokenData.access_token;
                if (!accessToken) {
                    return new Response(`未获得 access_token: ${JSON.stringify(tokenData)}`, {
                        status: 400,
                        headers: { 'Content-Type': 'text/plain' }
                    });
                }
                
                // 获取用户信息
                const userRes = await fetch('https://api.github.com/user', {
                    headers: { 
                        'Authorization': `Bearer ${accessToken}`,
                        'User-Agent': 'Hedwig-Worker'
                    }
                });
                const githubUser = await userRes.json();
                
                return new Response(JSON.stringify({
                    success: true,
                    user: githubUser
                }, null, 2), {
                    headers: { 'Content-Type': 'application/json' }
                });
            } catch (err) {
                return new Response(`异常: ${err.message}`, { status: 500 });
            }
        }
        
        return new Response('Not Found', { status: 404 });
    }
};