<script lang="ts">
  /**
   * Voice Control's pieces that float over the app: the mic button (while it
   * is switched on), the line beside whichever mic is held, the card a press
   * opens when something is missing, and a Notes recording's pill and pocket
   * screen while one runs. Voice Control's models load on the first command,
   * never here.
   */
  import { onMount } from 'svelte';
  import FloatingMic from './FloatingMic.svelte';
  import VoiceBubble from './VoiceBubble.svelte';
  import VoiceCard from './VoiceCard.svelte';
  import RecorderPill from './RecorderPill.svelte';
  import PocketScreen from './PocketScreen.svelte';
  import { watchVoiceReady } from '../lib/voice/holdToTalk';

  onMount(() => watchVoiceReady());
</script>

<FloatingMic />
<VoiceBubble />
<VoiceCard />
<RecorderPill />
<PocketScreen />
