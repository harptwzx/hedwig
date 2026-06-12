// GitHub 配置
const GITHUB_OWNER = 'harptwzx';
const GITHUB_REPO = 'hedwig';
const DATA_PATH = 'data/users/';

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
        
        // 静态文件
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
        
        // ==================== 注册流程：GitHub 验证入口 ====================
        if (url.pathname === '/auth/github/register') {
            const state = url.searchParams.get('state');
            const redirectUri = 'https://hedwig.eu.org/auth/github/register/callback';
            const githubUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user,user:email&state=${state}`;
            return Response.redirect(githubUrl, 302);
        }
        
        // ==================== 注册流程：GitHub 回调 ====================
        if (url.pathname === '/auth/github/register/callback') {
            const code = url.searchParams.get('code');
            const state = url.searchParams.get('state');
            const redirectUri = 'https://hedwig.eu.org/auth/github/register/callback';
            
            try {
                // 解析待注册的用户信息
                let pendingUser = null;
                if (state) {
                    try {
                        pendingUser = JSON.parse(atob(state));
                    } catch(e) {}
                }
                
                if (!pendingUser || !pendingUser.username || !pendingUser.password) {
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
                
                // 检查该 GitHub ID 是否已被注册
                const githubCheckPath = `${DATA_PATH}github_${githubId}.json`;
                const existingGithubUser = await readGitHubFile(githubCheckPath, GITHUB_TOKEN);
                
                if (existingGithubUser) {
                    // GitHub 账号已被其他用户绑定
                    return Response.redirect('https://hedwig.eu.org/register.html?result=github_already_used', 302);
                }
                
                // 检查用户名是否已被占用
                const userPath = `${DATA_PATH}user_${pendingUser.username}.json`;
                const existingUser = await readGitHubFile(userPath, GITHUB_TOKEN);
                
                if (existingUser) {
                    return Response.redirect('https://hedwig.eu.org/register.html?result=username_exists', 302);
                }
                
                // 创建用户数据
                const userData = {
                    id: Date.now().toString(),
                    username: pendingUser.username,
                    password: btoa(pendingUser.password), // 简单加密
                    githubId: githubId,
                    githubLogin: githubUser.login,
                    email: '',
                    avatar: githubUser.avatar_url,
                    createdAt: new Date().toISOString()
                };
                
                // 保存用户文件
                await writeGitHubFile(userPath, userData, `创建用户: ${pendingUser.username}`, GITHUB_TOKEN);
                
                // 保存 GitHub ID 映射文件
                const githubMap = { username: pendingUser.username, githubId: githubId, createdAt: new Date().toISOString() };
                await writeGitHubFile(githubCheckPath, githubMap, `GitHub 绑定: ${pendingUser.username}`, GITHUB_TOKEN);
                
                return Response.redirect('https://hedwig.eu.org/register.html?result=success', 302);
                
            } catch (err) {
                return Response.redirect('https://hedwig.eu.org/register.html?result=error', 302);
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
                
                const token = btoa(`${userData.id}:${Date.now()}`);
                
                return new Response(JSON.stringify({
                    success: true,
                    token: token,
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
        
        // ==================== 获取用户信息 API ====================
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
                
                // 查找用户
                const usersPath = `${DATA_PATH}`;
                // 简化：这里需要遍历查找，实际可以维护一个索引
                // 为简化，我们先用一个临时方案
                return new Response(JSON.stringify({ error: '暂不支持' }), {
                    status: 501,
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