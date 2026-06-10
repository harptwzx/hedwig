export default {
    async fetch(request, env, ctx) {
        return new Response('Hello from Worker! Current time: ' + new Date().toISOString(), {
            headers: { 'Content-Type': 'text/plain' }
        });
    }
};