// The first screen's backdrop: a few metaballs drifting, merging and pinching apart, shaded as a translucent, skin-like body (light shows
// through where it is thin, the thick middle stays deeper). One WebGL fragment shader, drawn at reduced size since the look is soft.
// createBlob(canvas) returns null when WebGL is not available, so the caller can fall back to the logo.
const VS = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
const FS = `precision highp float;uniform vec2 R,M;uniform float T,B;uniform vec3 C1,C2;
float h(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}   // no sin(): its hash shows diagonal patterns on some GPUs
float smin(float a,float b,float k){float x=max(k-abs(a-b),0.)/k;return min(a,b)-x*x*x*k/6.;}
vec3 P(int i,float t){float f=float(i);vec3 q=vec3(.75*sin(t*.31+f*2.1)+.2*sin(t*.7+f),.95*sin(t*.27+f*1.3+1.)+.15*cos(t*.5+f*3.),.35*sin(t*.23+f*4.));
if(i==0)q=mix(q,vec3(M*vec2(.9,1.1),0.),.45);return q;}
float map(vec3 p){float d=1e3;for(int i=0;i<4;i++){float f=float(i);float r=.42+.1*sin(T*.4+f*1.7)+.05*B;d=smin(d,length(p-.82*P(i,T))-r,.7);}return d;}
vec3 nrm(vec3 p){vec2 e=vec2(.003,0);return normalize(vec3(map(p+e.xyy)-map(p-e.xyy),map(p+e.yxy)-map(p-e.yxy),map(p+e.yyx)-map(p-e.yyx)));}
void main(){vec2 uv=gl_FragCoord.xy/R;vec2 p=(gl_FragCoord.xy-.5*R)/min(R.x,R.y*1.15);
// a lava lamp's room: light pink at the top fading to light green at the bottom, with a soft glow at each end where the bulbs would be
vec3 pink=vec3(1.,.62,.78),green=vec3(.50,.95,.68);
vec3 bg=mix(mix(vec3(.80,.95,.85),vec3(.97,.97,.95),smoothstep(.05,.5,uv.y)),vec3(.98,.85,.91),smoothstep(.5,.95,uv.y));   // a pale warm white between them, so the two do not mix to grey
bg+=pink*.16*pow(max(0.,1.-length((uv-vec2(.5,1.04))*vec2(.9,1.5))),2.)+green*.16*pow(max(0.,1.-length((uv-vec2(.5,-.04))*vec2(.9,1.5))),2.);
bg*=1.-.07*pow(length(p)*.8,2.);
vec3 ro=vec3(0.,0.,-5.6),rd=normalize(vec3(p,1.9));float t=0.;bool hit=false;
for(int i=0;i<72;i++){float d=map(ro+rd*t);if(d<.002){hit=true;break;}t+=d;if(t>9.)break;}
vec3 col=bg;
if(hit){vec3 pos=ro+rd*t;vec3 n=nrm(pos);
float jit=h(gl_FragCoord.xy+fract(T)*13.);   // a per-pixel start turns the stepped contours of a short march into fine grain
float tt=.03+.03*jit;for(int i=0;i<22;i++){float d=-map(pos+rd*tt);if(d<.002)break;tt+=max(d,.02);}float thk=tt;
float th2=0.;for(int i=1;i<=5;i++){float s=(float(i)-.5+jit)*.1;th2+=clamp(-map(pos-n*s),0.,s);}
float thin=exp(-th2*4.2),core=exp(-thk*.9);
// a few quiet lights, not just an even glow: a soft key from the upper left, a cool fill from the right, a warm light from behind and below
float key=clamp((dot(n,normalize(vec3(-.45,.6,-.65)))+.55)/1.55,0.,1.);
float fill=clamp((dot(n,normalize(vec3(.8,.1,-.5)))+.6)/1.6,0.,1.);
float back=clamp(dot(n,normalize(vec3(.2,-.8,.6)))*.5+.5,0.,1.);
float wrap=clamp(key*.82+fill*.18,0.,1.);
float fr=pow(1.-max(dot(n,-rd),0.),3.);
vec3 deep=C1*.80,mid=mix(C1,C2,.35);
vec3 body=mix(deep,mid,wrap*.75+.25*(1.-core));
body=mix(body,C2,clamp(thin*.9,0.,1.)*.8);                 // translucent necks glow
body=mix(body,C2,clamp(exp(-thk*1.5)*.32,0.,1.));           // a little light through the thin edges
body+=(C2-C1)*.05*fr;
body+=(C2-C1)*.06*smoothstep(.0,1.,1.-th2*3.);
body+=vec3(.05,.035,.0)*pow(key,3.)*(1.-thin);                                  // key: a touch of warmth where it lands
body+=vec3(-.02,.02,.045)*fill*(1.-wrap)*.9;                                    // fill: slightly cooler on the shadow side
body=mix(body,C2*vec3(1.0,.98,.94),pow(back,4.)*clamp(.25+thin,0.,1.)*.22);   // light from behind: shows through the thin parts and rims
body=mix(body,C2,B*.18);
// lit by the lamp: near the top the body turns pink, near the bottom green (nearer the edge, more), keeping its own shading and its glowing thin parts
float topw=smoothstep(.5,.98,uv.y),botw=smoothstep(.5,.02,uv.y);
vec3 zone=pink*topw+green*botw;float zw=max(topw,botw);
body=mix(body,zone*(.72+.5*wrap)+zone*thin*.18,zw*.8);
col=body;}
// dither (triangular, about two levels) takes the banding out of the slow gradients, plus a faint grain
vec2 fc=gl_FragCoord.xy+fract(T*7.3)*91.;
col+=(h(fc)+h(fc+17.3)-1.)*(2.2/255.)+(h(fc*.77+5.)-.5)*.012;
gl_FragColor=vec4(col,1.);}`;

export function createBlob(canvas, { colours = [[.30, .74, .80], [.62, .97, .98]] } = {}) {
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
  if (!gl) return null;
  const shader = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null; };
  const vs = shader(gl.VERTEX_SHADER, VS), fs = shader(gl.FRAGMENT_SHADER, FS);
  if (!vs || !fs) return null;
  const pr = gl.createProgram(); gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return null;
  gl.useProgram(pr);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const at = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(at); gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
  const u = n => gl.getUniformLocation(pr, n);
  const uR = u('R'), uM = u('M'), uT = u('T'), uB = u('B');
  gl.uniform3fv(u('C1'), colours[0]); gl.uniform3fv(u('C2'), colours[1]);
  const still = matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let time = 7, last = 0, mx = 0, my = 0, tx = 0, ty = 0, boost = 0, boostTo = 0;
  const size = () => {
    const k = Math.min(devicePixelRatio || 1, 1100 / Math.max(1, canvas.clientWidth));   // soft, so no more than about 1100 pixels across
    const w = Math.max(2, Math.round(canvas.clientWidth * k)), h = Math.max(2, Math.round(canvas.clientHeight * k));
    if (w !== canvas.width || h !== canvas.height) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, canvas.width, canvas.height); gl.uniform2f(uR, canvas.width, canvas.height);
  };
  return {
    // the pointer, as a place on the screen from -1 to 1 either way
    point(x, y) { tx = x; ty = y; },
    excite(on) { boostTo = on ? 1 : 0; },
    draw(now) {
      size();   // cheap, and right even when the box was hidden when this was made
      const dt = last ? Math.min(.1, (now - last) / 1000) : 0; last = now;
      boost += (boostTo - boost) * .04; mx += (tx - mx) * .03; my += (ty - my) * .03;
      if (!still) time += dt * (1 + 1.6 * boost);
      gl.uniform1f(uT, time); gl.uniform1f(uB, boost); gl.uniform2f(uM, mx, my);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    lose() { gl.getExtension('WEBGL_lose_context')?.loseContext(); },
  };
}
