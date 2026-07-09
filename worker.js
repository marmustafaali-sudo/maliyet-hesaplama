export default {
  async fetch(request, env) {
    const VALID_USER = "kardokmak";
    const VALID_PASS = "kardokmak78";
    const expected = "Basic " + btoa(`${VALID_USER}:${VALID_PASS}`);

    const auth = request.headers.get("Authorization");
    if (auth !== expected) {
      return new Response("Bu siteye erişmek için giriş yapmanız gerekiyor.", {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Basic realm="Giris Gerekli", charset="UTF-8"',
        },
      });
    }

    return env.ASSETS.fetch(request);
  },
};
