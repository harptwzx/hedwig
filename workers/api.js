// ==================== 辅助函数 ====================

// 安全读取 GitHub 文件
async function safeReadGitHubFile(filePath, token) {
    const url = `https://api.github.com/repos/harptwzx/hedwig/contents/${filePath}`;
    try {
        const resp = await fetch(url, {
            headers: { 'Authorization': `token ${token}`, 'User-Agent': 'Hedwig-Worker' }
        });
        if (resp.status === 404) return null;
        if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        const data = await resp.json();
        const content = atob(data.content);
        return JSON.parse(content);
    } catch (err) {
        console.error(`读取文件失败 ${filePath}:`, err);
        return null;
    }
}

// 安全写入 GitHub 文件
async function safeWriteGitHubFile(filePath, content, commitMsg, token) {
    const url = `https://api.github.com/repos/harptwzx/hedwig/contents/${filePath}`;
    try {
        let sha = null;
        const existing = await fetch(url, { headers: { 'Authorization': `token ${token}` } });
        if (existing.ok) {
            const existData = await existing.json();
            sha = existData.sha;
        }
        const body = {
            message: commitMsg,
            content: btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2)))),
            sha: sha
        };
        const resp = await fetch(url, {
            method: 'PUT',
            headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        return resp.ok;
    } catch (err) {
        console.error(`写入文件失败 ${filePath}:`, err);
        return false;
    }
}

// 静态文件服务
async function serveStatic(path) {
    const fileUrl = `https://raw.githubusercontent.com/harptwzx/hedwig/main/public${path}`;
    try {
        const resp = await fetch(fileUrl);
        if (resp.ok) {
            let contentType = 'text/html';
            if (path.endsWith('.css')) contentType = 'text/css';
            if (path.endsWith('.js')) contentType = 'application/javascript';
            return new Response(await resp.text(), { headers: { 'Content-Type': contentType } });
        }
    } catch (e) {}
    return null;
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_TOKEN } = env;

        // 处理 CORS 预检
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                }
            });
        }

        try {
            // ========== 静态文件 ==========
            if (url.pathname === '/' || url.pathname === '/index.html') {
                const res = await serveStatic('/index.html');
                if (res) return res;
            }
            if (url.pathname === '/login.html') {
                const res = await serveStatic('/login.html');
                if (res) return res;
            }
            if (url.pathname === '/register.html') {
                const res = await serveStatic('/register.html');
                if (res) return res;
            }
            if (url.pathname === '/css/common.css') {
                const res = await serveStatic('/css/common.css');
                if (res) return res;
            }
            if (url.pathname === '/js/common.js') {
                const res = await serveStatic('/js/common.js');
                if (res) return res;
            }

            // ========== 注册入口 ==========
            if (url.pathname === '/auth/register') {
                const username = url.searchParams.get('username');
                const password = url.searchParams.get('password');
                if (!username || !password) {
                    return Response.redirect('https://hedwig.eu.org/register.html?result=error', 302);
                }
                const stateData = JSON.stringify({ username, password });
                const state = btoa(stateData);
                const redirectUri = 'https://hedwig.eu.org/auth/github/callback';
                const githubUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user,user:email&state=${state}`;
                return Response.redirect(githubUrl, 302);
            }

            // ========== 登录入口 ==========
            if (url.pathname === '/auth/login') {
                const state = btoa('login');
                const redirectUri = 'https://hedwig.eu.org/auth/github/callback';
                const githubUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user,user:email&state=${state}`;
                return Response.redirect(githubUrl, 302);
            }

            // ========== GitHub 回调 ==========
            if (url.pathname === '/auth/github/callback') {
                const code = url.searchParams.get('code');
                const stateParam = url.searchParams.get('state');
                if (!code) {
                    return Response.redirect('https://hedwig.eu.org/login.html?error=auth_failed', 302);
                }

                // 解析 state
                let state;
                try {
                    const decoded = atob(stateParam);
                    state = JSON.parse(decoded);
                } catch (e) {
                    state = { type: 'login' };
                }

                // 交换 token - 关键修正部分
                const redirectUri = 'https://hedwig.eu.org/auth/github/callback';
                const tokenResp = await fetch('https://github.com/login/oauth/access_token', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',  // 强制要求 JSON
                        'User-Agent': 'Hedwig-Worker'
                    },
                    body: JSON.stringify({
                        client_id: GITHUB_CLIENT_ID,
                        client_secret: GITHUB_CLIENT_SECRET,
                        code: code,
                        redirect_uri: redirectUri
                    })
                });

                // 获取原始文本，先判断是否为 JSON
                const rawText = await tokenResp.text();
                let tokenData;
                try {
                    tokenData = JSON.parse(rawText);
                } catch (e) {
                    console.error('GitHub 返回的不是 JSON:', rawText.substring(0, 200));
                    return Response.redirect('https://hedwig.eu.org/login.html?error=auth_failed', 302);
                }

                const accessToken = tokenData.access_token;
                if (!accessToken) {
                    console.error('Token 交换失败:', tokenData);
                    return Response.redirect('https://hedwig.eu.org/login.html?error=auth_failed', 302);
                }

                // 获取 GitHub 用户信息
                const userRes = await fetch('https://api.github.com/user', {
                    headers: { 'Authorization': `Bearer ${accessToken}`, 'User-Agent': 'Hedwig-Worker' }
                });
                const githubUser = await userRes.json();
                const githubId = githubUser.id.toString();

                // 获取邮箱
                const emailRes = await fetch('https://api.github.com/user/emails', {
                    headers: { 'Authorization': `Bearer ${accessToken}`, 'User-Agent': 'Hedwig-Worker' }
                });
                const emails = await emailRes.json();
                const primaryEmail = emails.find(e => e.primary)?.email || emails[0]?.email || '';

                // ========== 注册流程 ==========
                if (state.username && state.password) {
                    const { username, password } = state;
                    const DATA_PATH = 'data/users/';

                    // 检查 GitHub ID 是否已注册
                    const githubCheckPath = `${DATA_PATH}github_${githubId}.json`;
                    const existingGithub = await safeReadGitHubFile(githubCheckPath, GITHUB_TOKEN);
                    if (existingGithub) {
                        return Response.redirect('https://hedwig.eu.org/register.html?result=github_already_used', 302);
                    }

                    // 检查用户名是否已存在
                    const userPath = `${DATA_PATH}user_${username}.json`;
                    const existingUser = await safeReadGitHubFile(userPath, GITHUB_TOKEN);
                    if (existingUser) {
                        return Response.redirect('https://hedwig.eu.org/register.html?result=username_exists', 302);
                    }

                    // 创建用户数据
                    const userData = {
                        id: Date.now().toString(),
                        username,
                        password: btoa(password),
                        githubId,
                        githubLogin: githubUser.login,
                        email: primaryEmail,
                        avatar: githubUser.avatar_url,
                        createdAt: new Date().toISOString()
                    };

                    const ok1 = await safeWriteGitHubFile(userPath, userData, `创建用户: ${username}`, GITHUB_TOKEN);
                    const ok2 = await safeWriteGitHubFile(githubCheckPath, { username, githubId }, `GitHub绑定: ${username}`, GITHUB_TOKEN);
                    if (!ok1 || !ok2) {
                        return Response.redirect('https://hedwig.eu.org/register.html?result=error', 302);
                    }
                    return Response.redirect('https://hedwig.eu.org/register.html?result=success', 302);
                }

                // ========== 登录流程 ==========
                if (state === 'login' || state.type === 'login') {
                    const DATA_PATH = 'data/users/';
                    const githubCheckPath = `${DATA_PATH}github_${githubId}.json`;
                    const githubMap = await safeReadGitHubFile(githubCheckPath, GITHUB_TOKEN);
                    if (!githubMap) {
                        return Response.redirect('https://hedwig.eu.org/login.html?error=not_registered', 302);
                    }
                    const userPath = `${DATA_PATH}user_${githubMap.username}.json`;
                    const userData = await safeReadGitHubFile(userPath, GITHUB_TOKEN);
                    if (!userData) {
                        return Response.redirect('https://hedwig.eu.org/login.html?error=not_found', 302);
                    }
                    const sessionToken = btoa(`${userData.id}:${Date.now()}`);
                    const html = `
                        <!DOCTYPE html>
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
                        </html>
                    `;
                    return new Response(html, { headers: { 'Content-Type': 'text/html' } });
                }

                return Response.redirect('https://hedwig.eu.org/login.html?error=auth_failed', 302);
            }

            // ========== 本地登录 API ==========
            if (url.pathname === '/api/login' && request.method === 'POST') {
                const { username, password } = await request.json();
                const userPath = `data/users/user_${username}.json`;
                const userData = await safeReadGitHubFile(userPath, GITHUB_TOKEN);
                if (!userData || userData.password !== btoa(password)) {
                    return new Response(JSON.stringify({ error: '用户名或密码错误' }), {
                        status: 401,
                        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
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
                }), { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
            }

            // ========== 获取当前用户 ==========
            if (url.pathname === '/api/user' && request.method === 'GET') {
                const auth = request.headers.get('Authorization');
                const token = auth?.replace('Bearer ', '');
                if (!token) {
                    return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
                }
                const userId = atob(token).split(':')[0];
                const DATA_PATH = 'data/users/';
                const urlList = `https://api.github.com/repos/harptwzx/hedwig/contents/${DATA_PATH}`;
                const listRes = await fetch(urlList, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
                if (!listRes.ok) {
                    return new Response(JSON.stringify({ error: '获取用户信息失败' }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
                }
                const files = await listRes.json();
                for (const file of files) {
                    if (file.name.startsWith('user_') && file.name.endsWith('.json')) {
                        const fileData = await safeReadGitHubFile(`${DATA_PATH}${file.name}`, GITHUB_TOKEN);
                        if (fileData && fileData.id === userId) {
                            return new Response(JSON.stringify({
                                username: fileData.username,
                                avatar: fileData.avatar,
                                createdAt: fileData.createdAt
                            }), { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
                        }
                    }
                }
                return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
            }

            return new Response('Not Found', { status: 404 });
        } catch (err) {
            console.error('Worker 未捕获异常:', err);
            // 返回更友好的错误信息，但不暴露内部细节
            return new Response('服务器内部错误，请稍后重试', { status: 500 });
        }
    }
};