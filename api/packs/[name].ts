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
      const gh = await fetch(githubUrl, { redirect: "manual", headers });

      if (gh.status >= 300 && gh.status < 400) {
        const location = gh.headers.get('location');
        if (location) {
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Location', location);
          res.status(302).end();
          return;
        }
      }
      // If GitHub served directly (no redirect), fall through to stream below
      if (!gh.ok || !gh.body) {
        res.status(gh.status ?? 502).send(`GitHub fetch failed: ${gh.statusText}`);
        return;
      }
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      res.status(200);
      const reader = gh.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
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
