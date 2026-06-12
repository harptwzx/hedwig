// GitHub 配置
const GITHUB_OWNER = 'harptwzx';
const GITHUB_REPO = 'hedwig';
const DATA_PATH = 'data/users/';

// 辅助函数：读取 GitHub 文件
async function readGitHubFile(filePath, githubToken) {
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`;
    const response = await fetch(url, {
        headers: { 'Authorization': `token ${githubToken}`, 'User-Agent': 'Hedwig-Worker' }
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);
    const data = await response.json();
    const content = atob(data.content);
    return JSON.parse(content);
}

// 辅助函数：写入 GitHub 文件
async function writeGitHubFile(filePath, content, commitMessage, githubToken) {
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`;
    let sha = null;
    const existingResponse = await fetch(url, { headers: { 'Authorization': `token ${githubToken}` } });
    if (existingResponse.ok) {
        const existingData = await existingResponse.json();
        sha = existingData.sha;
    }
    const response = await fetch(url, {
        method: 'PUT',
        headers: { 'Authorization': `token ${githubToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message: commitMessage,
            content: btoa(JSON.stringify(content, null, 2)),
            sha: sha
        })
    });
    return response.ok;
}

// 辅助函数：获取静态文件
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
    } catch (e) {}
    return null;
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        
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
        
        // ==================== 注册：跳转 GitHub ====================
        if (url.pathname === '/auth/github/register') {
            // 把用户名和密码存到 session 或临时存储
            const username = url.searchParams.get('username');
            const password = url.searchParams.get('password');
            const redirectUri = 'https://hedwig.eu.org/auth/github/register/callback';
            // 把用户名和密码作为 state 的一部分（简化）
            const stateData = btoa(`${username}:${password}`);
            const githubUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user,user:email&state=${stateData}`;
            return Response.redirect(githubUrl, 302);
        }
        
        // ==================== 注册回调 ====================
        if (url.pathname === '/auth/github/register/callback') {
            const code = url.searchParams.get('code');
            const state = url.searchParams.get('state');
            const redirectUri = 'https://hedwig.eu.org/auth/github/register/callback';
            
            try {
                // 解析用户名和密码
                let username = null, password = null;
                if (state) {
                    const decoded = atob(state);
                    const parts = decoded.split(':');
                    username = parts[0];
                    password = parts[1];
                }
                
                if (!username || !password) {
                    return Response.redirect('https://hedwig.eu.org/register.html?result=error', 302);
                }
                
                // 用 code 换 token
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
                    return Response.redirect('https://hedwig.eu.org/register.html?result=error', 302);
                }
                
                // 获取 GitHub 用户信息
                const userRes = await fetch('https://api.github.com/user', {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                });
                const githubUser = await userRes.json();
                const githubId = githubUser.id.toString();
                
                // 检查 GitHub ID 是否已被注册
                const githubCheckPath = `${DATA_PATH}github_${githubId}.json`;
                const existingGithubUser = await readGitHubFile(githubCheckPath, GITHUB_TOKEN);
                if (existingGithubUser) {
                    return Response.redirect('https://hedwig.eu.org/register.html?result=github_already_used', 302);
                }
                
                // 检查用户名是否已被占用
                const userPath = `${DATA_PATH}user_${username}.json`;
                const existingUser = await readGitHubFile(userPath, GITHUB_TOKEN);
                if (existingUser) {
                    return Response.redirect('https://hedwig.eu.org/register.html?result=username_exists', 302);
                }
                
                // 获取邮箱
                const emailRes = await fetch('https://api.github.com/user/emails', {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                });
                const emails = await emailRes.json();
                const primaryEmail = emails.find(e => e.primary)?.email || emails[0]?.email || '';
                
                // 创建用户数据
                const userData = {
                    id: Date.now().toString(),
                    username: username,
                    password: btoa(password),
                    githubId: githubId,
                    githubLogin: githubUser.login,
                    email: primaryEmail,
                    avatar: githubUser.avatar_url,
                    createdAt: new Date().toISOString()
                };
                
                await writeGitHubFile(userPath, userData, `创建用户: ${username}`, GITHUB_TOKEN);
                await writeGitHubFile(githubCheckPath, { username: username, githubId }, `GitHub绑定: ${username}`, GITHUB_TOKEN);
                
                return Response.redirect('https://hedwig.eu.org/register.html?result=success', 302);
                
            } catch (err) {
                console.error(err);
                return Response.redirect('https://hedwig.eu.org/register.html?result=error', 302);
            }
        }
        
        // ==================== 登录：跳转 GitHub ====================
        if (url.pathname === '/auth/github/login') {
            const redirectUri = 'https://hedwig.eu.org/auth/github/login/callback';
            const githubUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user,user:email`;
            return Response.redirect(githubUrl, 302);
        }
        
        // ==================== 登录回调 ====================
        if (url.pathname === '/auth/github/login/callback') {
            const code = url.searchParams.get('code');
            const redirectUri = 'https://hedwig.eu.org/auth/github/login/callback';
            
            try {
                // 用 code 换 token
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
                    return Response.redirect('https://hedwig.eu.org/login.html?error=auth_failed', 302);
                }
                
                // 获取 GitHub 用户信息
                const userRes = await fetch('https://api.github.com/user', {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                });
                const githubUser = await userRes.json();
                const githubId = githubUser.id.toString();
                
                // 通过 GitHub ID 查找用户
                const githubCheckPath = `${DATA_PATH}github_${githubId}.json`;
                const githubMap = await readGitHubFile(githubCheckPath, GITHUB_TOKEN);
                
                if (!githubMap) {
                    return Response.redirect('https://hedwig.eu.org/login.html?error=not_registered', 302);
                }
                
                const userPath = `${DATA_PATH}user_${githubMap.username}.json`;
                const userData = await readGitHubFile(userPath, GITHUB_TOKEN);
                
                if (!userData) {
                    return Response.redirect('https://hedwig.eu.org/login.html?error=not_found', 302);
                }
                
                const sessionToken = btoa(`${userData.id}:${Date.now()}`);
                
                const html = `<!DOCTYPE html>
                <html>
                <body>
                    <script>
                        localStorage.setItem('auth_token', '${sessionToken}');
                        localStorage.setItem('user_info', JSON.stringify({
                            username: '${userData.username}',
                            avatar: '${userData.avatar}'
                        }));
                        window.location.href = '/';
                    </script>
                </body>
                </html>`;
                
                return new Response(html, { headers: { 'Content-Type': 'text/html' } });
                
            } catch (err) {
                console.error(err);
                return Response.redirect('https://hedwig.eu.org/login.html?error=auth_failed', 302);
            }
        }
        
        // ==================== 本地登录 API ====================
        if (url.pathname === '/api/login' && request.method === 'POST') {
            try {
                const { username, password } = await request.json();
                
                const userPath = `${DATA_PATH}user_${username}.json`;
                const userData = await readGitHubFile(userPath, GITHUB_TOKEN);
                
                if (!userData) {
                    return new Response(JSON.stringify({ error: '用户名或密码错误' }), {
                        status: 401,
                        headers: { 'Content-Type': 'application/json', ...corsHeaders }
                    });
                }
                
                const hashedInput = btoa(password);
                if (userData.password !== hashedInput) {
                    return new Response(JSON.stringify({ error: '用户名或密码错误' }), {
                        status: 401,
                        headers: { 'Content-Type': 'application/json', ...corsHeaders }
                    });
                }
                
                const sessionToken = btoa(`${userData.id}:${Date.now()}`);
                
                return new Response(JSON.stringify({
                    success: true,
                    token: sessionToken,
                    user: {
                        username: userData.username,
                        avatar: userData.avatar,
                        createdAt: userData.createdAt
                    }
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json', ...corsHeaders }
                });
            } catch (error) {
                return new Response(JSON.stringify({ error: '登录失败' }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json', ...corsHeaders }
                });
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
                const userId = decoded.split(':')[0];
                
                const urlList = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${DATA_PATH}`;
                const response = await fetch(urlList, {
                    headers: { 'Authorization': `token ${GITHUB_TOKEN}` }
                });
                if (!response.ok) {
                    return new Response(JSON.stringify({ error: '获取用户信息失败' }), {
                        status: 500,
                        headers: { 'Content-Type': 'application/json', ...corsHeaders }
                    });
                }
                const files = await response.json();
                
                for (const file of files) {
                    if (file.name.startsWith('user_') && file.name.endsWith('.json')) {
                        const fileData = await readGitHubFile(`${DATA_PATH}${file.name}`, GITHUB_TOKEN);
                        if (fileData && fileData.id === userId) {
                            return new Response(JSON.stringify({
                                username: fileData.username,
                                avatar: fileData.avatar,
                                createdAt: fileData.createdAt
                            }), {
                                status: 200,
                                headers: { 'Content-Type': 'application/json', ...corsHeaders }
                            });
                        }
                    }
                }
                
                return new Response(JSON.stringify({ error: '用户不存在' }), {
                    status: 404,
                    headers: { 'Content-Type': 'application/json', ...corsHeaders }
                });
            } catch (error) {
                return new Response(JSON.stringify({ error: '获取用户信息失败' }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json', ...corsHeaders }
                });
            }
        }
        
        return new Response('Not Found', { status: 404, headers: corsHeaders });
    }
};