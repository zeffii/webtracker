// The first screen: nothing but "click to initialize", and when it is clicked a few lines of start-up report type out as
// the real steps finish (audio context, DSP, worklet, project), and the screen folds away to show the tracker. The whole
// thing takes about a second once the engine is up. The browser needs a click before it will make sound, so this is that
// click; it runs what the Start button runs.
const wait = ms => new Promise(r => setTimeout(r, ms));
const frame = () => new Promise(r => requestAnimationFrame(r));

export function createSplash({ box, onStart }) {
  const log = box.querySelector('.s-log'), go = box.querySelector('.s-go'), crt = box.querySelector('.s-crt'), bar = box.querySelector('.s-bar i'), hint = box.querySelector('.s-hint');
  let count = 0, total = 7, nextAt = 0, typing = [];
  document.body.classList.add('splashing');
  box.hidden = false;
  go.focus();

  // One line of the report, typed out quickly; `tag` ([ ok ] and so on) lands when it is complete. Lines start at least
  // 55 ms apart, so a burst of fast steps still reads as a sequence.
  function say(text, tag = 'ok') {
    const row = document.createElement('div'), span = document.createElement('span');
    row.append(span); log.append(row);
    const start = Math.max(performance.now(), nextAt); nextAt = start + 55;
    const line = tag === '' ? `> ${text}` : text.padEnd(54, '.');
    const job = (async () => {
      await wait(start - performance.now());
      for (let i = 0; i < line.length; i += 9) { span.textContent = line.slice(0, i + 9); await frame(); }
      if (tag === '') return;
      const t = document.createElement('span'); t.className = tag === 'ready' ? 'hl' : tag === 'ok' ? 'ok' : 'bad'; t.textContent = ` [ ${tag} ]`; row.append(t);
      count++; bar.style.width = `${Math.min(100, Math.round(count / total * 100))}%`;
    })();
    typing.push(job);
    return job;
  }

  go.addEventListener('click', () => {
    go.disabled = true; go.style.visibility = 'hidden'; hint.style.display = 'none'; box.querySelector('.s-bar').style.display = 'block';
    log.textContent = ''; count = 0; typing = []; nextAt = 0;
    say('initialize', '');
    onStart();
  });

  return {
    say,
    // The start-up is done: let the lines finish, fold the screen away and show the app.
    async finish() {
      await Promise.all(typing); bar.style.width = '100%';
      await wait(80);
      crt.style.transition = 'opacity .25s, transform .28s'; crt.style.opacity = '0'; crt.style.transform = 'scaleY(.02)';
      await wait(230);
      box.style.transition = 'opacity .15s'; box.style.opacity = '0';
      await wait(150);
      box.hidden = true; document.body.classList.remove('splashing');
    },
    // It did not work: say why, and let the button be clicked again.
    async fail(message) {
      await Promise.all(typing);
      const row = document.createElement('div'); row.className = 'bad'; row.textContent = message; log.append(row);
      go.disabled = false; go.style.visibility = 'visible'; box.querySelector('.l').textContent = 'click to try again';
    },
  };
}
