// functions/auth/callback.js
// 轻量级转发器：接收 GitHub 回调，转发给 Worker 的 /auth/github/callback 端点

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code) {
    // 缺少 code，跳转到登录页并提示错误
    return Response.redirect('/login.html?error=missing_code');
  }

  // 动态获取当前域名（无需硬编码）
  const host = request.headers.get('host') || 'hedwig.eu.org';
  const protocol = request.headers.get('x-forwarded-proto') || 'https';
  const baseUrl = `${protocol}://${host}`;
  const workerCallbackUrl = `${baseUrl}/auth/github/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;

  // 转发请求到 Worker 处理
  const workerResponse = await fetch(workerCallbackUrl, {
    method: 'GET',
    headers: {
      'Authorization': request.headers.get('Authorization') || '',
      'User-Agent': 'Hedwig-Pages-Function'
    }
  });

  // 读取 Worker 返回的 JSON 结果
  const result = await workerResponse.json();

  // 根据结果重定向回前端注册/登录页面，附带参数
  if (result.success) {
    // 注册或登录成功，跳转到仪表板或注册成功页
    // 这里简单跳转到 dashboard，并将用户名存入 session（可改进）
    const redirectUrl = `/dashboard.html?username=${encodeURIComponent(result.username)}`;
    return Response.redirect(redirectUrl);
  } else {
    // 失败，跳回注册页并显示错误
    const errorMsg = result.error || 'unknown_error';
    return Response.redirect(`/register.html?error=${encodeURIComponent(errorMsg)}`);
  }
}