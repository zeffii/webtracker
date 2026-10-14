// What a port carries. Ports are audio unless the node type lists them in `kinds`.
// 'audio' and 'control' are mono buffers (control is for envelopes, lfos and triggers);
// 'stereo' is a left/right pair that travels on one wire.
export const portKind = (def, name) => def.kinds?.[name] ?? 'audio';
