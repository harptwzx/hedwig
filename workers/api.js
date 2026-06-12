// GitHub 配置（从环境变量读取）
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
    
    // 先获取当前文件信息（获取 SHA，用于更新）
    const existingResponse = await fetch(url, {
        headers: { 'Authorization': `token ${githubToken}` }
    });
    
    if (existingResponse.ok) {
        const existingData = await existingResponse.json();
        sha = existingData.sha;
    }
    
    // 写入文件
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

// 辅助函数：检查用户名是否已存在
async function userExists(username, githubToken) {
    const filePath = `${DATA_PATH}${username}.json`;
    const userData = await readGitHubFile(filePath, githubToken);
    return userData !== null;
}

// 辅助函数：创建新用户
async function createUser(username, password, email, githubToken) {
    const filePath = `${DATA_PATH}${username}.json`;
    const userData = {
        username: username,
        password: password,
        email: email || '',
        createdAt: new Date().toISOString(),
        role: 'user'
    };
    
    return await writeGitHubFile(filePath, userData, `创建用户: ${username}`, githubToken);
}

// 辅助函数：验证用户登录
async function verifyUser(username, password, githubToken) {
    const filePath = `${DATA_PATH}${username}.json`;
    const userData = await readGitHubFile(filePath, githubToken);
    
    if (!userData) return null;
    if (userData.password !== password) return null;
    
    return { username: userData.username, email: userData.email, role: userData.role };
}

// 辅助函数：从 GitHub 获取静态文件
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
        
        // ==================== 注册 API ====================
        if (url.pathname === '/api/register' && request.method === 'POST') {
            try {
                const { username, password, email } = await request.json();
                
                if (!username || !password) {
                    return new Response(JSON.stringify({ error: '用户名和密码不能为空' }), {
                        status: 400,
                        headers: { 'Content-Type': 'application/json', ...corsHeaders }
                    });
                }
                
                if (password.length < 6) {
                    return new Response(JSON.stringify({ error: '密码长度不能少于6位' }), {
                        status: 400,
                        headers: { 'Content-Type': 'application/json', ...corsHeaders }
                    });
                }
                
                const exists = await userExists(username, GITHUB_TOKEN);
                if (exists) {
                    return new Response(JSON.stringify({ error: '用户名已存在' }), {
                        status: 409,
                        headers: { 'Content-Type': 'application/json', ...corsHeaders }
                    });
                }
                
                await createUser(username, password, email, GITHUB_TOKEN);
                
                return new Response(JSON.stringify({ success: true, message: '注册成功，请登录' }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json', ...corsHeaders }
                });
            } catch (error) {
                return new Response(JSON.stringify({ error: '注册失败: ' + error.message }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json', ...corsHeaders }
                });
            }
        }
        
        // ==================== 登录 API ====================
        if (url.pathname === '/api/login' && request.method === 'POST') {
            try {
                const { username, password } = await request.json();
                
                const user = await verifyUser(username, password, GITHUB_TOKEN);
                if (!user) {
                    return new Response(JSON.stringify({ error: '用户名或密码错误' }), {
                        status: 401,
                        headers: { 'Content-Type': 'application/json', ...corsHeaders }
                    });
                }
                
                // 生成简单的 session token
                const token = btoa(`${username}:${Date.now()}`);
                
                return new Response(JSON.stringify({ 
                    success: true, 
                    token: token,
                    user: user
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json', ...corsHeaders }
                });
            } catch (error) {
                return new Response(JSON.stringify({ error: '登录失败: ' + error.message }), {
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
                const username = decoded.split(':')[0];
                
                const filePath = `${DATA_PATH}${username}.json`;
                const userData = await readGitHubFile(filePath, GITHUB_TOKEN);
                
                if (!userData) {
                    return new Response(JSON.stringify({ error: '用户不存在' }), {
                        status: 404,
                        headers: { 'Content-Type': 'application/json', ...corsHeaders }
                    });
                }
                
                return new Response(JSON.stringify({ 
                    username: userData.username, 
                    email: userData.email,
                    role: userData.role,
                    createdAt: userData.createdAt
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
        
        // ==================== GitHub OAuth 登录（可选） ====================
        if (url.pathname === '/auth/login') {
            const redirectUri = 'https://hedwig.eu.org/auth/callback';
            const githubUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user`;
            return Response.redirect(githubUrl, 302);
        }
        
        if (url.pathname === '/auth/callback') {
            const code = url.searchParams.get('code');
            const redirectUri = 'https://hedwig.eu.org/auth/callback';
            
            try {
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
