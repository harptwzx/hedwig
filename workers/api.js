export default {
  async fetch(request, env, ctx) {
    return new Response("Hello from hedwig.eu.org!", {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
    });
  },
};
