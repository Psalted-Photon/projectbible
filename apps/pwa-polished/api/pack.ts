import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Readable } from 'node:stream';

const RELEASE_BASE =
  'https://github.com/Psalted-Photon/ProjectBible/releases/download/packs-v1.0.0';

const ALLOWED_FILES = new Set([
  'translations.sqlite',
  'dictionary-en.sqlite',
  'ancient-languages.sqlite',
  'lexical.sqlite',
  'study-tools.sqlite',
  'bsb-audio-pt1.sqlite',
  'bsb-audio-pt2.sqlite'
]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const name = typeof req.query.name === 'string' ? req.query.name : '';

  if (!ALLOWED_FILES.has(name)) {
    res.status(400).send('Invalid pack name');
    return;
  }

  const url = `${RELEASE_BASE}/${name}`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      res.status(response.status).send(`Pack fetch failed: ${response.statusText}`);
      return;
    }

    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    const length = response.headers.get('content-length');
    if (length) res.setHeader('Content-Length', length);

    if (response.body) {
      const stream = Readable.fromWeb(response.body as unknown as ReadableStream);
      stream.pipe(res);
      return;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    res.status(200).send(buffer);
  } catch (error) {
    res.status(500).send(`Pack fetch failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}