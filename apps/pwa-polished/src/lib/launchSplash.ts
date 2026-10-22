/**
 * The launch splash: the irisBible wordmark, on the ground of whichever look
 * the clock picks (lib/wordmark.ts), covering the app while it starts.
 *
 * It plays as one piece:
 *
 *   1. the one-color iris, big and centered, for a second;
 *   2. it flies onto the dot of the "ı" in Bible, shrinking and turning into
 *      the color iris on the way, while the letters fade in around it;
 *   3. it lands with a stamp (a quick squash and a ring pulsing out);
 *   4. the finished wordmark holds for a moment and the splash fades.
 *
 * The letters stay hidden until the wordmark's font has loaded, so the word
 * never shows in a stand-in font first. Where the app takes longer than all
 * this, the finished wordmark simply stays until it is up. Two ways out never
 * wait: an error (the message under the splash has to be readable) and a hard
 * cap, so a launch that never finishes cannot hide the page forever.
 *
 * With Motion reduced or off the iris does not travel: the one-color iris
 * gives way to the finished wordmark in place. Opening the app again under
 * two seconds after closing it (a fold handing it to the other screen) shows
 * no splash at all; public/startup.js decides that, as data-boot="skip".
 *
 * Step 1 starts before this code has loaded: index.html draws the same big
 * iris as #boot-splash, because Android keeps its own splash (the app icon on
 * a square) up until the page draws something. This takes it over in place.
 */

import { mount, unmount } from 'svelte';
import Wordmark from '../components/Wordmark.svelte';
import { CREAM, NIGHT, WORDMARKS, wordmarkAt } from './wordmark';

/** How long the one-color iris sits alone before it moves, from the page's start. */
const MONO_MS = 1000;
/** The flight onto the "ı". */
const FLIGHT_MS = 800;
/** The stamp's squash, and the ring that pulses out with it. */
const SQUASH_MS = 280;
const RIPPLE_MS = 650;
/** The finished wordmark, held once the iris has landed. */
const HOLD_MS = 1500;
/** The longest the splash waits for the black-and-white iris before showing anyway. */
const MONO_WAIT_MS = 600;
/** The longest the letters wait for their font before showing anyway. */
const FONT_WAIT_MS = 2500;
/** The most the splash stays, whatever the app is doing. */
const LAUNCH_SPLASH_MAX_MS = 9000;
const FADE_MS = 250;

export interface LaunchSplash {
  /** Take the splash down once it has finished playing. Safe to call twice. */
  dismiss(): void;
}

const NONE: LaunchSplash = { dismiss() {} };

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Resolves when the promise does or the time runs out, whichever is first. */
function capped(work: Promise<unknown>, ms: number): Promise<void> {
  return Promise.race([work.then(() => {}, () => {}), wait(ms)]);
}

export function showLaunchSplash(): LaunchSplash {
  if (document.documentElement.dataset.boot === 'skip') return NONE;

  // The first frame index.html drew, swapped for this one once it is ready.
  const boot = document.getElementById('boot-splash');
  const code = wordmarkAt();
  const look = WORDMARKS[code];
  // The landing ring stands out from the ground, whatever color the letters are.
  const contrast = look.ground === CREAM ? NIGHT : CREAM;
  const level = document.documentElement.dataset.motion ?? 'full';

  const cover = document.createElement('div');
  cover.setAttribute('aria-hidden', 'true');
  cover.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:20000',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    `background:${look.ground}`,
    // The wordmark's shadows reach about a third of an em past the letters.
    'font-size:min(17vw,96px)',
    `transition:opacity ${FADE_MS}ms ease`,
    'opacity:1',
  ].join(';');

  // The word, laid out from the start so the dot's landing spot can be
  // measured, but unseen until the iris sets off.
  const holder = document.createElement('div');
  holder.style.opacity = '0';
  cover.appendChild(holder);
  const mark = mount(Wordmark, { target: holder, props: { code } });
  const dot = holder.querySelector<HTMLImageElement>('.iris');
  if (dot) dot.style.visibility = 'hidden';

  // The big iris: the art traced to black and white (public/iris-mono.png,
  // white, darkened on a cream ground), with the color art on top of it at no
  // opacity. Both come from the same art, so the change is a fade.
  const big = 'min(62vw,52vh,340px)';
  const flyer = document.createElement('div');
  flyer.style.cssText = [
    'position:fixed',
    'left:50%',
    'top:50%',
    `width:${big}`,
    `height:${big}`,
    `margin-left:calc(${big} / -2)`,
    `margin-top:calc(${big} / -2)`,
    'transform-origin:50% 50%',
    'will-change:transform',
  ].join(';');
  const mono = document.createElement('img');
  mono.src = '/iris-mono.png';
  mono.alt = '';
  mono.draggable = false;
  mono.style.cssText = `display:block;width:100%;height:100%${look.ground === CREAM ? ';filter:brightness(0)' : ''}`;
  flyer.appendChild(mono);
  const color = document.createElement('img');
  color.src = '/pb-gem.png';
  color.alt = '';
  color.draggable = false;
  color.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border-radius:50%;opacity:0';
  flyer.appendChild(color);
  cover.appendChild(flyer);

  // Swapped in once the black-and-white iris is ready to draw, so the swap
  // never shows an empty ground. It is precached, so this is a moment at most.
  const monoReady = capped(mono.decode(), MONO_WAIT_MS);
  void monoReady.then(() => {
    if (gone) return;
    document.body.appendChild(cover);
    boot?.remove();
  });

  let gone = false;
  let played = false;
  let ready = false;

  function remove(): void {
    if (gone) return;
    gone = true;
    boot?.remove();
    cover.style.opacity = '0';
    setTimeout(() => {
      void unmount(mark);
      cover.remove();
    }, FADE_MS);
  }

  function finished(): void {
    played = true;
    if (ready) remove();
  }

  /** The finished wordmark, no movement: where Motion is off, or anything fails. */
  function settle(): void {
    holder.style.opacity = '1';
    if (dot) dot.style.visibility = '';
    flyer.remove();
  }

  async function play(): Promise<void> {
    const font = capped(document.fonts?.load('400 1em Milonga') ?? Promise.resolve(), FONT_WAIT_MS);
    const art = capped(color.decode(), FONT_WAIT_MS);
    await monoReady;
    await Promise.all([wait(MONO_MS - performance.now()), font, art]);
    if (gone) return;

    if (level !== 'full' || !dot || typeof flyer.animate !== 'function') {
      // In place: the word fades up as the one-color iris fades away.
      const fade = level === 'off' ? 0 : FADE_MS;
      holder.style.transition = flyer.style.transition = `opacity ${fade}ms ease`;
      holder.style.opacity = '1';
      if (dot) dot.style.visibility = '';
      flyer.style.opacity = '0';
      await wait(fade);
      flyer.remove();
      await wait(HOLD_MS);
      return finished();
    }

    // Where the dot is, measured now that the font has laid the word out.
    const from = flyer.getBoundingClientRect();
    const to = dot.getBoundingClientRect();
    const scale = to.width / from.width;
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const ease = 'cubic-bezier(0.55, 0, 0.25, 1)';

    const flight = flyer.animate(
      [{ transform: 'none' }, { transform: `translate(${dx}px, ${dy}px) scale(${scale})` }],
      { duration: FLIGHT_MS, easing: ease, fill: 'forwards' },
    );
    // Full color exactly as it lands.
    color.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FLIGHT_MS, easing: 'ease-in-out', fill: 'forwards' });
    // The letters come in over the back half, done by the landing.
    holder.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: FLIGHT_MS * 0.6,
      delay: FLIGHT_MS * 0.4,
      easing: 'ease-out',
      fill: 'forwards',
    });
    await flight.finished;
    if (gone) return;

    // Landed: the real dot takes over, with its ring and shadow, and stamps.
    holder.style.opacity = '1';
    dot.style.visibility = '';
    flyer.remove();
    dot.style.transformOrigin = '50% 100%';
    dot.animate(
      [
        { transform: 'translateX(-50%) scale(1, 1)' },
        { transform: 'translateX(-50%) scale(1.22, 0.78)', offset: 0.35 },
        { transform: 'translateX(-50%) scale(0.94, 1.06)', offset: 0.7 },
        { transform: 'translateX(-50%) scale(1, 1)' },
      ],
      { duration: SQUASH_MS, easing: 'ease-out' },
    );

    const ring = document.createElement('div');
    ring.style.cssText = [
      'position:fixed',
      `left:${to.left}px`,
      `top:${to.top}px`,
      `width:${to.width}px`,
      `height:${to.height}px`,
      'border-radius:50%',
      `border:2px solid ${contrast}`,
      'pointer-events:none',
    ].join(';');
    cover.appendChild(ring);
    ring
      .animate(
        [
          { transform: 'scale(1)', opacity: 0.8 },
          { transform: 'scale(3.4)', opacity: 0 },
        ],
        { duration: RIPPLE_MS, easing: 'cubic-bezier(0.2, 0.6, 0.3, 1)', fill: 'forwards' },
      )
      .finished.then(() => ring.remove(), () => ring.remove());

    await wait(HOLD_MS);
    finished();
  }

  play().catch(() => {
    settle();
    finished();
  });

  function dismiss(): void {
    ready = true;
    if (played) remove();
  }

  // Never sit on top of an error message, and never stay forever.
  window.addEventListener('error', remove, { once: true });
  window.addEventListener('unhandledrejection', remove, { once: true });
  setTimeout(remove, LAUNCH_SPLASH_MAX_MS);

  return { dismiss };
}
