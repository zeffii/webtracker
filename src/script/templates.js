// Rhythm starting points for the scratch pattern: 16 rows of sixteenth notes, a column per voice. They are sketches of
// the usual grooves, meant to be changed: invert, rotate, add and remove cells until it is yours.
// Notes follow a drum-kit habit (C-2 kick, D-2 snare or clap, F#2 closed hat, A#2 open hat); the instrument decides what they sound like.
const K = 'C-2', S = 'D-2', R = 'C#2', H = 'F#2', O = 'A#2', P = 'E-2', B = 'G-2';

export const TEMPLATES = [
  { group: 'Electronic', name: 'Techno, four on the floor', cols: [[K, 'x...x...x...x...'], [S, '....x.......x...'], [O, '..x...x...x...x.'], [H, 'xxxxxxxxxxxxxxxx']] },
  { group: 'Electronic', name: 'Minimal techno', cols: [[K, 'x...x...x...x...'], [R, '...x..x...x..x..'], [H, '..x...x...x...x.'], [P, 'x..x..x.x..x..x.']] },
  { group: 'Electronic', name: 'House', cols: [[K, 'x...x...x...x...'], [S, '....x.......x...'], [O, '..x...x...x...x.'], [H, 'x.x.x.x.x.x.x.x.']] },
  { group: 'Electronic', name: 'Breakbeat', cols: [[K, 'x.x.......xx....'], [S, '....x..x.x..x...'], [H, 'x.x.x.x.x.x.x.x.']] },
  { group: 'Electronic', name: '2-step garage', cols: [[K, 'x.........x.....'], [S, '....x.......x...'], [H, 'x.x.x.x.x.x.x.x.'], [R, '...x......x..x..']] },
  { group: 'Hip hop', name: 'Trap', cols: [[K, 'x.......x.x.....'], [S, '........x.......'], [H, 'xxxxxxxxxxxxxxxx']] },
  { group: 'Latin', name: 'Son clave 3-2', cols: [[R, 'x..x..x...x.x...'], [B, '......x.....x...'], [P, '....x.xx....x.xx'], [H, 'x.x.x.x.x.x.x.x.']] },
  { group: 'Latin', name: 'Rumba clave', cols: [[R, 'x..x...x..x.x...'], [B, '......x.....x...'], [P, '....x.xx....x.xx']] },
  { group: 'Latin', name: 'Bossa nova', cols: [[R, 'x..x..x...x..x..'], [K, 'x..x....x..x....'], [H, 'x.x.x.x.x.x.x.x.']] },
  { group: 'Latin', name: 'Reggaeton (dembow)', cols: [[K, 'x...x...x...x...'], [S, '...x..x....x..x.'], [H, 'x.x.x.x.x.x.x.x.']] },
  { group: 'Dub', name: 'Reggae, one drop', cols: [[K, '........x.......'], [S, '........x.......'], [H, 'x.x.x.x.x.x.x.x.'], [O, '..x...x...x...x.']] },
];
