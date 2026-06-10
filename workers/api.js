export default {
    async fetch(request, env, ctx) {
        return new Response('Manual deploy test - ' + new Date().toISOString(), {
            headers: { 'Content-Type': 'text/plain' }
        });
    }
};