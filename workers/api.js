// GitHub 配置
const GITHUB_OWNER = 'harptwzx';
const GITHUB_REPO = 'hedwig';
const DATA_PATH = 'data/users/';

// 辅助函数：通过 GitHub API 读取文件
async function readGitHubFile(filePath, githubToken) {
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`;
    const response = await fetch(url, {
        headers: {
            'Authorization': `token ${githubToken}`,
            'User-Agent': 'Hedwig-Worker'
        }
    });
    
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);
    
    const data = await response.json();
    const content = atob(data.content);
    return JSON.parse(content);
}

// 辅助函数：通过 GitHub API 写入文件
async function writeGitHubFile(filePath, content, commitMessage, githubToken) {
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`;
    let sha = null;
    
    const existingResponse = await fetch(url, {
        headers: { 'Authorization': `token ${githubToken}` }
    });
    
    if (existingResponse.ok) {
        const existingData = await existingResponse.json();
        sha = existingData.sha;
    }
    
    const response = await fetch(url, {
        method: 'PUT',
        headers: {
            'Authorization': `token ${githubToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            message: commitMessage,
            content: btoa(JSON.stringify(content, null, 2)),
            sha: sha
        })
    });
    
    return response.ok;
}

// 获取或创建用户
async function getOrCreateUser(githubId, githubLogin, githubAvatar, githubEmail, githubToken) {
    const filePath = `${DATA_PATH}${githubId}.json`;
    let userData = await readGitHubFile(filePath, githubToken);
    
    if (!userData) {
        // 首次登录，自动创建用户
        userData = {
            githubId: githubId,
            username: githubLogin,
            email: githubEmail || '',
            avatar: githubAvatar,
            localPassword: null,  // 暂未设置本地密码
            createdAt: new Date().toISOString(),
            lastLogin: new Date().toISOString()
        };
        await writeGitHubFile(filePath, userData, `自动创建用户: ${githubLogin}`, githubToken);
    } else {
        // 更新最后登录时间
        userData.lastLogin = new Date().toISOString();
        await writeGitHubFile(filePath, userData, `更新登录时间: ${userData.username}`, githubToken);
    }
    
    return userData;
}

// 设置本地密码
async function setLocalPassword(githubId, password, githubToken) {
    const filePath = `${DATA_PATH}${githubId}.json`;
    const userData = await readGitHubFile(filePath, githubToken);
    
    if (!userData) return false;
    
    // 简单哈希（实际应用应该用 bcrypt）
    const hashedPassword = btoa(password);
    userData.localPassword = hashedPassword;
    userData.passwordSetAt = new Date().toISOString();
    
    return await writeGitHubFile(filePath, userData, `设置本地密码: ${userData.username}`, githubToken);
}

// 验证本地密码
async function verifyLocalPassword(githubId, password, githubToken) {
    const filePath = `${DATA_PATH}${githubId}.json`;
    const userData = await readGitHubFile(filePath, githubToken);
    
    if (!userData || !userData.localPassword) return false;
    
    const hashedInput = btoa(password);
    return userData.localPassword === hashedInput;
}

// 获取静态文件
async function serveStaticFile(path) {
    const fileUrl = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/public${path}`;
    try {
        const response = await fetch(fileUrl);
        if (response.ok) {
            const content = await response.text();
            let contentType = 'text/html';
            if (path.endsWith('.css')) contentType = 'text/css';
            if (path.endsWith('.js')) contentType = 'application/javascript';
            return new Response(content, { headers: { 'Content-Type': contentType } });
        }
    } catch (e) {
        console.error('Fetch error:', e);
    }
    return null;
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        
        // 从环境变量读取配置
        const GITHUB_CLIENT_ID = env.GITHUB_CLIENT_ID;
        const GITHUB_CLIENT_SECRET = env.GITHUB_CLIENT_SECRET;
        const GITHUB_TOKEN = env.GITHUB_TOKEN;
        
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        };
        
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }
        
        // ==================== 静态文件服务 ====================
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
        
        if (url.pathname === '/register.html') {
            const response = await serveStaticFile('/register.html');
            if (response) return response;
            return new Response('Register not found', { status: 404 });
        }
        
        if (url.pathname === '/settings.html') {
            const response = await serveStaticFile('/settings.html');
            if (response) return response;
            return new Response('Settings not found', { status: 404 });
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
        
        // ==================== GitHub OAuth 登录 ====================
        if (url.pathname === '/auth/github') {
            const redirectUri = 'https://hedwig.eu.org/auth/callback';
            const githubUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user,user:email`;
            return Response.redirect(githubUrl, 302);
        }
        
        if (url.pathname === '/auth/github/callback') {
            const code = url.searchParams.get('code');
            const redirectUri = 'https://hedwig.eu.org/auth/github/callback';
            
            try {
                // 用 code 换 access_token
                const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                    body: JSON.stringify({
                        client_id: GITHUB_CLIENT_ID,
                        client_secret: GITHUB_CLIENT_SECRET,
                        code,
                        redirect_uri: redirectUri
                    })
                });
                const tokenData = await tokenRes.json();
                const accessToken = tokenData.access_token;
                
                if (!accessToken) {
                    return Response.redirect('https://hedwig.eu.org/login.html?error=github_auth_failed', 302);
                }
                
                // 获取用户信息
                const userRes = await fetch('https://api.github.com/user', {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                });
                const githubUser = await userRes.json();
                
                // 获取用户邮箱
                const emailRes = await fetch('https://api.github.com/user/emails', {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                });
                const emails = await emailRes.json();
                const primaryEmail = emails.find(e => e.primary)?.email || emails[0]?.email || '';
                
                // 创建或获取用户
                const userData = await getOrCreateUser(
                    githubUser.id.toString(),
                    githubUser.login,
                    githubUser.avatar_url,
                    primaryEmail,
                    GITHUB_TOKEN
                );
                
                // 生成 session token
                const sessionToken = btoa(`${githubUser.id}:${Date.now()}`);
                
                // 返回 HTML，保存 token 并跳转
                const html = `<!DOCTYPE html>
                <html>
                <body>
                    <script>
                        localStorage.setItem('auth_token', '${sessionToken}');
                        localStorage.setItem('user_info', JSON.stringify({
                            githubId: '${githubUser.id}',
                            username: '${githubUser.login}',
                            email: '${primaryEmail}',
                            avatar: '${githubUser.avatar_url}'
                        }));
                        window.location.href = '/';
                    </script>
                </body>
                </html>`;
                
                return new Response(html, { headers: { 'Content-Type': 'text/html' } });
            } catch (err) {
                return Response.redirect('https://hedwig.eu.org/login.html?error=github_auth_failed', 302);
            }
        }
        
        // ==================== 获取当前用户信息 ====================
        if (url.pathname === '/api/user' && request.method === 'GET') {
            const authHeader = request.headers.get('Authorization');
            const token = authHeader?.replace('Bearer ', '');
            
            if (!token) {
                return new Response(JSON.stringify({ error: '未登录' }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json', ...corsHeaders }
                });
            }
            
            try {
                const decoded = atob(token);
                const githubId = decoded.split(':')[0];
                
                const filePath = `${DATA_PATH}${githubId}.json`;
                const userData = await readGitHubFile(filePath, GITHUB_TOKEN);
                
                if (!userData) {
                    return new Response(JSON.stringify({ error: '用户不存在' }), {
                        status: 404,
                        headers: { 'Content-Type': 'application/json', ...corsHeaders }
                    });
                }
                
                return new Response(JSON.stringify({
                    githubId: userData.githubId,
                    username: userData.username,
                    email: userData.email,
                    avatar: userData.avatar,
                    hasLocalPassword: !!userData.localPassword,
                    createdAt: userData.createdAt,
                    lastLogin: userData.lastLogin
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json', ...corsHeaders }
                });
            } catch (error) {
                return new Response(JSON.stringify({ error: '获取用户信息失败' }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json', ...corsHeaders }
                });
            }
        }
        
        // ==================== 设置本地密码 ====================
        if (url.pathname === '/api/set-password' && request.method === 'POST') {
            const authHeader = request.headers.get('Authorization');
            const token = authHeader?.replace('Bearer ', '');
            
            if (!token) {
                return new Response(JSON.stringify({ error: '未登录' }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json', ...corsHeaders }
                });
            }
            
            try {
                const { password } = await request.json();
                
                if (!password || password.length < 6) {
                    return new Response(JSON.stringify({ error: '密码长度不能少于6位' }), {
                        status: 400,
                        headers: { 'Content-Type': 'application/json', ...corsHeaders }
                    });
                }
                
                const decoded = atob(token);
                const githubId = decoded.split(':')[0];
                
                await setLocalPassword(githubId, password, GITHUB_TOKEN);
                
                return new Response(JSON.stringify({ success: true, message: '密码设置成功' }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json', ...corsHeaders }
                });
            } catch (error) {
                return new Response(JSON.stringify({ error: '设置密码失败' }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json', ...corsHeaders }
                });
            }
        }
        
        return new Response('Not Found', { status: 404, headers: corsHeaders });
    }
};
