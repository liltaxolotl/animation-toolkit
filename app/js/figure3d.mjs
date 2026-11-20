// ============================== FIGURE 3D ==============================
// A real rigged human (Mesh2Motion CC0 bodies, one 66-bone skeleton with fingers) for posing and reference.
// Loaded as an ES module through serve.py. window.Fig3D is the API other tabs use.
//
// Joint math. Every posable joint has up to three anatomical angles measured in the BODY frame at rest
// (X = the figure's left, Y = up, Z = forward), carried along by the parent bone:
//     local = (Wp^-1 * D * Wp) * restLocal          Wp = the parent's rest world rotation
// D is built from the angles (Euler, order per joint). Shoulders use an "arm hanging down" reference, so their
// angles read like the hips. Right-side joints mirror the left: angles about Y and Z flip sign.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const ASSETS = 'app/assets/figures/human/';
const BODIES = { man: { file: 'model.glb', label: 'Adult man' }, woman: { file: 'mannequin-female.glb', label: 'Adult woman' } };
const DEG = Math.PI / 180;

// ---------- joints: [label, axis, sign, min, max] in degrees, for the figure's LEFT side
const ARM_DOWN = { l: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2), r: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2) };
const SPINE = (f, b, l, t) => ({ order: 'XZY', ch: [['Bend forward', 'x', 1, -b, f], ['Lean to its left', 'z', -1, -l, l], ['Twist to its left', 'y', 1, -t, t]] });
const JOINTS = {
  pelvis: { name: 'Hips', free: true, order: 'YXZ', ch: [['Turn to its left', 'y', 1, -180, 180], ['Tip forward', 'x', 1, -90, 90], ['Tip to its left', 'z', -1, -60, 60]] },
  spine_01: { name: 'Lower back', ...SPINE(30, 15, 12, 12) },
  spine_02: { name: 'Mid back', ...SPINE(30, 12, 12, 15) },
  spine_03: { name: 'Chest', ...SPINE(25, 12, 10, 15) },
  neck_01: { name: 'Neck', ...SPINE(45, 40, 25, 45) },
  head: { name: 'Head', ...SPINE(30, 30, 18, 35) },
  clavicle: { name: 'Collarbone', order: 'XZY', ch: [['Shrug up', 'z', 1, -10, 35], ['Forward', 'y', -1, -15, 25], ['Roll', 'x', 1, -10, 10]] },
  upperarm: { name: 'Shoulder', down: true, order: 'XZY', ch: [['Raise forward', 'x', -1, -60, 180], ['Raise to the side', 'z', 1, -35, 180], ['Turn out', 'y', -1, -90, 90]] },
  lowerarm: { name: 'Elbow', hinge: 'y', order: 'YXZ', ch: [['Bend', 'y', -1, 0, 150]], lock: 8 },
  hand: { name: 'Wrist', order: 'XYZ', ch: [['Bend toward the palm', 'z', -1, -70, 80], ['Toward the thumb', 'y', -1, -30, 20], ['Roll the hand', 'x', 1, -90, 90]] },
  thigh: { name: 'Hip joint', order: 'XZY', ch: [['Swing forward', 'x', -1, -30, 125], ['Out to the side', 'z', 1, -25, 45], ['Turn the knee out', 'y', 1, -40, 45]] },
  calf: { name: 'Knee', hinge: 'x', order: 'XZY', ch: [['Bend', 'x', 1, 0, 150]], lock: 6 },
  foot: { name: 'Ankle', order: 'XZY', ch: [['Point the toes', 'x', 1, -25, 50], ['Roll the sole in', 'z', -1, -20, 25], ['Turn the toes in', 'y', -1, -25, 25]] },
  ball: { name: 'Toes', order: 'XZY', ch: [['Toes up', 'x', -1, -30, 60]], lock: 5 }
};
const SIDED = ['clavicle', 'upperarm', 'lowerarm', 'hand', 'thigh', 'calf', 'foot', 'ball'];
const POSABLE = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head', ...['l', 'r'].flatMap(s => SIDED.map(b => b + '_' + s))];
function jointOf(bone) { const m = bone.match(/^(.*)_([lr])$/); if (m && JOINTS[m[1]]) return { def: JOINTS[m[1]], side: m[2] }; return JOINTS[bone] ? { def: JOINTS[bone], side: null } : null; }
function jointName(bone) { const j = jointOf(bone); if (!j) return bone; return j.def.name + (j.side ? (j.side === 'l' ? ' (its left)' : ' (its right)') : ''); }

// ---------- builds: per bone length (L, along the bone) and girth (G, across it); head and hands scale evenly
const TORSO = ['pelvis', 'spine_01', 'spine_02', 'spine_03'], ARM_U = ['upperarm_l', 'upperarm_r'], ARM_L = ['lowerarm_l', 'lowerarm_r'], LEG_U = ['thigh_l', 'thigh_r'], LEG_L = ['calf_l', 'calf_r'];
const HANDS = ['hand_l', 'hand_r'], FEET = ['foot_l', 'foot_r'], CLAV = ['clavicle_l', 'clavicle_r'];
const BUILDS = {
  average: { label: 'Average', parts: [] },
  heavier: { label: 'Heavier', parts: [[TORSO, 1, 1.24], [['neck_01'], 1, 1.12], [ARM_U, 1, 1.18], [ARM_L, 1, 1.1], [LEG_U, 1, 1.22], [LEG_L, 1, 1.12]] },
  thinner: { label: 'Thinner', parts: [[TORSO, 1, 0.86], [['neck_01'], 1, 0.9], [ARM_U, 1, 0.84], [ARM_L, 1, 0.86], [LEG_U, 1, 0.84], [LEG_L, 1, 0.86]] },
  teen: { label: 'Teen', parts: [[TORSO, 0.9, 0.9], [['neck_01'], 0.92, 0.9], [CLAV, 0.9, 1], [ARM_U, 0.9, 0.88], [ARM_L, 0.9, 0.88], [LEG_U, 0.9, 0.88], [LEG_L, 0.9, 0.88], [['head'], 0.97, 0.97], [HANDS, 0.92, 0.92], [FEET, 0.92, 0.92]] },
  kid: { label: 'Kid (about 8)', parts: [[TORSO, 0.72, 0.74], [['neck_01'], 0.7, 0.75], [CLAV, 0.7, 0.8], [ARM_U, 0.66, 0.7], [ARM_L, 0.66, 0.7], [LEG_U, 0.62, 0.72], [LEG_L, 0.62, 0.72], [['head'], 0.87, 0.87], [HANDS, 0.66, 0.66], [FEET, 0.66, 0.66]] }
};
function buildScales(build, cartoon) {
  const S = {}; const get = n => (S[n] = S[n] || { L: 1, G: 1 });
  for (const [names, L, G] of (BUILDS[build] || BUILDS.average).parts) for (const n of names) { const s = get(n); s.L *= L; s.G *= G; }
  const t = Math.max(0, Math.min(1, cartoon || 0));
  if (t > 0) {                                     // realistic -> cartoon -> chibi: big head, short limbs, bigger hands and feet
    const mul = (names, L, G) => names.forEach(n => { const s = get(n); s.L *= L; s.G *= G; });
    mul(['head'], 1 + 1.3 * t, 1 + 1.3 * t); mul(TORSO, 1 - 0.28 * t, 1 + 0.06 * t); mul(['neck_01'], 1 - 0.5 * t, 1);
    mul(LEG_U, 1 - 0.42 * t, 1 + 0.12 * t); mul(LEG_L, 1 - 0.42 * t, 1 + 0.12 * t); mul(ARM_U, 1 - 0.32 * t, 1 + 0.1 * t); mul(ARM_L, 1 - 0.32 * t, 1 + 0.1 * t);
    mul(HANDS, 1 + 0.35 * t, 1 + 0.35 * t); mul(FEET, 1 + 0.3 * t, 1 + 0.3 * t);
  }
  return S;
}

// ---------- looks
function toonRamp(n) { const d = new Uint8Array(n * 4); for (let i = 0; i < n; i++) { const v = Math.round(255 * (0.42 + 0.58 * i / (n - 1))); d.set([v, v, v, 255], i * 4); } const t = new THREE.DataTexture(d, n, 1); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t; }
function withContour(mat, dens, amt, ink) {       // cross-contour rings around every limb, from each vertex's position along its main bone
  mat.onBeforeCompile = sh => {
    sh.uniforms.uDens = { value: dens }; sh.uniforms.uAmt = { value: amt }; sh.uniforms.uInk = { value: new THREE.Color(ink) };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float contour;\nvarying float vContour;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvContour = contour;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vContour;\nuniform float uDens; uniform float uAmt; uniform vec3 uInk;')
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n  float cc = vContour * uDens; float dd = abs(fract(cc - 0.5) - 0.5) / max(fwidth(cc), 1e-4); float ln = 1.0 - clamp(dd - 0.6, 0.0, 1.0);\n  gl_FragColor.rgb = mix(gl_FragColor.rgb, uInk, ln * uAmt);');
  };
  mat.customProgramCacheKey = () => 'contour' + dens + amt + ink;
  return mat;
}
const STYLES = {
  toon: { label: 'Toon + outline', outline: true, make: g => new THREE.MeshToonMaterial({ color: 0xf2ece6, gradientMap: g }) },
  shade: { label: 'Light and shadow', outline: false, shadows: true, make: () => new THREE.MeshStandardMaterial({ color: 0xe9e2da, roughness: 0.62, metalness: 0 }) },
  contour: { label: 'Cross-contour', outline: true, make: g => withContour(new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: g }), 26, 0.85, '#2e5bd8') },
  wood: { label: 'Wooden mannequin', outline: true, make: g => withContour(new THREE.MeshToonMaterial({ color: 0xd2a26b, gradientMap: g }), 150, 0.14, '#7a4a1e') },
  xray: { label: 'Skeleton (x-ray)', outline: false, xray: true, make: () => new THREE.MeshToonMaterial({ color: 0xcfd6ff, transparent: true, opacity: 0.28, depthWrite: false }) }
};

export async function createFigure(host, overlay, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement); renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(32, 1, 0.05, 200);
  camera.position.set(2.6, 1.45, 4.2);
  const controls = new OrbitControls(camera, overlay); controls.target.set(0, 0.95, 0); controls.enableDamping = false; controls.update();
  // outlines: an inverted hull that shares the figure's skeleton, pushed out along the normals by a fixed number of pixels
  const hullMat = new THREE.MeshBasicMaterial({ color: 0x1f1a24, side: THREE.BackSide });
  const hullU = { uPx: { value: 1.6 }, uRes: { value: new THREE.Vector2(1000, 1000) } };
  hullMat.onBeforeCompile = sh => { Object.assign(sh.uniforms, hullU);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
uniform float uPx; uniform vec2 uRes;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
  vec3 nView = normalize(normalMatrix * objectNormal); vec2 dir = length(nView.xy) > 1e-4 ? normalize(nView.xy) : vec2(0.0);
  gl_Position.xy += dir * uPx * 2.0 / uRes * gl_Position.w;`); };
  hullMat.customProgramCacheKey = () => 'hull';
  const outlineOn = on => { if (F) F.hulls.forEach(h => h.visible = on); };
  const ramp = toonRamp(3);

  // light and ground
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8494, 1.25));
  const sun = new THREE.DirectionalLight(0xffffff, 2.1); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -2.5, right: 2.5, top: 2.5, bottom: -2.5, near: 0.1, far: 20 }); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.28 })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const grid = new THREE.GridHelper(10, 20, 0x8b8597, 0x4a4656); grid.material.transparent = true; grid.material.opacity = 0.55; scene.add(grid);

  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const S = { body: 'man', build: 'average', cartoon: 0, style: 'toon', light: { az: 35, el: 50 }, limits: true, sel: null, clip: null, t: 0, playing: false, speed: 1, ground: true, bg: '#f4f1ec' };
  let F = null;                                    // the loaded figure
  const clipCache = {}, listeners = new Set();
  const changed = () => { for (const f of listeners) f(); };

  // ---------- loading a body
  async function loadBody(kind) {
    const g = await loader.loadAsync(ASSETS + BODIES[kind].file);
    const root = g.scene; root.updateMatrixWorld(true);
    const meshes = []; root.traverse(o => { if (o.isSkinnedMesh) { meshes.push(o); o.castShadow = true; o.frustumCulled = false; } });
    // the files store positions, normals and weights as packed integers; reshaping needs plain floats
    for (const m of meshes) for (const k of ['position', 'normal', 'skinWeight']) {
      const a = m.geometry.attributes[k]; if (!a || (!a.isInterleavedBufferAttribute && a.array instanceof Float32Array && !a.normalized)) continue;   // interleaved too: its .array holds other attributes
      const out = new Float32Array(a.count * a.itemSize); for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) out[i * a.itemSize + c] = a.getComponent(i, c);
      m.geometry.setAttribute(k, new THREE.BufferAttribute(out, a.itemSize));
    }
    const skel = meshes[0].skeleton, bones = {}; skel.bones.forEach(b => bones[b.name] = b);
    const rest = {}; for (const b of skel.bones) rest[b.name] = { pos: b.position.clone(), q: b.quaternion.clone(), world: b.matrixWorld.clone(), wq: b.getWorldQuaternion(new THREE.Quaternion()) };
    // what reshaping starts from every time: the vertices, the bind matrix and the skin's own inverse bind matrices
    const orig = meshes.map(m => ({ pos: m.geometry.attributes.position.array.slice(), nrm: m.geometry.attributes.normal.array.slice(), bind: m.bindMatrix.clone(), inv: m.skeleton.boneInverses.map(x => x.clone()) }));
    const hulls = meshes.map(m => { const h = new THREE.SkinnedMesh(m.geometry, hullMat); h.position.copy(m.position); h.quaternion.copy(m.quaternion); h.scale.copy(m.scale); h.frustumCulled = false; h.castShadow = false; m.parent.add(h); h.bind(m.skeleton, m.bindMatrix); return h; });
    const f = { kind, root, meshes, hulls, skel, bones, rest, orig, mixer: new THREE.AnimationMixer(root), pelvisY0: rest.pelvis.world.elements[13] };
    // the rotation each joint's angles are measured in: the parent's rest world rotation
    f.wp = {}; for (const b of skel.bones) f.wp[b.name] = b.parent && b.parent.isBone ? rest[b.parent.name].wq.clone() : (b.parent ? b.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion());
    return f;
  }
  async function setBody(kind) {
    const keep = F ? getPose() : null;
    if (F) { scene.remove(F.root); F.mixer.stopAllAction(); }
    F = await loadBody(kind); S.body = kind; scene.add(F.root);
    reshape(); applyStyle();
    if (keep) setPose(keep, { keepBody: true }); else standing();
    S.clip = null; render(); changed();
  }

  // ---------- re-proportioning in the bind pose (no shear when the joints bend afterwards)
  function reshape() {
    const sc = buildScales(S.build, S.cartoon), f = F, keepQ = {}, keepP = f.bones.pelvis.position.clone();
    f.root.position.y = 0;                         // measure from the body as loaded, not from an earlier reshape
    for (const b of f.skel.bones) { keepQ[b.name] = b.quaternion.clone(); b.quaternion.copy(f.rest[b.name].q); b.position.copy(f.rest[b.name].pos); b.scale.set(1, 1, 1); }
    // new rest offsets: a child sits further along (or wider from) its parent
    for (const b of f.skel.bones) { const p = b.parent; if (!p || !p.isBone) continue; const s = sc[p.name]; if (!s) continue; const o = f.rest[b.name].pos; b.position.set(o.x * s.G, o.y * s.L, o.z * s.G); }
    f.root.updateMatrixWorld(true);
    // per bone: where its vertices sit in the world at rest (the file's own skinning), then the stretch about its joint
    const D = f.skel.bones.map(b => { const s = sc[b.name] || { L: 1, G: 1 }, Ss = new THREE.Matrix4().makeScale(s.G, s.L, s.G); return b.matrixWorld.clone().multiply(Ss).multiply(f.rest[b.name].world.clone().invert()); });
    const box = new THREE.Box3(), world = [];
    f.meshes.forEach((m, mi) => {
      const G = m.geometry, P = G.attributes.position, Nn = G.attributes.normal, si = G.attributes.skinIndex, sw = G.attributes.skinWeight, o = f.orig[mi];
      // M_k = D_k * restWorld_k * inverseBind_k * bind: file vertex -> reshaped world position
      const M = m.skeleton.bones.map((b, k) => D[f.skel.bones.indexOf(b)].clone().multiply(f.rest[b.name].world).multiply(o.inv[k]).multiply(o.bind));
      const NM = M.map(x => new THREE.Matrix3().getNormalMatrix(x));
      const v = new THREE.Vector3(), acc = new THREE.Vector3(), t = new THREE.Vector3(), n = new THREE.Vector3(), nacc = new THREE.Vector3(), out = new Float32Array(P.count * 3);
      for (let i = 0; i < P.count; i++) {
        v.set(o.pos[i * 3], o.pos[i * 3 + 1], o.pos[i * 3 + 2]); n.set(o.nrm[i * 3], o.nrm[i * 3 + 1], o.nrm[i * 3 + 2]); acc.set(0, 0, 0); nacc.set(0, 0, 0);
        for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (!w) continue; const bi = si.getComponent(i, k); acc.addScaledVector(t.copy(v).applyMatrix4(M[bi]), w); nacc.addScaledVector(t.copy(n).applyMatrix3(NM[bi]), w); }
        out.set([acc.x, acc.y, acc.z], i * 3); box.expandByPoint(acc); nacc.normalize(); Nn.setXYZ(i, nacc.x, nacc.y, nacc.z);
      }
      world.push(out);
      // new bind: the mesh as it sits now, and every bone's inverse taken at its new rest
      m.bindMatrix.copy(m.matrixWorld); m.bindMatrixInverse.copy(m.matrixWorld).invert();
      for (let i = 0; i < P.count; i++) { v.fromArray(out, i * 3).applyMatrix4(m.bindMatrixInverse); P.setXYZ(i, v.x, v.y, v.z); }
      m.skeleton.calculateInverses(); f.hulls[mi].bind(m.skeleton, m.bindMatrix);
      P.needsUpdate = Nn.needsUpdate = true; G.computeBoundingBox(); G.computeBoundingSphere();
    });
    f.world = world;
    // stand on the ground: lowest point of the feet at y = 0
    f.height = box.max.y - box.min.y; f.lift = -box.min.y; f.root.position.y = f.lift;
    f.pelvisRatio = (f.bones.pelvis.getWorldPosition(new THREE.Vector3()).y) / f.pelvisY0;
    f.heads = headsTall(f, box);
    computeContour(); f.restPelvis = f.bones.pelvis.position.clone();
    for (const b of f.skel.bones) b.quaternion.copy(keepQ[b.name]);
    if (keepP) f.bones.pelvis.position.copy(f.restPelvis);
    f.root.updateMatrixWorld(true);
    f.clips = {};                                  // clips are re-fitted to the new body when next used
  }
  function headsTall(f, box) {                     // height / head height, the head measured from the vertices that move with it
    let lo = Infinity, hi = -Infinity;
    f.meshes.forEach((m, mi) => { const P = m.geometry.attributes.position, si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight, hb = new Set(m.skeleton.bones.map((b, k) => /^head/.test(b.name) ? k : -1).filter(k => k >= 0)), W = f.world[mi];
      for (let i = 0; i < P.count; i++) { let w = 0; for (let k = 0; k < 4; k++) if (hb.has(si.getComponent(i, k))) w += sw.getComponent(i, k); if (w > 0.5) { const y = W[i * 3 + 1]; lo = Math.min(lo, y); hi = Math.max(hi, y); } } });
    return { height: box.max.y - box.min.y, head: hi - lo, count: (box.max.y - box.min.y) / Math.max(1e-6, hi - lo) };
  }
  function computeContour() {
    const f = F; f.root.updateMatrixWorld(true);
    // each bone measures distance along itself from its joint, starting where its parent's measure is at that joint,
    // so two bones agree where they meet and the weight blend has nothing to tangle. Torso and head run along "up".
    const lift = new THREE.Vector3(0, f.lift || 0, 0), J = {}, dir = {}, off = {};
    for (const b of f.skel.bones) J[b.name] = b.getWorldPosition(new THREE.Vector3()).sub(lift);
    for (const b of f.skel.bones) { const c = b.children.find(x => x.isBone && !/leaf/.test(x.name)) || b.children.find(x => x.isBone); dir[b.name] = c && !/^(root|pelvis|spine|neck|head)/.test(b.name) ? J[c.name].clone().sub(J[b.name]).normalize() : new THREE.Vector3(0, 1, 0); }
    const walk = b => { const p = b.parent; off[b.name] = p && p.isBone ? J[b.name].clone().sub(J[p.name]).dot(dir[p.name]) + off[p.name] : 0; for (const c of b.children) if (c.isBone) walk(c); };
    for (const b of f.skel.bones) if (!b.parent || !b.parent.isBone) walk(b);
    f.meshes.forEach((m, mi) => { const G = m.geometry, P = G.attributes.position, si = G.attributes.skinIndex, sw = G.attributes.skinWeight, out = new Float32Array(P.count), v = new THREE.Vector3(), W = f.world[mi];
      for (let i = 0; i < P.count; i++) { v.fromArray(W, i * 3); let c = 0; for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (!w) continue; const n = m.skeleton.bones[si.getComponent(i, k)].name; c += w * (v.clone().sub(J[n]).dot(dir[n]) + off[n]); } out[i] = c; }
      G.setAttribute('contour', new THREE.BufferAttribute(out, 1)); });
  }

  // ---------- looks
  function applyStyle() {
    const st = STYLES[S.style] || STYLES.toon;
    F.meshes.forEach(m => { if (m.material && m.material.dispose) m.material.dispose(); m.material = st.make(ramp); m.castShadow = !st.xray; m.renderOrder = st.xray ? 1 : 0; });
    ground.visible = S.ground; grid.visible = S.ground; ground.material.opacity = st.shadows ? 0.34 : 0.18; render();
  }
  function placeLight() { const a = S.light.az * DEG, e = S.light.el * DEG; sun.position.set(Math.sin(a) * Math.cos(e) * 6, Math.sin(e) * 6 + 0.5, Math.cos(a) * Math.cos(e) * 6); sun.target.position.set(0, 0.9, 0); }

  // ---------- joint angles
  const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), e1 = new THREE.Euler();
  function dOf(name) {                             // D (body-frame rotation) from the bone's current local rotation
    const b = F.bones[name], wp = F.wp[name], qr = F.rest[name].q;
    return wp.clone().multiply(b.quaternion.clone().multiply(qr.clone().invert())).multiply(wp.clone().invert());
  }
  function setD(name, D) { const wp = F.wp[name]; F.bones[name].quaternion.copy(wp.clone().invert().multiply(D).multiply(wp).multiply(F.rest[name].q)); }
  function eulerOf(name) {                         // the joint's anatomical euler (radians), before sign and mirroring
    const j = jointOf(name); let D = dOf(name); if (j.def.down) D = D.multiply(ARM_DOWN[j.side].clone().invert());
    // every rotation has two euler readings (a, b, c) and (a + 180, 180 - b, c + 180) about the order's axes;
    // take the one that sits inside the joint's range, so an arm raised past level does not read as bent backwards
    const e = e1.setFromQuaternion(D, j.def.order).clone(), o = j.def.order.toLowerCase(), alt = e.clone(), PI = Math.PI;
    alt[o[0]] = e[o[0]] + PI; alt[o[1]] = PI - e[o[1]]; alt[o[2]] = e[o[2]] + PI;
    const wrap = v => Math.atan2(Math.sin(v), Math.cos(v)); for (const a of 'xyz') alt[a] = wrap(alt[a]);
    const cost = E => { let c = 0; for (const [, ax, sign, mn, mx] of j.def.ch) { const v = E[ax] / DEG * sign * (j.side === 'r' && ax !== 'x' ? -1 : 1); c += Math.max(0, v - mx, mn - v); } for (const a of 'xyz') { c += Math.abs(E[a]) * 1e-3; if (j.def.lock != null && !j.def.ch.some(q => q[1] === a)) c += Math.max(0, Math.abs(E[a]) / DEG - j.def.lock); } return c; };
    return cost(alt) < cost(e) ? alt : e;
  }
  function angles(name) {                          // -> [{label, value, min, max}] in degrees, in the joint's own words
    const j = jointOf(name); if (!j) return []; const e = eulerOf(name), mir = j.side === 'r';
    return j.def.ch.map(([label, ax, sign, min, max]) => ({ label, axis: ax, value: e[ax] / DEG * sign * (mir && ax !== 'x' ? -1 : 1), min, max }));
  }
  function setAngles(name, vals, clamp) {          // vals: {axis: degrees in the joint's own words}
    const j = jointOf(name); if (!j) return; const e = eulerOf(name), mir = j.side === 'r';
    for (const [, ax, sign, min, max] of j.def.ch) if (vals[ax] != null) { let v = vals[ax]; if (clamp) v = Math.max(min, Math.min(max, v)); e[ax] = v * DEG * sign * (mir && ax !== 'x' ? -1 : 1); }
    if (clamp && j.def.lock != null) for (const ax of ['x', 'y', 'z']) if (!j.def.ch.some(c => c[1] === ax)) e[ax] = Math.max(-j.def.lock * DEG, Math.min(j.def.lock * DEG, e[ax]));
    let D = new THREE.Quaternion().setFromEuler(e); if (j.def.down) D = D.multiply(ARM_DOWN[j.side]);
    setD(name, D);
  }
  function clampJoint(name) { if (jointOf(name) && !jointOf(name).def.free) { const v = {}; for (const a of angles(name)) v[a.axis] = a.value; setAngles(name, v, true); } }
  function overLimits() {                          // joints bent past a real body's range: [{bone, label, by}]
    const out = []; if (!F) return out;
    for (const n of POSABLE) { const j = jointOf(n); if (!j || j.def.free) continue;
      for (const a of angles(n)) { const by = a.value > a.max ? a.value - a.max : a.value < a.min ? a.min - a.value : 0; if (by > 2) out.push({ bone: n, name: jointName(n), label: a.label, by: Math.round(by) }); }
      if (j.def.lock != null) { const e = eulerOf(n); for (const ax of ['x', 'y', 'z']) if (!j.def.ch.some(c => c[1] === ax) && Math.abs(e[ax]) / DEG > j.def.lock + 4) out.push({ bone: n, name: jointName(n), label: 'twisting sideways', by: Math.round(Math.abs(e[ax]) / DEG - j.def.lock) }); } }
    return out;
  }

  // ---------- poses
  function standing() {
    stopClip();
    for (const b of F.skel.bones) b.quaternion.copy(F.rest[b.name].q);
    F.bones.pelvis.position.copy(F.restPelvis);
    for (const s of ['l', 'r']) { setAngles('upperarm_' + s, { z: 7, x: 2 }); setAngles('lowerarm_' + s, { y: 14 }); setAngles('hand_' + s, { z: 8, x: 0 }); curlFingers(s, 0.18); }
    F.root.updateMatrixWorld(true); render(); changed();
  }
  const FINGERS = ['index', 'middle', 'ring', 'pinky'];
  function curlFingers(side, amt, spread) {        // 0 = flat, 1 = fist. Each finger bends toward the palm
    for (const fg of FINGERS) for (let k = 1; k <= 3; k++) { const n = fg + '_0' + k + '_' + side, b = F.bones[n]; if (!b) continue; const D = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, side === 'l' ? -1 : 1), amt * (k === 1 ? 70 : k === 2 ? 95 : 70) * DEG); setD(n, D); }
    for (let k = 2; k <= 3; k++) { const n = 'thumb_0' + k + '_' + side; if (F.bones[n]) setD(n, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, side === 'l' ? 1 : -1, 0), amt * 35 * DEG)); }
  }
  function getPose() {
    const bones = {}; for (const b of F.skel.bones) bones[b.name] = b.quaternion.toArray().map(v => Math.round(v * 1e6) / 1e6);
    const p = F.bones.pelvis.position, r = F.restPelvis;
    return { kind: 'animtk-figure-pose', version: 1, body: S.body, build: S.build, cartoon: S.cartoon, pelvis: p.toArray().map(v => Math.round(v * 1e6) / 1e6), pelvisRest: r.toArray(), bones };
  }
  function setPose(p) {
    if (!p || !p.bones) return false; stopClip();
    for (const n in p.bones) if (F.bones[n]) F.bones[n].quaternion.fromArray(p.bones[n]);
    if (p.pelvis && p.pelvisRest) { const r0 = new THREE.Vector3().fromArray(p.pelvisRest), k = F.restPelvis.length() / Math.max(1e-6, r0.length()); F.bones.pelvis.position.fromArray(p.pelvis).multiplyScalar(k); }
    F.root.updateMatrixWorld(true); render(); changed(); return true;
  }

  // ---------- dragging: two-bone IK for wrists and ankles, aim for the rest, move for the hips
  const wpos = n => F.bones[n].getWorldPosition(new THREE.Vector3());
  function setWorldQ(b, qw) { const pq = b.parent.getWorldQuaternion(new THREE.Quaternion()); b.quaternion.copy(pq.invert().multiply(qw)); b.updateMatrixWorld(true); }
  function swing(bone, from, to) {                 // turn a bone (in world) so the direction 'from' points along 'to'
    const b = F.bones[bone], r = new THREE.Quaternion().setFromUnitVectors(from.clone().normalize(), to.clone().normalize());
    setWorldQ(b, r.multiply(b.getWorldQuaternion(new THREE.Quaternion())));
  }
  const CHAINS = { hand_l: ['upperarm_l', 'lowerarm_l'], hand_r: ['upperarm_r', 'lowerarm_r'], foot_l: ['thigh_l', 'calf_l'], foot_r: ['thigh_r', 'calf_r'] };
  function reach(end, target, keepEndWorld) {
    const [up, mid] = CHAINS[end], keepQ = keepEndWorld || F.bones[end].getWorldQuaternion(new THREE.Quaternion());
    const s = wpos(up), m = wpos(mid), w = wpos(end), a = s.distanceTo(m), b = m.distanceTo(w);
    const c = Math.max(Math.abs(a - b) + 1e-4, Math.min(a + b - 1e-4, s.distanceTo(target)));
    const inner = Math.acos(Math.max(-1, Math.min(1, (a * a + b * b - c * c) / (2 * a * b))));   // angle at the elbow / knee
    const j = jointOf(mid), ax = j.def.hinge, upB = F.bones[up];
    // the rest pose is not perfectly straight, so solve the bend that makes shoulder-to-wrist (hip-to-ankle) exactly c
    const span = deg => { setAngles(mid, { [ax]: deg }, false); upB.updateMatrixWorld(true); return wpos(up).distanceTo(wpos(end)); };
    let lo = -10, hi = 179; if (span(lo) <= c) hi = lo; else for (let it = 0; it < 26; it++) { const md = (lo + hi) / 2; if (span(md) > c) lo = md; else hi = md; }
    span(hi); F.root.updateMatrixWorld(true); void inner;
    swing(up, wpos(end).sub(s), target.clone().sub(s)); F.root.updateMatrixWorld(true);
    if (S.limits) { clampJoint(up); F.root.updateMatrixWorld(true); }
    setWorldQ(F.bones[end], keepQ); if (S.limits) clampJoint(end); F.root.updateMatrixWorld(true);
  }
  function aim(bone, target) {                     // drag a joint: its parent turns to point it at the target
    const b = F.bones[bone], p = b.parent; if (!p || !p.isBone || !jointOf(p.name)) return;
    const pp = wpos(p.name); swing(p.name, wpos(bone).sub(pp), target.clone().sub(pp)); if (S.limits) clampJoint(p.name); F.root.updateMatrixWorld(true);
  }
  function moveHips(target, plant) {
    const feet = plant ? ['foot_l', 'foot_r'].map(n => [n, wpos(n), F.bones[n].getWorldQuaternion(new THREE.Quaternion())]) : [];
    const p = F.bones.pelvis, wp = wpos('pelvis'), d = target.clone().sub(wp);
    p.parent.updateWorldMatrix(true, false); p.position.copy(p.parent.worldToLocal(wp.clone().add(d))); F.root.updateMatrixWorld(true);
    for (const [n, at, q] of feet) reach(n, at, q);
  }

  // ---------- clips
  const CLIPS = [
    ['Walks', [['walk', 'Walk'], ['walk-relaxed', 'Relaxed walk'], ['walk-female', 'Walk (hips)'], ['walk-happy', 'Bouncy walk'], ['walk-large', 'Heavy walk'], ['walk-stealth', 'Sneak'], ['walk-cautious', 'Cautious walk'], ['walk-injured', 'Limp'], ['walk-carry', 'Carrying'], ['walk-backwards', 'Walk backwards']]],
    ['Runs and jumps', [['jog', 'Jog'], ['run-female', 'Run'], ['sprint', 'Sprint'], ['jump-2', 'Jump'], ['jump-start', 'Jump: push off'], ['jump-air', 'Jump: in the air'], ['jump-land', 'Jump: land']]],
    ['Bend, sit, kneel', [['pick-up', 'Pick up from the floor'], ['pickup-table', 'Pick up from a table'], ['crouch-idle', 'Crouch'], ['crouch-walk', 'Crouch walk'], ['kneel', 'Kneel'], ['sitting-enter', 'Sit down'], ['sitting-idle', 'Sitting'], ['sitting-exit', 'Stand up'], ['sit-ground-idle', 'Sit on the floor']]],
    ['Reach and act', [['interact', 'Reach out'], ['open-door', 'Open a door'], ['knock', 'Knock'], ['push', 'Push'], ['throw-ball', 'Throw'], ['greeting', 'Wave hello'], ['clapping', 'Clap'], ['yes', 'Nod yes'], ['head-nod', 'Small nod']]],
    ['Moods', [['tired-hunched', 'Tired, hunched'], ['idle-a', 'Standing idle'], ['idle-subtle', 'Weight shift'], ['idle-foldarms', 'Arms folded'], ['angry', 'Angry'], ['confused', 'Confused'], ['victory', 'Victory']]]
  ];
  async function clipFor(id) {
    if (!clipCache[id]) { const g = await loader.loadAsync(ASSETS + 'animations/' + id + '.glb'); clipCache[id] = g.animations[0]; }
    if (!F.clips[id]) {                            // keep only rotations, plus the hips' travel scaled to this body
      const src = clipCache[id], tracks = [];
      for (const t of src.tracks) { const [bone, prop] = t.name.split('.'); if (!F.bones[bone]) continue;
        if (prop === 'quaternion') tracks.push(t.clone());
        else if (prop === 'position' && bone === 'pelvis') { const c = t.clone(); c.values = c.values.slice(); for (let i = 0; i < c.values.length; i++) c.values[i] *= F.pelvisRatio; tracks.push(c); } }
      F.clips[id] = new THREE.AnimationClip(src.name, src.duration, tracks);
    }
    return F.clips[id];
  }
  async function playClip(id, opts2 = {}) {
    const clip = await clipFor(id); F.mixer.stopAllAction();
    const act = F.mixer.clipAction(clip); act.reset(); act.play(); act.paused = true; act.setLoop(THREE.LoopRepeat);
    S.clip = { id, act, clip, dur: clip.duration, label: (CLIPS.flatMap(g => g[1]).find(c => c[0] === id) || [id, id])[1] };
    S.clip.keys = keyPoses(S.clip); seek(0); if (opts2.play) play(); changed();
  }
  function seek(t) { if (!S.clip) return; S.t = ((t % S.clip.dur) + S.clip.dur) % S.clip.dur; S.clip.act.time = S.t; F.mixer.update(0); F.root.updateMatrixWorld(true); render(); }
  function stopClip() { if (S.clip) { F.mixer.stopAllAction(); S.clip = null; S.playing = false; } }
  function freeze() {                              // turn the frame on screen into a still pose that can be edited
    if (!S.clip) return; const p = getPose(); const lbl = S.clip.label + ', frame ' + frameOf(S.t); stopClip(); setPose(p); S.frozeFrom = lbl;
  }
  let last = 0, raf = 0;
  function play() { if (!S.clip) return; S.playing = true; last = performance.now(); cancelAnimationFrame(raf); const step = now => { if (!S.playing) return; seek(S.t + (now - last) / 1000 * S.speed); last = now; changed(); raf = requestAnimationFrame(step); }; raf = requestAnimationFrame(step); }
  function pause() { S.playing = false; cancelAnimationFrame(raf); changed(); }
  const FPS = 24, frameOf = t => Math.round(t * FPS) + 1;
  // contact / down / passing / up, found from the feet and the hips (walks and runs only)
  function keyPoses(c) {
    const loco = /walk|jog|run|sprint|sneak|limp|carry/i.test(c.id + ' ' + c.label); if (!loco) return [];
    const n = Math.max(2, Math.round(c.dur * FPS)), rows = [];
    for (let i = 0; i < n; i++) { c.act.time = i / FPS; F.mixer.update(0); F.root.updateMatrixWorld(true);
      const hip = wpos('pelvis'), l = wpos('foot_l'), r = wpos('foot_r'); rows.push({ i, hy: hip.y, dz: l.z - r.z, ly: l.y, ry: r.y }); }
    const out = [], at = (i, k) => rows[((i % n) + n) % n][k];
    for (let i = 0; i < n; i++) {
      const dz = at(i, 'dz'), pd = at(i - 1, 'dz'), nd = at(i + 1, 'dz');
      if (Math.abs(dz) >= Math.abs(pd) && Math.abs(dz) > Math.abs(nd) && Math.abs(dz) > 0.08) out.push({ frame: i + 1, kind: 'contact', label: 'Contact (' + (dz > 0 ? 'its left' : 'its right') + ' foot forward)' });
      if (Math.sign(dz) !== Math.sign(nd) && Math.abs(dz) < 0.25) out.push({ frame: i + 1, kind: 'passing', label: 'Passing' });
    }
    const contacts = out.filter(k => k.kind === 'contact').map(k => k.frame - 1).sort((a, b) => a - b);
    for (let k = 0; k < contacts.length; k++) {   // between two contacts: the lowest hips = down, the highest = up
      const a = contacts[k], b = k + 1 < contacts.length ? contacts[k + 1] : contacts[0] + n; let lo = a, hi = a;
      for (let i = a; i <= b; i++) { if (at(i, 'hy') < at(lo, 'hy')) lo = i; if (at(i, 'hy') > at(hi, 'hy')) hi = i; }
      if (lo !== a) out.push({ frame: (lo % n) + 1, kind: 'down', label: 'Down' }); if (hi !== a && hi !== b) out.push({ frame: (hi % n) + 1, kind: 'up', label: 'Up' });
    }
    c.act.time = 0; F.mixer.update(0);
    const seen = new Set(); return out.filter(k => { const key = k.frame + k.kind; if (seen.has(key)) return false; seen.add(key); return true; }).sort((a, b) => a.frame - b.frame);
  }

  // ---------- drawing
  function size() { const r = host.getBoundingClientRect(); return [Math.max(2, Math.round(r.width)), Math.max(2, Math.round(r.height))]; }
  // the figure through someone else's camera (the Perspective tab's), on transparent, as an N x N square picture.
  // v: {pos, right, up, back: three.js world vectors (metres), theta: half-angle of the square view (radians), N,
  //     place: {x, z, yaw, height} (metres, radians), outlinePx}
  const tcam = new THREE.PerspectiveCamera(60, 1, 0.02, 2000); tcam.matrixAutoUpdate = false;
  function renderThrough(v) {
    if (!F) return null;
    const keep = { pr: renderer.getPixelRatio(), size: renderer.getSize(new THREE.Vector2()), pos: F.root.position.clone(), q: F.root.quaternion.clone(), s: F.root.scale.clone(), g: ground.visible, gr: grid.visible };
    const s = v.place.height / F.height; F.root.scale.setScalar(s); F.root.position.set(v.place.x, F.lift * s, v.place.z); F.root.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), v.place.yaw); F.root.updateMatrixWorld(true);
    tcam.fov = 2 * v.theta / DEG; tcam.aspect = 1; tcam.updateProjectionMatrix();
    tcam.matrixWorld.makeBasis(new THREE.Vector3(...v.right), new THREE.Vector3(...v.up), new THREE.Vector3(...v.back)).setPosition(new THREE.Vector3(...v.pos)); tcam.matrixWorldInverse.copy(tcam.matrixWorld).invert();
    placeLight(); sun.position.add(new THREE.Vector3(v.place.x, 0, v.place.z)); sun.target.position.set(v.place.x, 0.9 * v.place.height / 1.8, v.place.z);
    ground.visible = grid.visible = false; renderer.setPixelRatio(1); renderer.setSize(v.N, v.N, false); renderer.setClearColor(0x000000, 0);
    hullU.uRes.value.set(v.N, v.N); hullU.uPx.value = v.outlinePx || 1.6; outlineOn(!!(STYLES[S.style] || {}).outline);
    renderer.render(scene, tcam);
    const c = document.createElement('canvas'); c.width = c.height = v.N; c.getContext('2d').drawImage(renderer.domElement, 0, 0, v.N, v.N);
    F.root.position.copy(keep.pos); F.root.quaternion.copy(keep.q); F.root.scale.copy(keep.s); F.root.updateMatrixWorld(true); ground.visible = keep.g; grid.visible = keep.gr;
    renderer.setPixelRatio(keep.pr); renderer.setSize(keep.size.x, keep.size.y, false); render();
    return c;
  }
  function render() {
    if (!F) return; const [w, h] = size();
    if (renderer.domElement.width !== Math.round(w * renderer.getPixelRatio()) || renderer.domElement.height !== Math.round(h * renderer.getPixelRatio())) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
    placeLight(); renderer.setClearColor(new THREE.Color(S.bg), S.bg === 'transparent' ? 0 : 1);
    hullU.uRes.value.set(w, h); hullU.uPx.value = 1.6; outlineOn(!!(STYLES[S.style] || {}).outline);
    renderer.render(scene, camera);
    drawOverlay();
  }
  const proj = (v, w, h) => { const p = v.clone().project(camera); return [(p.x + 1) / 2 * w, (1 - p.y) / 2 * h, p.z]; };
  function drawOverlay() {
    const [w, h] = size(), dpr = window.devicePixelRatio || 1; if (overlay.width !== Math.round(w * dpr) || overlay.height !== Math.round(h * dpr)) { overlay.width = Math.round(w * dpr); overlay.height = Math.round(h * dpr); }
    const g = overlay.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h); if (!F) return;
    F.root.updateMatrixWorld(true);
    const st = STYLES[S.style] || {};
    if (st.xray || S.showBones) {                  // the skeleton, drawn on top
      g.lineCap = 'round';
      for (const b of F.skel.bones) { const p = b.parent; if (!p || !p.isBone || /leaf/.test(b.name)) continue; const a = proj(wpos(p.name), w, h), c = proj(wpos(b.name), w, h); g.strokeStyle = /index|middle|ring|pinky|thumb/.test(b.name) ? 'rgba(40,60,170,.6)' : 'rgba(30,50,160,.85)'; g.lineWidth = /index|middle|ring|pinky|thumb/.test(b.name) ? 1.2 : 2.6; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(c[0], c[1]); g.stroke(); }
    }
    const over = S.limits ? [] : overLimits(), flagged = new Set(overLimits().map(o => o.bone));
    for (const n of POSABLE) {
      const p = proj(wpos(n), w, h), sel = S.sel === n, bad = flagged.has(n), r = sel ? 7 : n === 'pelvis' ? 6.5 : 4.6;
      if (bad) { g.strokeStyle = '#ff5fa2'; g.lineWidth = 2.5; g.beginPath(); g.arc(p[0], p[1], r + 6, 0, 7); g.stroke(); }
      g.fillStyle = sel ? '#ff2f86' : n === 'pelvis' ? '#e8a020' : /hand|foot/.test(n) ? '#2fbf71' : '#3b6cff'; g.strokeStyle = '#fff'; g.lineWidth = 1.6;
      g.beginPath(); if (n === 'pelvis') { g.moveTo(p[0], p[1] - r); g.lineTo(p[0] + r, p[1]); g.lineTo(p[0], p[1] + r); g.lineTo(p[0] - r, p[1]); g.closePath(); } else g.arc(p[0], p[1], r, 0, 7); g.fill(); g.stroke();
    }
    if (opts.onOverlay) opts.onOverlay(g, w, h, over);
  }
  function pickJoint(x, y) { const [w, h] = size(); let best = null, bd = 14; for (const n of POSABLE) { const p = proj(wpos(n), w, h), d = Math.hypot(p[0] - x, p[1] - y); if (d < bd) { bd = d; best = n; } } return best; }
  // a picture at any size (for export): the figure only on transparent, or with the ground and background
  function snapshot(W, H, transparent) {
    const keep = { pr: renderer.getPixelRatio(), size: renderer.getSize(new THREE.Vector2()), aspect: camera.aspect, bg: S.bg, g: ground.visible, gr: grid.visible };
    renderer.setPixelRatio(1); renderer.setSize(W, H, false); camera.aspect = W / H; camera.updateProjectionMatrix();
    if (transparent) { S.bg = 'transparent'; ground.visible = grid.visible = false; }
    renderer.setClearColor(new THREE.Color(S.bg === 'transparent' ? '#000' : S.bg), S.bg === 'transparent' ? 0 : 1); placeLight();
    hullU.uRes.value.set(W, H); hullU.uPx.value = 1.6 * Math.max(1, H / Math.max(1, keep.size.y)); outlineOn(!!(STYLES[S.style] || {}).outline);
    renderer.render(scene, camera);
    const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').drawImage(renderer.domElement, 0, 0, W, H);
    S.bg = keep.bg; ground.visible = keep.g; grid.visible = keep.gr; renderer.setPixelRatio(keep.pr); renderer.setSize(keep.size.x, keep.size.y, false); camera.aspect = keep.aspect; camera.updateProjectionMatrix(); render();
    return c;
  }

  // ---------- mouse: dots pose, empty space orbits (right drag pans, wheel zooms)
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(), hitP = new THREE.Vector3();
  let drag = null;
  function pointOnPlane(e) { const r = overlay.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * 2 - 1, y = -(e.clientY - r.top) / r.height * 2 + 1; ray.setFromCamera({ x, y }, camera); return ray.ray.intersectPlane(plane, hitP) ? hitP.clone() : null; }
  overlay.addEventListener('pointerdown', e => {
    if (!F || e.button !== 0) return; const r = overlay.getBoundingClientRect(), n = pickJoint(e.clientX - r.left, e.clientY - r.top); if (!n) return;
    e.stopImmediatePropagation(); e.preventDefault(); overlay.setPointerCapture(e.pointerId);
    if (S.clip) freeze(); S.sel = n; opts.onPick && opts.onPick(n);
    plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), wpos(n)); drag = { n, undo: getPose() }; opts.onUndoPoint && opts.onUndoPoint(drag.undo); render(); changed();
  }, { capture: true });
  overlay.addEventListener('pointermove', e => {
    if (!drag) { const r = overlay.getBoundingClientRect(); overlay.style.cursor = F && pickJoint(e.clientX - r.left, e.clientY - r.top) ? 'grab' : 'default'; return; }
    const t = pointOnPlane(e); if (!t) return; const n = drag.n;
    if (n === 'pelvis') moveHips(t, S.plant !== false); else if (CHAINS[n]) reach(n, t); else aim(n, t);
    render(); changed();
  });
  overlay.addEventListener('pointerup', () => { drag = null; });
  controls.addEventListener('change', () => render());
  new ResizeObserver(() => render()).observe(host);

  await setBody(opts.body || 'man');
  return {
    THREE, S, scene, camera, controls, renderer, get F() { return F; }, JOINTS, POSABLE, BODIES, BUILDS, STYLES, CLIPS,
    setBody, render, jointName, angles, setAngles: (n, v, c) => { setAngles(n, v, c ?? S.limits); F.root.updateMatrixWorld(true); render(); changed(); },
    setBuild: (b, cartoon) => { const p = getPose(); if (b != null) S.build = b; if (cartoon != null) S.cartoon = cartoon; const c = S.clip && S.clip.id, t = S.t; stopClip(); reshape(); setPose(p); if (c) playClip(c).then(() => seek(t)); render(); changed(); },
    setStyle: s => { S.style = s; applyStyle(); changed(); }, setLight: (az, el) => { S.light = { az, el }; render(); }, curlFingers: (s, a) => { if (S.clip) freeze(); curlFingers(s, a); F.root.updateMatrixWorld(true); render(); changed(); },
    standing, getPose, setPose, renderThrough, moveHips: (t, plant) => { moveHips(t, plant); render(); }, overLimits, playClip, seek, play, pause, freeze, stopClip, frameOf, FPS, snapshot, pickJoint, reach: (n, t) => { reach(n, t); render(); }, wpos, proj: v => proj(v, ...size()),
    on: f => listeners.add(f), heads: () => F.heads
  };
}
