export function onRequest(context) {
    const clientId = context.env.GITHUB_CLIENT_ID;
    const redirectUri = 'https://hedwig-e85.pages.dev/auth/callback';
    const githubUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user`;
    return Response.redirect(githubUrl, 302);
}