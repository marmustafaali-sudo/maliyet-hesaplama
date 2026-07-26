export default {
  async fetch(request, env) {
    const VALID_USERS = {
      aliuser: { pass: "Ali1999", role: "admin" },
      kardokmak: { pass: "kardokmak78", role: "kisitli" },
    };

    function checkAuth(req) {
      const auth = req.headers.get("Authorization");
      if (!auth || !auth.startsWith("Basic ")) return null;
      let decoded;
      try {
        decoded = atob(auth.slice(6));
      } catch (e) {
        return null;
      }
      const idx = decoded.indexOf(":");
      if (idx === -1) return null;
      const user = decoded.slice(0, idx);
      const pass = decoded.slice(idx + 1);
      const entry = VALID_USERS[user];
      if (entry && entry.pass === pass) return { user, role: entry.role };
      return null;
    }

    const authInfo = checkAuth(request);
    if (!authInfo) {
      return new Response("Bu siteye erişmek için giriş yapmanız gerekiyor.", {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Basic realm="Giris Gerekli", charset="UTF-8"',
        },
      });
    }

    const url = new URL(request.url);

    // Delete-capable routes require the "admin" role (aliuser). The
    // restricted user (kardokmak) can view/save everything but not delete.
    const DELETE_ROUTES = ["/api/etut/delete", "/api/fiyat/delete"];
    if (DELETE_ROUTES.includes(url.pathname) && authInfo.role !== "admin") {
      return json({ ok: false, error: "Bu işlem için yetkin yok. Silme işlemleri sadece tam yetkili hesapla yapılabilir." }, 403);
    }

    // ---- Second, page-specific login for Fiyat Geçmişi (ürün havuzu + fiyat
    // geçmişi verileri). Separate credential, checked via a token, independent
    // of the site-wide Basic-Auth above. ----
    const FIYAT_USER = "userali";
    const FIYAT_PASS = "Ali1999";

    if (url.pathname === "/api/fiyat-login" && request.method === "POST") {
      return handleFiyatLogin(request, env, FIYAT_USER, FIYAT_PASS);
    }

    const FIYAT_PROTECTED_ROUTES = ["/api/fiyat/get", "/api/fiyat/delete"];
    if (FIYAT_PROTECTED_ROUTES.includes(url.pathname)) {
      const tokenOk = await checkFiyatToken(request, env);
      if (!tokenOk) {
        return json({ ok: false, error: "Bu bölüme erişmek için ayrıca giriş yapmalısın." }, 401);
      }
    }

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
    if (url.pathname === "/api/kur" && request.method === "GET") {
      return handleKur();
    }
    if (url.pathname === "/api/fiyat/save" && request.method === "POST") {
      return handleFiyatSave(request, env);
    }
    if (url.pathname === "/api/fiyat/list" && request.method === "GET") {
      return handleFiyatList(env);
    }
    if (url.pathname === "/api/fiyat/get" && request.method === "GET") {
      return handleFiyatGet(url, env);
    }
    if (url.pathname === "/api/fiyat/delete" && request.method === "POST") {
      return handleFiyatDelete(request, env);
    }
    if (url.pathname === "/api/katalog" && request.method === "GET") {
      return handleKatalogGet(env);
    }
    if (url.pathname === "/api/katalog/save" && request.method === "POST") {
      return handleKatalogSave(request, env);
    }
    if (url.pathname === "/api/bot" && request.method === "POST") {
      return handleBot(request, env);
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

async function handleFiyatSave(request, env) {
  try {
    const body = await request.json(); // { catalog: [...], opCatalog: [...] }
    const now = new Date();
    const dateStr = todayIso(now);
    const key = `fiyat:${dateStr}:${now.getTime()}`;
    const metadata = {
      savedAt: now.toISOString(),
      urunSayisi: (body.catalog || []).length,
      operasyonSayisi: (body.opCatalog || []).length,
    };
    await env.ETUT_KV.put(key, JSON.stringify(body), { metadata });
    return json({ ok: true, key });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}

async function handleFiyatList(env) {
  try {
    const result = await env.ETUT_KV.list({ prefix: "fiyat:" });
    const items = result.keys.map((k) => ({
      key: k.name,
      date: k.name.split(":")[1],
      savedAt: (k.metadata && k.metadata.savedAt) || "",
      urunSayisi: (k.metadata && k.metadata.urunSayisi) || 0,
      operasyonSayisi: (k.metadata && k.metadata.operasyonSayisi) || 0,
    }));
    items.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
    return json({ ok: true, items });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}

async function handleFiyatGet(url, env) {
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

async function handleFiyatDelete(request, env) {
  try {
    const body = await request.json();
    if (!body.key) return json({ ok: false, error: "key gerekli" }, 400);
    await env.ETUT_KV.delete(body.key);
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}

var KATALOG_KEY = "katalog:tumu";

async function handleKatalogGet(env) {
  try {
    const value = await env.ETUT_KV.get(KATALOG_KEY);
    if (value === null) return json({ ok: true, catalog: [], opCatalog: [], empty: true });
    const parsed = JSON.parse(value);
    return json({ ok: true, catalog: parsed.catalog || [], opCatalog: parsed.opCatalog || [], updatedAt: parsed.updatedAt || "" });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}

async function handleKatalogSave(request, env) {
  try {
    const body = await request.json(); // { catalog: [...], opCatalog: [...] }
    const payload = {
      catalog: body.catalog || [],
      opCatalog: body.opCatalog || [],
      updatedAt: new Date().toISOString(),
    };
    await env.ETUT_KV.put(KATALOG_KEY, JSON.stringify(payload));
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}

async function handleBot(request, env) {
  try {
    const body = await request.json();
    const question = (body.question || "").slice(0, 1000);
    if (!question.trim()) return json({ ok: false, error: "Soru boş olamaz" }, 400);

    // ---- Current product/operation pool ----
    let catalog = [], opCatalog = [];
    try {
      const kRaw = await env.ETUT_KV.get(KATALOG_KEY);
      if (kRaw) {
        const k = JSON.parse(kRaw);
        catalog = k.catalog || [];
        opCatalog = k.opCatalog || [];
      }
    } catch (e) {}

    // ---- Full etüt records (not just names) so the bot can actually
    // compare/comment on costs, weights, materials used, etc. ----
    function toEurLocal(price, currency, usd, eur) {
      const p = Number(price) || 0;
      if (currency === "EUR") return p;
      if (currency === "USD") return usd && eur ? (p * usd) / eur : 0;
      return eur ? p / eur : 0;
    }
    function convertQtyLocal(qty, fromUnit, toUnit) {
      const WEIGHT_KG = { kg: 1, ton: 1000 };
      const q = Number(qty) || 0;
      if (fromUnit === toUnit) return q;
      if (WEIGHT_KG[fromUnit] && WEIGHT_KG[toUnit]) return (q * WEIGHT_KG[fromUnit]) / WEIGHT_KG[toUnit];
      return q;
    }
    function summarizeEtut(snap) {
      const usd = snap.usdTry || 0, eur = snap.eurTry || 0;
      const items = snap.items || [];
      const laborItems = snap.laborItems || [];
      const materialTotal = items.reduce((s, it) => {
        const catalogUnit = it.catalogUnit || it.unit;
        const qty = convertQtyLocal(it.qty, it.unit, catalogUnit);
        return s + toEurLocal(it.price, it.currency, usd, eur) * qty;
      }, 0);
      const laborTotal = laborItems.reduce((s, it) => {
        return s + toEurLocal(it.hourlyRate, it.currency, usd, eur) * (Number(it.hours) || 0);
      }, 0);
      const grandTotal = materialTotal + laborTotal;
      const weight = parseFloat(snap.partWeight) || 0;
      const mainMaterials = items.slice(0, 8).map((it) => it.name).filter(Boolean).join(", ");
      return { materialTotal, laborTotal, grandTotal, weight, mainMaterials, notlar: snap.notlar || "" };
    }

    let etutLines = [];
    try {
      const etutList = await env.ETUT_KV.list({ prefix: "etut:" });
      const keys = etutList.keys.slice(0, 25); // cap to keep prompt + subrequests reasonable
      const records = await Promise.all(
        keys.map(async (k) => {
          try {
            const raw = await env.ETUT_KV.get(k.name);
            if (!raw) return null;
            const snap = JSON.parse(raw);
            const s = summarizeEtut(snap);
            const tarih = k.name.split(":")[1];
            const perKg = s.weight > 0 ? s.grandTotal / s.weight : null;
            return `- ${tarih} | ${snap.etutAdi || "(isimsiz)"}${snap.etutKodu ? " (" + snap.etutKodu + ")" : ""} | ` +
              `Malzeme: €${s.materialTotal.toFixed(2)} | İşçilik: €${s.laborTotal.toFixed(2)} | ` +
              `Genel toplam: €${s.grandTotal.toFixed(2)}` +
              (s.weight ? ` | Ağırlık: ${s.weight}kg | €/kg: ${perKg.toFixed(2)}` : "") +
              (s.mainMaterials ? ` | Malzemeler: ${s.mainMaterials}` : "") +
              (s.notlar ? ` | Not: ${s.notlar}` : "");
          } catch (e) {
            return null;
          }
        })
      );
      etutLines = records.filter(Boolean);
    } catch (e) {}

    // ---- Full price-history snapshots (not just dates) so the bot can
    // compare product prices across time and comment on trends. ----
    let fiyatBlocks = [];
    try {
      const fiyatList = await env.ETUT_KV.list({ prefix: "fiyat:" });
      const sortedKeys = fiyatList.keys
        .slice()
        .sort((a, b) => (a.name < b.name ? 1 : -1)) // newest first (date embedded in key)
        .slice(0, 8); // cap number of snapshots to keep prompt manageable
      const blocks = await Promise.all(
        sortedKeys.map(async (k) => {
          try {
            const raw = await env.ETUT_KV.get(k.name);
            if (!raw) return null;
            const snap = JSON.parse(raw);
            const dateStr = k.name.split(":")[1];
            const lines = (snap.catalog || [])
              .slice(0, 60)
              .map((p) => `  ${p.name}: ${p.price} ${p.currency}/${p.unit}`)
              .join("\n");
            return `${dateStr}:\n${lines || "  (boş)"}`;
          } catch (e) {
            return null;
          }
        })
      );
      fiyatBlocks = blocks.filter(Boolean);
    } catch (e) {}

    const contextText = [
      "ÜRÜN HAVUZU (şu anki güncel fiyatlar — ad, birim fiyat, para birimi, ölçü birimi):",
      catalog.slice(0, 150).map((p) => `- ${p.name}: ${p.price} ${p.currency}/${p.unit}`).join("\n") || "(boş)",
      "",
      "OPERASYON HAVUZU (ad, saatlik ücret, para birimi):",
      opCatalog.slice(0, 100).map((o) => `- ${o.name}: ${o.hourlyRate} ${o.currency}/saat`).join("\n") || "(boş)",
      "",
      "KAYITLI ETÜTLER (en yeni 25 tanesi, her biri maliyet detaylarıyla):",
      etutLines.join("\n") || "(boş)",
      "",
      "FİYAT GEÇMİŞİ ANLIK GÖRÜNTÜLERİ (en yeni 8 tanesi, tarih ve o tarihteki ürün fiyatları — bunları karşılaştırarak fiyat artış/azalış trendini yorumlayabilirsin):",
      fiyatBlocks.join("\n\n") || "(boş)",
    ].join("\n");

    const systemPrompt =
      "Sen bir döküm/imalat maliyet hesaplama sitesinin verilerine erişimi olan bir asistansın. " +
      "Sadece aşağıda verilen site verilerine dayanarak Türkçe cevap ver. Etütleri karşılaştırabilir, " +
      "fiyat geçmişindeki verilere bakarak hangi ürünün fiyatının arttığını/azaldığını yorumlayabilir, " +
      "en pahalı/en ucuz etüdü söyleyebilirsin. Veride gerçekten olmayan bir şey sorulursa bilmediğini söyle, uydurma. " +
      "Kısa ve net cevap ver.\n\n" +
      contextText;

    if (!env.AI || typeof env.AI.run !== "function") {
      return json({ ok: false, error: "Workers AI bağlı değil (env.AI tanımsız). Cloudflare panelinde bu Worker'ın Settings > Bindings kısmından Workers AI'ın eklendiğini kontrol et." }, 500);
    }

    let aiResp;
    try {
      aiResp = await env.AI.run("@cf/zai-org/glm-4.7-flash", {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: question },
        ],
      });
    } catch (aiErr) {
      return json({ ok: false, error: "Workers AI çağrısı başarısız: " + String(aiErr && aiErr.message ? aiErr.message : aiErr) }, 502);
    }

    const answer =
      (aiResp && aiResp.response) ||
      (aiResp && aiResp.choices && aiResp.choices[0] && aiResp.choices[0].message && aiResp.choices[0].message.content) ||
      "Cevap üretilemedi.";

    return json({ ok: true, answer: answer });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}

async function handleFiyatLogin(request, env, validUser, validPass) {
  try {
    const body = await request.json();
    const user = String(body.username || "");
    const pass = String(body.password || "");
    if (user !== validUser || pass !== validPass) {
      return json({ ok: false, error: "Kullanıcı adı veya şifre hatalı." }, 401);
    }
    const token = crypto.randomUUID();
    // Token valid for 12 hours.
    await env.ETUT_KV.put("fiyattoken:" + token, "1", { expirationTtl: 12 * 60 * 60 });
    return json({ ok: true, token: token });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}

async function checkFiyatToken(request, env) {
  try {
    const token = request.headers.get("X-Fiyat-Token");
    if (!token) return false;
    const value = await env.ETUT_KV.get("fiyattoken:" + token);
    return value !== null;
  } catch (e) {
    return false;
  }
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function handleKur() {
  try {
    const resp = await fetch("https://www.tcmb.gov.tr/kurlar/today.xml", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept": "application/xml,text/xml,*/*",
      },
    });
    if (!resp.ok) throw new Error("TCMB'den veri alınamadı (HTTP " + resp.status + ")");
    const xml = await resp.text();
    if (!xml || xml.indexOf("Currency") === -1) {
      throw new Error("TCMB'den beklenmeyen bir yanıt geldi (ilk 120 karakter: " + xml.slice(0,120) + ")");
    }

    const tarihMatch = xml.match(/Tarih="([^"]+)"/);
    const tarih = tarihMatch ? tarihMatch[1] : "";

    function rateFor(code) {
      const re = new RegExp('CurrencyCode="' + code + '"[\\s\\S]*?<ForexSelling>\\s*([\\d.,]*)\\s*</ForexSelling>');
      const m = xml.match(re);
      if (!m || !m[1]) return null;
      return parseFloat(m[1].replace(",", "."));
    }

    const usd = rateFor("USD");
    const eur = rateFor("EUR");
    if (usd == null || eur == null || isNaN(usd) || isNaN(eur)) {
      throw new Error("Kur değerleri XML içinde bulunamadı");
    }

    return json({ ok: true, usd, eur, parite: eur / usd, tarih });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 502);
  }
}
