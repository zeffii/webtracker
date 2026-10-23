// Starting points for the live picture's own shader (Config > Visual). Choosing one copies its text into the shader box, ready to edit.
// All use the picture's uniforms (see visual.js): R, T, BEAT, HITS, NL, C1, C2, LANE[16] = (hit, pitch, vel, held), and cell(lane, dx).
// They hold their colours to C1 and C2, and leave out the pattern skeleton, which only the built-in picture draws.
export const TEMPLATES = {
  rings: {
    label: 'Rings: one ring per lane',
    source: `// one ring for each lane, from the middle outwards: a hit makes its ring bright and thick, a held note keeps it thick
void main(){
  vec2 p = (gl_FragCoord.xy - .5 * R) / min(R.x, R.y);
  float r = length(p);
  vec3 col = mix(C1 * .35, C1 * .12, clamp(r * 1.6, 0., 1.));
  for (int i = 0; i < 16; i++) {
    if (float(i) >= NL) break;
    float f = float(i) / max(NL - 1., 1.);
    float rad = .07 + .4 * f + .012 * sin(T + f * 6.) + .03 * LANE[i].x;
    float w = .004 + .012 * LANE[i].x + .004 * LANE[i].w;
    float a = smoothstep(w, 0., abs(r - rad));
    col += mix(C1, C2, LANE[i].x) * a * (.3 + .7 * LANE[i].x);
  }
  gl_FragColor = vec4(col, 1.);
}`,
  },
  bars: {
    label: 'Bars: a column per lane',
    source: `// a column for each lane: height from the last hit and its velocity, a little more while the note is held, colour from the pitch
void main(){
  vec2 uv = gl_FragCoord.xy / R;
  float n = max(NL, 1.);
  float x = uv.x * n, id = floor(x), fx = fract(x);
  vec4 L = vec4(0.);
  for (int k = 0; k < 16; k++) if (float(k) == id) L = LANE[k];
  float top = .06 + .6 * L.x * (.4 + .6 * L.z) + .14 * L.w;
  vec3 col = mix(C1 * .3, C1 * .08, uv.y);
  float bar = step(uv.y, top) * step(.12, fx) * step(fx, .88);
  vec3 ink = mix(C1, C2, L.y);
  col = mix(col, ink * (.55 + .45 * uv.y / max(top, .01)), bar);
  col += C2 * .6 * step(abs(uv.y - top), .006) * step(.12, fx) * step(fx, .88);
  gl_FragColor = vec4(col, 1.);
}`,
  },
  tunnel: {
    label: 'Tunnel: flying forward with the beat',
    source: `// a tunnel that moves one ring per beat and pulses with every hit
void main(){
  vec2 p = (gl_FragCoord.xy - .5 * R) / min(R.x, R.y);
  float r = length(p) + 1e-3, a = atan(p.y, p.x);
  float z = .3 / r + BEAT * .5 - HITS * .15;
  float rings = smoothstep(.38, .5, abs(fract(z) - .5));
  float spokes = pow(abs(sin(a * 4. + z * .6)), 6.);
  vec3 col = mix(C1 * .25, C2, rings * .55 + spokes * .25);
  col *= smoothstep(0., .22, r) * (.7 + .5 * HITS);
  gl_FragColor = vec4(col, 1.);
}`,
  },
  roll: {
    label: 'Roll: the pattern as a piano roll',
    source: `// every lane a row of the pattern around the playhead: pitch is height, velocity is strength; what has played is dimmer
void main(){
  vec2 uv = gl_FragCoord.xy / R;
  uv.y = 1. - uv.y;
  float rows = max(NL, 1.);
  float row = floor(uv.y * rows), ry = fract(uv.y * rows);
  float cx = uv.x * WIN, dx = floor(cx) - BEHIND, fx = fract(cx);
  vec4 c = cell(row, dx);
  vec3 col = mix(C1 * .28, C1 * .1, uv.y) + C1 * .08 * step(.5, mod(row, 2.));
  float a = 0.;
  if (c.x > .5) {
    float py = 1. - clamp((c.y - .15) / .65, 0., 1.);
    a = step(abs(ry - py * .8 - .1), .12) * step(.08, fx) * step(fx, .92) * (.35 + .65 * c.z) * (dx < 0. ? .4 : 1.);
  }
  if (c.w > .5) a = max(a, step(abs(ry - .5), .05) * .4);
  col = mix(col, C2, a);
  col += C2 * .3 * smoothstep(.01, 0., abs(uv.x - BEHIND / WIN));
  gl_FragColor = vec4(col, 1.);
}`,
  },
  plasma: {
    label: 'Plasma: soft colour waves',
    source: `// slow overlapping waves in the two colours; the first lane's hit and all hits together push ripples through them
void main(){
  vec2 p = (gl_FragCoord.xy - .5 * R) / min(R.x, R.y) * 3.;
  float t = T * .4;
  float v = sin(p.x * 1.3 + t) + sin(p.y * 1.7 - t * 1.2) + sin((p.x + p.y) * 1.1 + t * .7) + sin(length(p) * 2. - t * 1.5);
  v += 1.6 * hit(0) * sin(length(p) * 5. - T * 7.) + 1.2 * HITS * sin(length(p) * 3. - T * 4.);
  float k = .5 + .5 * sin(v);
  gl_FragColor = vec4(mix(C1 * .4, C2, k) * (.65 + .35 * HITS), 1.);
}`,
  },
};
