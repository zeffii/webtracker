// The instrument a new "Drum synth 2" starts as: a kick with its three envelopes already drawn, a click-free low body, the bass
// boost on, and a filter after the voices. It is data only (the same shape as an instrument file), copied for each new instrument.
// `harm` is 0 here: the kick was made before that control existed, and this keeps its sound.
export const kick2 = {
  "graph": {
    "nodes": [
      {
        "id": "drum",
        "type": "drumsynth2",
        "x": 20,
        "y": 124,
        "data": {
          "env": {
            "pitch": [
              {
                "x": 0,
                "y": 1,
                "l": null,
                "r": [
                  0.03,
                  -0.5
                ]
              },
              {
                "x": 0.1178,
                "y": 0.1293,
                "l": [
                  -0.1178,
                  0.1071
                ],
                "r": [
                  0.1,
                  0.0536
                ]
              },
              {
                "x": 1,
                "y": 0,
                "l": [
                  -0.55,
                  0
                ],
                "r": null
              }
            ],
            "amp": [
              {
                "x": 0,
                "y": 0,
                "l": null,
                "r": [
                  0.002,
                  0.4
                ]
              },
              {
                "x": 0.02,
                "y": 1,
                "l": [
                  -0.006,
                  0
                ],
                "r": [
                  0.06,
                  -0.05
                ]
              },
              {
                "x": 0.2635,
                "y": 0.4262,
                "l": [
                  -0.037,
                  0.4821
                ],
                "r": [
                  0.1761,
                  -0.3304
                ]
              },
              {
                "x": 1,
                "y": 0,
                "l": [
                  -0.5,
                  0
                ],
                "r": null
              }
            ],
            "noise": [
              {
                "x": 0,
                "y": 1,
                "l": null,
                "r": [
                  0.02,
                  -0.55
                ]
              },
              {
                "x": 0.0809,
                "y": 0.2141,
                "l": null,
                "r": null
              },
              {
                "x": 1,
                "y": 0,
                "l": [
                  -0.4,
                  0
                ],
                "r": null
              }
            ]
          }
        },
        "params": {
          "drive": 0,
          "boost": 7.522,
          "boostFreq": 51.2226,
          "noiseType": 5,
          "noiseTone": 577.2778,
          "noiseHigh": 98.5986,
          "arate": 1.5408,
          "root": 64,
          "clickLen": 2.4854,
          "clickTone": 913.3091,
          "body": 0.6995,
          "prate": 1.8577,
          "nrate": 0.1355,
          "noise": 0.0009,
          "pitchMul": 2.0912,
          "startPitch": 1115.7979,
          "endPitch": 34.335,
          "harm": 0
        }
      },
      {
        "id": "poly",
        "type": "voices",
        "x": 170,
        "y": 124
      },
      {
        "id": "out",
        "type": "out",
        "params": {
          "gain": 0.6
        },
        "x": 624,
        "y": 120
      },
      {
        "id": "filterpro1",
        "type": "filterpro",
        "x": 312,
        "y": 120,
        "params": {
          "mode": 0,
          "resonance": 0.7969,
          "cutoff": 1582.9015,
          "vowel": 2.5596,
          "drive": 0.1959
        }
      }
    ],
    "connections": [
      [
        "drum.out",
        "poly.in"
      ],
      [
        "poly.out",
        "filterpro1.in"
      ],
      [
        "filterpro1.out",
        "out.in"
      ]
    ],
    "voices": 2
  },
  "noteColumns": 1,
  "exposed": [
    {
      "node": "drum",
      "param": "startPitch",
      "label": "Sta",
      "scale": "log"
    },
    {
      "node": "drum",
      "param": "endPitch",
      "label": "End",
      "scale": "log"
    },
    {
      "node": "drum",
      "param": "arate",
      "label": "Len",
      "scale": "log"
    },
    {
      "node": "drum",
      "param": "noise",
      "label": "Nse"
    },
    {
      "node": "drum",
      "param": "boost",
      "label": "Bst"
    }
  ],
  "commands": [
    {
      "id": 1,
      "node": "drum",
      "param": "startPitch",
      "scale": "log"
    },
    {
      "id": 2,
      "node": "drum",
      "param": "endPitch",
      "scale": "log"
    },
    {
      "id": 3,
      "node": "drum",
      "param": "prate",
      "scale": "log"
    },
    {
      "id": 4,
      "node": "drum",
      "param": "arate",
      "scale": "log"
    },
    {
      "id": 5,
      "node": "drum",
      "param": "noise"
    },
    {
      "id": 6,
      "node": "drum",
      "param": "nrate",
      "scale": "log"
    },
    {
      "id": 7,
      "node": "drum",
      "param": "click"
    },
    {
      "id": 8,
      "node": "drum",
      "param": "clickLen",
      "scale": "log"
    },
    {
      "id": 9,
      "node": "drum",
      "param": "pitchMul",
      "scale": "log"
    },
    {
      "id": 10,
      "node": "drum",
      "param": "drive"
    },
    {
      "id": 11,
      "node": "drum",
      "param": "boost"
    },
    {
      "id": 12,
      "node": "drum",
      "param": "boostFreq",
      "scale": "log"
    }
  ]
};
