// The Shader screen's guide: how the live picture works, what a shader is given, how to write one, the built-in functions, what it costs,
// and where to read more. Plain markdown, shown by ui/markdown.js in the Shader screen. Kept short; the rest lives in the further reading.
export const GUIDE = `# Shader guide

## What this is

The live picture is one **fragment shader**: a small program that runs on the graphics card once for every pixel, every frame, and answers one question: what colour is this pixel? You write the whole \`main()\` and set \`gl_FragColor\`. The language is GLSL ES 1.00 (the WebGL 1 dialect of GLSL).

The shader has no memory. It cannot remember the last frame, so the picture is a pure function of the pixel position and the numbers Wax hands it (time, beat, what each lane is playing). That sounds limiting, and it is the reason shaders are fast: every pixel is worked out on its own, thousands at a time.

Use it for a picture next to the pattern editor (Ctrl+Alt+V, or the pop-out window), a look of your own for each song, or just to learn. A project keeps up to 16 shaders; the Shd column of the shader lane switches between them as the song plays. The size comes from Config, Visual, "Picture: resolution" (300 by default, up to 1080).

When you stop typing the shader is compiled in the background. The old picture keeps running until the new one is ready. A mistake shows under the editor with its line marked in the gutter, and the built-in picture takes over until it is fixed.

## What the shader is given

These are already declared. Do not declare them again.

- \`vec2 R\`: the size of the picture in pixels.
- \`float T\`: seconds since the picture opened.
- \`float BEAT\`: beats since the start of the song.
- \`float HITS\`: every lane's hit added together, 0 to 1.
- \`float NL\`: how many lanes the song has.
- \`vec3 C1, C2\`: two colours, a deep one and a light one. Keeping to these makes the picture follow the theme.
- \`vec4 LANE[16]\`: one entry per lane, in lane order: \`.x\` hit, \`.y\` pitch, \`.z\` velocity, \`.w\` held.
- \`gl_FragCoord\`: the pixel being drawn, from (0, 0) at the bottom left to R at the top right.

A lane's **hit** is 1 at the moment of a note and fades away (Config, Visual, "hit fade", 220 ms by default). **Pitch** and **velocity** are of the last note, 0 to 1. **Held** is 1 while the note is held.

### Look-ups

These are rewritten before the shader is compiled, so they cost nothing:

- \`hit("kick")\`, \`pitch("acid")\`, \`vel(2)\`, \`held("pad")\`: the same four numbers for one lane, named by its id or its instrument's name, or numbered from 0. A name that is not in the song reads 0. With a loop variable, \`hit(i)\` is \`LANE[i].x\`.
- \`hits()\`: the same as \`HITS\`.
- \`cell("kick", dx)\`: the pattern around the playhead. It gives a \`vec4\` for the row \`dx\` ticks away: note starts, pitch, velocity, note off. \`dx\` runs from -8 (behind) to +23 (ahead).
- \`kn("name", start, low, high)\`: a number the patterns can move. Press **expose** on a number in the Knobs panel and it becomes one, with a column of that name in the shader lane. 0 in the column is \`low\`, FF is \`high\`; with no such input the shader just sees \`start\`.

## Writing one, in small steps

A flat colour:

\`\`\`
void main(){
  gl_FragColor = vec4(C1, 1.);
}
\`\`\`

Centre the picture and make it independent of the size. This line is at the top of nearly every shader here: \`p\` is 0 in the middle and about -0.5 to 0.5 across the shortest side.

\`\`\`
vec2 p = (gl_FragCoord.xy - .5 * R) / min(R.x, R.y);
\`\`\`

A circle that swells when the first lane hits:

\`\`\`
void main(){
  vec2 p = (gl_FragCoord.xy - .5 * R) / min(R.x, R.y);
  float d = length(p) - (.15 + .1 * hit(0));   // distance to the circle's edge: negative inside
  float a = 1. - smoothstep(0., .01, d);         // 1 inside, 0 outside, a soft edge
  gl_FragColor = vec4(mix(C1 * .2, C2, a), 1.);
}
\`\`\`

One circle per lane, using the loop idiom every template uses:

\`\`\`
void main(){
  vec2 p = (gl_FragCoord.xy - .5 * R) / min(R.x, R.y);
  vec3 col = C1 * .15;
  for (int i = 0; i < 16; i++) {
    if (float(i) >= NL) break;                    // a loop needs a fixed end; stop early here
    vec2 c = .3 * vec2(float(i) / 8. - 1., 0.);   // somewhere along a line
    float a = 1. - smoothstep(0., .02, length(p - c) - .03 - .05 * LANE[i].x);
    col += mix(C1, C2, LANE[i].y) * a;
  }
  gl_FragColor = vec4(col, 1.);
}
\`\`\`

Things worth knowing from these examples:

- **Distance fields.** Compute how far the pixel is from a shape (\`length(p - c) - radius\` for a circle), then turn the distance into colour with \`smoothstep\`. Almost everything in 2D works this way.
- **Glow** is \`exp(-d * k)\`: bright at the shape, fading with distance, wider for a smaller k.
- **Repeat** a pattern with \`fract(p * n)\` (n tiles each way) and use \`floor(p * n)\` as the tile's number.
- **Mix** two colours with \`mix(C1, C2, x)\`, x from 0 to 1. Colour out of range just clips, so adding glows together is fine.
- **Polar coordinates**: \`atan(p.y, p.x)\` is the angle and \`length(p)\` the radius. Rays, wedges and spirals are simple in them.
- **Random-looking numbers** come from a hash, a tiny function that scrambles a coordinate (see \`h()\` in the Marble and Truchet templates). Smooth noise blends the hashes of the four nearest corners.
- **Bend space before drawing** (add a sine to \`p\`, rotate it, fold it) and any shape becomes a moving one.

## Rules of GLSL ES 1.00

This is the old dialect, and most examples on the web are newer. The differences that bite:

- No automatic int to float: \`float x = 1;\` is an error. Write \`1.\`.
- A loop needs a constant bound: \`for (int i = 0; i < 16; i++)\`. You may \`break\` out early.
- An array such as \`LANE\` may only be indexed by a constant or a loop variable. To pick a lane from a computed number, loop and compare: \`for (int k = 0; k < 16; k++) if (float(k) == lane) L = LANE[k];\`
- No \`%\` operator: use \`mod(x, y)\`. No bit operations, no \`switch\`, no recursion.
- No \`round\`, \`trunc\`, \`sinh\`, \`cosh\`, \`tanh\`, \`texture\`, or derivatives. Use \`floor(x + .5)\` for round and \`texture2D\` for textures. \`atan(y, x)\` with two arguments exists.
- \`smoothstep(a, b, x)\` is only defined for a < b. The older templates here call it the other way round (\`smoothstep(w, 0., d)\`) to flip the edge, which works on the usual graphics drivers, but \`1. - smoothstep(0., w, d)\` is the safe way.
- Output alpha does not matter; write 1.

## Built-in functions

Most work on \`float\`, \`vec2\`, \`vec3\` and \`vec4\`, component by component.

- Angles: \`radians degrees sin cos tan asin acos atan\` (\`atan(y, x)\` too).
- Powers: \`pow exp log exp2 log2 sqrt inversesqrt\`.
- Common: \`abs sign floor ceil fract mod min max clamp\`.
- Mixing: \`mix(a, b, t)\` is a + (b - a) * t. \`step(edge, x)\` is 0 below the edge, 1 above. \`smoothstep(a, b, x)\` is a smooth 0 to 1 between a and b.
- Geometry: \`length distance dot cross normalize reflect refract faceforward\`.
- Comparing vectors: \`lessThan lessThanEqual greaterThan greaterThanEqual equal notEqual any all not\`.
- Matrices: \`mat2 mat3 mat4\`, multiplied with \`*\`; \`matrixCompMult\` for component by component.
- Textures: \`texture2D(sampler, uv)\`. Wax only gives the shader its own pattern texture (through \`cell\`).
- Swizzles pick and reorder components: \`p.yx\`, \`col.rgb\`, \`v.xxy\`.

## What it costs

The cost is roughly pixels times work per pixel. Halving the resolution in Config makes everything about four times lighter, and a soft picture rarely needs more than 300. Loops, \`pow\`, \`exp\`, \`sin\` and \`atan\` are the expensive parts; ray marching (many steps per pixel) is the most expensive of all.

Rough weight of the templates, measured on a software renderer, so the ratios only: the built-in metaballs 100, Flock 42, Cells 30, Lissajous 22, Ripples, Waves, Sunburst, Rings, Truchet, Bars, Lava and Marble between 6 and 11, and Tunnel, Moire, Roll, Leds, Plasma, Kaleido and Stars under 4. On a real graphics card all of them are far lighter, but the order holds.

If a shader makes the interface stutter, lower the resolution first, then cut the loop counts, then replace \`pow(x, 2.)\` with \`x * x\`.

## The templates, as things to learn from

- **Rings, Ripples**: distance to a circle; ripples read how far a hit has faded as the age of a wave.
- **Bars, Waves, Sunburst**: one lane per column, row or wedge, and how to pick the lane's numbers.
- **Tunnel, Kaleido**: polar coordinates and folding space.
- **Plasma, Marble**: sums of sines and noise; marble adds a domain warp (noise bending the lookup of noise).
- **Truchet, Leds, Cells**: tiling with \`floor\` and \`fract\`; Cells finds the nearest of a set of drifting points (a Voronoi diagram).
- **Roll**: reading the pattern with \`cell\`.
- **Moire, Lissajous**: interference of two sets of rings, and a curve drawn as a chain of short segments.
- **Stars, Flock, Lava**: many things without any stored state, each one worked out from a hash and the time.
- The built-in picture is a small 3D ray-marched scene with soft light through the shapes, a good one to read after the rest.

## Further reading

- **The Book of Shaders** (thebookofshaders.com): the gentlest start. Shapes, colour, noise and patterns, with every example editable. Mostly the same dialect as here.
- **Inigo Quilez** (iquilezles.org, the articles): the best reference for distance functions, smooth minimum, palettes and noise. Short and exact.
- **Shadertoy** (shadertoy.com): thousands of shaders to read and change. To bring one here, wrap its \`mainImage(out vec4 fragColor, in vec2 fragCoord)\` body in \`main()\`, use \`gl_FragCoord.xy\` for \`fragCoord\`, \`R\` for \`iResolution.xy\`, \`T\` for \`iTime\`, \`gl_FragColor\` for \`fragColor\`, and replace anything the older dialect does not have (see the rules above).
- **The Art of Code** (a video channel by Martijn Steinrucken): patient lessons that start with a blank shader.
- **The OpenGL ES 2.0 reference card** (Khronos Group, khronos.org): one page with every function and rule of this dialect.
`;
