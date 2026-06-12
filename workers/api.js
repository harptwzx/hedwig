// 极简版本，只测试注册跳转
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        
        // 获取环境变量
        const GITHUB_CLIENT_ID = env.GITHUB_CLIENT_ID;
        
        // 注册入口：跳转到 GitHub
        if (url.pathname === '/auth/register') {
            const username = url.searchParams.get('username');
            const password = url.searchParams.get('password');
            
            // 简单验证
            if (!username || !password) {
                return Response.redirect('https://hedwig.eu.org/register.html?result=error', 302);
            }
            
            // 构造 GitHub OAuth URL
            const redirectUri = 'https://hedwig.eu.org/auth/github/callback';
            const state = btoa(JSON.stringify({ username, password }));  // 暂存用户信息
            const githubUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user&state=${state}`;
            
            // 跳转到 GitHub
            return Response.redirect(githubUrl, 302);
        }
        
        // GitHub 回调（先简单返回一个 JSON）
        if (url.pathname === '/auth/github/callback') {
            const code = url.searchParams.get('code');
            const state = url.searchParams.get('state');
            return new Response(`Code: ${code}, State: ${state}`, { headers: { 'Content-Type': 'text/plain' } });
        }
        
        // 其他请求返回 404
        return new Response('Not Found', { status: 404 });
    }
};