import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const { name } = req.query;

    if (!name || Array.isArray(name)) {
      res.status(400).send("Invalid pack name");
      return;
    }

    const githubUrl =
      `https://github.com/Psalted-Photon/projectbible/releases/download/packs-v1.0.0/${name}`;

    const headers: Record<string, string> = {
      "User-Agent": "ProjectBible-PackProxy",
      "Accept": "application/octet-stream"
    };

    // Add GitHub token for private repository access
    if (process.env.GITHUB_TOKEN) {
      headers["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    // For large binary packs: use redirect:manual, then pass the CDN URL to the
    // browser via a 302. objects.githubusercontent.com has CORS headers so the
    // browser can download directly without timing out through Vercel.
    // For manifest.json: stream it normally (small file, needs correct Content-Type).
    const isLargePack = typeof name === 'string' && name.endsWith('.sqlite');

    if (isLargePack) {
      // Follow ALL redirects server-side to discover the final CDN URL.
      // GitHub releases: github.com → objects.githubusercontent.com (pre-signed URL).
      // redirect:"manual" returns an opaque response with status=0 in Node.js undici,
      // causing res.status(0) which sends invalid HTTP and the browser throws
      // "TypeError: Failed to fetch" before receiving any response headers.
      const gh = await fetch(githubUrl, { redirect: "follow", headers });

      if (!gh.ok) {
        res.status(gh.status || 502).send(`GitHub fetch failed: ${gh.status} ${gh.statusText} url=${gh.url}`);
        return;
      }

      // gh.url is the final URL after all redirects (objects.githubusercontent.com/...)
      // Cancel the body immediately — we don't stream 1.76 GB through Vercel.
      try { await gh.body?.cancel(); } catch (_) {}

      // Redirect the browser to the final CDN URL so it downloads directly.
      // objects.githubusercontent.com serves Access-Control-Allow-Origin: * for public repos.
      const finalUrl = gh.url;
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Location', finalUrl);
      res.status(302).end();
      return;
    }

    // manifest.json and other small files: follow redirects and stream
    const gh = await fetch(githubUrl, { redirect: "follow", headers });

    if (!gh.ok || !gh.body) {
      res.status(gh.status).send(`GitHub fetch failed: ${gh.statusText}`);
      return;
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", name === "manifest.json" ? "application/json" : "application/octet-stream");
    res.setHeader("Cache-Control", "no-cache, must-revalidate");
    res.status(200);

    const reader2 = gh.body.getReader();
    while (true) {
      const { done, value } = await reader2.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } catch (err: any) {
    res.status(500).send(`Proxy error: ${err.message}`);
  }
}
