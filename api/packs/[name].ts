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

    if (process.env.GITHUB_TOKEN) {
      headers["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    const gh = await fetch(githubUrl, { redirect: "follow", headers });

    if (!gh.ok || !gh.body) {
      res.status(gh.status || 502).send(`GitHub fetch failed: ${gh.status} ${gh.statusText}`);
      return;
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", name === "manifest.json" ? "application/json" : "application/octet-stream");
    res.setHeader("Cache-Control", "no-cache, must-revalidate");

    // Pass GitHub's Content-Length through. Without it the client falls back to
    // the size recorded in the manifest, so the progress bar tracks a guess and
    // a stale asset surfaces as a byte-count error rather than the SHA-256
    // mismatch that actually describes the problem.
    const contentLength = gh.headers.get("content-length");
    if (contentLength) {
      res.setHeader("Content-Length", contentLength);
    }

    res.status(200);

    const reader = gh.body.getReader();
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
