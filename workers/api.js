export default {
    async fetch(request, env, ctx) {
        return new Response('Hello! The website will be finished a few days later...Zhouxiang', {
            headers: { 'Content-Type': 'text/plain' }
        });
    }
};
