// The first screen: the Wax logo, and a thin loader bar along the bottom that fills as the engine starts. There is nothing to click:
// the start-up begins by itself once the screen has been painted, and the screen fades away when the app is ready (never sooner than
// MIN_SHOW milliseconds after it appeared, so it does not just flash). If the start-up fails, the reason is shown under the logo and a
// click anywhere tries again.
//
// createSplash({ box, onStart }): onStart() runs the start-up; main.js reports its steps with say() and ends with finish() or fail().
const wait = ms => new Promise(r => setTimeout(r, ms));
const MIN_SHOW = 900;
const STEPS = 7;   // how many say() reports a start-up makes: the bar is that much of the way along after each

export function createSplash({ box, onStart }) {
  const fill = box.querySelector('.s-bar i'), message = box.querySelector('.s-msg');
  const shown = performance.now();
  let steps = 0, busy = false;
  const progress = fraction => { fill.style.transform = `scaleX(${Math.max(0, Math.min(1, fraction))})`; };

  document.body.classList.add('splashing');
  box.hidden = false;
  box.setAttribute('aria-label', 'Starting Wax');

  const enter = () => {
    if (busy) return;
    busy = true; steps = 0;
    box.classList.remove('failed'); message.textContent = '';
    progress(0.05);
    onStart();
  };
  box.addEventListener('click', () => { if (box.classList.contains('failed')) enter(); });
  requestAnimationFrame(() => requestAnimationFrame(enter));   // the logo is painted first

  return {
    // One step of the start-up is done.
    say() { steps++; progress(0.1 + 0.85 * Math.min(1, steps / STEPS)); },
    // The start-up is done: fill the bar, then fade the screen away and show the app.
    async finish() {
      await wait(Math.max(0, MIN_SHOW - (performance.now() - shown)));
      progress(1); await wait(220);
      box.classList.add('leaving'); await wait(320);
      box.hidden = true; box.classList.remove('leaving'); progress(0);
      document.body.classList.remove('splashing');
    },
    // It did not work: say why, and let a click try again.
    fail(reason) {
      busy = false;
      box.classList.add('failed'); progress(1);
      message.textContent = `${reason} (click to try again)`;
    },
  };
}
