export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        };
        
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }
        
        if (url.pathname === '/auth/login') {
            const redirect = url.searchParams.get('redirect') || '/';
            const clientId = env.GITHUB_CLIENT_ID;
            const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&scope=read:user`;
            return Response.redirect(githubAuthUrl, 302);
        }
        
        if (url.pathname === '/auth/callback') {
            const code = url.searchParams.get('code');
            const clientId = env.GITHUB_CLIENT_ID;
            const clientSecret = env.GITHUB_CLIENT_SECRET;
            
            const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code })
            });
            const tokenData = await tokenRes.json();
            const accessToken = tokenData.access_token;
            
            return new Response(`
                <!DOCTYPE html>
                <html>
                <head><meta charset="UTF-8"></head>
                <body>
                    <script>
                        localStorage.setItem('github_token', '${accessToken}');
                        window.location.href = '/';
                    </script>
                </body>
                </html>
            `, { headers: { 'Content-Type': 'text/html' } });
        }
        
        return new Response('Not Found', { status: 404, headers: corsHeaders });
    }
};
