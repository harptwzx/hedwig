// 辅助函数：安全读取 GitHub 文件
async function safeReadGitHubFile(filePath, token) {
    const url = `https://api.github.com/repos/harptwzx/hedwig/contents/${filePath}`;
    try {
        const resp = await fetch(url, {
            headers: { 'Authorization': `token ${token}`, 'User-Agent': 'Hedwig-Worker' }
        });
        if (resp.status === 404) return null;
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        const content = atob(data.content);
        return JSON.parse(content);
    } catch (err) {
        console.error(`读取文件失败 ${filePath}:`, err);
        return null;
    }
}

// 辅助函数：安全写入 GitHub 文件
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

        // 处理 CORS
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
            // 静态文件
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

            // 注册入口
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

            // GitHub 回调 - 详细错误显示
            if (url.pathname === '/auth/github/callback') {
                const code = url.searchParams.get('code');
                const stateParam = url.searchParams.get('state');
                if (!code) {
                    return new Response('缺少 code 参数', { status: 400 });
                }

                // 解析 state
                let state;
                try {
                    const decoded = atob(stateParam);
                    state = JSON.parse(decoded);
                } catch (e) {
                    state = { username: null, password: null };
                }

                const redirectUri = 'https://hedwig.eu.org/auth/github/callback';

                // 交换 token
                const tokenResp = await fetch('https://github.com/login/oauth/access_token', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'User-Agent': 'Hedwig-Worker'
                    },
                    body: JSON.stringify({
                        client_id: GITHUB_CLIENT_ID,
                        client_secret: GITHUB_CLIENT_SECRET,
                        code: code,
                        redirect_uri: redirectUri
                    })
                });

                const rawText = await tokenResp.text();
                let tokenData;
                try {
                    tokenData = JSON.parse(rawText);
                } catch (e) {
                    // 如果 GitHub 返回的不是 JSON，直接显示原始响应
                    return new Response(`GitHub 返回了非 JSON 响应:\n\n${rawText}`, {
                        status: 500,
                        headers: { 'Content-Type': 'text/plain' }
                    });
                }

                const accessToken = tokenData.access_token;
                if (!accessToken) {
                    return new Response(`Token 交换失败，GitHub 返回:\n${JSON.stringify(tokenData, null, 2)}`, {
                        status: 400,
                        headers: { 'Content-Type': 'text/plain' }
                    });
                }

                // 获取 GitHub 用户信息
                const userRes = await fetch('https://api.github.com/user', {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                });
                const githubUser = await userRes.json();
                const githubId = githubUser.id.toString();

                // 注册处理
                if (state.username && state.password) {
                    const { username, password } = state;
                    const DATA_PATH = 'data/users/';

                    // 检查 GitHub ID 是否已被注册
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

                    // 创建用户
                    const userData = {
                        id: Date.now().toString(),
                        username,
                        password: btoa(password),
                        githubId,
                        githubLogin: githubUser.login,
                        email: githubUser.email || '',
                        avatar: githubUser.avatar_url,
                        createdAt: new Date().toISOString()
                    };

                    const ok1 = await safeWriteGitHubFile(userPath, userData, `创建用户: ${username}`, GITHUB_TOKEN);
                    const ok2 = await safeWriteGitHubFile(githubCheckPath, { username, githubId }, `GitHub绑定: ${username}`, GITHUB_TOKEN);
                    if (!ok1 || !ok2) {
                        return new Response('写入用户数据到 GitHub 失败', { status: 500 });
                    }
                    return Response.redirect('https://hedwig.eu.org/register.html?result=success', 302);
                }

                return new Response('无效的 state 参数', { status: 400 });
            }

            return new Response('Not Found', { status: 404 });
        } catch (err) {
            console.error(err);
            return new Response(`服务器错误: ${err.message}`, { status: 500 });
        }
    }
};