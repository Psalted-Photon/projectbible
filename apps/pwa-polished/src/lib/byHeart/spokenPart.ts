/**
 * Call and Response's voice: part of a verse in the Read Aloud voice. It has its
 * own audio element rather than the shared one, which holds Read Aloud's place
 * while it waits paused for the game to end.
 */

import { synthesizeSpeech } from '../../adapters/tts';

export class SpokenPart {
  private audio = new Audio();
  private url: string | null = null;
  private done: (() => void) | null = null;

  get ready(): boolean {
    return this.url !== null;
  }

  async load(text: string, voiceId: string): Promise<void> {
    const blob = await synthesizeSpeech(text, voiceId);
    this.release();
    this.url = URL.createObjectURL(blob);
    this.audio.src = this.url;
  }

  /** Plays it to the end. Rejects if the browser wants a tap first. */
  play(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.done = resolve;
      this.audio.onended = () => resolve();
      this.audio.onerror = () => reject(new Error('The voice could not play'));
      this.audio.currentTime = 0;
      this.audio.play().catch(reject);
    });
  }

  stop(): void {
    this.audio.pause();
    this.done?.();
    this.done = null;
  }

  private release(): void {
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
  }

  dispose(): void {
    this.stop();
    this.audio.removeAttribute('src');
    this.release();
  }
}
