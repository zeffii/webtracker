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
};
