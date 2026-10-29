// Playback controls: play/pause, scrubber with phase ticks, speed, render toggles, shortcuts.
import { LOOP, PHASES } from './choreography.js';
import { wrap } from '../math.js';

const ICON_PAUSE = '<svg width="14" height="14" viewBox="0 0 14 14"><rect x="2.5" y="2" width="3" height="10" rx="1" fill="currentColor"/><rect x="8.5" y="2" width="3" height="10" rx="1" fill="currentColor"/></svg>';
const ICON_PLAY = '<svg width="14" height="14" viewBox="0 0 14 14"><path d="M3.5 2.2v9.6a.6.6 0 0 0 .9.5l7.6-4.8a.6.6 0 0 0 0-1L4.4 1.7a.6.6 0 0 0-.9.5Z" fill="currentColor"/></svg>';

export function setupUI(state) {
  const $ = (id) => document.getElementById(id);
  const play = $('play');
  const scrub = $('scrub');
  const clock = $('clock');
  const phaseName = $('phase-name');
  const phaseNote = $('phase-note');
  const speedButtons = [...document.querySelectorAll('[data-speed]')];
  const toggles = { shaded: $('opt-shaded'), face: $('opt-face'), guides: $('opt-guides') };

  scrub.max = String(Math.round(LOOP * 1000));
  for (const p of PHASES) {
    const tick = document.createElement('span');
    tick.style.left = `${(p.start / LOOP) * 100}%`;
    tick.title = p.label;
    $('ticks').append(tick);
  }

  const syncPlay = () => {
    play.innerHTML = state.playing ? ICON_PAUSE : ICON_PLAY;
    play.setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
  };
  const syncSpeed = () => speedButtons.forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === state.speed)));
  const step = (dt) => {
    state.playing = false;
    state.t = wrap(state.t + dt, LOOP);
    syncPlay();
  };

  play.addEventListener('click', () => {
    state.playing = !state.playing;
    syncPlay();
  });
  scrub.addEventListener('input', () => {
    state.scrubbing = true;
    state.t = Number(scrub.value) / 1000;
  });
  scrub.addEventListener('change', () => (state.scrubbing = false));
  speedButtons.forEach((b) =>
    b.addEventListener('click', () => {
      state.speed = Number(b.dataset.speed);
      syncSpeed();
    }),
  );
  for (const [key, input] of Object.entries(toggles)) {
    input.checked = state[key];
    input.addEventListener('change', () => (state[key] = input.checked));
  }

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement && e.target.type === 'range' && e.key.startsWith('Arrow')) return;
    if (e.key === ' ') {
      e.preventDefault();
      play.click();
    } else if (e.key === 'ArrowRight') step(1 / 60);
    else if (e.key === 'ArrowLeft') step(-1 / 60);
    else if (e.key === 's') toggles.shaded.click();
    else if (e.key === 'f') toggles.face.click();
    else if (e.key === 'g') toggles.guides.click();
  });

  syncPlay();
  syncSpeed();

  let lastPhase = null;
  return {
    update(scene) {
      if (!state.scrubbing) scrub.value = String(Math.round(scene.t * 1000));
      clock.textContent = `${scene.t.toFixed(2)} s`;
      if (scene.phase !== lastPhase) {
        lastPhase = scene.phase;
        phaseName.textContent = scene.phase.label;
        phaseNote.textContent = scene.phase.note;
      }
    },
  };
}
