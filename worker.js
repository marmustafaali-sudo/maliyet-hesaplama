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

    const url = new URL(request.url);

    // ---- Etüt archive API (Cloudflare KV backed) ----
    if (url.pathname === "/api/etut/save" && request.method === "POST") {
      return handleSave(request, env);
    }
    if (url.pathname === "/api/etut/list" && request.method === "GET") {
      return handleList(env);
    }
    if (url.pathname === "/api/etut/get" && request.method === "GET") {
      return handleGet(url, env);
    }
    if (url.pathname === "/api/etut/backup" && request.method === "GET") {
      return handleBackup(url, env);
    }
    if (url.pathname === "/api/etut/delete" && request.method === "POST") {
      return handleDelete(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};

function todayIso(d) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

async function handleSave(request, env) {
  try {
    const body = await request.json();
    const now = new Date();
    const dateStr = todayIso(now);
    const key = `etut:${dateStr}:${now.getTime()}`;
    const metadata = {
      etutAdi: body.etutAdi || "",
      etutKodu: body.etutKodu || "",
      savedAt: now.toISOString(),
    };
    await env.ETUT_KV.put(key, JSON.stringify(body), { metadata });
    return json({ ok: true, key });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}

async function handleList(env) {
  try {
    const result = await env.ETUT_KV.list({ prefix: "etut:" });
    const items = result.keys.map((k) => ({
      key: k.name,
      date: k.name.split(":")[1],
      etutAdi: (k.metadata && k.metadata.etutAdi) || "",
      etutKodu: (k.metadata && k.metadata.etutKodu) || "",
      savedAt: (k.metadata && k.metadata.savedAt) || "",
    }));
    // newest first
    items.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
    return json({ ok: true, items });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}

async function handleGet(url, env) {
  try {
    const key = url.searchParams.get("key");
    if (!key) return json({ ok: false, error: "key gerekli" }, 400);
    const value = await env.ETUT_KV.get(key);
    if (value === null) return json({ ok: false, error: "bulunamadı" }, 404);
    return new Response(value, { headers: { "Content-Type": "application/json; charset=utf-8" } });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}

async function handleDelete(request, env) {
  try {
    const body = await request.json();
    if (!body.key) return json({ ok: false, error: "key gerekli" }, 400);
    await env.ETUT_KV.delete(body.key);
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}

async function handleBackup(url, env) {
  try {
    const date = url.searchParams.get("date");
    if (!date) return json({ ok: false, error: "date gerekli" }, 400);
    const result = await env.ETUT_KV.list({ prefix: `etut:${date}:` });
    const records = [];
    for (const k of result.keys) {
      const value = await env.ETUT_KV.get(k.name);
      if (value) records.push({ key: k.name, data: JSON.parse(value) });
    }
    const body = JSON.stringify({ date, count: records.length, records }, null, 2);
    return new Response(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="yedek-${date}.json"`,
      },
    });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
