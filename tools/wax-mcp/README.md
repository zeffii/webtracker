# Wax tools for Claude (MCP)

A small MCP server that lets Claude (or any MCP client) work on `.wax` songs: validate, outline, render to a sound file and
measure. It runs the same engine and offline renderer as the page's Export button, in Node, so it needs no browser and no
sound card, and no packages beyond the project's own. Rendering takes about half the song's length.

Add it to Claude Code (from the project folder, where `.mcp.json` already names it):

    claude mcp add wax -- node tools/wax-mcp/server.mjs

| tool | what it does |
| --- | --- |
| `wax_validate` | loads the file, compiles every instrument, parses every row; lists problems and warnings |
| `wax_outline` | the song as written: lanes, patterns, placements, notes per window of ticks |
| `wax_analyse` | renders and measures: peak, LUFS, clipping, per-section level, band balance, onsets, stereo correlation; `solo` / `mute` lanes |
| `wax_render` | renders to a WAV (16, 24 or 32 bit) and returns the measurements |
| `wax_nodes` | every node, or the matching ones with each parameter's range and default |

The skill in `.claude/skills/wax/SKILL.md` teaches the file format and the working loop.
