<script lang="ts">
  /**
   * A By Heart game: full screen over everything, mounted only while open. Only
   * the red X, the VC button and the game's own controls show. Read Aloud's pills
   * are hidden and its audio paused for as long as it is up.
   *
   * The words are said out loud with the VC button's mic open, and only the word
   * the user is on is checked (lib/byHeart/recitation.ts). A word it won't take
   * can be tapped: Show me is a brief peek and counts as a hint, and I said it
   * counts as right and teaches the verse that mishearing.
   *
   * One screen plays every way of going through a verse, as rounds
   * (lib/byHeart/rounds.ts): Focus clears the words as they are said, Build goes
   * phrase by phrase hiding more each round, Recital shows nothing until the end
   * and reads the whole of it back, Flashcards gives the reference or the opening
   * words, Call and Response starts with the app's voice reading part of it, and
   * Weak Spots drills the phrases around missed words. Silent study is the same
   * card with no voice: recall it in your head, reveal it, and say how it went.
   *
   * A session runs through steps, one verse each. Today's run is every verse due,
   * and one under 60 comes around again at the end.
   *
   * Closes by X or Escape only. Never `themed`: the theme's invert would turn the
   * card's colors into their opposites.
   *
   * The place is saved after every word (lib/byHeart/game.ts), so Back to Android
   * or a fold's relaunch loses nothing.
   */
  import { onDestroy, onMount } from 'svelte';
  import { MicrophoneSlash, SlidersHorizontal } from 'phosphor-svelte';
  import type { DBByHeartVerse } from '../../adapters/db';
  import { getSettings, updateSettings } from '../../adapters/settings';
  import { syncedByHeartStore } from '../../adapters/SyncedByHeartStore';
  import { getVoiceInfo } from '../../adapters/tts';
  import { cardImageOf, qrUrlOf } from '../../lib/byHeart/cardThumb';
  import {
    BLUR_LINE,
    BLUR_RANGE,
    byHeartGame,
    clearRun,
    closeGame,
    gamePrefs,
    readRun,
    saveRun,
    setGamePrefs,
    type FlashSide,
    type GameCover,
    type GameMode,
    type GameSession,
    type SpokenRefMode,
  } from '../../lib/byHeart/game';
  import { createGameMic } from '../../lib/byHeart/gameMic';
  import { VoiceKeeper, keepsVoice, ownVoiceOn, setOwnVoice } from '../../lib/byHeart/ownVoice';
  import { Recitation } from '../../lib/byHeart/recitation';
  import { phrasesOf, pickSide, roundsFor, type Round } from '../../lib/byHeart/rounds';
  import {
    HOLD_SCORE,
    afterBuild,
    afterRound,
    formatFor,
    progressOf,
    stageOf,
    withHeardAs,
    withoutMissed,
  } from '../../lib/byHeart/schedule';
  import { scoreColor, scoreOf } from '../../lib/byHeart/scoring';
  import { SpokenPart } from '../../lib/byHeart/spokenPart';
  import { findSpokenRef, type RefTarget } from '../../lib/byHeart/spokenRef';
  import { cardContentOf, drawableStyle, nextDateLabel, referenceOf, savedCardOf, type SavedCard } from '../../lib/byHeart/verse';
  import { alignHeard, heardAs, plainWord, upcomingWords, type Aligned } from '../../lib/byHeart/wordMatch';
  import { portal } from '../../lib/portal';
  import { cardWords, type CardImage, type CardStyle } from '../../lib/shareCard';
  import { isOriginalLanguage } from '../../lib/translationKind';
  import { pauseReading, readingState } from '../../lib/tts/readingEngine';
  import { fetchVoice, useVoice, voiceForTap } from '../../lib/tts/voiceForTap';
  import { gameTalk, setGameMic, voiceCard, voiceReady, watchVoiceReady } from '../../lib/voice/holdToTalk';
  import { askConfirm } from '../../stores/confirmStore';
  import { showNotice } from '../../stores/noticeStore';
  import CloseX from '../CloseX.svelte';
  import ByHeartCard from './ByHeartCard.svelte';

  export let session: GameSession;

  /** How many upcoming words the recognizer is told to favor. */
  const FAVOR = 3;
  /** How long a wrong word has to stand before it is shown, as a guess changing can flash one. */
  const STUCK_BEAT_MS = 1200;
  /** How long Show me leaves a word clear. */
  const PEEK_MS = 1500;
  /** How long a finished round stays up before the next one, with the mic still open. */
  const ROUND_BEAT_MS = 600;
  /** Silent study's answers. */
  const SILENT_CHOICES = [
    { label: 'Missed', score: 0 },
    { label: 'Barely', score: 25 },
    { label: 'Almost', score: 50 },
    { label: 'Pretty Much', score: 75 },
    { label: 'Got It', score: 100 },
  ];

  let steps = session.steps;
  let at = session.at;
  /** How this step is being played, which silent study can change. */
  let mode: GameMode = session.steps[session.at].mode;

  let verse: DBByHeartVerse | null = null;
  let card: SavedCard | null = null;
  let style: CardStyle | null = null;
  let image: CardImage | null = null;
  let words: string[] = [];

  let phase: 'loading' | 'playing' | 'between' | 'finishing' | 'silent' | 'silentPick' | 'results' = 'loading';
  let rounds: Round[] = [];
  let roundAt = 0;
  let round: Round | null = null;
  let rec: Recitation | null = null;
  let side: FlashSide = 'verse';
  /** Whether the reference is being said this game, fixed from the moment it starts. */
  let gameReference: SpokenRefMode = 'off';

  // What the screen shows of the recitation, copied out of it after every reply.
  let cursor = 0;
  let refStart = false;
  let refEnd = false;
  $: onReference = refStart || (refEnd && round !== null && round.from + cursor >= round.to);
  $: revealed = revealedWords(phase, round, cursor, words.length);
  $: shown = new Set(round?.shown ?? []);
  $: coverReference = coversReference(phase, round, refStart, refEnd);

  function revealedWords(p: typeof phase, r: Round | null, done: number, count: number): number {
    if (p === 'silent') return 0;
    if (!r || p === 'results' || p === 'silentPick') return count;
    return r.hidden ? 0 : r.from + done;
  }

  function coversReference(p: typeof phase, r: Round | null, start: boolean, end: boolean): boolean {
    if (!r || p === 'results' || p === 'silent' || p === 'silentPick') return false;
    return r.hidden ? r.refStart || r.refEnd : start || end;
  }

  /** What took a hint, as positions in the verse, the two references after the words. */
  let hints = new Set<number>();
  /** Which of those were asked for with Show me. */
  let shownMe = new Set<number>();
  let score: number | null = null;
  /** The verse as it was before this round's score, as a recital's score can change. */
  let before: DBByHeartVerse | null = null;
  /** A recital read back, and the words it didn't hear. */
  let aligned: Aligned | null = null;
  let missedWords: number[] = [];
  let refsMissed = 0;

  const prefs = gamePrefs();
  let blur = prefs.blur;
  let cover: GameCover = prefs.cover;
  let reference: SpokenRefMode = prefs.reference;
  let controlsOpen = false;
  let canSpeak = true;

  $: readable = cover === 'wordblur' && blur < BLUR_LINE;
  $: if ($gameTalk && !!$gameTalk.hidden !== (mode === 'silent')) gameTalk.update((s) => s && { ...s, hidden: mode === 'silent' });
  $: noMic = $voiceReady.mic === false || $voiceReady.permission === 'denied';

  // Audio stays paused for as long as the game is up, a timer or alarm starting
  // it in the meantime included.
  $: if ($readingState === 'playing') pauseReading();

  // ── Hearing ────────────────────────────────────────────────────────────────

  const mic = createGameMic({
    keywords: () => {
      if (!rec) return null;
      if (round?.hidden) return upcomingWords(words, Math.min(rec.heard().length, words.length), FAVOR);
      return rec.onReference ? (verse?.book ?? null) : upcomingWords(rec.words, rec.cursor, FAVOR);
    },
    progress: () => (round?.hidden ? rec?.heard().length : rec?.mark) ?? 0,
    onTake: () => rec?.newTake(),
    canOpen: () => calling !== 'getting' && calling !== 'speaking',
    onPcm: (pcm) => keeper?.add(pcm),
    onUpdate: (u) => {
      if (!rec) return;
      if (phase === 'finishing') rec.update(u);
      if (phase !== 'playing') return;
      rec.update(u);
      sync();
    },
  });

  const refStartAt = () => words.length;
  const refEndAt = () => words.length + 1;

  /** Bring the screen up to where the recitation is. */
  function sync() {
    const r = rec;
    if (!r || !round) return;
    if (round.hidden) {
      watchRecitalEnd(r);
      return;
    }
    const moved = r.cursor !== cursor || r.refStart !== refStart || r.refEnd !== refEnd;
    if (moved) {
      // A word said while it could be read is a hint, whichever word it is.
      if (readable) {
        for (let i = cursor; i < r.cursor; i++) {
          if (plainWord(words[round.from + i])) hints.add(round.from + i);
        }
        if (refStart && !r.refStart) hints.add(refStartAt());
        if (refEnd && !r.refEnd) hints.add(refEndAt());
      }
      cursor = r.cursor;
      refStart = r.refStart;
      refEnd = r.refEnd;
      clearStuck();
      helpOpen = false;
      savePlace();
    }
    watchStuck(r);
    if (r.done) finishRound();
  }

  /** Nothing to go on from a recital, which shows nothing, and a short verse or Weak Spots need no place. */
  function savePlace() {
    if (!verse || mode === 'recital' || mode === 'weak') return;
    saveRun({
      verseId: verse.id,
      mode,
      round: roundAt,
      cursor,
      reference: gameReference,
      side,
      refStart,
      refEnd,
      hints: [...hints],
      shownMe: [...shownMe],
    });
  }

  // ── A word it won't take ───────────────────────────────────────────────────

  /** What it heard instead, once that has stood for a beat and someone really said it. */
  let stuck = '';
  let stuckWord = '';
  let stuckTimer: ReturnType<typeof setTimeout> | null = null;
  let helpOpen = false;
  let peek: number | 'reference' | null = null;
  let peekTimer: ReturnType<typeof setTimeout> | null = null;

  function clearStuck() {
    if (stuckTimer) clearTimeout(stuckTimer);
    stuckTimer = null;
    stuck = '';
    stuckWord = '';
  }

  function watchStuck(r: Recitation) {
    const spoken = r.wrongNow.filter((w) => mic.wasSpoken(w));
    if (!spoken.length) return;
    const text = r.onReference
      ? spoken.slice(-4).map((w) => w.word.trim()).join(' ')
      : spoken[spoken.length - 1].word.trim();
    if (text === stuckWord) return;
    stuckWord = text;
    if (stuckTimer) clearTimeout(stuckTimer);
    stuckTimer = setTimeout(() => {
      stuckTimer = null;
      stuck = text;
    }, STUCK_BEAT_MS);
  }

  function tapWord(i: number) {
    if (phase !== 'playing' || !round || round.hidden || onReference) return;
    if (i === round.from + cursor) helpOpen = !helpOpen;
  }

  function tapReference() {
    if (phase === 'playing' && !round?.hidden && onReference) helpOpen = !helpOpen;
  }

  function showMe() {
    if (!round) return;
    const item = refStart ? refStartAt() : onReference ? refEndAt() : round.from + cursor;
    hints.add(item);
    hints = hints;
    shownMe.add(item);
    helpOpen = false;
    savePlace();
    peek = onReference ? 'reference' : item;
    if (peekTimer) clearTimeout(peekTimer);
    peekTimer = setTimeout(() => {
      peekTimer = null;
      peek = null;
    }, PEEK_MS);
  }

  function iSaidIt() {
    const r = rec;
    if (!r || !round) return;
    helpOpen = false;
    if (!r.onReference && stuck) remember(r.words[r.cursor], stuck);
    r.tap();
    sync();
  }

  /** The verse accepts this from now on, here and on any device. */
  function remember(word: string, heard: string) {
    const v = verse;
    const on = plainWord(word);
    const as = plainWord(heard);
    if (!v || !on || !as) return;
    rec?.alsoAccept(word, heard);
    const progress = withHeardAs(v, on, as);
    verse = { ...v, progress };
    if (before) before = { ...before, progress: withHeardAs(before, on, as) };
    void syncedByHeartStore.update(v.id, { progress });
  }

  // ── The round ──────────────────────────────────────────────────────────────

  function refTargetOf(v: DBByHeartVerse): RefTarget {
    return { book: v.book, chapter: v.chapter, startVerse: v.startVerse, several: v.endVerse > v.startVerse };
  }

  const alsoAsOf = (v: DBByHeartVerse) =>
    Object.fromEntries(Object.entries(progressOf(v).heardAs ?? {}).map(([word, heard]) => [word, [...heard]]));

  function startRound(r: Round, place: { cursor: number; refStart: boolean; refEnd: boolean } | null) {
    round = r;
    const v = verse!;
    rec = new Recitation(
      words.slice(r.from, r.to),
      {
        cursor: place?.cursor ?? 0,
        ref: refTargetOf(v),
        // A recital is read back at the end, so nothing is waited on along the way.
        refStart: r.hidden ? false : place ? place.refStart : r.refStart,
        refEnd: r.hidden ? false : place ? place.refEnd : r.refEnd,
        alsoAs: alsoAsOf(v),
      },
      place ? undefined : rec ?? undefined,
    );
    cursor = rec.cursor;
    refStart = rec.refStart;
    refEnd = rec.refEnd;
    clearStuck();
    helpOpen = false;
    phase = 'playing';
    // Nothing left to say: a saved place at the very end, or a card with no words.
    if (rec.done && !r.hidden) finishRound();
  }

  let betweenTimer: ReturnType<typeof setTimeout> | null = null;

  function finishRound() {
    if (phase !== 'playing') return;
    if (roundAt + 1 < rounds.length) {
      phase = 'between';
      betweenTimer = setTimeout(() => {
        betweenTimer = null;
        roundAt += 1;
        startRound(rounds[roundAt], null);
        savePlace();
      }, ROUND_BEAT_MS);
      return;
    }
    clearRun();
    if (mode === 'weak') {
      void finishWeak();
      return;
    }
    phase = 'results';
    mic.close();
    void finishStep();
  }

  /** What there was to say in this game, for the score. */
  function itemsToSay(): number {
    if (!round) return 0;
    const said = words.slice(round.from, round.to).filter((w) => plainWord(w)).length;
    return said + (round.refStart ? 1 : 0) + (round.refEnd ? 1 : 0);
  }

  async function finishStep() {
    const v = verse;
    if (!v) return;
    if (mode === 'build') {
      // Build doesn't count as recalling the verse, so it leaves the score alone.
      const patch = afterBuild(v);
      verse = { ...v, ...patch };
      await syncedByHeartStore.update(v.id, patch);
      return;
    }
    const missed = [...shownMe].filter((i) => i < words.length);
    await recordScore(scoreOf(itemsToSay(), hints.size), false, missed);
    await keepRecital();
  }

  /** A phrase done with no help is one less to drill. On to the next, with the mic left open. */
  async function finishWeak() {
    const v = verse;
    if (!v) return;
    const word = steps[at].word;
    if (!shownMe.size && word !== undefined) {
      const progress = withoutMissed(v, word);
      verse = { ...v, progress };
      await syncedByHeartStore.update(v.id, { progress });
    }
    if (at + 1 < steps.length) {
      phase = 'between';
      betweenTimer = setTimeout(() => {
        betweenTimer = null;
        next();
      }, ROUND_BEAT_MS);
    } else {
      phase = 'results';
      mic.close();
    }
  }

  /** The round's score goes on the verse and sets when it comes back. */
  async function recordScore(value: number, silent: boolean, missed: number[]) {
    const v = verse;
    if (!v) return;
    before ??= v;
    const patch = afterRound(before, value, { silent, missed });
    verse = { ...v, ...patch };
    score = value;
    await syncedByHeartStore.update(v.id, patch);
    // Under 60 comes around again in the same session, once.
    if (session.today && value < HOLD_SCORE && !steps[at].retry && !steps.some((s) => s.retry && s.verseId === v.id)) {
      steps = [...steps, { verseId: v.id, mode: mode === 'silent' ? 'silent' : 'focus', retry: true }];
    }
  }

  // ── Recital ────────────────────────────────────────────────────────────────

  /** It ends itself once the verse's last words have been heard, unless the reference comes after them. */
  function watchRecitalEnd(r: Recitation) {
    if (round?.refEnd) return;
    const said = words.filter((w) => plainWord(w));
    const heard = r.heard();
    if (r.allHeard().length < said.length * 0.6) return;
    const tail = heard.slice(-5);
    let last = tail.length - 1;
    while (last >= 0 && !heardAs(tail[last], said[said.length - 1])) last--;
    if (last < 0) return;
    if (said.length < 2 || tail.slice(0, last).some((w) => heardAs(w, said[said.length - 2]))) void finishRecital();
  }

  async function finishRecital() {
    if (phase !== 'playing') return;
    phase = 'finishing';
    mic.close();
    await mic.closed();
    const r = rec;
    const v = verse;
    if (!r || !v || !round) return;
    const heard = r.allHeard();
    aligned = alignHeard(words, heard, alsoAsOf(v));
    missedWords = aligned.said.flatMap((said, i) => (said ? [] : [i]));
    refsMissed = 0;
    if (round.refStart && !findSpokenRef(heard, 0, refTargetOf(v))) refsMissed++;
    if (round.refEnd && !refSaidAtEnd(heard, refTargetOf(v))) refsMissed++;
    clearRun();
    phase = 'results';
    await scoreRecital();
  }

  function refSaidAtEnd(heard: string[], target: RefTarget): boolean {
    for (let i = Math.max(0, heard.length - 12); i < heard.length; i += 4) {
      if (findSpokenRef(heard, i, target)) return true;
    }
    return false;
  }

  async function scoreRecital() {
    const items = itemsToSay();
    await recordScore(scoreOf(items, missedWords.length + refsMissed), false, missedWords);
    await keepRecital();
  }

  /** A word it missed that was said: counts as right, and that mishearing is remembered. */
  function iDidSay(i: number) {
    const heard = aligned?.heardFor[i];
    if (heard) remember(words[i], heard);
    missedWords = missedWords.filter((w) => w !== i);
    void scoreRecital();
  }

  // ── Call and Response ──────────────────────────────────────────────────────

  /** Where its voice has got to. The mic stays closed while it is getting ready and speaking. */
  let calling: 'no' | 'voice' | 'downloading' | 'getting' | 'speaking' | 'tap' = 'no';
  let callVoiceId = '';
  let downloadPct = 0;
  let spoken: SpokenPart | null = null;
  let micWasOn = false;

  /** A random phrase. A verse that is all one phrase gives its first half. */
  function callText(): string {
    const phrases = phrasesOf(words);
    const pick = phrases[Math.floor(Math.random() * phrases.length)] ?? { from: 0, to: words.length };
    const whole = pick.from === 0 && pick.to === words.length && words.length > 4;
    return words.slice(pick.from, whole ? Math.ceil(words.length / 2) : pick.to).join(' ');
  }

  async function beginCall() {
    const check = await voiceForTap();
    callVoiceId = check.voiceId;
    if (check.status !== 'ready') {
      calling = 'voice';
      return;
    }
    useVoice(callVoiceId);
    await speakCall();
  }

  async function downloadCallVoice() {
    calling = 'downloading';
    downloadPct = 0;
    try {
      await fetchVoice(callVoiceId, (pct) => (downloadPct = pct));
      useVoice(callVoiceId);
      await speakCall();
    } catch (error) {
      console.warn('[By Heart] the voice could not download', error);
      showNotice('The voice could not download. You can recite without it.', 'error');
      calling = 'no';
    }
  }

  async function speakCall() {
    micWasOn = mic.isOpen();
    if (micWasOn) mic.close();
    calling = 'getting';
    const part = (spoken ??= new SpokenPart());
    try {
      if (!part.ready) await part.load(callText(), callVoiceId);
      if (spoken !== part) return;
      calling = 'speaking';
      await part.play();
      if (spoken !== part) return;
      calling = 'no';
      if (micWasOn) mic.open();
    } catch (error) {
      if (spoken !== part) return;
      if (part.ready) {
        // The browser wants a tap before it will play.
        calling = 'tap';
      } else {
        console.warn('[By Heart] the voice could not speak', error);
        showNotice('The voice could not read it. You can recite without it.', 'error');
        calling = 'no';
      }
    }
  }

  function dropCall() {
    spoken?.dispose();
    spoken = null;
    calling = 'no';
  }

  // ── Your Own Voice ─────────────────────────────────────────────────────────

  let ownVoice = ownVoiceOn();
  /** This round's audio, only while Your Own Voice is on and it is a whole recital from the top. */
  let keeper: VoiceKeeper | null = null;

  async function keepRecital() {
    const v = verse;
    const audio = keeper?.empty === false ? keeper.toWav() : null;
    if (!v || !audio || score === null) return;
    await syncedByHeartStore.keepRecital({ id: v.id, audio, score, createdAt: Date.now() });
  }

  async function toggleOwnVoice() {
    if (ownVoice) {
      const ok = await askConfirm('Turn off Your Own Voice? The recitals saved on this device are deleted.', {
        confirmLabel: 'Turn off',
        danger: true,
      });
      if (!ok) return;
      setOwnVoice(false);
      ownVoice = false;
      keeper = null;
      await syncedByHeartStore.clearRecitals();
      return;
    }
    const ok = await askConfirm(
      'Your Own Voice keeps your best recital of each verse, so you can listen back to it from the verse’s menu. It stays on this device: it is never uploaded or synced, and it is deleted when you sign out. Turn it on?',
      { confirmLabel: 'Turn on' },
    );
    if (!ok) return;
    setOwnVoice(true);
    ownVoice = true;
    showNotice('Your Own Voice is on. It starts with your next recital.');
  }

  // ── Silent study ───────────────────────────────────────────────────────────

  function revealSilent() {
    phase = 'silentPick';
  }

  function pickSilent(value: number) {
    clearRun();
    phase = 'results';
    void recordScore(value, true, []);
  }

  function setSilent(on: boolean) {
    const v = verse;
    if (!v) return;
    updateSettings({ byHeartSilent: on });
    mode = on ? 'silent' : steps[at].mode !== 'silent' ? steps[at].mode : formatFor(v);
    controlsOpen = false;
    mic.close();
    startOver();
  }

  // ── Moving along ───────────────────────────────────────────────────────────

  function clearRound() {
    if (betweenTimer) clearTimeout(betweenTimer);
    betweenTimer = null;
    hints = new Set();
    shownMe = new Set();
    score = null;
    before = null;
    aligned = null;
    missedWords = [];
    refsMissed = 0;
    rec = null;
    round = null;
    keeper = null;
    dropCall();
  }

  function startOver() {
    controlsOpen = false;
    clearRun();
    clearRound();
    loadRounds(false);
  }

  function loadRounds(pickUp: boolean) {
    if (mode === 'silent') {
      phase = 'silent';
      return;
    }
    const saved = pickUp && verse ? readRun(verse.id, mode) : null;
    gameReference = saved?.reference ?? reference;
    side = saved?.side ?? pickSide(words);
    rounds = roundsFor({ mode, words, reference: gameReference, side, word: steps[at].word });
    roundAt = saved ? Math.min(saved.round, rounds.length - 1) : 0;
    if (saved) {
      hints = new Set(saved.hints);
      shownMe = new Set(saved.shownMe);
    }
    keeper = ownVoice && keepsVoice(mode) && !saved ? new VoiceKeeper() : null;
    const r = rounds[roundAt];
    startRound(
      r,
      saved && { cursor: Math.min(saved.cursor, r.to - r.from), refStart: saved.refStart, refEnd: saved.refEnd },
    );
    if (mode === 'call' && !saved) void beginCall();
  }

  async function loadStep() {
    phase = 'loading';
    const got = await syncedByHeartStore.get(steps[at].verseId);
    if (!got) {
      // Removed since it was opened, on another device or before a relaunch.
      clearRun();
      if (at + 1 < steps.length) next();
      else close();
      return;
    }
    const saved = savedCardOf(got);
    const picture = await cardImageOf(got);
    words = cardWords(got.passage);
    card = saved;
    image = picture;
    style = drawableStyle(saved, !!picture);
    verse = got;
    // The app only hears English, so the original languages are studied silently,
    // and silent study chosen on this device goes for everything it plays.
    canSpeak = !isOriginalLanguage(got.translation);
    mode = steps[at].mode === 'weak' ? 'weak' : !canSpeak || getSettings().byHeartSilent === true ? 'silent' : steps[at].mode;
    loadRounds(true);
  }

  $: hasNext = at + 1 < steps.length;

  function next() {
    if (at + 1 >= steps.length) {
      close();
      if (session.today) showNotice('That is everything due today.');
      return;
    }
    at += 1;
    clearRound();
    void loadStep();
  }

  // ── Controls ───────────────────────────────────────────────────────────────

  function setCover(next: GameCover) {
    cover = next;
    setGamePrefs({ cover });
  }

  function keepBlur() {
    setGamePrefs({ blur });
  }

  function setReference(next: SpokenRefMode) {
    if (next === reference) return;
    reference = next;
    setGamePrefs({ reference });
    // It changes what there is to say, so it starts from the top.
    if (phase === 'playing') startOver();
  }

  const REFERENCE_CHOICES: { value: SpokenRefMode; label: string }[] = [
    { value: 'off', label: 'Off' },
    { value: 'start', label: 'Start' },
    { value: 'end', label: 'End' },
    { value: 'both', label: 'Both' },
  ];

  // Build and Weak Spots go by their own rounds, and Flashcards has its own use for the reference.
  $: saysReference = mode === 'focus' || mode === 'recital' || mode === 'call';

  // ── Leaving ────────────────────────────────────────────────────────────────

  function close() {
    closeGame();
  }

  function onKey(e: KeyboardEvent) {
    // The card a press opened closes first.
    if (e.key !== 'Escape' || e.defaultPrevented || $voiceCard) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    close();
  }

  function onVisibility() {
    if (document.visibilityState === 'hidden') mic.close();
  }

  onMount(() => {
    setGameMic(mic);
    watchVoiceReady();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', mic.close);
    void loadStep();
  });

  onDestroy(() => {
    mic.dispose();
    setGameMic(null);
    clearStuck();
    if (peekTimer) clearTimeout(peekTimer);
    if (betweenTimer) clearTimeout(betweenTimer);
    dropCall();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', mic.close);
  });

  // The session on screen is what a relaunch brings back.
  $: byHeartGame.update((s) => (s && (s.at !== at || s.steps !== steps) ? { ...s, at, steps } : s));
</script>

<svelte:window on:keydown|capture={onKey} />

<div class="bh-game no-edge-gesture" use:portal>
  {#if verse && card && style}
    {#key verse.id}
      <ByHeartCard
        content={cardContentOf(verse)}
        {style}
        emphasis={card.emphasis}
        {image}
        qrUrl={qrUrlOf(verse)}
        {cover}
        {blur}
        {revealed}
        {shown}
        {peek}
        {coverReference}
        onTapWord={tapWord}
        onTapReference={tapReference}
      />
    {/key}
  {/if}

  <div class="top">
    <button
      class="tool"
      aria-label="Game settings"
      aria-expanded={controlsOpen}
      on:click={() => (controlsOpen = !controlsOpen)}
    >
      <SlidersHorizontal size="1.2em" weight="bold" />
    </button>
    <CloseX label={verse ? `Close ${referenceOf(verse)}` : 'Close'} on:click={close} />
  </div>

  {#if controlsOpen}
    <div class="controls">
      <label class="slider">
        <span>Blur</span>
        <input
          type="range"
          min={BLUR_RANGE.min}
          max={BLUR_RANGE.max}
          step="0.01"
          bind:value={blur}
          disabled={cover !== 'wordblur'}
          on:change={keepBlur}
        />
      </label>
      {#if readable && mode !== 'silent'}
        <p class="note">Words can be read at this blur, so saying them counts as a hint.</p>
      {/if}
      <div class="chips">
        <button class="chip" class:on={cover === 'wordblur'} on:click={() => setCover('wordblur')}>Word blur</button>
        <button class="chip" class:on={cover === 'box'} on:click={() => setCover('box')}>Black box</button>
      </div>
      {#if saysReference}
        <div class="chips">
          <span class="chips-label">Say the reference</span>
          {#each REFERENCE_CHOICES as choice (choice.value)}
            <button class="chip" class:on={reference === choice.value} on:click={() => setReference(choice.value)}>{choice.label}</button>
          {/each}
        </div>
      {/if}
      <div class="chips">
        {#if phase === 'playing' && (cursor > 0 || hints.size > 0 || roundAt > 0)}
          <button class="chip" on:click={startOver}>Start over</button>
        {/if}
        {#if mode === 'call' && phase === 'playing' && calling === 'no' && spoken}
          <button class="chip" on:click={() => { controlsOpen = false; void speakCall(); }}>Hear it again</button>
        {/if}
        {#if canSpeak && mode !== 'weak' && phase !== 'results'}
          <button class="chip" on:click={() => setSilent(mode !== 'silent')}>{mode === 'silent' ? 'Out loud' : 'Silent study'}</button>
        {/if}
        {#if canSpeak}
          <button class="chip" class:on={ownVoice} on:click={toggleOwnVoice}>Your own voice</button>
        {/if}
      </div>
    </div>
  {/if}

  {#if phase === 'playing' && calling === 'voice'}
    <div class="end">
      <div class="end-note">Call and Response reads part of the verse in a Read Aloud voice ({getVoiceInfo(callVoiceId)?.approxSizeMB ?? 64} MB to download).</div>
      <div class="end-row">
        <button class="end-btn" on:click={() => (calling = 'no')}>Recite without it</button>
        <button class="end-btn main" on:click={downloadCallVoice}>Download</button>
      </div>
    </div>
  {:else if phase === 'playing'}
    <div class="status" aria-live="polite">
      {#if calling === 'downloading'}
        <span class="line">Downloading the voice… {downloadPct}%</span>
      {:else if calling === 'getting'}
        <span class="line">Getting the voice ready…</span>
      {:else if calling === 'speaking'}
        <span class="line">Listen…</span>
      {:else if calling === 'tap'}
        <button class="line" on:click={speakCall}>Hear it</button>
      {:else if helpOpen}
        <div class="help">
          {#if stuck}<div class="help-heard">Heard “{stuck}”</div>{/if}
          <button class="end-btn" on:click={showMe}>Show me</button>
          <button class="end-btn" on:click={iSaidIt}>I said it</button>
        </div>
      {:else if round?.hidden}
        {#if noMic}
          <button class="line" on:click={() => setSilent(true)}>No mic here. Silent study</button>
        {:else if !$gameTalk?.on && !rec?.allHeard().length}
          <span class="line">Tap the mic and say it all from memory</span>
        {:else}
          <button class="end-btn main" on:click={finishRecital}>Finish</button>
        {/if}
      {:else if stuck}
        <button class="line" on:click={() => (helpOpen = true)}>Heard “{stuck}”</button>
      {:else if onReference}
        <span class="line">Say the reference</span>
      {:else if noMic}
        <button class="line" on:click={() => setSilent(true)}>No mic here. Silent study</button>
      {:else if !$gameTalk?.on && cursor === 0 && !round?.label}
        <span class="line">Tap the mic and say it from memory</span>
      {:else if round?.label}
        <span class="line">{round.label}</span>
      {/if}
    </div>
  {:else if phase === 'finishing'}
    <div class="status" aria-live="polite">
      <span class="line">Hearing the last of it…</span>
    </div>
  {/if}

  {#if phase === 'silent'}
    <div class="end">
      <div class="end-note">Recall it in your head, then reveal it.</div>
      <div class="end-row">
        <button class="end-btn main" on:click={revealSilent}>Reveal</button>
      </div>
    </div>
  {:else if phase === 'silentPick'}
    <div class="end">
      <div class="end-note">How did it go?</div>
      <div class="end-row picks">
        {#each SILENT_CHOICES as choice (choice.score)}
          <button class="end-btn pick" on:click={() => pickSilent(choice.score)}>{choice.label}</button>
        {/each}
      </div>
    </div>
  {/if}

  {#if phase === 'results' && verse}
    <div class="end">
      {#if score !== null}
        <div class="end-score">
          <span class="score" style="color: {scoreColor(score)}">{score}%</span>
          <span class="score-word">score</span>
          {#if mode === 'silent'}
            <span class="silent" title="Scored in silent study" aria-label="Scored in silent study"><MicrophoneSlash size="1em" weight="bold" /></span>
          {/if}
        </div>
      {/if}
      <div class="end-note">
        {#if mode === 'build'}
          Built. {nextDateLabel(verse)}
        {:else if mode === 'weak'}
          That's your weak spots for now.
        {:else}
          {#if stageOf(verse) === 'known'}Known. {/if}{nextDateLabel(verse)}
        {/if}
      </div>
      {#if missedWords.length}
        <div class="missed">
          <span class="chips-label">Missed. Tap any you did say.</span>
          {#each missedWords as i (i)}
            <button class="chip" on:click={() => iDidSay(i)}>{words[i]}</button>
          {/each}
        </div>
      {/if}
      <div class="end-row">
        {#if mode !== 'weak'}
          <button class="end-btn" on:click={startOver}>Again</button>
        {/if}
        <button class="end-btn main" on:click={next}>{hasNext ? 'Next' : 'Done'}</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .bh-game {
    position: fixed;
    inset: 0;
    /* Over every window, pane and popup. The VC button, notices and the cards a
       press opens stay above it. */
    z-index: 10045;
    background: #000;
    color: #f0f0f0;
    font-size: calc(15px * var(--bar-scale, 1));
    overscroll-behavior: contain;
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
  }

  .top {
    position: absolute;
    top: env(safe-area-inset-top, 0px);
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: calc(4px * var(--bar-scale, 1)) calc(6px * var(--bar-scale, 1));
    pointer-events: none;
  }

  .top > :global(*) {
    pointer-events: auto;
  }

  .tool {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: calc(40px * var(--bar-scale, 1));
    height: calc(40px * var(--bar-scale, 1));
    padding: 0;
    border: none;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.45);
    color: inherit;
    cursor: pointer;
  }

  .controls {
    position: absolute;
    top: calc(env(safe-area-inset-top, 0px) + 48px * var(--bar-scale, 1));
    left: calc(6px * var(--bar-scale, 1));
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: min(320px, calc(100vw - 12px));
    box-sizing: border-box;
    padding: 12px;
    border-radius: 12px;
    background: rgba(0, 0, 0, 0.72);
  }

  .slider {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 0.9em;
  }

  .slider input {
    flex: 1;
    min-width: 0;
    accent-color: #f472b6;
  }

  .note {
    margin: 0;
    font-size: 0.8em;
    line-height: 1.4;
    opacity: 0.85;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }

  .chips-label {
    width: 100%;
    font-size: 0.85em;
    opacity: 0.85;
  }

  .chip {
    padding: 6px 12px;
    border: 1px solid rgba(255, 255, 255, 0.3);
    border-radius: 999px;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 0.85em;
    cursor: pointer;
  }

  .chip.on {
    border-color: #f472b6;
    color: #f9a8d4;
  }

  .status {
    position: absolute;
    left: 50%;
    bottom: calc(env(safe-area-inset-bottom, 0px) + 16px);
    display: flex;
    flex-direction: column;
    align-items: center;
    max-width: calc(100vw - 24px);
    transform: translateX(-50%);
    pointer-events: none;
  }

  .status > * {
    pointer-events: auto;
  }

  .line {
    display: block;
    max-width: 100%;
    overflow: hidden;
    padding: 7px 14px;
    border: none;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.72);
    color: inherit;
    font: inherit;
    font-size: 0.9em;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  button.line {
    cursor: pointer;
  }

  .help {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px 12px;
    border-radius: 14px;
    background: rgba(0, 0, 0, 0.82);
  }

  .help-heard {
    width: 100%;
    text-align: center;
    font-size: 0.9em;
  }

  .end {
    position: absolute;
    left: 50%;
    bottom: calc(env(safe-area-inset-bottom, 0px) + 16px);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    max-width: calc(100vw - 24px);
    box-sizing: border-box;
    padding: 12px 16px;
    border-radius: 16px;
    background: rgba(0, 0, 0, 0.82);
    transform: translateX(-50%);
  }

  .end-score {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }

  .score {
    font-size: 1.8em;
    font-weight: 700;
  }

  .score-word {
    font-size: 0.85em;
    opacity: 0.8;
  }

  .silent {
    display: inline-flex;
    align-self: center;
    opacity: 0.8;
  }

  .end-note {
    font-size: 0.9em;
    text-align: center;
    opacity: 0.9;
  }

  .missed {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px;
    max-height: 30vh;
    overflow-y: auto;
  }

  .missed .chips-label {
    text-align: center;
  }

  .picks {
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px;
  }

  .end-btn.pick {
    padding: 9px 14px;
  }

  .end-row {
    display: flex;
    gap: 10px;
  }

  .end-btn {
    padding: 10px 22px;
    border: 1px solid rgba(255, 255, 255, 0.35);
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.72);
    color: inherit;
    font: inherit;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
  }

  .end-btn.main {
    border-color: #f472b6;
    background: #f472b6;
    color: #111;
  }
</style>
