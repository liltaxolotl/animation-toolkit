// Checks that the camera math inside animation_app.html matches animtk/scene3d.py.
//   node tests/test_app_core.mjs
// It pulls the CORE block out of the HTML, runs it, asks Python for the same projections,
// and compares the numbers.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = fs.readFileSync(path.join(root, 'animation_app.html'), 'utf8');
const core = html.split('/*CORE-START*/')[1].split('/*CORE-END*/')[0];
const AT = new Function(core + '; return AT;')();

const cams = [
  { pos: [0, 5, 0], yaw: 0, pitch: 0, roll: 0, fov: 60, k: 1, skew: 0 },
  { pos: [1, 4, -2], yaw: 12, pitch: -8, roll: 7, fov: 95, k: 0.6, skew: 5 },
  { pos: [-2, 6, 1], yaw: -40, pitch: 15, roll: -12, fov: 150, k: 0.05, skew: -10 },
  { pos: [0.5, 5, 0], yaw: 20, pitch: -25, roll: 3, fov: 70, k: 0.8, skew: 4, shift: [310, -140] },     // a lens centre off the middle (3 point)
];
const pts = [[2, 1, 9], [-3, 0, 6], [0.5, 7, 12], [4, 2, 3], [-1, 0.5, 20]];
const py = `
import sys, json
sys.path.insert(0, r'${root.replace(/\\/g, '/')}')
import numpy as np
from animtk import scene3d as S
cams = json.loads(sys.argv[1]); pts = np.array(json.loads(sys.argv[2]), float); out = []
for c in cams:
    cam = S.Camera.from_dict(c, 3840, 1920)
    door = S.place(S.prop_door(3, 6.8, 50, 'right', frame=False), (1, 0, 8), 30)
    panel = [np.asarray(d[1]).tolist() for d in door if d[0] == 'poly'][0]   # first face of the swung panel
    vp = cam.vanishing_point((0, 0, 1))
    out.append(dict(uv=cam.project(pts).tolist(), vp=None if vp is None else vp.tolist(), R=cam.R.tolist(),
                    ray=cam.ray((700, 400)).tolist(), panel=cam.project(np.array(panel)).tolist()))
vz, vx = [2500.0, 700.0], [-3000.0, 820.0]
c2, notes = S.camera_from_vps(vz, vx, W=3840, H=1920)
out.append(dict(fov=c2.fov, R=c2.R.tolist()))
for t in json.loads(sys.argv[3]):
    c3, n3 = S.camera_from_vps(t['A'], t['B'], W=3840, H=1920, k=t['k'], skew=t['skew'], vp_up=t['V'])
    out.append(dict(fov=c3.fov, R=c3.R.tolist(), shift=[c3.ox, c3.oy]))
print(json.dumps(out))
`;
// three point drawings: cameras whose lens centre is off the middle, and the three vanishing points they give
const threeTruth = [{ yaw: 25, pitch: -30, roll: 4, fov: 80, k: 1, skew: 0, shift: [200, -120] }, { yaw: -35, pitch: 22, roll: -6, fov: 65, k: 0.7, skew: 5, shift: [-260, 90] }];
const three = threeTruth.map(t => { const c = AT.makeCamera({ ...t, pos: [0, 5, 0], W: 3840, H: 1920 }); return { A: AT.vanishingPoint(c, [0, 0, 1]), B: AT.vanishingPoint(c, [1, 0, 0]), V: AT.vanishingPoint(c, [0, 1, 0]), k: t.k, skew: t.skew, cam: c }; });
const res = JSON.parse(execFileSync('python', ['-c', py, JSON.stringify(cams), JSON.stringify(pts), JSON.stringify(three.map(t => ({ A: t.A, B: t.B, V: t.V, k: t.k, skew: t.skew })))], { encoding: 'utf8' }));

let fails = 0;
const close = (a, b, tol) => Math.abs(a - b) <= tol;
const check = (name, ok, detail) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  ' + detail : '')); if (!ok) fails++; };

cams.forEach((c, i) => {
  const cam = AT.makeCamera({ ...c, W: 3840, H: 1920 });
  let worst = 0;
  pts.forEach((p, j) => { const uv = AT.project(cam, p); worst = Math.max(worst, Math.abs(uv[0] - res[i].uv[j][0]), Math.abs(uv[1] - res[i].uv[j][1])); });
  check(`camera ${i + 1}: projection matches Python`, worst < 1e-6, `worst difference ${worst.toExponential(2)} px`);
  const R = cam.R.flat(), Rp = res[i].R.flat();
  check(`camera ${i + 1}: rotation matches`, R.every((v, k) => close(v, Rp[k], 1e-9)));
  const ray = AT.ray(cam, [700, 400]);
  check(`camera ${i + 1}: pixel ray matches`, ray.every((v, k) => close(v, res[i].ray[k], 1e-9)));
  const vp = AT.vanishingPoint(cam, [0, 0, 1]);
  check(`camera ${i + 1}: vanishing point matches`, (vp === null) === (res[i].vp === null) && (!vp || (close(vp[0], res[i].vp[0], 1e-5) && close(vp[1], res[i].vp[1], 1e-5))));
  // door with right hinge, swung 50, turned 30: compare one face of the panel
  const g = AT.propWorld({ type: 'door', pos: [1, 0, 8], rot: 30, w: 3, h: 6.8, swing: 50, hinge: 'right' }, cam.C);
  const jsPanel = g.faces[0].map(p => AT.project(cam, p));     // z = -t/2 face of the panel box
  const pyPanel = res[i].panel;
  const d = Math.max(...jsPanel.map(q => Math.min(...pyPanel.map(r => Math.hypot(q[0] - r[0], q[1] - r[1])))));
  check(`camera ${i + 1}: swung door lands on the same pixels`, d < 1e-5, `worst corner difference ${d.toExponential(2)} px`);
  const a = AT.rToAngles(cam.R);
  check(`camera ${i + 1}: angles survive a round trip`, close(a.yaw, c.yaw, 1e-6) && close(a.pitch, c.pitch, 1e-6) && close(a.roll, c.roll, 1e-6));
});
const two = AT.cameraFromVPs([2500, 700], [-3000, 820], null, { W: 3840, H: 1920, k: 1, skew: 0, fov: 60 });
const r2 = res[cams.length];
check('two vanishing points: solved lens width matches Python', close(two.fov, r2.fov, 1e-6), `${two.fov.toFixed(3)} vs ${r2.fov.toFixed(3)}`);
check('two vanishing points: rotation matches Python', two.R.flat().every((v, k) => close(v, r2.R.flat()[k], 1e-7)));
three.forEach((t, i) => { const tr = threeTruth[i], got = AT.cameraFromVPs(t.A, t.B, t.V, { W: 3840, H: 1920, k: t.k, skew: t.skew, fov: 60 }), pyr = res[cams.length + 1 + i], kind = t.k === 1 ? 'plain lens' : 'bent, skewed lens';
  check(`three vanishing points (${kind}): the lens width and lens centre come back`, got.solved && got.shift && close(got.fov, tr.fov, 1e-3) && close(got.shift[0], tr.shift[0], 0.05) && close(got.shift[1], tr.shift[1], 0.05), got.shift ? `lens ${got.fov.toFixed(3)}, centre ${got.shift.map(v => v.toFixed(2))}` : got.notes.join(' '));
  check(`three vanishing points (${kind}): the camera faces the same way`, got.R.flat().every((v, k) => close(v, t.cam.R.flat()[k], 1e-5)));
  check(`three vanishing points (${kind}): matches Python`, close(got.fov, pyr.fov, 1e-5) && close(got.shift[0], pyr.shift[0], 1e-3) && close(got.shift[1], pyr.shift[1], 1e-3) && got.R.flat().every((v, k) => close(v, pyr.R.flat()[k], 1e-6))); });
const flatTri = AT.cameraFromVPs([1000, 900], [3000, 900], [2000, 890], { W: 3840, H: 1920, k: 1, skew: 0, fov: 60 });
check('three points that no lens can make square: says so, and falls back to depth + side', !flatTri.shift && flatTri.solved && /upright point is left out/.test(flatTri.notes.join(' ')));
const vp = AT.lsqPoint([{ a: [0, 0], b: [100, 100] }, { a: [0, 200], b: [100, 100] }, { a: [50, 0], b: [80, 60] }]);
check('line intersection: three lines through (100,100)', close(vp[0], 100, 1e-6) && close(vp[1], 100, 1e-6));

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
