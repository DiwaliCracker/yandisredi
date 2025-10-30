export default {
  async fetch(request) {
    try {
      const { searchParams } = new URL(request.url);
      const inputUrl = searchParams.get("url");
      const segment = searchParams.get("segment");

      // 1️⃣ Proxy .ts segments if requested
      if (segment) {
        const segmentRes = await fetch(segment);
        return new Response(segmentRes.body, {
          headers: {
            "Content-Type": "video/mp2t",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      // 2️⃣ Validate input
      if (!inputUrl) {
        return new Response(
          JSON.stringify({ error: "Missing ?url= parameter" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      // 3️⃣ Fetch HTML (like view-source)
      const res = await fetch(inputUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; WorkerFetcher/1.0)",
        },
      });
      const html = await res.text();

      // 4️⃣ Extract HLS master playlist URL
      const regex = /(https:\/\/streaming\.disk\.yandex\.net\/hls\/[^\s"'<>]+?master-playlist\.m3u8)/;
      const match = html.match(regex);

      if (!match) {
        return new Response(
          JSON.stringify({
            error: "No HLS master playlist found",
            hint: "Make sure you provided a Yandex Disk embed or share URL that contains a video.",
          }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      }

      const m3u8Url = match[1];

      // 5️⃣ Fetch and rewrite the playlist for proxying segments
      const playlistRes = await fetch(m3u8Url);
      let playlist = await playlistRes.text();

      const base = m3u8Url.substring(0, m3u8Url.lastIndexOf("/") + 1);
      playlist = playlist.replace(
        /([a-zA-Z0-9_-]+\.ts)/g,
        `${request.url.split("?")[0]}?segment=${base}$1`
      );

      // 6️⃣ Return playable M3U8
      return new Response(playlist, {
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch (e) {
      return new Response(
        JSON.stringify({ error: e.message }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  },
};
