/**
 * Cactus's own browser build of its engine (needle.js + needle.wasm), bound to
 * the C API in needle.h. One engine runs both models: Whistle (speech → text)
 * and Needle 3 (text → tool calls). Moved here from the Voice Control lab
 * (public/voice-control-lab/engine.js).
 */

const enc = new TextEncoder();

/** The Emscripten module needle.js builds. */
type NeedleModule = any;

/** Needle's reply to one turn. */
export interface NeedleAnswer {
  function_calls?: Array<{ name: string; arguments: unknown }>;
  suppressed_calls?: Array<{ name: string; arguments: unknown; reason?: string }>;
  confidence?: number;
  success?: boolean;
  error?: string;
}

export interface Transcript {
  text: string;
}

export class NeedleEngine {
  private m: NeedleModule;
  private outCap: number;
  private out: number;

  /**
   * @param createNeedle the factory needle.js defines
   * @param wasmBinary   needle.wasm's bytes, handed over so the glue never fetches
   */
  static async create(createNeedle: (opts: object) => Promise<NeedleModule>, wasmBinary: Uint8Array): Promise<NeedleEngine> {
    const m = await createNeedle({ wasmBinary, print: () => {}, printErr: () => {} });
    return new NeedleEngine(m);
  }

  private constructor(m: NeedleModule) {
    this.m = m;
    // One reply buffer for every call. A 30 s transcript is a few KB; a
    // megabyte leaves no question of a reply being cut short.
    this.outCap = 1 << 20;
    this.out = m._malloc(this.outCap);
  }

  private str(s: string | null): number {
    if (s == null) return 0;
    const b = enc.encode(s);
    const p = this.m._malloc(b.length + 1);
    this.m.HEAPU8.set(b, p);
    this.m.HEAPU8[p + b.length] = 0;
    return p;
  }

  private pcm(f32: Float32Array): number {
    const p = this.m._malloc(f32.length * 4);
    new Float32Array(this.m.HEAPU8.buffer, p, f32.length).set(f32);
    return p;
  }

  private fail(where: string): Error {
    const p = this.m._needle_last_error();
    const why = p ? this.m.UTF8ToString(p) : '';
    return new Error(`${where} failed${why ? ': ' + why : ''}`);
  }

  private reply<T>(): T {
    return JSON.parse(this.m.UTF8ToString(this.out, this.outCap));
  }

  /**
   * Loads one .cact (Whistle or Needle; the engine reads which). The engine
   * reads the file in place, so its copy in the heap is never freed.
   */
  load(bytes: Uint8Array): void {
    const p = this.m._malloc(bytes.length);
    this.m.HEAPU8.set(bytes, p);
    let r: number;
    try {
      // n is an unsigned long long: a BigInt when the build passes 64-bit
      // values straight through, two 32-bit halves when it does not.
      r = this.m._needle_load(p, BigInt(bytes.length));
    } catch (e) {
      if (!(e instanceof TypeError)) throw e;
      r = this.m._needle_load(p, bytes.length, 0);
    }
    if (r < 0) {
      this.m._free(p);
      throw this.fail('Loading the model');
    }
  }

  /** Sets the tools. */
  init(system: string, toolsJson: string): void {
    const ps = this.str(system);
    const pt = this.str(toolsJson);
    try {
      if (this.m._needle_init(ps, pt, 0) < 0) throw this.fail('Setting up the tools');
    } finally {
      if (ps) this.m._free(ps);
      if (pt) this.m._free(pt);
    }
  }

  /** Clears the conversation, so each command is answered on its own. */
  reset(): void {
    this.m._needle_reset();
  }

  /** One turn of text against the tools from init. */
  complete(text: string, maxNewTokens = 256): NeedleAnswer {
    const pi = this.str(text);
    try {
      if (this.m._needle_complete(pi, 0, 0, maxNewTokens, this.out, this.outCap) < 0) throw this.fail('Choosing the actions');
      return this.reply<NeedleAnswer>();
    } finally {
      this.m._free(pi);
    }
  }

  /** 16 kHz mono float PCM → its words. keywords: names to favor, one per line. */
  transcribe(pcm: Float32Array, keywords: string | null = null): Transcript {
    const pp = this.pcm(pcm);
    const pl = this.str('en');
    const pk = this.str(keywords && keywords.trim() ? keywords : null);
    try {
      if (this.m._needle_transcribe(pp, pcm.length, pl, pk, 0, this.out, this.outCap) < 0) throw this.fail('Transcribing');
      return this.reply<Transcript>();
    } finally {
      this.m._free(pp);
      if (pl) this.m._free(pl);
      if (pk) this.m._free(pk);
    }
  }
}
