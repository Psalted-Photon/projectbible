/**
 * Emscripten glue for piper_phonemize (espeak-ng based phonemizer).
 * Vendored from @diffusionstudio/vits-web 1.0.3 dist (MIT).
 * The .wasm/.data binaries are served from /tts/ via locateFile.
 */
export function createPiperPhonemize(moduleArg?: {
  print?: (msg: string) => void;
  printErr?: (msg: string) => void;
  locateFile?: (file: string) => string;
}): Promise<{
  callMain(args: string[]): void;
}>;
