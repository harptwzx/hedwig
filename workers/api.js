// workers/api.js
export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  }
};

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const DOMAIN = env.DOMAIN || 'https://hedwig.eu.org';

  // 1. 发起 GitHub OAuth（注册/登录）
  if (path === '/api/auth/github') {
    try {
      const { username, password, action } = await request.json();
      if (!username || !password || !action) {
        return jsonResponse({ error: 'Missing fields' }, 400);
      }
      const stateData = btoa(JSON.stringify({ username, password, action }));
      const redirectUri = `${DOMAIN}/auth/callback`;
      const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${env.GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${stateData}&scope=user`;
      return Response.redirect(githubAuthUrl);
    } catch (err) {
      return jsonResponse({ error: err.message }, 500);
    }
  }

  // 2. GitHub OAuth 回调（Worker 内部处理）
  if (path === '/auth/github/callback') {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state) {
      return jsonResponse({ error: 'Missing code or state' }, 400);
    }

    let userInfo;
    try {
      userInfo = JSON.parse(atob(state));
    } catch (e) {
      return jsonResponse({ error: 'Invalid state' }, 400);
    }
    const { username, password, action } = userInfo;

    // 交换 access_token
    const tokenResp = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
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
      return jsonResponse({ error: 'Failed to get access token' }, 500);
    }

    // 获取 GitHub 用户信息
    const userResp = await fetch('https://api.github.com/user', {
      headers: { 'Authorization': `Bearer ${accessToken}`, 'User-Agent': 'Hedwig' }
    });
    const githubUser = await userResp.json();
    if (!githubUser.id) {
      return jsonResponse({ error: 'Failed to get GitHub user' }, 500);
    }

    // 根据 action 处理
    if (action === 'register') {
      // 检查用户名是否已存在
      const userFilePath = `data/users/${username}.json`;
      const existing = await readGitHubFile(env, userFilePath);
      if (existing && !existing.error) {
        return jsonResponse({ error: 'Username already exists' }, 409);
      }

      // 创建用户数据文件（存储到 data/users/）
      const userData = {
        username,
        password,  // 生产环境请加密
        githubId: githubUser.id,
        githubLogin: githubUser.login,
        createdAt: new Date().toISOString()
      };
      const writeResult = await writeGitHubFile(env, userFilePath, JSON.stringify(userData, null, 2));
      if (writeResult.error) {
        return jsonResponse({ error: 'Failed to create user file' }, 500);
      }

      // 同时创建 GitHub ID 映射文件（便于快速查找）
      const githubMapPath = `data/users/github_${githubUser.id}.json`;
      await writeGitHubFile(env, githubMapPath, JSON.stringify({ username }, null, 2));

      return jsonResponse({ success: true, username });
    } 
    else if (action === 'login') {
      const userFilePath = `data/users/${username}.json`;
      const userFile = await readGitHubFile(env, userFilePath);
      if (userFile.error || !userFile) {
        return jsonResponse({ error: 'User not found' }, 401);
      }
      const userData = JSON.parse(userFile);
      if (userData.password !== password) {
        return jsonResponse({ error: 'Invalid password' }, 401);
      }
      if (userData.githubId !== githubUser.id) {
        return jsonResponse({ error: 'GitHub account mismatch' }, 403);
      }
      return jsonResponse({ success: true, username });
    } 
    else {
      return jsonResponse({ error: 'Invalid action' }, 400);
    }
  }

  // 3. 获取用户数据（示例：获取 posts）
  if (path === '/api/user/data' && request.method === 'GET') {
    const username = request.headers.get('X-Username');
    if (!username) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }
    const postsPath = `data/users/${username}/posts.json`;
    const data = await readGitHubFile(env, postsPath);
    if (data.error && data.error === 'not_found') {
      return jsonResponse({ posts: [] }, 200);
    }
    if (data.error) {
      return jsonResponse({ error: 'Failed to read posts' }, 500);
    }
    return new Response(data, { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  return new Response('Not Found', { status: 404 });
}

// ========== 辅助函数 ==========
function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function readGitHubFile(env, path) {
  const owner = env.GITHUB_REPO_OWNER || 'harptwzx';
  const repo = env.GITHUB_REPO_NAME || 'hedwig';
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
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

async function writeGitHubFile(env, path, content) {
  const owner = env.GITHUB_REPO_OWNER || 'harptwzx';
  const repo = env.GITHUB_REPO_NAME || 'hedwig';
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  // 获取现有文件 SHA（如果存在）
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
    content: btoa(unescape(encodeURIComponent(content))),
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
    const errText = await response.text();
    return { error: `Write failed: ${response.status} - ${errText}` };
  }
  return { success: true };
}