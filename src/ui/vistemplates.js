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
  rollall: {
    label: 'Roll, all lanes: one piano roll, every lane its own colour',
    source: `// one piano roll for the whole song: time runs left to right with the playhead at the bright line (what has played is dimmer), pitch runs
// up, and every lane has its own colour, so notes of different lanes can overlap and still be told apart (where they overlap it glows).
// A note lasts until the next note or note off of its lane, at most "note length" ticks, which keeps a drum hit short.
vec3 laneCol(float i){ float h = fract(.08 + i * .382); vec3 k = clamp(abs(mod(h * 6. + vec3(0., 4., 2.), 6.) - 3.) - 1., 0., 1.); return mix(vec3(1.), k, .65); }
// the note lane i is sounding at tick d: (pitch 0..1, velocity, ticks since it started), or pitch -1 for none
vec3 noteAt(float lane, float d, float cap){
  for (int k = 0; k < 16; k++) {
    if (float(k) >= cap) break;
    vec4 c = cell(lane, d - float(k));
    if (c.x > .5) return vec3(c.y, c.z, float(k));
    if (c.w > .5) break;
  }
  return vec3(-1., 0., 0.);
}
void main(){
  vec2 uv = gl_FragCoord.xy / R;
  float cap = kn("note length", 5., 1., 16.);
  float span = kn("octaves", 4., 1., 8.) * 12.;
  float mid = kn("centre", .47, 0., 1.) * 127.;
  float sy = (uv.y - .5) * span + mid;            // the pitch of this pixel, in semitones
  float r = floor(sy + .5), fy = fract(sy + .5);
  float pc = mod(r, 12.);
  float black = (pc == 1. || pc == 3. || pc == 6. || pc == 8. || pc == 10.) ? 1. : 0.;
  float cx = uv.x * WIN, dx = floor(cx) - BEHIND, fx = fract(cx);
  vec3 col = C1 * (.16 - .07 * black);
  col += C1 * .22 * step(pc, .5) * step(fy, .08);   // a line along every C
  col += C1 * .07 * step(mod(dx, 4.), .5) * step(fx, .06);   // and one at every fourth tick
  float cover = 0.;
  for (int i = 0; i < 16; i++) {
    if (float(i) >= NL) break;
    vec3 n = noteAt(float(i), dx, cap);
    if (n.x < 0. || floor(n.x * 127. + .5) != r) continue;
    float body = step(.1, fy) * step(fy, .9) * (n.z < .5 ? step(.1, fx) : 1.);
    if (body < .5) continue;
    vec3 lc = laneCol(float(i)) * (.55 + .45 * n.y) * (dx < 0. ? .45 : 1.);
    lc += vec3(.35) * step(n.z, .5) * step(abs(dx), .5) * (1. - fx);   // a flash as the note starts at the playhead
    col = mix(col, lc, .9);
    cover += 1.;
  }
  col += .08 * max(cover - 1., 0.);
  col += C2 * .4 * smoothstep(.004, 0., abs(uv.x - BEHIND / WIN));
  gl_FragColor = vec4(col, 1.);
}`,
  },
  rollstack: {
    label: 'Roll, stacked: the lanes as sheets in space (isometric)',
    source: `// every lane is its own piano roll, drawn as a sheet; the sheets stand one behind the other in space (the first lane at the back and the
// top), so notes that sound together in several lanes are all visible. The "angle" knob turns the view: 30 is an isometric one, 90 stacks
// the sheets straight up. A note is a slab with a darker side; the line across each sheet is the playhead, and a sheet lights up when its
// lane plays. Each lane has its own colour. Each sheet is found by turning the pixel back into the sheet's own time and pitch.
vec3 laneCol(float i){ float h = fract(.08 + i * .382); vec3 k = clamp(abs(mod(h * 6. + vec3(0., 4., 2.), 6.) - 3.) - 1., 0., 1.); return mix(vec3(1.), k, .65); }
vec3 noteAt(float lane, float d, float cap){
  for (int k = 0; k < 16; k++) {
    if (float(k) >= cap) break;
    vec4 c = cell(lane, d - float(k));
    if (c.x > .5) return vec3(c.y, c.z, float(k));
    if (c.w > .5) break;
  }
  return vec3(-1., 0., 0.);
}
// 1 when lane i has a note on this pixel: dx the tick, fx the place across it, sy the pitch in semitones; v is (velocity, ticks since it started)
float bar(float i, float dx, float fx, float sy, float cap, out vec2 v){
  vec3 n = noteAt(i, dx, cap);
  v = n.yz;
  float r = floor(sy + .5), fy = fract(sy + .5);
  if (n.x < 0. || floor(n.x * 127. + .5) != r) return 0.;
  return step(.08, fy) * step(fy, .92) * (n.z < .5 ? step(.1, fx) : 1.);
}
void main(){
  vec2 p = (gl_FragCoord.xy - .5 * R) / R.y;
  float cap = kn("note length", 5., 1., 16.);
  float span = kn("octaves", 3., 1., 6.) * 12.;
  float mid = kn("centre", .47, 0., 1.) * 127.;
  float ang = radians(kn("angle", 70., 25., 90.));  // the direction the sheets recede in: 30 is a true isometric view, 90 stacks them straight up
  float n = max(NL, 1.);
  float s = min(.75 / n * kn("spread", 1., .5, 1.8), .14);   // the step from one sheet to the next
  vec2 ez = vec2(cos(ang), sin(ang)) * s;
  float ux = (.92 - cos(ang) * s * (n - 1.)) / WIN;          // the width of a tick, so the whole stack fits
  float uy = ux * .3;                                        // the time axis runs a little downhill
  float H = min(s * 3.2, .22);                               // the height of a sheet (they overlap a little, and the sheets are see-through)
  vec3 col = mix(C1 * .22, C1 * .05, gl_FragCoord.y / R.y);
  for (int i = 0; i < 16; i++) {
    if (float(i) >= n) break;
    vec4 L = LANE[i];
    float zi = (n - 1. - float(i)) - (n - 1.) * .5;          // the first lane is the farthest and highest
    float tc = (p.x - zi * ez.x) / ux;                       // ticks from the middle of the window
    float dxf = tc + BEHIND;                                 // ticks from the playhead
    float q = (p.y - zi * ez.y + tc * uy) / H + .5;          // 0 to 1 up the sheet
    if (dxf < -BEHIND || dxf >= WIN - BEHIND || q < 0. || q > 1.) continue;
    float dx = floor(dxf), fx = fract(dxf);
    float sy = (q - .5) * span + mid;
    vec3 lc = laneCol(float(i));
    float pc = mod(floor(sy + .5), 12.);
    float black = (pc == 1. || pc == 3. || pc == 6. || pc == 8. || pc == 10.) ? 1. : 0.;
    vec3 sheet = lc * (.14 - .05 * black + .25 * L.x);
    sheet += lc * .10 * step(pc, .5) * step(fract(sy + .5), .1);
    sheet += lc * .06 * step(mod(dx, 4.), .5) * step(fx, .08);
    col = mix(col, sheet, .5);
    vec2 v, v2;
    float top = bar(float(i), dx, fx, sy, cap, v);
    float side = bar(float(i), dx, fx, sy + .9, cap, v2);   // the same note seen a little higher: the slab's side
    float dim = dx < 0. ? .5 : 1.;
    if (top > .5) col = lc * (.65 + .5 * v.x) * dim + vec3(.4) * step(v.y, .5) * step(abs(dx), .5);
    else if (side > .5) col = lc * .28 * dim;
    float edge = min(min(dxf + BEHIND, WIN - BEHIND - dxf), min(q, 1. - q) * 12.);
    col += lc * .45 * step(edge, .12);                       // the sheet's rim
    col += C2 * .5 * step(abs(dxf), .09);                    // the playhead
  }
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
  leds: {
    label: 'LEDs: a lamp matrix of the pattern',
    source: `// a grid of round lamps: a row for each lane, a column for each tick of the pattern around the playhead (the lit column is now)
void main(){
  vec2 uv = gl_FragCoord.xy / R;
  uv.y = 1. - uv.y;
  float rows = max(NL, 1.);
  vec2 g = vec2(uv.x * WIN, uv.y * rows);
  vec2 id = floor(g), f = fract(g) - .5;
  float dx = id.x - BEHIND;
  vec4 c = cell(id.y, dx);
  float on = c.x + .5 * c.w;
  vec2 cs = vec2(R.x / WIN, R.y / rows);
  float d = length(f * cs) / min(cs.x, cs.y);
  float lamp = smoothstep(.42, .32, d);
  vec3 col = C1 * .1;
  col += mix(C1 * .35, C2, clamp(on * (.4 + .6 * c.z), 0., 1.)) * lamp * (dx < 0. ? .5 : 1.);
  col += C2 * .25 * step(abs(dx), .5) * lamp;
  gl_FragColor = vec4(col, 1.);
}`,
  },
  kaleido: {
    label: 'Kaleidoscope: mirrored shards',
    source: `// the plane folded into eight mirrored wedges; hits spin it and open the shapes
void main(){
  vec2 p = (gl_FragCoord.xy - .5 * R) / min(R.x, R.y) * 2.;
  float a = atan(p.y, p.x), r = length(p);
  float seg = 3.14159265 / 4.;
  a = abs(mod(a + BEAT * .08, 2. * seg) - seg);
  p = r * vec2(cos(a), sin(a));
  float v = sin(p.x * 6. + T * .6 + hit(0) * 4.) * sin(p.y * 6. - T * .5) + sin(r * 8. - T * 1.2 - HITS * 5.);
  float k = smoothstep(-.2, .8, v);
  vec3 col = mix(C1 * .3, C2, k) * (1. - .45 * r);
  col += C2 * .3 * HITS * smoothstep(.5, 0., r);
  gl_FragColor = vec4(col, 1.);
}`,
  },
  stars: {
    label: 'Stars: a starfield that speeds up',
    source: `// stars flying out of the middle; the more is playing, the faster they fly
float rnd(vec2 p){return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);}
void main(){
  vec2 p = (gl_FragCoord.xy - .5 * R) / min(R.x, R.y);
  float r = length(p) + 1e-3, a = atan(p.y, p.x);
  vec3 col = C1 * .12;
  float speed = T * .25 + BEAT * .02 + HITS * .05;
  for (int layer = 0; layer < 3; layer++) {
    float l = float(layer);
    float cells = 30. + l * 22.;
    float z = fract(speed * (.5 + l * .4) + l * .37);
    float rr = r / (.15 + z * 1.6);
    float aa = a / 6.2831853 * cells;
    float id = floor(aa), fa = fract(aa) - .5;
    float h = rnd(vec2(id, l + floor(rr * 3.)));
    float star = step(.82, h) * smoothstep(.5, 0., abs(fa) * r * cells * .3) * smoothstep(.0, .12, z) * (1. - z);
    col += mix(C1, C2, h) * star * (.8 + HITS);
  }
  gl_FragColor = vec4(col, 1.);
}`,
  },
  lava: {
    label: 'Lava: soft blobs, one per lane',
    source: `// a flat lava lamp: each lane is a soft blob; a hit swells it, the pitch of its last note moves it up or down
void main(){
  vec2 p = (gl_FragCoord.xy - .5 * R) / min(R.x, R.y);
  float field = 0.;
  for (int i = 0; i < 16; i++) {
    if (float(i) >= NL) break;
    float f = float(i) + 1.;
    vec2 c = vec2(.34 * sin(T * .21 * f + f * 1.7), .3 * sin(T * .17 * f + f * 2.3) + .2 * (LANE[i].y - .5));
    float r = .06 + .05 * LANE[i].x + .02 * LANE[i].w;
    field += r * r / (dot(p - c, p - c) + .002);
  }
  float edge = smoothstep(.9, 1.1, field);
  vec3 col = mix(C1 * .25, C1 * .12, gl_FragCoord.y / R.y);
  col = mix(col, mix(C1, C2, clamp(field * .35, 0., 1.)), edge);
  col += C2 * .35 * smoothstep(.8, .9, field) * (1. - edge);
  gl_FragColor = vec4(col, 1.);
}`,
  },
  flock: {
    label: 'Flock: birds that follow a leader',
    source: `// a flock without any stored state: every bird follows the leader's path a little later than the one before (cohesion), faces where
// the path is going (alignment) and sways to the side on its own beat (separation). Each lane brings three birds; a hit flings its
// birds outwards and lights them, a held note keeps them bright. (A true boids flock needs each bird's position kept from one frame
// to the next, which a picture shader cannot do; this is the closed-form version of the same look.)
vec2 path(float t){
  return vec2(.30 * sin(t * .37 + 1.7 * sin(t * .11)), .24 * sin(t * .29 + 2. * sin(t * .13)));
}
void main(){
  vec2 p = (gl_FragCoord.xy - .5 * R) / min(R.x, R.y);
  vec3 col = mix(C1 * .3, C1 * .1, clamp(length(p) * 1.3, 0., 1.));
  for (int l = 0; l < 16; l++) {
    if (float(l) >= NL) break;
    vec4 L = LANE[l];
    for (int j = 0; j < 3; j++) {
      float f = float(l * 3 + j);
      float tt = T * 1.1 - f * .16;
      vec2 pos = path(tt);
      vec2 h = normalize(path(tt + .05) - pos + 1e-5);
      vec2 n = vec2(-h.y, h.x);
      pos += n * sin(f * 5.1 + T * .6) * .1 + h * sin(f * 3.7 + T * .45) * .05;
      pos += vec2(cos(f * 2.4), sin(f * 2.4)) * .09 * L.x;
      vec2 q = p - pos;
      float x = dot(q, h), y = dot(q, n);
      float body = smoothstep(1., .55, length(vec2(x / .03, y / .011)));
      float tail = step(x, 0.) * exp(x * 22.) * smoothstep(.005, 0., abs(y)) * .4;
      col += mix(C1, C2, .35 + .65 * L.x) * (body + tail) * (.55 + .5 * L.x + .25 * L.w);
    }
  }
  gl_FragColor = vec4(col, 1.);
}`,
  },
  cells: {
    label: 'Cells: a Voronoi mosaic, a lane in every cell',
    source: `// Voronoi cells drifting about: every cell belongs to one lane (by its hash). A hit lights that lane's cells, the pitch picks the colour,
// a held note keeps them warm, and the walls between the cells flash with the beat.
vec2 h2(vec2 p){
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}
void main(){
  vec2 p = (gl_FragCoord.xy - .5 * R) / min(R.x, R.y) * 7.;
  vec2 g = floor(p), f = fract(p);
  float d1 = 9.;
  vec2 id = vec2(0.), mr = vec2(0.);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 q = o + .5 + .4 * sin(T * .5 + 6.283 * h2(g + o)) - f;
      float d = dot(q, q);
      if (d < d1) { d1 = d; id = g + o; mr = q; }
    }
  }
  // the exact distance to the nearest wall: a second look at the neighbours, to the line half way to each of them
  float wall = 9.;
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 q = o + .5 + .4 * sin(T * .5 + 6.283 * h2(g + o)) - f;
      if (dot(q - mr, q - mr) > .00001) wall = min(wall, dot(.5 * (mr + q), normalize(q - mr)));
    }
  }
  vec2 hh = h2(id);
  float lane = floor(hh.x * max(NL, 1.));
  vec4 L = vec4(0.);
  for (int k = 0; k < 16; k++) if (float(k) == lane) L = LANE[k];
  float pulse = 1. - fract(BEAT);
  vec3 col = mix(C1 * .10, C1 * .26, hh.y);
  col = mix(col, mix(C1, C2, L.y) * (.45 + .55 * L.z), clamp(L.x + .45 * L.w, 0., 1.) * (.55 + .45 * hh.y));
  col += C2 * smoothstep(.05 + .03 * pulse, 0., wall) * (.35 + .5 * pulse + .5 * L.x);
  col *= 1. - .35 * dot(p / 7., p / 7.);
  gl_FragColor = vec4(col, 1.);
}`,
  },
  ripples: {
    label: 'Ripples: a pond, a spot for each lane',
    source: `// every lane has a spot on a ring; a hit sends a ripple out from it, and the ripple fades as it spreads (hit() falls from 1 to 0 after a note)
void main(){
  vec2 p = (gl_FragCoord.xy - .5 * R) / min(R.x, R.y);
  vec3 col = mix(C1 * .24, C1 * .07, clamp(length(p) * 1.5, 0., 1.));
  for (int i = 0; i < 16; i++) {
    if (float(i) >= NL) break;
    float a = 6.2832 * float(i) / max(NL, 1.) + T * .04;
    vec2 c = .24 * vec2(cos(a), sin(a)) * step(1.5, NL);
    float hit = LANE[i].x;
    float age = 1. - hit;                       // 0 at the hit, towards 1 as it fades
    float d = length(p - c);
    float r1 = age * .55, r2 = age * .32;       // two rings, the second one behind the first
    float w = .008 + .02 * age;
    float ring = smoothstep(w, 0., abs(d - r1)) + .5 * smoothstep(w, 0., abs(d - r2));
    vec3 tint = mix(C1, C2, LANE[i].y);
    col += tint * ring * hit * (.4 + .6 * LANE[i].z);
    col += C2 * exp(-d * 45.) * (.12 + .5 * hit + .3 * LANE[i].w);   // the spot itself
  }
  gl_FragColor = vec4(col, 1.);
}`,
  },
  marble: {
    label: 'Marble: ink swirling in water',
    source: `// noise bent by noise, twice (a domain warp): slow marbled swirls in the two colours. Every hit stirs it harder
float h(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float n(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3. - 2. * f);
  return mix(mix(h(i), h(i + vec2(1., 0.)), f.x), mix(h(i + vec2(0., 1.)), h(i + vec2(1., 1.)), f.x), f.y);
}
float fbm(vec2 p){
  float s = 0., a = .5;
  for (int i = 0; i < 4; i++) { s += a * n(p); p = p * 2.03 + vec2(1.7, 9.2); a *= .5; }
  return s;
}
void main(){
  vec2 p = (gl_FragCoord.xy - .5 * R) / min(R.x, R.y) * 3.;
  float t = T * .08 + BEAT * .03;
  vec2 q = vec2(fbm(p + t), fbm(p + vec2(5.2, 1.3) - t));
  float f = fbm(p + (2. + 3. * HITS) * q + t);
  vec3 col = mix(C1 * .2, C2, smoothstep(.2, .85, f));
  col = mix(col, C1, clamp(dot(q, q) * 1.3, 0., 1.) * .45);
  col += C2 * .18 * pow(f, 5.);
  gl_FragColor = vec4(col, 1.);
}`,
  },
  truchet: {
    label: 'Truchet: a maze of arcs that scrolls with the beat',
    source: `// tiles with two quarter-circle arcs, each tile flipped by chance, so the arcs join into winding paths. A row of tiles belongs to a lane:
// its hit lights the path and thickens it. The pattern drifts one tile every four beats.
float h(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main(){
  vec2 p = (gl_FragCoord.xy - .5 * R) / min(R.x, R.y) * 6. + vec2(BEAT * .25, T * .03);
  vec2 id = floor(p), f = fract(p);
  if (h(id) > .5) f.x = 1. - f.x;               // flip half of the tiles
  float d = min(abs(length(f) - .5), abs(length(f - 1.) - .5));   // distance to the nearest arc
  float lane = mod(id.y, max(NL, 1.));
  vec4 L = vec4(0.);
  for (int k = 0; k < 16; k++) if (float(k) == lane) L = LANE[k];
  float w = .06 + .09 * L.x + .02 * L.w;
  float line = smoothstep(w, w - .035, d);
  vec3 col = C1 * .10 + C1 * .05 * h(id + 7.);
  col += mix(C1, C2, L.y) * line * (.5 + .5 * L.x + .3 * L.w);
  col += C2 * smoothstep(.12, 0., d) * L.x * .5;   // a bright core while it plays
  gl_FragColor = vec4(col, 1.);
}`,
  },
  sunburst: {
    label: 'Sunburst: a ray for each lane',
    source: `// the circle is cut into one wedge per lane; each wedge has a ray whose length follows the last hit and its velocity, with a dot at the end
// that rides on the pitch. The whole thing turns slowly with the beat.
void main(){
  vec2 p = (gl_FragCoord.xy - .5 * R) / min(R.x, R.y);
  float r = length(p);
  float a = atan(p.y, p.x) / 6.2832 + .5 + BEAT * .01;
  float n = max(NL, 1.);
  float x = fract(a) * n, id = floor(x), fx = fract(x);
  vec4 L = vec4(0.);
  for (int k = 0; k < 16; k++) if (float(k) == id) L = LANE[k];
  float len = .10 + .30 * L.x * (.4 + .6 * L.z) + .06 * L.w;
  float edge = smoothstep(0., .1, fx) * smoothstep(0., .1, 1. - fx);       // a gap between the wedges
  float ray = step(.07, r) * smoothstep(len, len - .02, r) * edge;
  vec3 tint = mix(C1, C2, L.y);
  vec3 col = C1 * .10 * (1. - r);
  col += tint * ray * (.35 + .65 * (r - .07) / max(len - .07, .01)) * (.5 + .5 * L.x + .4 * L.w);
  float dotR = .10 + .30 * L.y + .02;                                       // the pitch dot sits further out for a higher note
  col += C2 * smoothstep(.025, .0, length(vec2(r - dotR, (fx - .5) * r * 6.2832 / n))) * (.3 + .7 * L.x);
  col += C2 * smoothstep(.006, 0., abs(r - .06)) * (.2 + .8 * HITS);        // the hub
  gl_FragColor = vec4(col, 1.);
}`,
  },
  moire: {
    label: 'Moire: two sets of rings that beat against each other',
    source: `// two sets of circles around two centres drift past each other; where they meet the bands flicker (the moire pattern).
// The first two lanes push the centres when they hit, and the ring spacing changes slowly with the beat.
void main(){
  vec2 p = (gl_FragCoord.xy - .5 * R) / min(R.x, R.y);
  vec2 a = .2 * vec2(cos(T * .31), sin(T * .23)) + vec2(.06 * LANE[0].x, 0.);
  vec2 b = -a + vec2(0., .06 * LANE[1].x);
  float k = 70. + 30. * sin(BEAT * .12);
  float s = .25 * (sin(length(p - a) * k) + sin(length(p - b) * k)) + .5;   // 0 to 1
  vec3 col = mix(C1 * .12, C2, smoothstep(.45, .95, s));
  col += C1 * .25 * smoothstep(.3, 0., abs(s - .35));
  col *= 1. - .5 * dot(p, p);
  col += C2 * .12 * HITS;
  gl_FragColor = vec4(col, 1.);
}`,
  },
  lissajous: {
    label: 'Lissajous: a looping curve drawn by the pitch',
    source: `// a glowing Lissajous curve: x and y swing at two different rates. The pitch of the first lane sets one rate and the second lane's the other,
// so the curve changes shape when the notes do. Hits make the line thicker and the glow wider.
void main(){
  vec2 p = (gl_FragCoord.xy - .5 * R) / min(R.x, R.y);
  float fa = 2. + floor(LANE[0].y * 4. + .5);
  float fb = 3. + floor(LANE[1].y * 4. + .5);
  float ph = T * .3 + BEAT * .05;
  float d = 9.;
  vec2 prev = vec2(.38 * sin(ph), 0.);
  for (int i = 1; i <= 96; i++) {
    float t = 6.2832 * float(i) / 96.;
    vec2 cur = .38 * vec2(sin(fa * t + ph), sin(fb * t));
    vec2 e = cur - prev, w = p - prev;
    float s = clamp(dot(w, e) / max(dot(e, e), 1e-6), 0., 1.);
    d = min(d, length(w - e * s));              // distance to this piece of the curve
    prev = cur;
  }
  float th = .004 + .008 * HITS;
  vec3 col = C1 * .08;
  col += mix(C1, C2, .5) * smoothstep(th * 2., th, d);
  col += C2 * exp(-d * (45. - 20. * HITS)) * .45;
  gl_FragColor = vec4(col, 1.);
}`,
  },
  waves: {
    label: 'Waves: a wobbling line for each lane',
    source: `// one line for each lane, stacked from bottom to top. A hit makes its line swing wide, the pitch of the last note sets how fast it wobbles,
// and a held note keeps a little of the swing. The ends are pinned down.
void main(){
  vec2 uv = gl_FragCoord.xy / R;
  float n = max(NL, 1.);
  vec3 col = mix(C1 * .14, C1 * .05, uv.y);
  for (int i = 0; i < 16; i++) {
    if (float(i) >= n) break;
    float yc = (float(i) + .5) / n;
    float amp = (.012 + .45 / n * (LANE[i].x * (.4 + .6 * LANE[i].z) + .25 * LANE[i].w)) * sin(uv.x * 3.1416);
    float y = yc + amp * sin(uv.x * (8. + 36. * LANE[i].y) + T * 3. + float(i) * 1.7);
    float d = abs(uv.y - y);
    vec3 tint = mix(C1, C2, LANE[i].y);
    col += tint * (smoothstep(.006, 0., d) + .3 * exp(-d * 70.)) * (.35 + .65 * LANE[i].x + .3 * LANE[i].w);
  }
  gl_FragColor = vec4(col, 1.);
}`,
  },
};
