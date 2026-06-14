// workers/api.js
// 处理静态资源、GitHub OAuth、用户数据读写

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  }
};

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  // 获取域名（优先环境变量，兜底为你的域名）
  const DOMAIN = env.DOMAIN || 'https://hedwig.eu.org';

  // 静态资源服务（public 目录）
  if (path === '/' || path === '/index.html') {
    return serveStatic('index.html', env);
  }
  if (path === '/login.html') {
    return serveStatic('login.html', env);
  }
  if (path === '/register.html') {
    return serveStatic('register.html', env);
  }
  if (path === '/dashboard.html') {
    return serveStatic('dashboard.html', env);
  }
  if (path === '/common.css') {
    return serveStatic('common.css', env);
  }
  if (path.startsWith('/css/')) {
    return serveStatic(path.slice(1), env);
  }

  // API: 发起 GitHub OAuth 授权（注册/登录）
  if (path === '/api/auth/github') {
    try {
      const { username, password, action } = await request.json();
      if (!username || !password || !action) {
        return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 });
      }
      // state 中暂存用户信息（Base64 编码）
      const stateData = btoa(JSON.stringify({ username, password, action }));
      const redirectUri = `${DOMAIN}/auth/callback`;
      const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${env.GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${stateData}&scope=user`;
      return Response.redirect(githubAuthUrl);
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  }

  // API: GitHub OAuth 回调处理（Worker 内部端点）
  if (path === '/auth/github/callback') {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state) {
      return new Response(JSON.stringify({ error: 'Missing code or state' }), { status: 400 });
    }

    // 解析 state 中的用户名、密码、动作
    let userInfo;
    try {
      userInfo = JSON.parse(atob(state));
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Invalid state' }), { status: 400 });
    }
    const { username, password, action } = userInfo;

    // 用 code 换取 access_token
    const tokenResp = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${DOMAIN}/auth/callback`
      })
    });
    const tokenData = await tokenResp.json();
    const accessToken = tokenData.access_token;
    if (!accessToken) {
      return new Response(JSON.stringify({ error: 'Failed to get access token' }), { status: 500 });
    }

    // 获取 GitHub 用户信息
    const userResp = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'User-Agent': 'Hedwig'
      }
    });
    const githubUser = await userResp.json();
    if (!githubUser.id) {
      return new Response(JSON.stringify({ error: 'Failed to get GitHub user' }), { status: 500 });
    }

    // 根据 action 处理注册或登录
    if (action === 'register') {
      // 检查用户是否已存在
      const userFilePath = `data/users/${username}.json`;
      const existingUser = await readGitHubFile(env, userFilePath);
      if (existingUser && !existingUser.error) {
        return new Response(JSON.stringify({ error: 'Username already exists' }), { status: 409 });
      }
      // 创建用户数据文件
      const userData = {
        username,
        password, // 实际生产应加密，此处仅为演示
        githubId: githubUser.id,
        githubLogin: githubUser.login,
        createdAt: new Date().toISOString()
      };
      const writeResult = await writeGitHubFile(env, userFilePath, JSON.stringify(userData, null, 2));
      if (writeResult.error) {
        return new Response(JSON.stringify({ error: 'Failed to create user' }), { status: 500 });
      }
      // 同时创建 github_id 映射文件
      const githubMapPath = `data/users/github_${githubUser.id}.json`;
      await writeGitHubFile(env, githubMapPath, JSON.stringify({ username }, null, 2));
      return new Response(JSON.stringify({ success: true, username }), { status: 200 });
    } 
    else if (action === 'login') {
      // 登录：验证用户名密码
      const userFilePath = `data/users/${username}.json`;
      const userFile = await readGitHubFile(env, userFilePath);
      if (userFile.error || !userFile) {
        return new Response(JSON.stringify({ error: 'User not found' }), { status: 401 });
      }
      const userData = JSON.parse(userFile);
      if (userData.password !== password) {
        return new Response(JSON.stringify({ error: 'Invalid password' }), { status: 401 });
      }
      // 验证 GitHub ID 是否匹配（可选）
      if (userData.githubId !== githubUser.id) {
        return new Response(JSON.stringify({ error: 'GitHub account mismatch' }), { status: 403 });
      }
      return new Response(JSON.stringify({ success: true, username }), { status: 200 });
    }
    else {
      return new Response(JSON.stringify({ error: 'Invalid action' }), { status: 400 });
    }
  }

  // API: 获取用户数据（dashboard 用）
  if (path === '/api/user/data' && request.method === 'GET') {
    // 从请求头获取用户名（简单实现，生产应使用 session）
    const username = request.headers.get('X-Username');
    if (!username) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }
    const data = await readGitHubFile(env, `data/users/${username}/posts.json`);
    if (data.error) {
      return new Response(JSON.stringify({ posts: [] }), { status: 200 });
    }
    return new Response(data, { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  // 默认 404
  return new Response('Not Found', { status: 404 });
}

// 辅助函数：读取 GitHub 文件
async function readGitHubFile(env, path) {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO_OWNER || 'harptwzx'}/${env.GITHUB_REPO_NAME || 'hedwig'}/contents/${path}`;
  const response = await fetch(url, {
    headers: {
      'Authorization': `token ${env.GITHUB_TOKEN}`,
      'User-Agent': 'Hedwig'
    }
  });
  if (response.status === 404) {
    return { error: 'not_found' };
  }
  if (!response.ok) {
    return { error: `HTTP ${response.status}` };
  }
  const data = await response.json();
  const content = atob(data.content);
  return content;
}

// 辅助函数：写入 GitHub 文件
async function writeGitHubFile(env, path, content) {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO_OWNER || 'harptwzx'}/${env.GITHUB_REPO_NAME || 'hedwig'}/contents/${path}`;
  // 先获取当前文件 SHA（如果存在）
  let sha = null;
  const existing = await fetch(url, {
    headers: { 'Authorization': `token ${env.GITHUB_TOKEN}` }
  });
  if (existing.ok) {
    const existingData = await existing.json();
    sha = existingData.sha;
  }
  const body = {
    message: `Update ${path} via Hedwig`,
    content: btoa(unescape(encodeURIComponent(content))), // 处理中文
    branch: 'main'
  };
  if (sha) body.sha = sha;
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `token ${env.GITHUB_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    return { error: `Write failed: ${response.status}` };
  }
  return { success: true };
}

// 静态资源服务
async function serveStatic(filePath, env) {
  // 实际应从 KV 或 assets 读取，这里简单返回 404，你需要根据实际情况实现
  // 建议将静态文件部署到 Pages 的 public 目录，Worker 只处理 API
  return new Response('Static file serving not implemented in Worker. Use Pages.', { status: 404 });
}