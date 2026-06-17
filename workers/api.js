// ============================================
// Hedwig - 安全实用版 Session 方案
// 所有数据存 GitHub，不绑定设备，版本号控制
// ============================================

const CONFIG = {
    owner: 'harptwzx',
    repo: 'hedwig',
    dataPath: 'data/users/',
    sessionsPath: 'data/sessions/',
    domain: 'https://hedwig.eu.org'
};

// ========== 工具函数 ==========

function generateSalt() {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(text) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password, salt) {
    return await sha256(password + salt);
}

async function verifyPassword(password, storedHash, salt) {
    const hash = await hashPassword(password, salt);
    return hash === storedHash;
}

function generateSessionId() {
    return crypto.randomUUID();
}

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Credentials': 'true'
    };
}

// ========== GitHub 文件操作 ==========

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
        if (!response.ok) {
            console.error(`[GitHub] 读取失败 ${filePath}: ${response.status}`);
            return null;
        }
        const data = await response.json();
        const content = atob(data.content);
        return { content: JSON.parse(content), sha: data.sha };
    } catch (error) {
        console.error(`[GitHub] 读取错误 ${filePath}:`, error);
        return null;
    }
}

async function writeGitHubFile(filePath, content, commitMessage, token, existingSha) {
    const url = `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${filePath}`;
    try {
        let sha = existingSha;
        if (!sha) {
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
        if (!response.ok) {
            console.error(`[GitHub] 写入失败 ${filePath}: ${response.status}`);
        }
        return response.ok;
    } catch (error) {
        console.error(`[GitHub] 写入错误 ${filePath}:`, error);
        return false;
    }
}

async function deleteGitHubFile(filePath, token) {
    const url = `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${filePath}`;
    try {
        const checkResponse = await fetch(url, {
            headers: {
                'Authorization': `token ${token}`,
                'User-Agent': 'Hedwig-Worker'
            }
        });
        if (!checkResponse.ok) return false;
        const existingData = await checkResponse.json();
        const response = await fetch(url, {
            method: 'DELETE',
            headers: {
                'Authorization': `token ${token}`,
                'Content-Type': 'application/json',
                'User-Agent': 'Hedwig-Worker'
            },
            body: JSON.stringify({
                message: `删除: ${filePath}`,
                sha: existingData.sha
            })
        });
        return response.ok;
    } catch (error) {
        return false;
    }
}

// ========== Session 管理（存 GitHub，不绑定设备）==========

async function getSession(env, sessionId) {
    const filePath = `${CONFIG.sessionsPath}${sessionId}.json`;
    const result = await readGitHubFile(filePath, env.GITHUB_TOKEN);
    if (!result) return null;

    const session = result.content;
    if (session.expires < Date.now()) {
        await deleteGitHubFile(filePath, env.GITHUB_TOKEN);
        return null;
    }
    return { session, sha: result.sha };
}

async function saveSession(env, sessionId, sessionData) {
    const filePath = `${CONFIG.sessionsPath}${sessionId}.json`;
    await writeGitHubFile(filePath, sessionData, `更新 Session: ${sessionId}`, env.GITHUB_TOKEN);
}

async function deleteSession(env, sessionId) {
    const filePath = `${CONFIG.sessionsPath}${sessionId}.json`;
    await deleteGitHubFile(filePath, env.GITHUB_TOKEN);
}

// 清理某用户的所有 Session
async function cleanupUserSessions(env, username) {
    try {
        const url = `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${CONFIG.sessionsPath}`;
        const response = await fetch(url, {
            headers: {
                'Authorization': `token ${env.GITHUB_TOKEN}`,
                'User-Agent': 'Hedwig-Worker'
            }
        });
        if (!response.ok) return;

        const files = await response.json();
        for (const file of files) {
            if (file.type !== 'file' || !file.name.endsWith('.json')) continue;
            try {
                const content = atob(file.content || '');
                const session = JSON.parse(content);
                if (session.username === username) {
                    await deleteGitHubFile(`${CONFIG.sessionsPath}${file.name}`, env.GITHUB_TOKEN);
                }
            } catch (e) {}
        }
    } catch (error) {}
}

// 概率清理过期 Session
async function cleanupSessions(env) {
    if (Math.random() > 0.1) return;
    try {
        const url = `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${CONFIG.sessionsPath}`;
        const response = await fetch(url, {
            headers: {
                'Authorization': `token ${env.GITHUB_TOKEN}`,
                'User-Agent': 'Hedwig-Worker'
            }
        });
        if (!response.ok) return;

        const files = await response.json();
        const now = Date.now();
        for (const file of files) {
            if (file.type !== 'file' || !file.name.endsWith('.json')) continue;
            try {
                const content = atob(file.content || '');
                const session = JSON.parse(content);
                if (session.expires < now) {
                    await deleteGitHubFile(`${CONFIG.sessionsPath}${file.name}`, env.GITHUB_TOKEN);
                }
            } catch (e) {}
        }
    } catch (error) {}
}

// ========== Cookie 处理 ==========

function getSessionId(request) {
    const cookie = request.headers.get('Cookie');
    if (!cookie) return null;
    const match = cookie.match(/session_id=([^;]+)/);
    return match ? match[1] : null;
}

function setSessionCookie(sessionId) {
    return `session_id=${sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800; Secure`;
}

function clearSessionCookie() {
    return `session_id=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure`;
}

// ========== 静态文件服务 ==========

async function serveStaticFile(path) {
    const url = `https://raw.githubusercontent.com/${CONFIG.owner}/${CONFIG.repo}/main/public${path}`;
    try {
        const response = await fetch(url);
        if (response.ok) {
            const content = await response.text();
            let contentType = 'text/html';
            if (path.endsWith('.css')) contentType = 'text/css';
            if (path.endsWith('.js')) contentType = 'application/javascript';
            if (path.endsWith('.png')) contentType = 'image/png';
            if (path.endsWith('.jpg') || path.endsWith('.jpeg')) contentType = 'image/jpeg';
            if (path.endsWith('.svg')) contentType = 'image/svg+xml';
            return new Response(content, { headers: { 'Content-Type': contentType } });
        }
    } catch (error) {}
    return null;
}

// ========== 主入口 ==========

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;

        // 环境变量检查
        if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || !env.GITHUB_TOKEN) {
            return new Response('服务器配置错误', { status: 500 });
        }

        // 概率清理过期 Session
        ctx.waitUntil(cleanupSessions(env));

        // CORS 预检
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders() });
        }

        // ========== 静态文件 ==========
        const staticPaths = {
            '/': '/index.html',
            '/index.html': '/index.html',
            '/login.html': '/login.html',
            '/register.html': '/register.html',
            '/dashboard.html': '/dashboard.html',
            '/css/style.css': '/css/style.css',
            '/js/app.js': '/js/app.js'
        };

        if (staticPaths[path]) {
            const res = await serveStaticFile(staticPaths[path]);
            if (res) return res;
        }

        // ========== 注册入口 ==========
        if (path === '/auth/register') {
            const username = url.searchParams.get('username');
            const password = url.searchParams.get('password');
            if (!username || !password) {
                return Response.redirect(`${CONFIG.domain}/register.html?error=1`, 302);
            }
            const stateData = { username, password, type: 'register' };
            const state = btoa(JSON.stringify(stateData));
            const redirectUri = `${CONFIG.domain}/auth/callback`;
            const authUrl = `https://github.com/login/oauth/authorize?client_id=${env.GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user,user:email&state=${state}`;
            return Response.redirect(authUrl, 302);
        }

        // ========== 登录入口（GitHub OAuth）==========
        if (path === '/auth/login') {
            const stateData = { type: 'login' };
            const state = btoa(JSON.stringify(stateData));
            const redirectUri = `${CONFIG.domain}/auth/callback`;
            const authUrl = `https://github.com/login/oauth/authorize?client_id=${env.GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user,user:email&state=${state}`;
            return Response.redirect(authUrl, 302);
        }

        // ========== GitHub 回调 ==========
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
                    client_id: env.GITHUB_CLIENT_ID,
                    client_secret: env.GITHUB_CLIENT_SECRET,
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
                headers: { 'Authorization': `Bearer ${accessToken}`, 'User-Agent': 'Hedwig-Worker' }
            });
            const githubUser = await userResponse.json();
            const githubId = githubUser.id.toString();

            const emailResponse = await fetch('https://api.github.com/user/emails', {
                headers: { 'Authorization': `Bearer ${accessToken}`, 'User-Agent': 'Hedwig-Worker' }
            });
            const emails = await emailResponse.json();
            const primaryEmail = emails.find(e => e.primary)?.email || emails[0]?.email || '';

            // ===== 注册流程 =====
            if (state.type === 'register') {
                const { username, password } = state;
                if (!username || !password) {
                    return Response.redirect(`${CONFIG.domain}/register.html?error=1`, 302);
                }

                const githubMappingPath = `${CONFIG.dataPath}github_${githubId}.json`;
                const existingMapping = await readGitHubFile(githubMappingPath, env.GITHUB_TOKEN);
                if (existingMapping) {
                    return Response.redirect(`${CONFIG.domain}/register.html?error=2`, 302);
                }

                const userFilePath = `${CONFIG.dataPath}user_${username}.json`;
                const existingUser = await readGitHubFile(userFilePath, env.GITHUB_TOKEN);
                if (existingUser) {
                    return Response.redirect(`${CONFIG.domain}/register.html?error=3`, 302);
                }

                const salt = generateSalt();
                const passwordHash = await hashPassword(password, salt);

                const userData = {
                    id: Date.now().toString(),
                    username: username,
                    passwordHash: passwordHash,
                    salt: salt,
                    tokenVersion: 1,
                    githubId: githubId,
                    githubLogin: githubUser.login,
                    email: primaryEmail,
                    avatar: githubUser.avatar_url,
                    createdAt: new Date().toISOString()
                };

                const userWriteSuccess = await writeGitHubFile(userFilePath, userData, `创建用户: ${username}`, env.GITHUB_TOKEN);
                const mappingWriteSuccess = await writeGitHubFile(githubMappingPath, { username: username, githubId: githubId }, `绑定 GitHub: ${username}`, env.GITHUB_TOKEN);

                if (!userWriteSuccess || !mappingWriteSuccess) {
                    return Response.redirect(`${CONFIG.domain}/register.html?error=4`, 302);
                }
                return Response.redirect(`${CONFIG.domain}/login.html?registered=1`, 302);
            }

            // ===== 登录流程（GitHub OAuth）=====
            if (state.type === 'login') {
                const githubMappingPath = `${CONFIG.dataPath}github_${githubId}.json`;
                const mappingResult = await readGitHubFile(githubMappingPath, env.GITHUB_TOKEN);
                if (!mappingResult) {
                    return Response.redirect(`${CONFIG.domain}/login.html?error=2`, 302);
                }

                const userFilePath = `${CONFIG.dataPath}user_${mappingResult.content.username}.json`;
                const userResult = await readGitHubFile(userFilePath, env.GITHUB_TOKEN);
                if (!userResult) {
                    return Response.redirect(`${CONFIG.domain}/login.html?error=3`, 302);
                }

                const userData = userResult.content;
                const sessionId = generateSessionId();
                const sessionData = {
                    userId: userData.id,
                    username: userData.username,
                    avatar: userData.avatar,
                    tokenVersion: userData.tokenVersion || 1,
                    expires: Date.now() + 7 * 24 * 60 * 60 * 1000
                };

                await saveSession(env, sessionId, sessionData);

                const response = Response.redirect(`${CONFIG.domain}/dashboard.html`, 302);
                response.headers.set('Set-Cookie', setSessionCookie(sessionId));
                return response;
            }

            return Response.redirect(`${CONFIG.domain}/login.html?error=4`, 302);
        }

        // ========== 本地登录 API ==========
        if (path === '/api/login' && request.method === 'POST') {
            try {
                const { username, password } = await request.json();

                if (!username || !password) {
                    return new Response(JSON.stringify({
                        success: false,
                        error: '用户名和密码不能为空'
                    }), {
                        status: 400,
                        headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
                    });
                }

                const userFilePath = `${CONFIG.dataPath}user_${username}.json`;
                const userResult = await readGitHubFile(userFilePath, env.GITHUB_TOKEN);

                if (!userResult) {
                    return new Response(JSON.stringify({
                        success: false,
                        error: '用户名或密码错误'
                    }), {
                        status: 401,
                        headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
                    });
                }

                const userData = userResult.content;

                let passwordValid = false;
                if (userData.passwordHash && userData.salt) {
                    passwordValid = await verifyPassword(password, userData.passwordHash, userData.salt);
                } else if (userData.password) {
                    passwordValid = userData.password === btoa(password);
                }

                if (!passwordValid) {
                    return new Response(JSON.stringify({
                        success: false,
                        error: '用户名或密码错误'
                    }), {
                        status: 401,
                        headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
                    });
                }

                const sessionId = generateSessionId();
                const sessionData = {
                    userId: userData.id,
                    username: userData.username,
                    avatar: userData.avatar,
                    tokenVersion: userData.tokenVersion || 1,
                    expires: Date.now() + 7 * 24 * 60 * 60 * 1000
                };

                await saveSession(env, sessionId, sessionData);

                const responseData = {
                    success: true,
                    redirect: '/dashboard.html'
                };

                const response = new Response(JSON.stringify(responseData), {
                    headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
                });
                response.headers.set('Set-Cookie', setSessionCookie(sessionId));
                return response;

            } catch (error) {
                return new Response(JSON.stringify({
                    success: false,
                    error: '服务器错误'
                }), {
                    status: 500,
                    headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
                });
            }
        }

        // ========== 获取当前用户（版本号校验）==========
        if (path === '/api/current-user' && request.method === 'GET') {
            const sessionId = getSessionId(request);

            if (!sessionId) {
                return new Response(JSON.stringify({ user: null }), {
                    headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
                });
            }

            const sessionResult = await getSession(env, sessionId);
            if (!sessionResult) {
                const response = new Response(JSON.stringify({ user: null }), {
                    headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
                });
                response.headers.set('Set-Cookie', clearSessionCookie());
                return response;
            }

            const session = sessionResult.session;

            // 查用户最新版本号
            const userFilePath = `${CONFIG.dataPath}user_${session.username}.json`;
            const userResult = await readGitHubFile(userFilePath, env.GITHUB_TOKEN);

            if (!userResult) {
                await deleteSession(env, sessionId);
                return new Response(JSON.stringify({ user: null }), {
                    headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
                });
            }

            const userData = userResult.content;

            // 版本号校验：改密码后旧 Session 失效
            if (session.tokenVersion !== (userData.tokenVersion || 1)) {
                await deleteSession(env, sessionId);
                const response = new Response(JSON.stringify({ user: null }), {
                    headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
                });
                response.headers.set('Set-Cookie', clearSessionCookie());
                return response;
            }

            return new Response(JSON.stringify({
                user: {
                    id: session.userId,
                    username: session.username,
                    avatar: session.avatar
                }
            }), { headers: { ...corsHeaders(), 'Content-Type': 'application/json' } });
        }

        // ========== 退出登录 ==========
        if (path === '/api/logout' && request.method === 'POST') {
            const sessionId = getSessionId(request);
            if (sessionId) {
                await deleteSession(env, sessionId);
            }
            const response = new Response(JSON.stringify({ success: true }), {
                headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
            });
            response.headers.set('Set-Cookie', clearSessionCookie());
            return response;
        }

        // ========== 修改密码（让所有设备退出）==========
        if (path === '/api/change-password' && request.method === 'POST') {
            const sessionId = getSessionId(request);
            if (!sessionId) {
                return new Response(JSON.stringify({ success: false, error: '未登录' }), {
                    status: 401,
                    headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
                });
            }

            const sessionResult = await getSession(env, sessionId);
            if (!sessionResult) {
                return new Response(JSON.stringify({ success: false, error: 'Session 无效' }), {
                    status: 401,
                    headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
                });
            }

            try {
                const { oldPassword, newPassword } = await request.json();
                if (!oldPassword || !newPassword || newPassword.length < 6) {
                    return new Response(JSON.stringify({ success: false, error: '密码格式错误' }), {
                        status: 400,
                        headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
                    });
                }

                const userFilePath = `${CONFIG.dataPath}user_${sessionResult.session.username}.json`;
                const userResult = await readGitHubFile(userFilePath, env.GITHUB_TOKEN);
                if (!userResult) {
                    return new Response(JSON.stringify({ success: false, error: '用户不存在' }), {
                        status: 404,
                        headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
                    });
                }

                const userData = userResult.content;

                let oldValid = false;
                if (userData.passwordHash && userData.salt) {
                    oldValid = await verifyPassword(oldPassword, userData.passwordHash, userData.salt);
                } else if (userData.password) {
                    oldValid = userData.password === btoa(oldPassword);
                }

                if (!oldValid) {
                    return new Response(JSON.stringify({ success: false, error: '旧密码错误' }), {
                        status: 401,
                        headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
                    });
                }

                // 更新密码，版本号 +1
                const newSalt = generateSalt();
                userData.passwordHash = await hashPassword(newPassword, newSalt);
                userData.salt = newSalt;
                userData.tokenVersion = (userData.tokenVersion || 1) + 1;

                await writeGitHubFile(userFilePath, userData, '修改密码', env.GITHUB_TOKEN, userResult.sha);

                // 清理该用户所有 Session
                await cleanupUserSessions(env, userData.username);

                return new Response(JSON.stringify({ success: true }), {
                    headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
                });

            } catch (error) {
                return new Response(JSON.stringify({ success: false, error: '服务器错误' }), {
                    status: 500,
                    headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
                });
            }
        }

        return new Response('Not Found', { status: 404 });
    }
};