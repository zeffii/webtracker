// Two more backdrops for the first screen, each drawn live in WebGL2 over the card (the blob is in blob.js):
//   reaction   Gray-Scott reaction diffusion. Two chemicals feed on and eat each other, so spots, worms and coral grow from a few
//              seeds and never repeat. A pointer drag seeds new growth.
//   plasma     domain-warped noise: smooth noise bent by more noise, twice over, so the colour flows like marbled ink.
// Both take the palette from splashpalette.js. Each returns the same small object the blob does, { point, excite, draw, lose },
// or null when the browser cannot draw it (see canSimulate).
const VERT = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }`;

const reduced = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Reaction diffusion keeps its chemicals in float textures, which WebGL2 can draw into only with an extension. Asking on a
// canvas of its own first means the card's canvas is still free for the blob when this browser cannot.
let simulateOk;
export function canSimulate() {
  if (simulateOk !== undefined) return simulateOk;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    simulateOk = !!gl && !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { simulateOk = false; }
  return simulateOk;
}

function build(gl, fragment) {
  const shader = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const program = gl.createProgram();
  gl.attachShader(program, shader(gl.VERTEX_SHADER, VERT)); gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragment));
  gl.bindAttribLocation(program, 0, 'p'); gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  const uniforms = {};
  for (let i = 0; i < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); i++) { const name = gl.getActiveUniform(program, i).name; uniforms[name] = gl.getUniformLocation(program, name); }
  return { program, u: uniforms };
}

// One triangle that covers the screen.
const fullScreen = gl => {
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
};

// Soft pictures, so no more than about 1000 pixels across.
function fitCanvas(canvas) {
  const k = Math.min(devicePixelRatio || 1, 1000 / Math.max(1, canvas.clientWidth));
  const w = Math.max(2, Math.round(canvas.clientWidth * k)), h = Math.max(2, Math.round(canvas.clientHeight * k));
  if (w !== canvas.width || h !== canvas.height) { canvas.width = w; canvas.height = h; }
}

const setColours = (gl, u, p) => { gl.uniform3fv(u.bg, p.bg); gl.uniform3fv(u.ink, p.ink); gl.uniform3fv(u.hi, p.hi); gl.uniform3fv(u.warm, p.warm); };
const lose = gl => () => gl.getExtension('WEBGL_lose_context')?.loseContext();

// ---- reaction diffusion ----
// The feed and kill rates of the patterns worth starting from.
// coral, worms, labyrinth: each fills the card within the warm-up (the slow ones, mitosis and spots, are still thin by then)
const REACTIONS = [[0.0545, 0.062], [0.078, 0.061], [0.029, 0.057]];
const W = 400, H = 248, STEPS = 8, WARM_UP = 900;

export function createReaction(canvas, palette, rand = Math.random) {
  if (!canSimulate()) return null;
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'low-power' });
  if (!gl) return null;
  gl.getExtension('EXT_color_buffer_float'); gl.getExtension('EXT_color_buffer_half_float');
  fullScreen(gl);
  const [feed, kill] = REACTIONS[Math.floor(rand() * REACTIONS.length)];
  const step = build(gl, `#version 300 es
    precision highp float; uniform sampler2D chem; uniform vec2 texel; uniform float feed, kill; uniform vec3 seed; out vec4 o;
    void main(){
      vec2 uv = gl_FragCoord.xy * texel;
      vec2 c = texture(chem, uv).xy;
      vec2 side = texture(chem, uv + vec2(texel.x, 0.)).xy + texture(chem, uv - vec2(texel.x, 0.)).xy + texture(chem, uv + vec2(0., texel.y)).xy + texture(chem, uv - vec2(0., texel.y)).xy;
      vec2 corner = texture(chem, uv + texel).xy + texture(chem, uv - texel).xy + texture(chem, uv + vec2(texel.x, -texel.y)).xy + texture(chem, uv + vec2(-texel.x, texel.y)).xy;
      vec2 lap = 0.2 * side + 0.05 * corner - c;
      float a = c.x, b = c.y, r = a * b * b;
      a += lap.x - r + feed * (1. - a);
      b += 0.5 * lap.y + r - (kill + feed) * b;
      if (seed.z > 0. && length((uv - seed.xy) * vec2(texel.y / texel.x, 1.)) < seed.z) b = 1.;
      o = vec4(clamp(a, 0., 1.), clamp(b, 0., 1.), 0., 1.);
    }`);
  const start = build(gl, `#version 300 es
    precision highp float; uniform vec2 texel; uniform float salt; out vec4 o;
    float h(vec2 p){ return fract(sin(dot(p + salt, vec2(127.1, 311.7))) * 43758.5453); }
    void main(){
      vec2 uv = gl_FragCoord.xy * texel; float b = 0.;
      for (int i = 0; i < 40; i++) { vec2 c = vec2(h(vec2(float(i), 1.)), h(vec2(float(i), 2.))); if (length((uv - c) * vec2(texel.y / texel.x, 1.)) < 0.035) b = 1.; }
      o = vec4(1., b, 0., 1.);
    }`);
  const show = build(gl, `#version 300 es
    precision highp float; uniform sampler2D chem; uniform vec2 texel, res; uniform vec3 bg, ink, hi, warm; out vec4 o;
    float h(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
    void main(){
      vec2 uv = gl_FragCoord.xy / res;
      float v = texture(chem, uv).y;
      float dx = texture(chem, uv + vec2(texel.x, 0.)).y - texture(chem, uv - vec2(texel.x, 0.)).y;
      float dy = texture(chem, uv + vec2(0., texel.y)).y - texture(chem, uv - vec2(0., texel.y)).y;
      vec3 n = normalize(vec3(-dx * 5., -dy * 5., 1.));
      float lit = clamp(dot(n, normalize(vec3(-.5, .6, .8))), 0., 1.);
      float m = smoothstep(.06, .42, v);
      vec3 col = mix(bg, ink, m);
      col += (hi - bg) * (lit - .78) * .9 * m;                       // a soft emboss on the ridges
      col = mix(col, warm, smoothstep(.34, .5, v) * .22);            // the thickest growth warms a little
      vec2 fc = gl_FragCoord.xy; col += (h(fc) + h(fc + 17.3) - 1.) * (2.2 / 255.);   // dither, against banding
      o = vec4(col, 1.);
    }`);
  // two float textures that take turns being read and written
  const make = () => {
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, W, H, 0, gl.RGBA, gl.HALF_FLOAT, null);
    for (const [name, value] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.REPEAT], [gl.TEXTURE_WRAP_T, gl.REPEAT]]) gl.texParameteri(gl.TEXTURE_2D, name, value);
    const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo };
  };
  const pair = [make(), make()];
  let now = 0, excited = false, px = 0.5, py = 0.5, time = 0, last = 0;
  const drawInto = fbo => { gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, W, H); gl.drawArrays(gl.TRIANGLES, 0, 3); };
  const advance = seed => {
    gl.useProgram(step.program);
    gl.uniform2f(step.u.texel, 1 / W, 1 / H); gl.uniform1f(step.u.feed, feed); gl.uniform1f(step.u.kill, kill); gl.uniform1i(step.u.chem, 0); gl.uniform3f(step.u.seed, ...seed);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, pair[now].tex);
    drawInto(pair[1 - now].fbo); now = 1 - now;
  };
  gl.useProgram(start.program); gl.uniform2f(start.u.texel, 1 / W, 1 / H); gl.uniform1f(start.u.salt, rand() * 100); drawInto(pair[0].fbo);
  for (let i = 0; i < WARM_UP; i++) advance([0, 0, -1]);   // it opens already grown
  const still = reduced();
  return {
    point(x, y) { px = (x + 1) / 2; py = (y + 1) / 2; },
    excite(on) { excited = on; },
    draw(t) {
      fitCanvas(canvas);
      const dt = last ? Math.min(0.1, (t - last) / 1000) : 0; last = t; time += dt;
      if (!still) for (let i = 0; i < STEPS; i++) {
        // while excited (the pointer is down, or the app is starting) the pointer seeds growth; now and then a seed drops in by itself
        const wander = i === 0 && Math.floor(time * 60) % 120 === 0;
        advance(excited ? [px, py, 0.03] : wander ? [0.5 + 0.42 * Math.sin(time * 0.31), 0.5 + 0.4 * Math.sin(time * 0.23 + 1.3), 0.02] : [0, 0, -1]);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(show.program); gl.uniform1i(show.u.chem, 0); gl.uniform2f(show.u.texel, 1 / W, 1 / H); gl.uniform2f(show.u.res, canvas.width, canvas.height);
      setColours(gl, show.u, palette);
      gl.bindTexture(gl.TEXTURE_2D, pair[now].tex); gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    lose: lose(gl),
  };
}

// ---- domain-warped plasma ----
export function createPlasma(canvas, palette, rand = Math.random) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'low-power' });
  if (!gl) return null;
  fullScreen(gl);
  const plasma = build(gl, `#version 300 es
    precision highp float; uniform vec2 res, look; uniform float t, warp; uniform vec3 bg, ink, hi, warm; out vec4 o;
    float h(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
    float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
      return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
    float fbm(vec2 p){ float a = .5, s = 0.; mat2 r = mat2(.8, -.6, .6, .8); for (int i = 0; i < 5; i++) { s += a * noise(p); p = r * p * 2.02 + 7.3; a *= .5; } return s; }
    void main(){
      vec2 p = (gl_FragCoord.xy - .5 * res) / res.y * 2.6 + look;
      vec2 q = vec2(fbm(p + vec2(0., t * .10)), fbm(p + vec2(5.2, 1.3) - t * .08));
      vec2 r = vec2(fbm(p + warp * q + vec2(1.7, 9.2) + t * .13), fbm(p + warp * q + vec2(8.3, 2.8) - t * .11));
      float f = fbm(p + warp * 1.3 * r);
      vec3 col = mix(bg, ink, smoothstep(.15, .75, f));
      col = mix(col, hi, smoothstep(.45, .95, length(q)) * .55);
      col = mix(col, warm, smoothstep(.55, 1.0, r.x * r.y * 2.2) * .38);
      col *= .85 + .3 * f * f;
      vec2 fc = gl_FragCoord.xy; col += (h(fc) + h(fc + 17.3) - 1.) * (2.2 / 255.);   // dither, against banding
      o = vec4(col, 1.);
    }`);
  const still = reduced();
  let time = rand() * 40, last = 0, boost = 0, boostTo = 0, tx = 0, ty = 0, lx = 0, ly = 0;
  return {
    point(x, y) { tx = x; ty = y; },
    excite(on) { boostTo = on ? 1 : 0; },
    draw(t) {
      fitCanvas(canvas);
      const dt = last ? Math.min(0.1, (t - last) / 1000) : 0; last = t;
      boost += (boostTo - boost) * 0.04; lx += (tx - lx) * 0.03; ly += (ty - ly) * 0.03;
      if (!still) time += dt * (1.6 + 2.4 * boost);
      gl.viewport(0, 0, canvas.width, canvas.height); gl.useProgram(plasma.program);
      gl.uniform2f(plasma.u.res, canvas.width, canvas.height); gl.uniform2f(plasma.u.look, lx * 0.4, ly * 0.25);
      gl.uniform1f(plasma.u.t, time); gl.uniform1f(plasma.u.warp, 1.4 + 0.6 * boost);
      setColours(gl, plasma.u, palette);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    lose: lose(gl),
  };
}
