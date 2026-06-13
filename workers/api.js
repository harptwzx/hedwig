// ============================================================
// 配置
// ============================================================
const GITHUB_OWNER = 'harptwzx';
const GITHUB_REPO = 'hedwig';
const DATA_PATH = 'data/users/';
const DOMAIN = 'https://hedwig.eu.org';

// ============================================================
// 辅助函数：读写 GitHub 文件
// ============================================================
async function readGitHubFile(filePath, token) {
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`;
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
        console.error(`读取失败 ${filePath}:`, err);
        return null;
    }
}

async function writeGitHubFile(filePath, content, commitMsg, token) {
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`;
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
        console.error(`写入失败 ${filePath}:`, err);
        return false;
    }
}

// ============================================================
// 辅助函数：静态文件服务
// ============================================================
async function serveStatic(path) {
    const url = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/public${path}`;
    try {
        const resp = await fetch(url);
        if (resp.ok) {
            let contentType = 'text/html';
            if (path.endsWith('.css')) contentType = 'text/css';
            if (path.endsWith('.js')) contentType = 'application/javascript';
            return new Response(await resp.text(), { headers: { 'Content-Type': contentType } });
        }
    } catch (e) { }
    return null;
}

// ============================================================
// Worker 主逻辑
// ============================================================
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_TOKEN } = env;

        // 检查环境变量
        if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET || !GITHUB_TOKEN) {
            return new Response('环境变量未配置', { status: 500 });
        }

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
                return Response.redirect(`${DOMAIN}/register.html?result=error`, 302);
            }
            const state = btoa(JSON.stringify({ username, password }));
            const redirectUri = `${DOMAIN}/auth/github/callback`;
            const githubUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user,user:email&state=${state}`;
            return Response.redirect(githubUrl, 302);
        }

        // ========== 登录入口 ==========
        if (url.pathname === '/auth/login') {
            const redirectUri = `${DOMAIN}/auth/github/callback`;
            const githubUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user,user:email&state=login`;
            return Response.redirect(githubUrl, 302);
        }

        // ========== GitHub 回调 ==========
        if (url.pathname === '/auth/github/callback') {
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
                state = 'login';
            }

            const redirectUri = `${DOMAIN}/auth/github/callback`;

            // 交换 token
            const tokenResp = await fetch('https://github.com/login/oauth/access_token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': 'Hedwig-Worker' },
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
                console.error('Token 交换失败:', tokenData);
                return Response.redirect(`${DOMAIN}/login.html?error=token_failed`, 302);
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

                // 检查 GitHub ID 是否已被注册
                const githubCheckPath = `${DATA_PATH}github_${githubId}.json`;
                const existingGithub = await readGitHubFile(githubCheckPath, GITHUB_TOKEN);
                if (existingGithub) {
                    return Response.redirect(`${DOMAIN}/register.html?result=github_already_used`, 302);
                }

                // 检查用户名是否已被占用
                const userPath = `${DATA_PATH}user_${username}.json`;
                const existingUser = await readGitHubFile(userPath, GITHUB_TOKEN);
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
                await writeGitHubFile(userPath, userData, `创建用户: ${username}`, GITHUB_TOKEN);
                await writeGitHubFile(githubCheckPath, { username, githubId }, `GitHub绑定: ${username}`, GITHUB_TOKEN);

                return Response.redirect(`${DOMAIN}/register.html?result=success`, 302);
            }

            // ========== 登录流程 ==========
            if (state === 'login') {
                const githubCheckPath = `${DATA_PATH}github_${githubId}.json`;
                const githubMap = await readGitHubFile(githubCheckPath, GITHUB_TOKEN);
                if (!githubMap) {
                    return Response.redirect(`${DOMAIN}/login.html?error=not_registered`, 302);
                }
                const userPath = `${DATA_PATH}user_${githubMap.username}.json`;
                const userData = await readGitHubFile(userPath, GITHUB_TOKEN);
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

        // ========== 本地登录 API ==========
        if (url.pathname === '/api/login' && request.method === 'POST') {
            const { username, password } = await request.json();
            const userPath = `${DATA_PATH}user_${username}.json`;
            const userData = await readGitHubFile(userPath, GITHUB_TOKEN);
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
                user: { username: userData.username, avatar: userData.avatar, createdAt: userData.createdAt }
            }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
        }

        // ========== 获取当前用户 ==========
        if (url.pathname === '/api/user' && request.method === 'GET') {
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
                    const fileData = await readGitHubFile(`${DATA_PATH}${file.name}`, GITHUB_TOKEN);
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