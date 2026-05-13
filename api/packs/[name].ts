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

    // Use redirect:manual so we can pass the CDN URL directly to the browser.
    // objects.githubusercontent.com has Access-Control-Allow-Origin: * so the
    // browser can fetch it without timing out through a Vercel function.
    const gh = await fetch(githubUrl, {
      redirect: "manual",
      headers
    });

    // GitHub returns a 302 → objects.githubusercontent.com (CDN with CORS headers)
    if (gh.status >= 300 && gh.status < 400) {
      const location = gh.headers.get('location');
      if (location) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.redirect(302, location);
        return;
      }
    }

    if (!gh.ok || !gh.body) {
      res.status(gh.status).send(`GitHub fetch failed: ${gh.statusText}`);
      return;
    }

    // Fallback: stream directly if GitHub didn't redirect (shouldn't normally happen)
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (name === 'manifest.json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    } else {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }

    const reader = gh.body.getReader();
    res.status(200);
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } catch (err: any) {
    res.status(500).send(`Proxy error: ${err.message}`);
  }
}
