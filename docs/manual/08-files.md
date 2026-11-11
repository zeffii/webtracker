# 8. Files

| extension | what it is |
|---|---|
| `.wax` | The project: plain JSON. Song, instruments as graphs, samples, lanes and patterns. Small until samples go in. |
| `.waxi` | One instrument. |
| `.wxpr` | A preset library. |
| `.mid` | A MIDI file, imported as lanes and patterns. |
| `.mod` | A ProTracker module. The order list is played out, tempo changes go to the master lane, each channel becomes a lane on a MOD channel machine, and the samples come along. |
| `.wav` | What **Export WAV** writes: the song rendered once, offline, with a tail, as 16-bit, 24-bit or 32-bit float stereo. |

## Where things live

The project is the file. Settings (theme, view sizes, shortcuts panels) live in the browser's local storage; **Config** (F11) can export and import them as a JSON file, or reset them. Nothing is sent anywhere.

## Backups

Wax keeps rolling snapshots of the project in the browser and can also write them to a folder you choose (Chrome and Brave; the permission is asked again after a restart). Brave keeps the folder picker off by default: enable `brave://flags/#file-system-access-api` and relaunch. In Config, **Download a backup file** hands you the project once per change.

## The player

`player.html` lists songs as a page of square artwork, each playable with the real engine and no tracker around it. It is a way to share finished songs with people who do not want a tracker.
