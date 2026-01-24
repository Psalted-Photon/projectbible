import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const { name } = req.query;

    if (!name || Array.isArray(name)) {
      res.status(400).send("Invalid pack name");
      return;
    }

    const githubUrl =
      `https://github.com/Psalted-Photon/ProjectBible/releases/download/packs-v1.0.0/${name}`;

    const gh = await fetch(githubUrl, {
      redirect: "follow",
      headers: {
        "User-Agent": "ProjectBible-PackProxy",
        "Accept": "application/octet-stream"
      }
    });

    if (!gh.ok || !gh.body) {
      res.status(gh.status).send(`GitHub fetch failed: ${gh.statusText}`);
      return;
    }

    // CORS + streaming headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

    // Stream GitHub → Vercel → Browser
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
