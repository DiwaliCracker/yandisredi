addEventListener('fetch', event => {
  event.respondWith(handle(event.request));
});

const HLS_REGEX = /(https?:\/\/streaming\.disk\.yandex\.net\/hls\/[^\s"'<>]*?master-playlist\.m3u8)/i;
const YANDEX_DOWNLOAD_API = 'https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key=';

async function handle(request) {
  const url = new URL(request.url);
  const target = url.searchParams.get('url');
  if (!target) return json(400, { error: 'Missing ?url= parameter' });

  let targetUrl = target.trim();
  if (!/^https?:\/\//i.test(targetUrl)) targetUrl = 'https://' + targetUrl;

  // 1) If the target appears to be a disk.yandex link with /i/ or /d/, try Yandex public API first
  try {
    const normalized = targetUrl.replace('disk.yandex.com', 'disk.yandex.ru');
    const idMatchD = normalized.match(/\/d\/([^\/?#]+)/i);
    const idMatchI = normalized.match(/\/i\/([^\/?#]+)/i);
    let apiHref = null;

    if (idMatchD || idMatchI) {
      const id = idMatchD ? idMatchD[1] : idMatchI[1];
      const publicKey = encodeURIComponent(`https://disk.yandex.ru/i/${id}`);
      const apiUrl = YANDEX_DOWNLOAD_API + publicKey;

      try {
        const apiResp = await fetch(apiUrl, { method: 'GET', redirect: 'follow' });
        const apiJson = await apiResp.json().catch(() => null);
        if (apiJson && apiJson.href) {
          apiHref = apiJson.href;
        }
      } catch (e) {
        // continue, we'll try fetching the original target page as fallback
      }
    }

    // Candidate URLs to scan (prefer API href if found)
    const toScan = [];
    if (apiHref) toScan.push({src: apiHref, source: 'yandex_api_href'});
    toScan.push({src: targetUrl, source: 'provided_target'});

    // 2) For each candidate, fetch and look for HLS in HTML and scripts
    for (const cand of toScan) {
      const found = await fetchAndSearchForHls(cand.src);
      if (found) {
        // Redirect to the exact discovered m3u8
        return Response.redirect(found, 302);
      }
    }

    // 3) Nothing found — return JSON with debug info and helpful hints
    return json(404, {
      error: 'HLS master playlist not found',
      hint: 'Worker scanned Yandex API href (if available) and the provided page for streaming.disk.yandex.net/.../master-playlist.m3u8',
      tested: toScan.map(t => t.src)
    });
  } catch (err) {
    return json(502, { error: 'Server error', details: String(err) });
  }
}

/* ---------------- helpers ---------------- */

function json(status, obj) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
  });
}

async function fetchAndSearchForHls(fetchUrl) {
  // Fetch main resource text
  let respText = '';
  let finalUrl = fetchUrl;
  try {
    const resp = await fetch(fetchUrl, { method: 'GET', redirect: 'follow' });
    finalUrl = resp.url || fetchUrl;
    respText = await resp.text().catch(() => '');
    // Rapid check in body
    const m = respText.match(HLS_REGEX);
    if (m) return decodeHTML(m[1]);
  } catch (e) {
    // continue — maybe CORS or network; still try other ways
  }

  // Extract <script src="..."> entries and search them
  try {
    const scriptSrcRegex = /<script[^>]+src=(?:'|")([^'"]+)(?:'|")[^>]*>/ig;
    const scriptUrls = [];
    for (const s of respText.matchAll(scriptSrcRegex)) {
      try {
        const raw = s[1];
        const abs = new URL(raw, finalUrl).toString();
        scriptUrls.push(abs);
      } catch (e) { /* ignore bad urls */ }
    }

    for (const sUrl of scriptUrls) {
      try {
        const sResp = await fetch(sUrl, { method: 'GET', redirect: 'follow' });
        const sText = await sResp.text().catch(() => '');
        const m = sText.match(HLS_REGEX);
        if (m) return decodeHTML(m[1]);
      } catch (e) {
        // ignore
      }
    }
  } catch (e) { /* ignore */ }

  // Extract inline scripts and search them
  try {
    const inlineScriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/ig;
    for (const s of respText.matchAll(inlineScriptRegex)) {
      const content = s[1] || '';
      const m = content.match(HLS_REGEX);
      if (m) return decodeHTML(m[1]);
    }
  } catch (e) { /* ignore */ }

  return null;
}

function decodeHTML(s) {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');
}
