// GLSL for the two kinds of stone, kept in step with public/gem-lab.html.
// Neither uses a real environment map: env() paints a dark studio with a
// few soft boxes and pin lights, which is what makes the facets flash.

const COMMON = `
float hash1(float n){ return fract(sin(n)*43758.5453); }
float spot(vec3 d, vec3 l, float s){ return pow(max(dot(d,l),0.0), s); }
vec3 env(vec3 d){
  float y = d.y;
  vec3 c = vec3(0.012,0.014,0.022) + vec3(0.16,0.18,0.24)*smoothstep(0.0,1.0,y);
  c += vec3(3.2)            * smoothstep(0.93,0.97, dot(d, normalize(vec3(0.0,1.0,0.25))));
  c += vec3(2.4,2.3,2.1)    * smoothstep(0.90,0.95, dot(d, normalize(vec3(1.0,0.35,0.2))));
  c += vec3(1.6,1.75,2.1)   * smoothstep(0.90,0.95, dot(d, normalize(vec3(-1.0,0.25,0.5))));
  c += vec3(2.2)            * smoothstep(0.95,0.98, dot(d, normalize(vec3(0.2,0.2,1.0))));
  c += vec3(1.4)            * smoothstep(0.96,0.985,dot(d, normalize(vec3(-0.4,0.6,-0.8))));
  c += 20.0*spot(d, normalize(vec3(0.5,0.8,0.6)), 1800.0);
  c += 15.0*spot(d, normalize(vec3(-0.6,0.7,0.3)), 2200.0);
  c += 13.0*spot(d, normalize(vec3(0.1,0.5,0.9)), 1500.0);
  c += 11.0*spot(d, normalize(vec3(-0.3,0.9,-0.4)), 2500.0);
  c += 9.0 *spot(d, normalize(vec3(0.8,0.4,-0.3)), 2000.0);
  c *= mix(0.12, 1.0, smoothstep(-0.35, 0.1, y));
  return c;
}
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
`;

export const VERT = `
varying vec3 vO; varying vec3 vNo; varying vec3 vN; varying vec3 vW;
void main(){
  vO = position; vNo = normal;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position,1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const GEM_FRAG = `
uniform vec3 uColor; uniform float uIor; uniform float uDisp; uniform float uDepth; uniform float uFacets;
uniform vec3 uCamObj; uniform mat3 uRot; uniform float uExposure;
varying vec3 vO; varying vec3 vNo; varying vec3 vN; varying vec3 vW;
${COMMON}
vec3 through(vec3 Vo, vec3 No, float ior){
  vec3 T = refract(Vo, No, 1.0/ior);
  if(dot(T,T) < 1e-4) T = reflect(Vo, No);
  float seg = 6.2831853/uFacets;
  float a = atan(vO.z + T.z*0.8, vO.x + T.x*0.8);
  float k = floor(a/seg);
  float a1 = (k+0.5)*seg;
  vec3 p1 = normalize(vec3(cos(a1)*0.87, -1.0, sin(a1)*0.87));
  vec3 T2 = reflect(T, p1);
  float jit = (hash1(k*3.1 + floor(vO.y*6.0)) - 0.5)*seg;
  float a2 = a1 + 3.14159265 + jit;
  vec3 p2 = normalize(vec3(cos(a2)*0.87, -1.0, sin(a2)*0.87));
  vec3 T3 = T2;
  if(T3.y < 0.0) T3 = reflect(T2, p2);
  float lum = 1.0;
  vec3 E;
  if(T3.y > 0.0){
    float b = atan(T3.z, T3.x);
    float ab = (floor(b/seg)+0.5)*seg;
    vec3 nOut = normalize(vec3(cos(ab)*0.35, 1.0, sin(ab)*0.35));
    E = refract(T3, -nOut, ior);
    if(dot(E,E) < 1e-4){ E = reflect(T3, -nOut); lum = 0.35; }
  } else { E = T3; lum = 0.22; }
  return env(normalize(uRot*E)) * lum;
}
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(vW - cameraPosition);
  vec3 No = normalize(vNo);
  vec3 Vo = normalize(vO - uCamObj);
  vec3 t;
  t.r = through(Vo, No, uIor - uDisp).r;
  t.g = through(Vo, No, uIor).g;
  t.b = through(Vo, No, uIor + uDisp).b;
  float h = hash1(dot(floor(vO*9.0), vec3(1.0,57.0,113.0)));
  t *= pow(uColor, vec3(uDepth*(0.75+0.5*h)));
  float cosi = clamp(dot(-V,N), 0.0, 1.0);
  float F0 = pow((uIor-1.0)/(uIor+1.0), 2.0);
  float F = F0 + (1.0-F0)*pow(1.0-cosi, 5.0);
  vec3 col = t*(1.0-F) + env(reflect(V,N))*F;
  col = aces(col*uExposure);
  gl_FragColor = vec4(pow(col, vec3(1.0/2.2)), 1.0);
}`;

export const CAB_FRAG = `
uniform float uType; uniform vec3 uA; uniform vec3 uB; uniform vec3 uC; uniform float uTrans; uniform float uExposure;
varying vec3 vO; varying vec3 vNo; varying vec3 vN; varying vec3 vW;
${COMMON}
float h3(vec3 p){ p = fract(p*0.3183099 + 0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(h3(i),h3(i+vec3(1.0,0.0,0.0)),f.x), mix(h3(i+vec3(0.0,1.0,0.0)),h3(i+vec3(1.0,1.0,0.0)),f.x), f.y),
             mix(mix(h3(i+vec3(0.0,0.0,1.0)),h3(i+vec3(1.0,0.0,1.0)),f.x), mix(h3(i+vec3(0.0,1.0,1.0)),h3(i+vec3(1.0,1.0,1.0)),f.x), f.y), f.z);
}
float fbm(vec3 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s += a*vnoise(p); p = p*2.03 + vec3(1.7,9.2,3.1); a *= 0.5; } return s; }
float qnoise(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f*f*f*(f*(f*6.0-15.0)+10.0);
  return mix(mix(mix(h3(i),h3(i+vec3(1.0,0.0,0.0)),f.x), mix(h3(i+vec3(0.0,1.0,0.0)),h3(i+vec3(1.0,1.0,0.0)),f.x), f.y),
             mix(mix(h3(i+vec3(0.0,0.0,1.0)),h3(i+vec3(1.0,0.0,1.0)),f.x), mix(h3(i+vec3(0.0,1.0,1.0)),h3(i+vec3(1.0,1.0,1.0)),f.x), f.y), f.z);
}
float sfbm(vec3 p){ return 0.65*qnoise(p) + 0.35*qnoise(p*1.9 + vec3(4.3,1.1,7.7)); }
float smin(float a, float b, float k){ float h = clamp(0.5 + 0.5*(b-a)/k, 0.0, 1.0); return mix(b, a, h) - k*h*(1.0-h); }
vec3 flow(vec3 p, float amt){
  vec3 w = p + amt*vec3(sin(p.y*2.3 + p.z*1.1), sin(p.z*1.9 + p.x*1.7 + 1.3), sin(p.x*2.1 + p.y*1.5 + 2.1));
  return w + amt*0.7*(vec3(sfbm(p*1.2), sfbm(p*1.2 + vec3(5.2)), sfbm(p*1.2 + vec3(9.1))) - 0.5);
}
void main(){
  vec3 p = vO;
  vec3 base; float metal = 0.0;
  if(uType < 0.5){
    float f = fbm(p*1.8);
    float g = fbm(p*5.0 + vec3(3.0));
    base = mix(uA, uB, smoothstep(0.25, 0.75, f));
    base = mix(base, uA*0.6, smoothstep(0.62, 0.75, g)*0.7);
    float band = smoothstep(0.9, 0.99, sin((p.y*2.0 + f*1.5)*9.0)*0.5 + 0.5);
    base = mix(base, uC, band*0.3);
  } else if(uType < 1.5){
    float f = fbm(p*2.5);
    base = mix(uA, uB, smoothstep(0.3, 0.7, f));
    base *= 0.75 + 0.5*vnoise(p*14.0);
    float vein = 1.0 - smoothstep(0.0, 0.025, abs(fbm(p*2.2 + vec3(7.0)) - 0.5));
    base = mix(base, uC, vein*0.7);
    float cluster = smoothstep(0.55, 0.75, fbm(vec3(p.x*1.2, p.y*3.0, p.z*1.2) + vec3(11.0)));
    metal = cluster * smoothstep(0.62, 0.72, vnoise(p*38.0));
    metal = max(metal, smoothstep(0.86, 0.9, vnoise(p*45.0 + vec3(2.0)))*0.8);
    base = mix(base, vec3(0.62,0.46,0.14), metal);
  } else if(uType < 2.5){
    vec3 w = flow(p, 0.22);
    float d1 = length((w - vec3(0.30, 0.10, -0.15))*vec3(1.0, 1.4, 1.15));
    float d2 = length((w - vec3(-0.45, -0.05, 0.30))*vec3(1.2, 1.4, 1.0));
    float r = smin(d1, d2 + 0.08, 0.35);
    float t = fract(r*3.4);
    vec3 c1 = vec3(0.86,0.83,0.77), c2 = vec3(0.80,0.50,0.24), c3 = vec3(0.55,0.13,0.04), c4 = vec3(0.10,0.03,0.015);
    base = mix(c1, c2, smoothstep(0.06, 0.16, t));
    base = mix(base, c3, smoothstep(0.22, 0.42, t));
    base = mix(base, c4, smoothstep(0.52, 0.76, t));
    base = mix(base, c1, smoothstep(0.90, 0.97, t));
    float fineW = pow(0.5 + 0.5*sin(r*58.0), 14.0);
    float fineD = pow(0.5 + 0.5*sin(r*41.0 + 1.0), 16.0);
    base = mix(base, c1, fineW*0.45);
    base = mix(base, c4, fineD*0.35);
  } else if(uType < 3.5){
    vec3 w = flow(p, 0.28);
    float d1 = length((w - vec3(0.35, 0.05, 0.10))*vec3(1.0, 1.6, 1.3));
    float d2 = length((w - vec3(-0.40, 0.0, -0.20))*vec3(1.3, 1.5, 1.0));
    float d3 = length((w - vec3(0.05, -0.1, 0.45))*vec3(1.1, 1.3, 1.6));
    float r = smin(smin(d1, d2 + 0.05, 0.3), d3 + 0.12, 0.3);
    float group = 0.5 + 0.5*sin(r*4.3 + 0.7);
    float sv = 0.5 + 0.5*sin(r*26.0);
    float lines = smoothstep(0.93, 0.985, sv)*smoothstep(0.25, 0.6, group);
    float fine = smoothstep(0.965, 0.995, 0.5 + 0.5*sin(r*61.0 + 0.3))*smoothstep(0.4, 0.8, group);
    float wide = smoothstep(0.955, 0.985, 0.5 + 0.5*sin(r*8.5 + 2.0));
    float haze = smoothstep(0.6, 0.95, group)*0.22;
    base = mix(uA, uB, clamp(haze + fine*0.6, 0.0, 1.0));
    base = mix(base, uC, clamp(lines + wide*0.9, 0.0, 1.0));
  } else {
    // red / polychrome jasper: layered, multi-scale
    vec3 w = flow(p, 0.3);
    vec3 wd = w + 0.18*(vec3(fbm(p*2.6), fbm(p*2.6 + vec3(3.3)), fbm(p*2.6 + vec3(7.7))) - 0.5);
    // mottled red body
    float m = fbm(wd*2.2);
    base = mix(vec3(0.66,0.16,0.04), vec3(0.38,0.07,0.05), smoothstep(0.35, 0.7, m));
    base = mix(base, vec3(0.80,0.27,0.06), smoothstep(0.6, 0.8, fbm(wd*4.5 + vec3(9.0)))*0.5);
    // clouded maroon veining
    float rv = abs(fbm(wd*1.7 + vec3(5.0)) - 0.5);
    base = mix(base, vec3(0.30,0.06,0.07), (1.0 - smoothstep(0.0, 0.07, rv))*0.65);
    // ochre patches with dark and pale speckles
    float ocM = smoothstep(0.56, 0.62, fbm(wd*1.4 + vec3(21.0)));
    vec3 och = mix(vec3(0.80,0.50,0.12), vec3(0.62,0.34,0.08), fbm(p*6.0 + vec3(2.0)));
    base = mix(base, och, ocM*0.9);
    base = mix(base, vec3(0.22,0.10,0.04), smoothstep(0.80, 0.86, vnoise(p*34.0 + vec3(1.0)))*ocM*0.85);
    base = mix(base, vec3(0.85,0.78,0.60), smoothstep(0.84, 0.90, vnoise(p*40.0 + vec3(8.0)))*ocM*0.6);
    // grey zones with red tendrils running through
    float gM = smoothstep(0.60, 0.64, fbm(w*1.1 + vec3(33.0)));
    vec3 grey = mix(vec3(0.62,0.60,0.56), vec3(0.45,0.44,0.42), fbm(p*5.0 + vec3(4.0)));
    float tend = abs(fbm(wd*3.0 + vec3(44.0)) - 0.5);
    base = mix(base, mix(grey, vec3(0.62,0.15,0.05), (1.0 - smoothstep(0.02, 0.06, tend))*0.9), gM);
    // dark hairline fractures and pale quartz veins
    float h1 = abs(fbm(p*2.4 + vec3(13.0)) - 0.5);
    base = mix(base, vec3(0.20,0.05,0.03), (1.0 - smoothstep(0.003, 0.011, h1))*0.8);
    float h2 = abs(fbm(p*1.9 + vec3(61.0)) - 0.5);
    base = mix(base, vec3(0.80,0.70,0.60), (1.0 - smoothstep(0.002, 0.008, h2))*0.55);
    // fine grain
    base *= 0.85 + 0.3*vnoise(p*22.0);
  }
  vec3 N = normalize(vN);
  vec3 V = normalize(vW - cameraPosition);
  vec3 irr = vec3(0.10)
    + 0.85*max(dot(N, normalize(vec3(0.0,1.0,0.3))), 0.0)
    + 0.45*max(dot(N, normalize(vec3(1.0,0.35,0.2))), 0.0)
    + 0.30*vec3(0.85,0.9,1.0)*max(dot(N, normalize(vec3(-1.0,0.25,0.5))), 0.0);
  float facing = max(dot(N,-V), 0.0);
  vec3 col = base*irr*(1.0 - metal*0.6);
  col += uTrans*base*pow(facing, 2.0)*1.1;
  float F = 0.045 + 0.955*pow(1.0-facing, 5.0);
  vec3 R = reflect(V, N);
  col = col*(1.0-F) + env(R)*F;
  col += metal*env(R)*vec3(1.0,0.8,0.4)*0.9;
  col = aces(col*uExposure);
  gl_FragColor = vec4(pow(col, vec3(1.0/2.2)), 1.0);
}`;
