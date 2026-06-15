// GitHub 配置
const CONFIG = {
    owner: 'harptwzx',
    repo: 'hedwig',
    dataPath: 'data/users/',
    domain: 'https://hedwig.eu.org'
};

// 读取 GitHub 文件
async function readGitHubFile(filePath, token) {
    const url = `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${filePath}`;
    try {
        const response = await fetch(url, {
            headers: {
                'Authorization': `token ${token}`,
                'User-Agent': 'Hedwig-Worker'
            }
        });
        if (response.status === 404) return null;
        if (!response.ok) return null;
        const data = await response.json();
        const content = atob(data.content);
        return JSON.parse(content);
    } catch (error) {
        return null;
    }
}

// 写入 GitHub 文件
async function writeGitHubFile(filePath, content, commitMessage, token) {
    const url = `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${filePath}`;
    try {
        let sha = null;
        const checkResponse = await fetch(url, {
            headers: {
                'Authorization': `token ${token}`,
                'User-Agent': 'Hedwig-Worker'
            }
        });
        if (checkResponse.ok) {
            const existingData = await checkResponse.json();
            sha = existingData.sha;
        }
        const contentString = JSON.stringify(content, null, 2);
        const encodedContent = btoa(unescape(encodeURIComponent(contentString)));
        const response = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${token}`,
                'Content-Type': 'application/json',
                'User-Agent': 'Hedwig-Worker'
            },
            body: JSON.stringify({
                message: commitMessage,
                content: encodedContent,
                sha: sha
            })
        });
        return response.ok;
    } catch (error) {
        return false;
    }
}

// 静态文件服务
async function serveStaticFile(path) {
    const url = `https://raw.githubusercontent.com/${CONFIG.owner}/${CONFIG.repo}/main/public${path}`;
    try {
        const response = await fetch(url);
        if (response.ok) {
            const content = await response.text();
            let contentType = 'text/html';
            if (path.endsWith('.css')) contentType = 'text/css';
            if (path.endsWith('.js')) contentType = 'application/javascript';
            return new Response(content, {
                headers: { 'Content-Type': contentType }
            });
        }
    } catch (error) {}
    return null;
}

// 生成随机的 Session ID
function generateSessionId() {
    return crypto.randomUUID();
}

// 会话存储（内存中）
let sessions = new Map();

// 清理过期会话（每小时运行一次）
setInterval(() => {
    const now = Date.now();
    for (const [sid, session] of sessions.entries()) {
        if (session.expires < now) {
            sessions.delete(sid);
        }
    }
}, 60 * 60 * 1000);

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;
        
        const GITHUB_CLIENT_ID = env.GITHUB_CLIENT_ID;
        const GITHUB_CLIENT_SECRET = env.GITHUB_CLIENT_SECRET;
        const GITHUB_TOKEN = env.GITHUB_TOKEN;
        
        if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET || !GITHUB_TOKEN) {
            return new Response('配置错误：环境变量未设置', { status: 500 });
        }
        
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type'
                }
            });
        }
        
        // 获取 Cookie 中的 session_id
        const getSessionId = (request) => {
            const cookie = request.headers.get('Cookie');
            if (!cookie) return null;
            const match = cookie.match(/session_id=([^;]+)/);
            return match ? match[1] : null;
        };
        
        // 设置 Cookie
        const setSessionCookie = (sessionId) => {
            return `session_id=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`;
        };
        
        // 清除 Cookie
        const clearSessionCookie = () => {
            return `session_id=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
        };
        
        // 静态文件
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
        if (path === '/dashboard.html') {
            const res = await serveStaticFile('/dashboard.html');
            if (res) return res;
        }
        if (path === '/css/style.css') {
            const res = await serveStaticFile('/css/style.css');
            if (res) return res;
        }
        if (path === '/js/app.js') {
            const res = await serveStaticFile('/js/app.js');
            if (res) return res;
        }
        
        // 注册入口
        if (path === '/auth/register') {
            const username = url.searchParams.get('username');
            const password = url.searchParams.get('password');
            if (!username || !password) {
                return Response.redirect(`${CONFIG.domain}/register.html?error=1`, 302);
            }
            const stateData = { username, password, type: 'register' };
            const state = btoa(JSON.stringify(stateData));
            const redirectUri = `${CONFIG.domain}/auth/callback`;
            const authUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user,user:email&state=${state}`;
            return Response.redirect(authUrl, 302);
        }
        
        // 登录入口
        if (path === '/auth/login') {
            const stateData = { type: 'login' };
            const state = btoa(JSON.stringify(stateData));
            const redirectUri = `${CONFIG.domain}/auth/callback`;
            const authUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user,user:email&state=${state}`;
            return Response.redirect(authUrl, 302);
        }
        
        // GitHub 回调
        if (path === '/auth/callback') {
            const code = url.searchParams.get('code');
            const stateParam = url.searchParams.get('state');
            if (!code) {
                return Response.redirect(`${CONFIG.domain}/login.html?error=1`, 302);
            }
            let state;
            try {
                state = JSON.parse(atob(stateParam));
            } catch (error) {
                state = { type: 'login' };
            }
            const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
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
                    redirect_uri: `${CONFIG.domain}/auth/callback`
                })
            });
            const tokenData = await tokenResponse.json();
            const accessToken = tokenData.access_token;
            if (!accessToken) {
                return Response.redirect(`${CONFIG.domain}/login.html?error=1`, 302);
            }
            const userResponse = await fetch('https://api.github.com/user', {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'User-Agent': 'Hedwig-Worker'
                }
            });
            const githubUser = await userResponse.json();
            const githubId = githubUser.id.toString();
            const emailResponse = await fetch('https://api.github.com/user/emails', {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'User-Agent': 'Hedwig-Worker'
                }
            });
            const emails = await emailResponse.json();
            const primaryEmail = emails.find(e => e.primary)?.email || emails[0]?.email || '';
            
            // 注册流程
            if (state.type === 'register') {
                const { username, password } = state;
                if (!username || !password) {
                    return Response.redirect(`${CONFIG.domain}/register.html?error=1`, 302);
                }
                const githubMappingPath = `${CONFIG.dataPath}github_${githubId}.json`;
                const existingMapping = await readGitHubFile(githubMappingPath, GITHUB_TOKEN);
                if (existingMapping) {
                    return Response.redirect(`${CONFIG.domain}/register.html?error=2`, 302);
                }
                const userFilePath = `${CONFIG.dataPath}user_${username}.json`;
                const existingUser = await readGitHubFile(userFilePath, GITHUB_TOKEN);
                if (existingUser) {
                    return Response.redirect(`${CONFIG.domain}/register.html?error=3`, 302);
                }
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
                const userWriteSuccess = await writeGitHubFile(userFilePath, userData, `创建用户: ${username}`, GITHUB_TOKEN);
                const mappingWriteSuccess = await writeGitHubFile(githubMappingPath, { username: username, githubId: githubId }, `绑定 GitHub: ${username}`, GITHUB_TOKEN);
                if (!userWriteSuccess || !mappingWriteSuccess) {
                    return Response.redirect(`${CONFIG.domain}/register.html?error=4`, 302);
                }
                return Response.redirect(`${CONFIG.domain}/login.html?registered=1`, 302);
            }
            
            // 登录流程
            if (state.type === 'login') {
                const githubMappingPath = `${CONFIG.dataPath}github_${githubId}.json`;
                const mapping = await readGitHubFile(githubMappingPath, GITHUB_TOKEN);
                if (!mapping) {
                    return Response.redirect(`${CONFIG.domain}/login.html?error=2`, 302);
                }
                const userFilePath = `${CONFIG.dataPath}user_${mapping.username}.json`;
                const userData = await readGitHubFile(userFilePath, GITHUB_TOKEN);
                if (!userData) {
                    return Response.redirect(`${CONFIG.domain}/login.html?error=3`, 302);
                }
                
                // 创建 Session
                const sessionId = generateSessionId();
                sessions.set(sessionId, {
                    userId: userData.id,
                    username: userData.username,
                    avatar: userData.avatar,
                    expires: Date.now() + 7 * 24 * 60 * 60 * 1000
                });
                
                // 设置 Cookie 并跳转
                const response = Response.redirect(`${CONFIG.domain}/dashboard.html`, 302);
                response.headers.set('Set-Cookie', setSessionCookie(sessionId));
                return response;
            }
            return Response.redirect(`${CONFIG.domain}/login.html?error=4`, 302);
        }
        
        // 本地登录 API
        if (path === '/api/login' && request.method === 'POST') {
            try {
                const { username, password } = await request.json();
                if (!username || !password) {
                    return new Response(JSON.stringify({ error: '用户名和密码不能为空' }), {
                        status: 400,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }
                const userFilePath = `${CONFIG.dataPath}user_${username}.json`;
                const userData = await readGitHubFile(userFilePath, GITHUB_TOKEN);
                if (!userData || userData.password !== btoa(password)) {
                    return new Response(JSON.stringify({ error: '用户名或密码错误' }), {
                        status: 401,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }
                
                // 创建 Session
                const sessionId = generateSessionId();
                sessions.set(sessionId, {
                    userId: userData.id,
                    username: userData.username,
                    avatar: userData.avatar,
                    expires: Date.now() + 7 * 24 * 60 * 60 * 1000
                });
                
                const response = new Response(JSON.stringify({
                    success: true,
                    redirect: '/dashboard.html'
                }), { headers: { 'Content-Type': 'application/json' } });
                response.headers.set('Set-Cookie', setSessionCookie(sessionId));
                return response;
            } catch (error) {
                return new Response(JSON.stringify({ error: '服务器错误' }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
        }
        
        // 获取当前用户（通过 Cookie）
        if (path === '/api/current-user' && request.method === 'GET') {
            const sessionId = getSessionId(request);
            
            if (!sessionId) {
                return new Response(JSON.stringify({ user: null }), {
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            
            const session = sessions.get(sessionId);
            if (!session || session.expires < Date.now()) {
                if (session) sessions.delete(sessionId);
                return new Response(JSON.stringify({ user: null }), {
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            
            return new Response(JSON.stringify({
                user: {
                    id: session.userId,
                    username: session.username,
                    avatar: session.avatar
                }
            }), { headers: { 'Content-Type': 'application/json' } });
        }
        
        // 退出登录
        if (path === '/api/logout' && request.method === 'POST') {
            const sessionId = getSessionId(request);
            if (sessionId) {
                sessions.delete(sessionId);
            }
            const response = new Response(JSON.stringify({ success: true }));
            response.headers.set('Set-Cookie', clearSessionCookie());
            return response;
        }
        
        return new Response('Not Found', { status: 404 });
    }
};
