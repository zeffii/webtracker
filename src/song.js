// A hand-written test song: two lanes playing at once.
// Columns: Note Vel Smp Off Rtg Cut Res Mix Time Cmd. Empty cells are dots, '===' is note off,
// and missing cells at the end of a row are empty. An empty parameter cell leaves
// the parameter as it is. Cmd is CCXXYY: command 02 is resonance, 03 delay time.
export const song = {
  name: 'demo',
  bpm: 120,
  ticksPerBeat: 4,
  length: 32,
  lanes: [
    {
      id: 'lead',
      instrument: 'lead',
      patterns: {
        arp: {
          text: `
            C-4 .. .. .... .... 70 50 40 4C9E
            ... .. .. .... .... 78 .. ..
            D#4 .. .. .... .... 80 .. ..
            ... .. .. .... .... 88 .. ..
            G-4 .. .. .... .... 90 .. ..
            ... .. .. .... .... 98 .. ..
            C-5 .. .. .... .... A0 .. ..
            ... .. .. .... .... A8 .. ..
            === .. .. .... .... B0 .. ..
            ... .. .. .... .... B8 .. ..
            A#3 .. .. .... .... C0 .. ..
            ... .. .. .... .... C8 .. ..
            D-4 .. .. .... .... D0 .. ..
            ... .. .. .... .... D8 .. ..
            F-4 .. .. .... .... E0 .. ..
            === .. .. .... .... E8 .. ..`,
        },
        fill: {
          text: `
            C-5 .. .. .... .... F0 .. 80 2000
            G-4 .. .. .... .... F0 .. 80
            D#5 .. .. .... .... F0 .. 80 .... 02A000
            === .. .. .... .... F0 .. 80`,
        },
      },
      // 'fill' sits on top of the second 'arp' and the arp carries on underneath.
      placements: [
        { puid: 'arp', start: 0, length: 16 },
        { puid: 'arp', start: 16, length: 16 },
        { puid: 'fill', start: 28, length: 4 },
      ],
    },
    {
      id: 'bass',
      instrument: 'bass',
      patterns: {
        line: {
          text: `
            C-2 .. .. .... .... .. .. ..
            ... .. .. .... .... .. .. ..
            === .. .. .... .... .. .. ..
            ... .. .. .... .... .. .. ..
            C-2 .. .. .... .... .. .. ..
            ... .. .. .... .... .. .. ..
            === .. .. .... .... .. .. ..
            ... .. .. .... .... .. .. ..
            G#1 .. .. .... .... .. .. ..
            ... .. .. .... .... .. .. ..
            === .. .. .... .... .. .. ..
            ... .. .. .... .... .. .. ..
            A#1 .. .. .... .... .. .. ..
            ... .. .. .... .... .. .. ..
            === .. .. .... .... .. .. ..
            ... .. .. .... .... .. .. ..`,
        },
      },
      placements: [
        { puid: 'line', start: 0, length: 16 },
        { puid: 'line', start: 16, length: 16 },
      ],
    },
    {
      id: 'kick',
      instrument: 'kick',
      patterns: {
        four: {
          text: `
            C-2 .. 60 90
            ... .. .. ..
            ... .. .. ..
            ... .. .. ..
            C-2 .. .. ..
            ... .. .. ..
            ... .. .. ..
            ... .. .. ..
            C-2 .. .. ..
            ... .. .. ..
            ... .. .. ..
            ... .. .. ..
            C-2 .. .. ..
            ... .. .. ..
            C-2 .. .. ..
            ... .. .. ..`,
        },
      },
      placements: [
        { puid: 'four', start: 0, length: 16 },
        { puid: 'four', start: 16, length: 16 },
      ],
    },
  ],
};
