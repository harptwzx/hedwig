export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
            client_id: env.GITHUB_CLIENT_ID,
            client_secret: env.GITHUB_CLIENT_SECRET,
            code: code,
            redirect_uri: 'https://hedwig-e85.pages.dev/auth/callback'
        })
    });
    
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    
    const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body>
    <script>
        localStorage.setItem('github_token', '${accessToken}');
        window.location.href = '/login.html?success=true';
    </script>
</body>
</html>`;
    
    return new Response(html, {
        headers: { 'Content-Type': 'text/html' }
    });
}