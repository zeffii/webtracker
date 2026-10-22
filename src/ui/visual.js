// A small live picture driven by the song (see visdata.js). One WebGL fragment shader on a square canvas, 300 x 300 by default, the size
// of a video frame, so what you see is what an MP4 export would show. The shader is plain GLSL ES 1.00 written as a whole `main`, with
// these uniforms already declared:
//   vec2  R       the size in pixels            float T      seconds since the picture opened
//   float BEAT    beats since the song's start  float HITS   every lane's hit added together, 0 to 1
//   vec3  C1, C2  two colours (deep and light)  vec4  LANE[16]   (hit, pitch, vel, held) of each lane, in lane order
// and these look-ups, which are rewritten before it is compiled:  hit("kick")  pitch("acid")  vel(2)  held("pad")  hits()
// A lane is named by its id or its instrument's name, or numbered from 0 (the first lane after the master lane). hit is 1 on a note and
// fades; pitch and vel are of the last note, 0 to 1; held is 1 while the note is held. A name that is not in the song reads 0.
import { preprocess } from './visdata.js';

const VS = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
const PREAMBLE = `precision highp float;
uniform vec2 R;uniform float T,BEAT,HITS;uniform vec3 C1,C2;uniform vec4 LANE[16];
`;
const PRE_LINES = PREAMBLE.split('\n').length - 1;

// The built-in picture: the translucent metaballs of the first screen, one per lane for the first four lanes. A hit swells its ball, the
// pitch of the last note moves it up or down, and while a note is held its ball keeps a little of the glow.
export const DEFAULT_GLSL = `// four metaballs, one for each of the first four lanes: hit() swells it, pitch() lifts it, held() keeps it glowing
float h(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float smin(float a,float b,float k){float x=max(k-abs(a-b),0.)/k;return min(a,b)-x*x*x*k/6.;}
vec3 P(int i,float t){float f=float(i);return vec3(.75*sin(t*.31+f*2.1)+.2*sin(t*.7+f),.95*sin(t*.27+f*1.3+1.)+.15*cos(t*.5+f*3.),.35*sin(t*.23+f*4.));}
float map(vec3 p){float d=1e3;for(int i=0;i<4;i++){float f=float(i);
  float r=.42+.1*sin(T*.4+f*1.7)+.26*hit(i)+.05*held(i);
  vec3 c=.82*P(i,T)+vec3(0.,.35*(pitch(i)-.5)*vel(i),0.);
  d=smin(d,length(p-c)-r,.7);}return d;}
vec3 nrm(vec3 p){vec2 e=vec2(.003,0);return normalize(vec3(map(p+e.xyy)-map(p-e.xyy),map(p+e.yxy)-map(p-e.yxy),map(p+e.yyx)-map(p-e.yyx)));}
void main(){vec2 uv=gl_FragCoord.xy/R;vec2 p=(gl_FragCoord.xy-.5*R)/min(R.x,R.y*1.15);
vec3 bg=mix(vec3(.93,.91,.88),vec3(.78,.81,.85),smoothstep(.45,1.,uv.y));bg=mix(bg,vec3(.95,.93,.9),smoothstep(.5,.0,uv.y)*.5);
bg*=1.-.16*pow(length(p)*.8,2.);
vec3 ro=vec3(0.,0.,-5.6),rd=normalize(vec3(p,1.9));float t=0.;bool hitp=false;
for(int i=0;i<72;i++){float d=map(ro+rd*t);if(d<.002){hitp=true;break;}t+=d;if(t>9.)break;}
vec3 col=bg;
if(hitp){vec3 pos=ro+rd*t;vec3 n=nrm(pos);
float jit=h(gl_FragCoord.xy+fract(T)*13.);
float tt=.03+.03*jit;for(int i=0;i<22;i++){float d=-map(pos+rd*tt);if(d<.002)break;tt+=max(d,.02);}float thk=tt;
float th2=0.;for(int i=1;i<=5;i++){float s=(float(i)-.5+jit)*.1;th2+=clamp(-map(pos-n*s),0.,s);}
float thin=exp(-th2*4.2),core=exp(-thk*.9);
float key=clamp((dot(n,normalize(vec3(-.45,.6,-.65)))+.55)/1.55,0.,1.);
float fill=clamp((dot(n,normalize(vec3(.8,.1,-.5)))+.6)/1.6,0.,1.);
float back=clamp(dot(n,normalize(vec3(.2,-.8,.6)))*.5+.5,0.,1.);
float wrap=clamp(key*.82+fill*.18,0.,1.);
float fr=pow(1.-max(dot(n,-rd),0.),3.);
vec3 deep=C1*.80,mid=mix(C1,C2,.35);
vec3 body=mix(deep,mid,wrap*.75+.25*(1.-core));
body=mix(body,C2,clamp(thin*.9,0.,1.)*.8);
body=mix(body,C2,clamp(exp(-thk*1.5)*.32,0.,1.));
body+=(C2-C1)*.05*fr;
body+=(C2-C1)*.06*smoothstep(.0,1.,1.-th2*3.);
body+=vec3(.05,.035,.0)*pow(key,3.)*(1.-thin);
body+=vec3(-.02,.02,.045)*fill*(1.-wrap)*.9;
body=mix(body,C2*vec3(1.0,.98,.94),pow(back,4.)*clamp(.25+thin,0.,1.)*.22);
body=mix(body,C2,hits()*.22);
col=body;}
vec2 fc=gl_FragCoord.xy+fract(T*7.3)*91.;
col+=(h(fc)+h(fc+17.3)-1.)*(2.2/255.)+(h(fc*.77+5.)-.5)*.012;
gl_FragColor=vec4(col,1.);}`;

// canvas: a canvas (its size is set here); data: createVisData's out object, read every draw; onError(text) hears compile errors (and ''
// when the shader is fine). Returns null without WebGL.
export function createVisual(canvas, { size = 300, colours = [[.30, .74, .80], [.62, .97, .98]], onError = () => {} } = {}) {
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: true });
  if (!gl) return null;
  canvas.width = size; canvas.height = size;
  gl.viewport(0, 0, size, size);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  let program = null, names = [], source = '', locs = {};
  const compile = (type, text) => {
    const s = gl.createShader(type); gl.shaderSource(s, text); gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? { s } : { error: gl.getShaderInfoLog(s) ?? 'the shader did not compile' };
  };
  // Builds the program for `src` (the user's text) with the lane names as they are now. Returns '' or the error text, with line numbers
  // counted in the user's own text.
  function build(src, laneNames) {
    const vs = compile(gl.VERTEX_SHADER, VS), fs = compile(gl.FRAGMENT_SHADER, PREAMBLE + preprocess(src, laneNames));
    if (fs.error || vs.error) return String(fs.error ?? vs.error).replace(/ERROR: (\d+):(\d+)/g, (_, f, l) => `line ${Math.max(1, Number(l) - PRE_LINES)}`).trim().split('\n')[0];
    const pr = gl.createProgram(); gl.attachShader(pr, vs.s); gl.attachShader(pr, fs.s); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return gl.getProgramInfoLog(pr) ?? 'the shader did not link';
    if (program) gl.deleteProgram(program);
    program = pr; gl.useProgram(pr);
    const at = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(at); gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
    locs = { R: gl.getUniformLocation(pr, 'R'), T: gl.getUniformLocation(pr, 'T'), BEAT: gl.getUniformLocation(pr, 'BEAT'), HITS: gl.getUniformLocation(pr, 'HITS'), LANE: gl.getUniformLocation(pr, 'LANE') };
    gl.uniform3fv(gl.getUniformLocation(pr, 'C1'), colours[0]); gl.uniform3fv(gl.getUniformLocation(pr, 'C2'), colours[1]);
    return '';
  }
  const sameNames = (a, b) => a.length === b.length && a.every((x, i) => x[0] === b[i][0] && x[1] === b[i][1]);
  let wanted = DEFAULT_GLSL, fallback = false;
  const tryBuild = laneNames => {
    let err = build(wanted, laneNames);
    if (err && wanted !== DEFAULT_GLSL) { onError(err); fallback = true; err = build(DEFAULT_GLSL, laneNames); }
    else { fallback = false; onError(err); }
    names = laneNames; source = wanted;
  };
  return {
    // The shader text to use (empty for the built-in one). Takes effect at the next draw.
    setSource(text) { wanted = text && text.trim() ? text : DEFAULT_GLSL; source = null; },
    draw(data) {
      if (source !== wanted || !sameNames(names, data.names)) tryBuild(data.names.map(n => [...n]));
      if (!program) return;
      gl.uniform2f(locs.R, size, size); gl.uniform1f(locs.T, data.T); gl.uniform1f(locs.BEAT, data.BEAT); gl.uniform1f(locs.HITS, data.HITS);
      gl.uniform4fv(locs.LANE, data.lane);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    get fallback() { return fallback; },
    lose() { gl.getExtension('WEBGL_lose_context')?.loseContext(); },
  };
}
