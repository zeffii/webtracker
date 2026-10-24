#!/usr/bin/env node
// An MCP server (stdio) that lets Claude, or any MCP client, work on Wax songs: check a .wax file, see its structure,
// render it to a sound file with the same engine the page uses, and measure the result. No browser, no sound card.
//   claude mcp add wax -- node /path/to/webtracker/tools/wax-mcp/server.mjs
import { writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { basename, dirname, join } from 'node:path';
import { loadProject, render, analyse, outline, validate, reference, encodeWav } from './core.mjs';

const list = { type: 'array', items: { type: 'string' } };
const TOOLS = [
  { name: 'wax_validate', description: 'Check a .wax file: it loads, every instrument compiles, every pattern row parses, and the placements fit the song. Returns the problems (the file will not play) and the warnings (it will, but check).',
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'path of the .wax file' } }, required: ['path'] },
    run: ({ path }) => validate(path) },
  { name: 'wax_outline', description: 'The song as written, without rendering: its length, tempo, and for every lane its instrument, patterns, placements and how many notes it plays in each window of ticks. Good for seeing what plays when, and what could be carved away.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, window: { type: 'number', description: 'window in ticks (default 64, four bars at 16 ticks a bar)' } }, required: ['path'] },
    run: ({ path, window }) => outline(loadProject(path), { window: window ?? 64 }) },
  { name: 'wax_analyse', description: 'Render the song offline and measure it: peak, integrated loudness (LUFS), clipping, DC offset, and for every window of seconds the level, centroid, band balance (sub/low/lowmid/mid/high/air as a percent), stereo correlation and note-onset rate. Use solo or mute (lane ids) to hear one lane or all but one. Takes about half the song\'s length to render.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, window: { type: 'number', description: 'seconds per section (default 8)' }, solo: list, mute: list, tail: { type: 'number', description: 'seconds of tail after the last row (default 6)' }, maxSeconds: { type: 'number', description: 'render only the first N seconds' } }, required: ['path'] },
    run: async ({ path, window, solo, mute, tail, maxSeconds }) => analyse(await render(loadProject(path), { tail: tail ?? 6, solo: solo ?? [], mute: mute ?? [], maxSeconds }), { window: window ?? 8 }) },
  { name: 'wax_render', description: 'Render the song offline to a WAV file (the same engine as the Export button) and return its measurements. Writes next to the project unless out is given.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, out: { type: 'string', description: 'where to write the WAV' }, bits: { type: 'number', enum: [16, 24, 32], description: 'default 24; 32 is floating point and never clips' }, solo: list, mute: list, tail: { type: 'number' }, maxSeconds: { type: 'number' } }, required: ['path'] },
    run: async ({ path, out, bits, solo, mute, tail, maxSeconds }) => {
      const audio = await render(loadProject(path), { tail: tail ?? 6, solo: solo ?? [], mute: mute ?? [], maxSeconds });
      const file = out ?? join(dirname(path), `${basename(path).replace(/\.wax$/i, '')}${solo?.length ? `.${solo.join('+')}` : ''}.wav`);
      writeFileSync(file, Buffer.from(encodeWav(audio, bits ?? 24)));
      return { wrote: file, ...analyse(audio, { window: 30 }).whole };
    } },
  { name: 'wax_nodes', description: 'The nodes the machine offers. With no query: every node type with its category, ports and how many parameters it has. With a query (part of a node name or a category such as Delay or Sources): the matching nodes with every parameter, its range and default.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    run: ({ query }) => reference(query ?? '') },
];

const send = msg => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);
const text = value => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 1) }] });

createInterface({ input: process.stdin }).on('line', async line => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (id === undefined) return;   // a notification: nothing to answer
  try {
    if (method === 'initialize') send({ id, result: { protocolVersion: params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'wax', version: '1.0.0' } } });
    else if (method === 'ping') send({ id, result: {} });
    else if (method === 'tools/list') send({ id, result: { tools: TOOLS.map(({ run, ...t }) => t) } });
    else if (method === 'tools/call') {
      const tool = TOOLS.find(t => t.name === params?.name);
      if (!tool) { send({ id, error: { code: -32602, message: `unknown tool ${params?.name}` } }); return; }
      try { send({ id, result: text(await tool.run(params.arguments ?? {})) }); } catch (e) { send({ id, result: { ...text(`${e.message}`), isError: true } }); }
    } else send({ id, error: { code: -32601, message: `unknown method ${method}` } });
  } catch (e) { send({ id, error: { code: -32603, message: e.message } }); }
});
