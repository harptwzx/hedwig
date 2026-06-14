// functions/auth/callback.js
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code) {
    return Response.redirect('/register.html?error=missing_code');
  }

  // 动态获取域名
  const host = request.headers.get('host') || 'hedwig.eu.org';
  const protocol = request.headers.get('x-forwarded-proto') || 'https';
  const baseUrl = `${protocol}://${host}`;
  const workerUrl = `${baseUrl}/auth/github/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;

  const workerResp = await fetch(workerUrl);
  const result = await workerResp.json();

  if (result.success) {
    // 注册成功，跳转到 dashboard 并携带用户名（可通过 URL 参数或 session）
    return Response.redirect(`/dashboard.html?username=${encodeURIComponent(result.username)}`);
  } else {
    // 注册失败，跳转回注册页并显示错误
    const errorMsg = result.error || 'registration_failed';
    return Response.redirect(`/register.html?error=${encodeURIComponent(errorMsg)}`);
  }
}