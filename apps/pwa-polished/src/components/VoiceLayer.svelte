<script lang="ts">
  /**
   * Voice Control's pieces that float over the app: the mic button (while it
   * is switched on), the line beside whichever mic is held, the card a press
   * opens when something is missing, a recording's pill and pocket screen
   * while one runs, and the card every Stop opens. Voice Control's models
   * load on the first command, never here.
   *
   * A transcript the app closed on carries on a few seconds after launch.
   * Recordings' own pills in the writing paint themselves
   * (lib/recorder/recordingChips.ts).
   */
  import { onMount } from 'svelte';
  import FloatingMic from './FloatingMic.svelte';
  import VoiceBubble from './VoiceBubble.svelte';
  import VoiceCard from './VoiceCard.svelte';
  import RecorderPill from './RecorderPill.svelte';
  import PocketScreen from './PocketScreen.svelte';
  import StopRecordingCard from './StopRecordingCard.svelte';
  import { watchVoiceReady } from '../lib/voice/holdToTalk';
  import { resumeWaitingTranscript } from '../lib/voice/transcribe';

  /** Long enough for the app to settle and the account to be known. */
  const RESUME_AFTER_MS = 5000;

  onMount(() => {
    watchVoiceReady();
    const t = setTimeout(() => void resumeWaitingTranscript().catch(() => {}), RESUME_AFTER_MS);
    return () => clearTimeout(t);
  });
</script>

<FloatingMic />
<VoiceBubble />
<VoiceCard />
<RecorderPill />
<PocketScreen />
<StopRecordingCard />
