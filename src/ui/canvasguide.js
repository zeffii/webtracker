// The manual for the canvas picture, shown under the editor while a canvas picture is being edited. Plain markdown (ui/markdown.js).
export const CANVAS_GUIDE = `# Canvas guide

## What this is

A canvas picture is a small JavaScript program that draws on a 2D canvas, the way Processing does. You write two functions:

- \`setup()\` runs once, when the picture starts (and again whenever you change the text).
- \`draw()\` runs every frame, about 60 times a second, while the picture is on show.

Variables you declare outside the two functions stay between frames, so a picture can remember things: where a dot is, how many hits have come, a list of falling balls. Everything is drawn with the browser's own 2D canvas, \`ctx\`: \`ctx.fillRect\`, \`ctx.arc\`, \`ctx.fillText\`, \`ctx.stroke\` and the rest (the MDN page "CanvasRenderingContext2D" lists them).

The picture is not cleared between frames. Start \`draw()\` with \`background('#111')\` for a fresh picture each frame, \`fade(0.2)\` to let the old frame fade out (trails), or neither to keep drawing on top.

It sits in the same list as the shaders: **+** adds a picture, the Kind box switches this one between Shader and Canvas (each keeps its own text), and the Shd column of the shader lane switches between them while the song plays.

## Time, and the transport

| name | what it is |
| --- | --- |
| \`T\` | seconds since the page started |
| \`dt\` | seconds since the last frame |
| \`frame\` | frames drawn since the picture started |
| \`song\` | the position in ticks as a decimal: 37.62 is a bit over half way through tick 37 |
| \`tick\` | the whole tick the song is on (the row number) |
| \`frac\` | how far into the tick, 0 to 1 (0 while stopped) |
| \`beat\` | the position in beats, with the fraction |
| \`bar\` | the position in bars, with the fraction |
| \`playing\` | true while the song plays |

## Sub-tick movement

The song moves in ticks, the picture in frames. Between two ticks there are several frames, and \`song\`, \`frac\` and \`beat\` tell you where between them you are. So a movement can be glided:

\`\`\`js
const k = ease((song - startedAt) / 3);   // 0 to 1 over 3 ticks, slow at both ends
x = lerp(from, to, k);
\`\`\`

Or set a target when something happens and ease towards it every frame: \`x += (target - x) * Math.min(1, dt * 10)\`.

## What the song is doing

Lanes are named by their id or their instrument's name (\`"kick"\`), or by their place in the lane list from 0. A name that matches nothing reads 0. These are the same numbers a shader gets.

| call | what it gives |
| --- | --- |
| \`hit("kick")\` | 1 at the moment a note starts, then fading away (Config, Visual, "Hit fade") |
| \`since("kick")\` | seconds since that lane's last note: \`Math.exp(-since("kick") * 8)\` is a flash that decays |
| \`pitch("acid")\` | the last note's pitch, 0 to 1 across the 128 notes |
| \`vel("acid")\` | the last note's velocity, 0 to 1 |
| \`held("pad")\` | 1 while a note is held, until a note off or a cut |
| \`hits()\` | all the hits together, 0 to 1 |
| \`lanes()\` | the list of lanes: \`[{ id, inst }, ...]\` |
| \`cell("kick", 4)\` | what the pattern holds 4 ticks ahead (negative is behind): \`{ hit, pitch, vel, off }\` or \`null\` for an empty row. This is how a picture can start before the hit |

## Ticks and notes

Most frames are not a tick. These two calls tell you when one is.

\`\`\`js
function draw() {
  for (const t of ticked()) {      // ticked() is the list of ticks that began since the last frame; usually empty, [] 
    // t.tick is the tick number, t.notes the notes that started on it
    if (t.tick % 8 === 0) pulse = 1;
    for (const n of t.notes) console.log(n.inst, n.note, n.vel);
  }
}
\`\`\`

If the page is slow and two ticks go by in one frame, \`ticked()\` has both, so none is lost. After a jump or a loop it has just the tick you landed on.

\`onNote(lane, fn)\` is the same thing the other way round: Wax calls \`fn\` for every note that starts on that lane, before \`draw()\` that frame. Use \`'*'\` for any lane. Call it in \`setup()\`. The note is \`{ lane, id, inst, note, vel, tick }\` with \`note\` a MIDI number and \`vel\` 0 to 1.

\`\`\`js
function setup() {
  onNote('kick', n => { size = 1; });
  onNote('*',    n => { lastLane = n.lane; });
}
\`\`\`

## Drawing helpers

| call | what it does |
| --- | --- |
| \`background(colour)\` | fills the whole picture |
| \`fade(amount, colour)\` | paints the colour over it at that opacity (0.1 to 0.3 gives trails) |
| \`C1\`, \`C2\` | the two palette colours (deep and light) as CSS colours, from Config, Visual |
| \`alpha(C1, 0.4)\` | a palette colour with an opacity |
| \`hsl(h, s, l, a)\` | a colour, every number 0 to 1 (h goes round) |
| \`W\`, \`H\`, \`S\` | the picture's size in pixels; it is square, so S is the same |
| \`lerp(a, b, t)\`, \`map(v, a, b, c, d)\`, \`clamp(v, lo, hi)\` | the usual |
| \`ease(t)\`, \`easeIn(t)\`, \`easeOut(t)\` | shape a 0 to 1 movement |
| \`fract(v)\`, \`noise(x, y)\`, \`hash(a, b)\` | the decimals of a number; smooth noise, 0 to 1; a repeatable "random" from numbers, 0 to 1 |
| \`rand(a, b)\` | a random number: \`rand()\` is 0 to 1, \`rand(5)\` 0 to 5, \`rand(2, 3)\` 2 to 3 |
| \`TAU\`, \`PI\`, \`sin\`, \`cos\`, \`atan2\`, \`sqrt\`, \`abs\`, \`floor\`, \`min\`, \`max\`, \`pow\` ... | the Math functions, without the \`Math.\` |

## Good to know

- Use \`hash(n.tick, n.lane)\` instead of \`rand()\` when the same note should always do the same thing; the picture then looks the same every time the song plays.
- A mistake shows under the picture with its line number and stops that picture until you change the text. A mistake in \`draw()\` only stops the picture, never the music. (A typo that stops the program from being read at all gives the message without a line.)
- The size comes from Config, Visual, "Picture: resolution". Draw with \`W\`, \`H\` and \`S\` rather than fixed numbers and it works at any size.
- console.log goes to the browser's console (F12), which is the way to look inside a picture that does something unexpected.
- The picture reads the pattern, not the sound: it is the same on every run and does not depend on the audio engine.
- Not here yet: the exposed number inputs (\`kn()\`) of the shaders, and the pattern skeleton.
`;
