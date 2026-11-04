// The splash blob's shimmer: where the pointer is, and while it moves, a patch of wireframe runs over the blob's surface.
// The blob is a distance field with no real mesh, so the mesh is a fixed lattice of 3D cells the blob swims through: where the
// surface cuts a wall between two cells there is an edge, where it cuts a corner shared by three there is a vertex.
// The patch is a soft disc round the pointer, sized to about a seventh of the visible blob when it lies fully on it.
// blob.js splices these three pieces into its shader: the uniforms, the functions, and the step that draws the wire on the body.

// SP: the pointer in the shader's picture coordinates; SA: how much the pointer has been moving (0 still, 1 busy);
// WE, WV: the colours of the edges and the vertices
export const SHIMMER_UNIFORMS = 'uniform vec2 SP;uniform float SA;uniform vec3 WE,WV;';

export const SHIMMER_FUNCS = `
// the patch: a disc round the pointer, faded in by how much the pointer is moving
float shimMask(vec2 p){
  return SA*smoothstep(.185,.0925,length(p-SP));
}
// a random point in each cell
vec3 cellPoint(vec3 g){g=fract(g*vec3(.1031,.103,.0973));g+=dot(g,g.yxz+33.33);return fract((g.xxy+g.yxx)*g.zyx);}
// the wire at a point on the surface: x is the edge (near a wall between cells), y the vertex (near a corner of three)
vec2 wireCell(vec3 pos){
  vec3 p=pos*3.6,g=floor(p),f=fract(p);
  float F1=9.,F2=9.,F3=9.;   // the nearest three cell points
  for(int z=-1;z<=1;z++)for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
    vec3 o=vec3(float(x),float(y),float(z));
    float d=length(o+.15+.7*cellPoint(g+o)-f);
    if(d<F1){F3=F2;F2=F1;F1=d;}else if(d<F2){F3=F2;F2=d;}else if(d<F3)F3=d;
  }
  return vec2(smoothstep(.07,.02,F2-F1),smoothstep(.16,.08,F3-F1));
}
`;

// runs inside the shader's "the ray hit the blob" branch, where pos, n, rd, p and col are known
export const SHIMMER_APPLY = `
{
  float m=shimMask(p);
  if(m>.002){
    vec2 e=wireCell(pos);
    float face=clamp(dot(n,-rd)*1.6,0.,1.);                      // the wire thins out towards the silhouette
    float glint=.55+.45*sin(dot(pos,vec3(5.,3.,2.))*3.-T*11.);    // a ripple runs through the patch
    float twinkle=.6+.4*sin(T*7.+h(floor(pos.xy*9.))*30.);        // vertices flicker one by one
    col=mix(col,WE,clamp(e.x*m*face*glint,0.,1.)*.9);
    col=mix(col,WV,clamp(e.y*m*face*twinkle,0.,1.));
  }
}`;
