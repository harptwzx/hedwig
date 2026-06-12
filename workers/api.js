// ============================================================
// 1. 配置（请务必根据实际情况修改）
// ============================================================
const GITHUB_OWNER = 'harptwzx';
const GITHUB_REPO = 'hedwig';
const DATA_PATH = 'data/users/';
const DOMAIN = 'https://hedwig.eu.org';   // 你的域名

// 从环境变量读取，如果没有则报错
const GITHUB_CLIENT_ID = env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = env.GITHUB_CLIENT_SECRET;
const GITHUB_TOKEN = env.GITHUB_TOKEN;

// ============================================================
// 2. 辅助函数
// ============================================================
async function readGitHubFile(filePath) {
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`;
    const resp = await fetch(url, {
        headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'User-Agent': 'Hedwig-Worker' }
    });
    if (resp.status === 404) return null;
    if (!resp.ok) throw new Error(`GitHub API error: ${resp.status}`);
    const data = await resp.json();
    const content = atob(data.content);
    return JSON.parse(content);
}

async function writeGitHubFile(filePath, content, commitMsg) {
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`;
    let sha = null;
    const existing = await fetch(url, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
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
        headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    return resp.ok;
}

async function serveStaticFile(path) {
    const url = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/public${path}`;
    const resp = await fetch(url);
    if (resp.ok) {
        let contentType = 'text/html';
        if (path.endsWith('.css')) contentType = 'text/css';
        if (path.endsWith('.js')) contentType = 'application/javascript';
        return new Response(await resp.text(), { headers: { 'Content-Type': contentType } });
    }
    return null;
}

// ============================================================
// 3. Worker 主逻辑
// ============================================================
export default {
    async fetch(request, env, ctx) {
        // 注入环境变量（在函数内部重新获取，确保存在）
        const GITHUB_CLIENT_ID = env.GITHUB_CLIENT_ID;
        const GITHUB_CLIENT_SECRET = env.GITHUB_CLIENT_SECRET;
        const GITHUB_TOKEN = env.GITHUB_TOKEN;

        // 如果环境变量缺失，直接报错
        if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET || !GITHUB_TOKEN) {
            return new Response('环境变量未正确配置', { status: 500 });
        }

        const url = new URL(request.url);
        const path = url.pathname;

        // 处理 CORS
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            }});
        }

        // ---------- 静态文件 ----------
        if (path === '/' || path === '/index.html') {
            const res = await serveStaticFile('/index.html');
            if (res) return res;
        }
        if (path === '/login.html') {
            const res = await serveStaticFile('/login.html');
            if (res) return res;
        }
        if (path === '/register.html') {
            const res = await serveStaticFile('/register.html');
            if (res) return res;
        }
        if (path === '/css/common.css') {
            const res = await serveStaticFile('/css/common.css');
            if (res) return res;
        }
        if (path === '/js/common.js') {
            const res = await serveStaticFile('/js/common.js');
            if (res) return res;
        }

        // ---------- 注册入口 ----------
        if (path === '/auth/register') {
            const username = url.searchParams.get('username');
            const password = url.searchParams.get('password');
            if (!username || !password) {
                return Response.redirect(`${DOMAIN}/register.html?result=error`, 302);
            }
            const state = btoa(JSON.stringify({ username, password }));
            const redirectUri = `${DOMAIN}/auth/github/callback`;
            const githubUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user,user:email&state=${state}`;
            return Response.redirect(githubUrl, 302);
        }

        // ---------- 登录入口 ----------
        if (path === '/auth/login') {
            const state = btoa('login');
            const redirectUri = `${DOMAIN}/auth/github/callback`;
            const githubUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user,user:email&state=${state}`;
            return Response.redirect(githubUrl, 302);
        }

        // ---------- GitHub 回调 ----------
        if (path === '/auth/github/callback') {
            const code = url.searchParams.get('code');
            const stateParam = url.searchParams.get('state');
            if (!code) {
                return Response.redirect(`${DOMAIN}/login.html?error=no_code`, 302);
            }

            // 解析 state
            let state;
            try {
                state = JSON.parse(atob(stateParam));
            } catch (e) {
                state = { type: 'login' };
            }

            // 交换 token
            const redirectUri = `${DOMAIN}/auth/github/callback`;
            const tokenResp = await fetch('https://github.com/login/oauth/access_token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({
                    client_id: GITHUB_CLIENT_ID,
                    client_secret: GITHUB_CLIENT_SECRET,
                    code,
                    redirect_uri: redirectUri
                })
            });
            const tokenData = await tokenResp.json();
            const accessToken = tokenData.access_token;
            if (!accessToken) {
                // 打印错误到日志
                console.error('Token exchange failed:', tokenData);
                return Response.redirect(`${DOMAIN}/login.html?error=token_failed`, 302);
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

            // 注册流程
            if (state.username && state.password) {
                const { username, password } = state;

                // 检查是否已绑定 GitHub
                const githubCheckPath = `${DATA_PATH}github_${githubId}.json`;
                const existingGithub = await readGitHubFile(githubCheckPath);
                if (existingGithub) {
                    return Response.redirect(`${DOMAIN}/register.html?result=github_already_used`, 302);
                }

                // 检查用户名是否被占用
                const userPath = `${DATA_PATH}user_${username}.json`;
                const existingUser = await readGitHubFile(userPath);
                if (existingUser) {
                    return Response.redirect(`${DOMAIN}/register.html?result=username_exists`, 302);
                }

                // 创建用户
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
                const ok1 = await writeGitHubFile(userPath, userData, `创建用户: ${username}`);
                const ok2 = await writeGitHubFile(githubCheckPath, { username, githubId }, `GitHub绑定: ${username}`);
                if (!ok1 || !ok2) {
                    return Response.redirect(`${DOMAIN}/register.html?result=error`, 302);
                }
                return Response.redirect(`${DOMAIN}/register.html?result=success`, 302);
            }

            // 登录流程
            if (state === 'login' || state.type === 'login') {
                const githubCheckPath = `${DATA_PATH}github_${githubId}.json`;
                const githubMap = await readGitHubFile(githubCheckPath);
                if (!githubMap) {
                    return Response.redirect(`${DOMAIN}/login.html?error=not_registered`, 302);
                }
                const userPath = `${DATA_PATH}user_${githubMap.username}.json`;
                const userData = await readGitHubFile(userPath);
                if (!userData) {
                    return Response.redirect(`${DOMAIN}/login.html?error=not_found`, 302);
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

            return Response.redirect(`${DOMAIN}/login.html?error=unknown`, 302);
        }

        // ---------- 本地登录 API ----------
        if (path === '/api/login' && request.method === 'POST') {
            const { username, password } = await request.json();
            const userPath = `${DATA_PATH}user_${username}.json`;
            const userData = await readGitHubFile(userPath);
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
            }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
        }

        // ---------- 获取当前用户 ----------
        if (path === '/api/user' && request.method === 'GET') {
            const auth = request.headers.get('Authorization');
            const token = auth?.replace('Bearer ', '');
            if (!token) {
                return new Response(JSON.stringify({ error: '未登录' }), { status: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
            }
            const userId = atob(token).split(':')[0];
            const listUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${DATA_PATH}`;
            const listResp = await fetch(listUrl, { headers: { 'Authorization': `token ${GITHUB_TOKEN}` } });
            if (!listResp.ok) {
                return new Response(JSON.stringify({ error: '获取用户信息失败' }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
            }
            const files = await listResp.json();
            for (const file of files) {
                if (file.name.startsWith('user_') && file.name.endsWith('.json')) {
                    const fileData = await readGitHubFile(`${DATA_PATH}${file.name}`);
                    if (fileData && fileData.id === userId) {
                        return new Response(JSON.stringify({
                            username: fileData.username,
                            avatar: fileData.avatar,
                            createdAt: fileData.createdAt
                        }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
                    }
                }
            }
            return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
        }

        return new Response('Not Found', { status: 404 });
    }
};