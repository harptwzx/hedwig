// ============================================================
// 配置
// ============================================================
const GITHUB_OWNER = 'harptwzx';
const GITHUB_REPO = 'hedwig';
const DATA_PATH = 'data/users/';
const DOMAIN = 'https://hedwig.eu.org';

// ============================================================
// 辅助函数：写入 GitHub 文件（带详细日志）
// ============================================================
async function writeGitHubFile(filePath, content, commitMsg, token) {
    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`;
    console.log(`[写入] 开始写入: ${filePath}`);
    
    try {
        // 1. 检查文件是否已存在，获取 SHA
        let sha = null;
        const existing = await fetch(url, { 
            headers: { 'Authorization': `token ${token}`, 'User-Agent': 'Hedwig-Worker' } 
        });
        
        if (existing.ok) {
            const existData = await existing.json();
            sha = existData.sha;
            console.log(`[写入] 文件已存在，SHA: ${sha}`);
        } else if (existing.status === 404) {
            console.log(`[写入] 文件不存在，将创建新文件`);
        } else {
            console.log(`[写入] 检查文件时出错: ${existing.status}`);
        }

        // 2. 准备写入内容
        const contentStr = JSON.stringify(content, null, 2);
        const encodedContent = btoa(unescape(encodeURIComponent(contentStr)));
        
        const body = {
            message: commitMsg,
            content: encodedContent,
            sha: sha
        };
        
        // 3. 执行写入
        const resp = await fetch(url, {
            method: 'PUT',
            headers: { 
                'Authorization': `token ${token}`, 
                'Content-Type': 'application/json',
                'User-Agent': 'Hedwig-Worker'
            },
            body: JSON.stringify(body)
        });
        
        const responseText = await resp.text();
        console.log(`[写入] 响应状态: ${resp.status}`);
        console.log(`[写入] 响应内容: ${responseText.substring(0, 200)}`);
        
        if (resp.ok) {
            console.log(`[写入] ✅ 成功写入: ${filePath}`);
            return true;
        } else {
            console.log(`[写入] ❌ 失败: ${resp.status}`);
            return false;
        }
    } catch (err) {
        console.error(`[写入] 异常:`, err);
        return false;
    }
}

// ============================================================
// 辅助函数：读取 GitHub 文件
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

        console.log(`[请求] ${request.method} ${url.pathname}`);

        // 检查环境变量
        if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET || !GITHUB_TOKEN) {
            console.error('[错误] 环境变量未配置');
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
            console.log(`[注册] 收到注册请求: username=${username}`);
            
            if (!username || !password) {
                return Response.redirect(`${DOMAIN}/register.html?result=error`, 302);
            }
            const state = btoa(JSON.stringify({ username, password }));
            const redirectUri = `${DOMAIN}/auth/github/callback`;
            const githubUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user,user:email&state=${state}`;
            console.log(`[注册] 跳转到 GitHub: ${githubUrl}`);
            return Response.redirect(githubUrl, 302);
        }

        // ========== GitHub 回调 ==========
        if (url.pathname === '/auth/github/callback') {
            const code = url.searchParams.get('code');
            const stateParam = url.searchParams.get('state');
            console.log(`[回调] code=${code ? '有' : '无'}, state=${stateParam ? '有' : '无'}`);
            
            if (!code) {
                return Response.redirect(`${DOMAIN}/login.html?error=no_code`, 302);
            }

            // 解析 state
            let state;
            try {
                state = JSON.parse(atob(stateParam));
                console.log(`[回调] 解析 state:`, state);
            } catch (e) {
                state = 'login';
            }

            const redirectUri = `${DOMAIN}/auth/github/callback`;

            // 交换 token
            console.log(`[回调] 开始交换 token...`);
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
            console.log(`[回调] token交换结果: ${accessToken ? '成功' : '失败'}`);
            
            if (!accessToken) {
                console.error('[回调] Token 交换失败:', tokenData);
                return Response.redirect(`${DOMAIN}/login.html?error=token_failed`, 302);
            }

            // 获取 GitHub 用户信息
            const userRes = await fetch('https://api.github.com/user', {
                headers: { 'Authorization': `Bearer ${accessToken}`, 'User-Agent': 'Hedwig-Worker' }
            });
            const githubUser = await userRes.json();
            const githubId = githubUser.id.toString();
            console.log(`[回调] GitHub 用户: ${githubUser.login} (ID: ${githubId})`);

            // ========== 注册流程 ==========
            if (state.username && state.password) {
                const { username, password } = state;
                console.log(`[注册流程] 保存用户: ${username}`);

                // 1. 检查 GitHub ID 是否已被注册
                const githubCheckPath = `${DATA_PATH}github_${githubId}.json`;
                const existingGithub = await readGitHubFile(githubCheckPath, GITHUB_TOKEN);
                if (existingGithub) {
                    console.log(`[注册流程] GitHub ID ${githubId} 已被注册`);
                    return Response.redirect(`${DOMAIN}/register.html?result=github_already_used`, 302);
                }

                // 2. 检查用户名是否已被占用
                const userPath = `${DATA_PATH}user_${username}.json`;
                const existingUser = await readGitHubFile(userPath, GITHUB_TOKEN);
                if (existingUser) {
                    console.log(`[注册流程] 用户名 ${username} 已被占用`);
                    return Response.redirect(`${DOMAIN}/register.html?result=username_exists`, 302);
                }

                // 3. 创建用户数据
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
                
                console.log(`[注册流程] 准备写入用户文件: ${userPath}`);
                const ok1 = await writeGitHubFile(userPath, userData, `创建用户: ${username}`, GITHUB_TOKEN);
                
                console.log(`[注册流程] 准备写入 GitHub 映射: ${githubCheckPath}`);
                const ok2 = await writeGitHubFile(githubCheckPath, { username, githubId }, `GitHub绑定: ${username}`, GITHUB_TOKEN);
                
                console.log(`[注册流程] 写入结果: user=${ok1}, github=${ok2}`);
                
                if (!ok1 || !ok2) {
                    console.error('[注册流程] 写入失败');
                    return Response.redirect(`${DOMAIN}/register.html?result=error`, 302);
                }
                
                console.log(`[注册流程] ✅ 注册成功`);
                return Response.redirect(`${DOMAIN}/register.html?result=success`, 302);
            }

            // ========== 登录流程 ==========
            if (state === 'login') {
                console.log(`[登录流程] 查找 GitHub ID: ${githubId}`);
                const githubCheckPath = `${DATA_PATH}github_${githubId}.json`;
                const githubMap = await readGitHubFile(githubCheckPath, GITHUB_TOKEN);
                if (!githubMap) {
                    console.log(`[登录流程] GitHub ID ${githubId} 未注册`);
                    return Response.redirect(`${DOMAIN}/login.html?error=not_registered`, 302);
                }
                console.log(`[登录流程] 找到用户: ${githubMap.username}`);
                
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
            console.log(`[API] 本地登录: ${username}`);
            
            const userPath = `${DATA_PATH}user_${username}.json`;
            const userData = await readGitHubFile(userPath, GITHUB_TOKEN);
            
            if (!userData) {
                console.log(`[API] 用户不存在: ${username}`);
                return new Response(JSON.stringify({ error: '用户名或密码错误' }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                });
            }
            
            if (userData.password !== btoa(password)) {
                console.log(`[API] 密码错误: ${username}`);
                return new Response(JSON.stringify({ error: '用户名或密码错误' }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                });
            }
            
            const sessionToken = btoa(`${userData.id}:${Date.now()}`);
            console.log(`[API] ✅ 登录成功: ${username}`);
            
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