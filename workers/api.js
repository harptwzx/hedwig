export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        
        // 获取环境变量
        const GITHUB_CLIENT_ID = env.GITHUB_CLIENT_ID;
        const GITHUB_CLIENT_SECRET = env.GITHUB_CLIENT_SECRET;
        const GITHUB_TOKEN = env.GITHUB_TOKEN;
        
        // 公共静态文件服务（仅示例，可保留完整静态文件服务）
        async function serveStaticFile(path) {
            const fileUrl = `https://raw.githubusercontent.com/harptwzx/hedwig/main/public${path}`;
            const resp = await fetch(fileUrl);
            if (resp.ok) {
                let contentType = 'text/html';
                if (path.endsWith('.css')) contentType = 'text/css';
                if (path.endsWith('.js')) contentType = 'application/javascript';
                return new Response(await resp.text(), { headers: { 'Content-Type': contentType } });
            }
            return null;
        }
        
        // 静态文件路由
        if (url.pathname === '/' || url.pathname === '/index.html') {
            const res = await serveStaticFile('/index.html');
            if (res) return res;
        }
        if (url.pathname === '/login.html') {
            const res = await serveStaticFile('/login.html');
            if (res) return res;
        }
        if (url.pathname === '/register.html') {
            const res = await serveStaticFile('/register.html');
            if (res) return res;
        }
        if (url.pathname === '/css/common.css') {
            const res = await serveStaticFile('/css/common.css');
            if (res) return res;
        }
        if (url.pathname === '/js/common.js') {
            const res = await serveStaticFile('/js/common.js');
            if (res) return res;
        }
        
        // 注册入口：跳转到 GitHub
        if (url.pathname === '/auth/register') {
            const username = url.searchParams.get('username');
            const password = url.searchParams.get('password');
            
            // 调试：返回错误信息以便排查
            if (!GITHUB_CLIENT_ID) {
                return new Response('错误: GITHUB_CLIENT_ID 环境变量未设置', { status: 500 });
            }
            if (!username || !password) {
                return Response.redirect('https://hedwig.eu.org/register.html?result=error', 302);
            }
            
            // 构造 state 参数（存储用户名密码）
            const stateData = JSON.stringify({ username, password });
            const state = Buffer.from(stateData).toString('base64'); // 使用 Buffer 避免编码问题
            
            const redirectUri = 'https://hedwig.eu.org/auth/github/callback';
            const githubUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user,user:email&state=${state}`;
            
            // 跳转到 GitHub
            return Response.redirect(githubUrl, 302);
        }
        
        // 登录入口
        if (url.pathname === '/auth/login') {
            if (!GITHUB_CLIENT_ID) {
                return new Response('错误: GITHUB_CLIENT_ID 环境变量未设置', { status: 500 });
            }
            const state = Buffer.from('login').toString('base64');
            const redirectUri = 'https://hedwig.eu.org/auth/github/callback';
            const githubUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user,user:email&state=${state}`;
            return Response.redirect(githubUrl, 302);
        }
        
        // GitHub 回调
        if (url.pathname === '/auth/github/callback') {
            const code = url.searchParams.get('code');
            const stateBase64 = url.searchParams.get('state');
            if (!code) {
                return Response.redirect('https://hedwig.eu.org/login.html?error=auth_failed', 302);
            }
            
            // 解析 state
            let state;
            try {
                const decoded = Buffer.from(stateBase64, 'base64').toString();
                state = JSON.parse(decoded);
            } catch(e) {
                state = { type: 'login' };
            }
            
            // 交换 token
            const redirectUri = 'https://hedwig.eu.org/auth/github/callback';
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
            
            // 获取邮箱
            const emailRes = await fetch('https://api.github.com/user/emails', {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            const emails = await emailRes.json();
            const primaryEmail = emails.find(e => e.primary)?.email || emails[0]?.email || '';
            
            // 处理注册
            if (state && state.username && state.password) {
                const { username, password } = state;
                const DATA_PATH = 'data/users/';
                const GITHUB_OWNER = 'harptwzx';
                const GITHUB_REPO = 'hedwig';
                
                // 读取/写入 GitHub 文件的辅助函数
                const readGitHubFile = async (path, token) => {
                    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`;
                    const r = await fetch(url, { headers: { 'Authorization': `token ${token}` } });
                    if (r.status === 404) return null;
                    if (!r.ok) throw new Error(`GitHub API error: ${r.status}`);
                    const data = await r.json();
                    const content = atob(data.content);
                    return JSON.parse(content);
                };
                const writeGitHubFile = async (path, content, msg, token) => {
                    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`;
                    let sha = null;
                    const existing = await fetch(url, { headers: { 'Authorization': `token ${token}` } });
                    if (existing.ok) {
                        const existData = await existing.json();
                        sha = existData.sha;
                    }
                    const res = await fetch(url, {
                        method: 'PUT',
                        headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            message: msg,
                            content: btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2)))),
                            sha: sha
                        })
                    });
                    return res.ok;
                };
                
                try {
                    // 检查 GitHub ID 是否已注册
                    const githubCheckPath = `${DATA_PATH}github_${githubId}.json`;
                    const existingGithub = await readGitHubFile(githubCheckPath, GITHUB_TOKEN);
                    if (existingGithub) {
                        return Response.redirect('https://hedwig.eu.org/register.html?result=github_already_used', 302);
                    }
                    // 检查用户名是否已存在
                    const userPath = `${DATA_PATH}user_${username}.json`;
                    const existingUser = await readGitHubFile(userPath, GITHUB_TOKEN);
                    if (existingUser) {
                        return Response.redirect('https://hedwig.eu.org/register.html?result=username_exists', 302);
                    }
                    // 创建用户文件
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
                    await writeGitHubFile(githubCheckPath, { username, githubId }, `GitHub绑定: ${username}`, GITHUB_TOKEN);
                    return Response.redirect('https://hedwig.eu.org/register.html?result=success', 302);
                } catch (err) {
                    return Response.redirect('https://hedwig.eu.org/register.html?result=error', 302);
                }
            }
            
            // 处理登录
            if (state === 'login' || (state && state.type === 'login')) {
                // 通过 GitHub ID 查找用户
                const DATA_PATH = 'data/users/';
                const GITHUB_OWNER = 'harptwzx';
                const GITHUB_REPO = 'hedwig';
                const readGitHubFile = async (path, token) => {
                    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`;
                    const r = await fetch(url, { headers: { 'Authorization': `token ${token}` } });
                    if (r.status === 404) return null;
                    if (!r.ok) throw new Error(`GitHub API error: ${r.status}`);
                    const data = await r.json();
                    const content = atob(data.content);
                    return JSON.parse(content);
                };
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
            }
            
            return Response.redirect('https://hedwig.eu.org/login.html?error=auth_failed', 302);
        }
        
        // 本地登录 API
        if (url.pathname === '/api/login' && request.method === 'POST') {
            try {
                const { username, password } = await request.json();
                const DATA_PATH = 'data/users/';
                const GITHUB_OWNER = 'harptwzx';
                const GITHUB_REPO = 'hedwig';
                const readGitHubFile = async (path, token) => {
                    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`;
                    const r = await fetch(url, { headers: { 'Authorization': `token ${token}` } });
                    if (r.status === 404) return null;
                    if (!r.ok) throw new Error(`GitHub API error: ${r.status}`);
                    const data = await r.json();
                    const content = atob(data.content);
                    return JSON.parse(content);
                };
                const userPath = `${DATA_PATH}user_${username}.json`;
                const userData = await readGitHubFile(userPath, GITHUB_TOKEN);
                if (!userData || userData.password !== btoa(password)) {
                    return new Response(JSON.stringify({ error: '用户名或密码错误' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
                }
                const sessionToken = btoa(`${userData.id}:${Date.now()}`);
                return new Response(JSON.stringify({
                    success: true,
                    token: sessionToken,
                    user: { username: userData.username, avatar: userData.avatar, createdAt: userData.createdAt }
                }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            } catch (err) {
                return new Response(JSON.stringify({ error: '登录失败' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
            }
        }
        
        // 获取当前用户
        if (url.pathname === '/api/user' && request.method === 'GET') {
            const authHeader = request.headers.get('Authorization');
            const token = authHeader?.replace('Bearer ', '');
            if (!token) {
                return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
            }
            try {
                const userId = atob(token).split(':')[0];
                const DATA_PATH = 'data/users/';
                const GITHUB_OWNER = 'harptwzx';
                const GITHUB_REPO = 'hedwig';
                const readGitHubFile = async (path, token) => {
                    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`;
                    const r = await fetch(url, { headers: { 'Authorization': `token ${token}` } });
                    if (r.status === 404) return null;
                    if (!r.ok) throw new Error(`GitHub API error: ${r.status}`);
                    const data = await r.json();
                    const content = atob(data.content);
                    return JSON.parse(content);
                };
                const urlList = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${DATA_PATH}`;
                const listRes = await fetch(urlList, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
                if (!listRes.ok) {
                    return new Response(JSON.stringify({ error: '获取用户信息失败' }), { status: 500 });
                }
                const files = await listRes.json();
                for (const file of files) {
                    if (file.name.startsWith('user_') && file.name.endsWith('.json')) {
                        const fileData = await readGitHubFile(`${DATA_PATH}${file.name}`, GITHUB_TOKEN);
                        if (fileData && fileData.id === userId) {
                            return new Response(JSON.stringify({
                                username: fileData.username,
                                avatar: fileData.avatar,
                                createdAt: fileData.createdAt
                            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                        }
                    }
                }
                return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404 });
            } catch (err) {
                return new Response(JSON.stringify({ error: '获取用户信息失败' }), { status: 500 });
            }
        }
        
        return new Response('Not Found', { status: 404 });
    }
};