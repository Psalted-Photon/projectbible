import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash } from "crypto";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Stops the GitHub download when the app hangs up (closed tab, canceled
  // install), rather than letting it run on, billed, until the 5-minute limit.
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abort.abort();
  });

  try {
    const { name, v } = req.query;

    // A pack name is a plain file name in the release: letters, digits, dots,
    // dashes and underscores. Anything else (a slash, "..", an encoded slash)
    // could walk the URL out of the release and onto other GitHub paths, with
    // the token attached.
    if (!name || Array.isArray(name) || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || name.includes("..")) {
      res.status(400).send("Invalid pack name");
      return;
    }

    // The app asks for a pack as ?v=<its sha256 from the manifest>. That URL
    // can only ever mean those exact bytes, so Vercel's CDN may keep it and
    // answer later downloads itself instead of running this function again.
    // A re-uploaded pack gets a new hash in the manifest, so a new URL.
    const version = typeof v === "string" && /^[a-f0-9]{64}$/i.test(v) ? v.toLowerCase() : null;

    const githubUrl =
      `https://github.com/Psalted-Photon/projectbible/releases/download/packs-v1.0.0/${encodeURIComponent(name)}`;

    const headers: Record<string, string> = {
      "User-Agent": "ProjectBible-PackProxy",
      "Accept": "application/octet-stream"
    };

    if (process.env.GITHUB_TOKEN) {
      headers["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    const gh = await fetch(githubUrl, { redirect: "follow", headers, signal: abort.signal });

    if (!gh.ok || !gh.body) {
      res.status(gh.status || 502).send(`GitHub fetch failed: ${gh.status} ${gh.statusText}`);
      return;
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", name === "manifest.json" ? "application/json" : "application/octet-stream");
    // Browsers never keep a copy (the app stores packs itself); only the CDN
    // does, and only for a hash-pinned request.
    res.setHeader(
      "Cache-Control",
      version ? "public, max-age=0, s-maxage=31536000, immutable" : "no-cache, must-revalidate"
    );

    // Pass GitHub's Content-Length through. Without it the client falls back to
    // the size recorded in the manifest, so the progress bar tracks a guess and
    // a stale asset surfaces as a byte-count error rather than the SHA-256
    // mismatch that actually describes the problem.
    const contentLength = gh.headers.get("content-length");
    if (contentLength) {
      res.setHeader("Content-Length", contentLength);
    }

    res.status(200);

    const hash = version ? createHash("sha256") : null;
    const reader = gh.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      hash?.update(value);
      // Wait for the app to take what was sent before reading more, so a slow
      // phone doesn't make this function hold the whole pack in memory.
      if (!res.write(value)) {
        await new Promise<void>((resolve) => {
          const go = () => {
            res.off("drain", go);
            res.off("close", go);
            resolve();
          };
          res.on("drain", go);
          res.on("close", go);
        });
      }
      if (abort.signal.aborted) {
        await reader.cancel().catch(() => {});
        return;
      }
    }

    // GitHub sent something other than what this URL promises (the manifest
    // was uploaded before its pack). Cut the response off unfinished, so the
    // CDN never stores it and the app sees a failed download, not bad bytes.
    if (hash && hash.digest("hex") !== version) {
      res.destroy();
      return;
    }
    res.end();
  } catch (err: any) {
    // Once the first bytes are out, a status can no longer be sent: close the
    // connection instead, which the app reads as a failed download.
    if (abort.signal.aborted) return;
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.status(500).send(`Proxy error: ${err?.message ?? err}`);
  }
}
