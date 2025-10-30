export default {
  async fetch(request) {
    try {
      const { searchParams } = new URL(request.url);
      const inputUrl = searchParams.get("url");

      if (!inputUrl) {
        return new Response(
          JSON.stringify({ error: "Missing ?url= parameter" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      // Fetch the Yandex embed or shared page
      const res = await fetch(inputUrl);
      const html = await res.text();

      // Look for HLS (m3u8) link inside the HTML
      const match = html.match(
        /(https:\/\/streaming\.disk\.yandex\.net\/hls\/[^"' ]+?master-playlist\.m3u8)/
      );

      if (!match) {
        return new Response(
          JSON.stringify({
            error: "HLS master playlist not found",
            hint: "Provide the embed page URL that contains the m3u8 playlist",
          }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      }

      const m3u8Url = match[1];

      // Check if this is a playlist or segment
      if (m3u8Url.endsWith(".m3u8")) {
        const playlistRes = await fetch(m3u8Url);
        let playlist = await playlistRes.text();

        // Rewrite segment URLs to pass through the worker
        const base = m3u8Url.substring(0, m3u8Url.lastIndexOf("/") + 1);
        playlist = playlist.replace(
          /([a-zA-Z0-9_-]+\.ts)/g,
          `${request.url.split("?")[0]}?segment=${base}$1`
        );

        return new Response(playlist, {
          headers: {
            "Content-Type": "application/vnd.apple.mpegurl",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      // Proxy segments (.ts)
      const segment = searchParams.get("segment");
      if (segment) {
        const segmentRes = await fetch(segment);
        return new Response(segmentRes.body, {
          headers: {
            "Content-Type": "video/mp2t",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      // Default: Redirect directly to m3u8
      return Response.redirect(m3u8Url, 302);
    } catch (e) {
      return new Response(
        JSON.stringify({ error: e.message }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  },
};
