export default {
    async fetch(request, env, ctx) {
        return new Response('Hello! Worker is working!', {
            headers: { 'Content-Type': 'text/plain' }
        });
    }
};