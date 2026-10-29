/**
 * How a transcript's words land in the writing, a piece at a time.
 *
 * Each piece comes as blocks: paragraphs, headings and numbered items. They
 * go in just in front of the recording's pill, so the text that was after
 * the cursor stays after the new words; a page without one gets them at the
 * end (lib/lexical/transcriptWrite.ts says how, for both).
 *
 * Two ways in: through the editor when the page or journal day is open
 * (LexicalEditor's writeTranscript), so the words appear as they come and
 * the editor's own save keeps them; otherwise straight into its saved text,
 * here, through the same steps run without a screen.
 */

import type { TranscriptTail } from '../recorder/recordings';

export type { TranscriptTail };

export interface TranscriptBlock {
  kind: 'p' | 'h' | 'li';
  text: string;
  /** Carries on the last block written. */
  joins?: boolean;
  /**
   * An item's number, as said ("the second point"). A list that starts
   * after a paragraph starts at it, so the numbers carry on.
   */
  n?: number;
}

const write = () => import('../lexical/transcriptWrite');

/** Saved text with the blocks written in front of the recording's pill (or at the end), and what the last of them now reads. */
export async function writeBlocksIntoHtml(
  html: string,
  recId: string | null,
  blocks: TranscriptBlock[],
  tail: TranscriptTail | null,
): Promise<{ html: string; tail: TranscriptTail | null }> {
  const W = await write();
  const out = W.editHtml(html, () => W.$writeTranscript(recId, blocks, tail));
  return { html: out.html, tail: out.result.tail };
}

/** Saved text with a recording's pill added at the end, as a Record from a closed page or day. Null when it's already there. */
export async function placeRecordingInHtml(html: string, recId: string): Promise<string | null> {
  const W = await write();
  if (W.htmlHasRecording(html, recId)) return null;
  return W.editHtml(html, () => W.$placeRecording(recId, null)).html;
}

/** Saved text with a recording's pill taken out. Null when it isn't there. */
export async function removeRecordingFromHtml(html: string, recId: string): Promise<string | null> {
  const W = await write();
  if (!W.htmlHasRecording(html, recId)) return null;
  return W.editHtml(html, () => W.$removeRecording(recId)).html;
}
