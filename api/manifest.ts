import type { VercelRequest, VercelResponse } from '@vercel/node';

const MANIFEST_URL =
  'https://github.com/Psalted-Photon/ProjectBible/releases/download/packs-v1.0.0/manifest.json';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const response = await fetch(MANIFEST_URL);

    if (!response.ok) {
      res.status(response.status).send(`Manifest fetch failed: ${response.statusText}`);
      return;
    }

    const text = await response.text();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    res.status(200).send(text);
  } catch (error) {
    res.status(500).send(`Manifest fetch failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}