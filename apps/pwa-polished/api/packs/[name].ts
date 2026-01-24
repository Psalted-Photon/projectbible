import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const { name } = req.query;

    if (!name || Array.isArray(name)) {
      res.status(400).send("Invalid pack name");
      return;
    }

    // IMPORTANT: direct GitHub Releases URL
    const githubUrl =
      `https://github.com/Psalted-Photon/ProjectBible/releases/download/packs-v1.0.0/${name}`;

    // Fetch from GitHub server-side (bypasses CORS)
    const gh = await fetch(githubUrl, {
      redirect: "follow",
      headers: {
        "User-Agent": "ProjectBible-PackProxy",
        "Accept": "application/octet-stream"
      }
    });

    if (!gh.ok) {
      res.status(gh.status).send(`GitHub fetch failed: ${gh.statusText}`);
      return;
    }

    // Set headers so browser accepts the file
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

    // Stream the response directly to the client
    const reader = gh.body!.getReader();
    const encoder = new TextEncoder();

    res.status(200);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }

    res.end();
  } catch (err: any) {
    res.status(500).send(`Proxy error: ${err.message}`);
  }
}
