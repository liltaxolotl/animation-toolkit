// ============================== FIGURE 3D: the tab ==============================
import { createFigure } from './figure3d.mjs';

export async function start() {
  const host = $('#fHost'), over = $('#fOver');
  const F = await createFigure(host, over, {
    onPick: n => syncJoint(n),
    onUndoPoint: p => pushUndo(p)
  });
  window.Fig3D = F;
  const undo = [];
  const pushUndo = p => { undo.push(p || F.getPose()); if (undo.length > 60) undo.shift(); };
  const KEYCOL = { contact: '#ff5560', down: '#4d8dff', passing: '#2fbf71', up: '#ffa23a' };

  // ---------- body
  $$('[data-fbody]').forEach(b => b.onclick = async () => { b.disabled = true; await F.setBody(b.dataset.fbody); b.disabled = false; sync(); });
  $('#fBuild').onchange = e => F.setBuild(e.target.value, null);
  $('#fCartoon').oninput = e => { $('#fCartoon').nextElementSibling.textContent = e.target.value + '%'; };
  $('#fCartoon').onchange = e => F.setBuild(null, +e.target.value / 100);

  // ---------- look
  const sty = $('#fStyles'); sty.innerHTML = Object.entries(F.STYLES).map(([k, s]) => '<button data-fstyle="' + k + '">' + s.label + '</button>').join('');
  $$('[data-fstyle]').forEach(b => b.onclick = () => F.setStyle(b.dataset.fstyle));
  const light = () => { F.setLight(+$('#fAz').value, +$('#fEl').value); $('#fAz').nextElementSibling.textContent = $('#fAz').value + '°'; $('#fEl').nextElementSibling.textContent = $('#fEl').value + '°'; };
  $('#fAz').oninput = light; $('#fEl').oninput = light; light();
  $('#fGround').onchange = e => { F.S.ground = e.target.checked; F.setStyle(F.S.style); };
  $('#fBones').onchange = e => { F.S.showBones = e.target.checked; F.render(); };

  // ---------- actions
  $('#fClips').innerHTML = F.CLIPS.map(([g, list]) => '<div class="muted" style="margin:6px 0 3px">' + g + '</div><div class="grid2">' + list.map(([id, l]) => '<button data-fclip="' + id + '" style="font-size:12px">' + l + '</button>').join('') + '</div>').join('');
  $$('[data-fclip]').forEach(b => b.onclick = async () => { pushUndo(); $$('[data-fclip]').forEach(x => x.classList.toggle('on', x === b)); await F.playClip(b.dataset.fclip, { play: true }); sync(); });
  $('#fPlay').onclick = () => { if (!F.S.clip) return; F.S.playing ? F.pause() : F.play(); sync(); };
  $('#fSpeed').oninput = e => { F.S.speed = +e.target.value / 100; $('#fSpeedO').textContent = e.target.value + '%'; };
  $('#fFreeze').onclick = () => { if (!F.S.clip) return; pushUndo(); F.freeze(); $$('[data-fclip]').forEach(x => x.classList.remove('on')); sync(); };

  // ---------- timeline
  const tl = $('#fTime');
  function drawTime() {
    const r = tl.getBoundingClientRect(), dpr = window.devicePixelRatio || 1; tl.width = Math.round(r.width * dpr); tl.height = Math.round(r.height * dpr);
    const g = tl.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, r.width, r.height);
    const c = F.S.clip; if (!c) { g.fillStyle = '#a6a1b4'; g.font = '12px system-ui'; g.fillText(F.S.frozeFrom ? 'Still pose (from ' + F.S.frozeFrom + '). Pick an action to play one.' : 'Pick an action on the left to play it here.', 6, 26); return; }
    const n = Math.max(1, Math.round(c.dur * F.FPS)), x0 = 8, w = r.width - 16, px = f => x0 + (f - 1) / Math.max(1, n - 1) * w;
    g.strokeStyle = '#3b3846'; g.lineWidth = 1; for (let f = 1; f <= n; f++) { const x = px(f); g.beginPath(); g.moveTo(x, f % 6 === 1 ? 4 : 10); g.lineTo(x, 18); g.stroke(); }
    g.fillStyle = '#a6a1b4'; g.font = '10px system-ui'; for (let f = 1; f <= n; f += 6) g.fillText(String(f), px(f) + 2, 30);
    for (const k of c.keys || []) { const x = px(k.frame); g.fillStyle = KEYCOL[k.kind] || '#fff'; g.beginPath(); g.moveTo(x, 34); g.lineTo(x + 5, 39); g.lineTo(x, 44); g.lineTo(x - 5, 39); g.closePath(); g.fill(); }
    const f = F.frameOf(F.S.t), x = px(Math.min(n, f)); g.strokeStyle = '#ff8fb8'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 46); g.stroke();
  }
  let scrub = false;
  const scrubTo = e => { const c = F.S.clip; if (!c) return; const r = tl.getBoundingClientRect(), n = Math.max(1, Math.round(c.dur * F.FPS)), f = Math.round((e.clientX - r.left - 8) / (r.width - 16) * (n - 1)) + 1; F.pause(); F.seek((Math.max(1, Math.min(n, f)) - 1) / F.FPS); sync(); };
  tl.addEventListener('pointerdown', e => { scrub = true; tl.setPointerCapture(e.pointerId); scrubTo(e); });
  tl.addEventListener('pointermove', e => { if (scrub) scrubTo(e); });
  tl.addEventListener('pointerup', () => { scrub = false; });

  // ---------- the selected joint
  function syncJoint(n) {
    n = n || F.S.sel; const el = $('#fJoint'); $('#fJointName').textContent = n ? F.jointName(n) : 'Click a dot'; el.innerHTML = ''; if (!n) return;
    for (const a of F.angles(n)) {
      const row = document.createElement('div'); row.className = 'sl'; row.style.gridTemplateColumns = '1fr'; const lim = F.S.limits && n !== 'pelvis';
      row.innerHTML = '<label style="display:flex;justify-content:space-between"><span>' + a.label + '</span><output>' + Math.round(a.value) + '°</output></label><input type="range" step="1" min="' + (lim ? a.min : -180) + '" max="' + (lim ? a.max : 180) + '" value="' + Math.round(a.value) + '">' +
        '<div class="muted" style="font-size:11px">real range ' + a.min + '° to ' + a.max + '°</div>';
      const inp = row.querySelector('input'); inp.addEventListener('pointerdown', () => { if (F.S.clip) { F.freeze(); sync(); } pushUndo(); });
      inp.oninput = () => { F.setAngles(n, { [a.axis]: +inp.value }); row.querySelector('output').textContent = inp.value + '°'; syncOver(); };
      el.appendChild(row);
    }
  }
  $('#fJointReset').onclick = () => { const n = F.S.sel; if (!n) return; pushUndo(); if (F.S.clip) F.freeze(); const v = {}; for (const a of F.angles(n)) v[a.axis] = 0; F.setAngles(n, v); syncJoint(n); syncOver(); };

  // ---------- posing
  $('#fLimits').onchange = e => { F.S.limits = e.target.checked; syncJoint(); F.render(); syncOver(); };
  $('#fPlant').onchange = e => { F.S.plant = e.target.checked; };
  $('#fHands').onchange = e => { pushUndo(); F.curlFingers('l', +e.target.value); F.curlFingers('r', +e.target.value); };
  $('#fStand').onclick = () => { pushUndo(); F.standing(); $$('[data-fclip]').forEach(x => x.classList.remove('on')); F.S.frozeFrom = null; sync(); };
  $('#fUndo').onclick = () => { const p = undo.pop(); if (p) { F.setPose(p); sync(); } };
  function syncOver() {
    const o = F.overLimits(); $('#fOverList').innerHTML = !o.length ? 'Every joint is inside a real body\'s range.' :
      '<b style="color:#ff8fb8">Past a real body\'s range (ringed):</b><br>' + o.slice(0, 8).map(x => x.name + ': ' + x.label.toLowerCase() + ', ' + x.by + '° past').join('<br>') + '<br>A heads up, not a rule: breaking a joint for a frame or two is a real technique.';
  }

  // ---------- save
  $('#fSavePose').onclick = () => { const p = F.getPose(); download(new Blob([JSON.stringify(p, null, 1)], { type: 'application/json' }), 'figure_pose.json'); $('#fSaveInfo').textContent = 'Saved figure_pose.json.'; };
  $('#fOpenPose').onclick = () => $('#fPoseFile').click();
  $('#fPoseFile').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { const p = JSON.parse(await f.text()); if (p.kind !== 'animtk-figure-pose') throw new Error('that is not a figure pose file'); pushUndo(); if (p.body && p.body !== F.S.body) await F.setBody(p.body); if (p.build && (p.build !== F.S.build || p.cartoon !== F.S.cartoon)) F.setBuild(p.build, p.cartoon || 0); F.setPose(p); $('#fSaveInfo').textContent = 'Opened ' + f.name + '.'; sync(); } catch (err) { $('#fSaveInfo').textContent = 'Could not open it: ' + err.message; } };
  $('#fPng').onclick = () => {
    const v = $('#fSize').value, r = host.getBoundingClientRect(), [W, H] = v === 'view' ? [Math.round(r.width), Math.round(r.height)] : v.split('x').map(Number);
    const c = F.snapshot(W, H, $('#fTransparent').checked), name = 'figure_' + F.S.body + '_' + (F.S.clip ? F.S.clip.id + '_f' + F.frameOf(F.S.t) : 'pose') + '.png';
    c.toBlob(b => Store.exportFile('figure', name, b), 'image/png'); $('#fSaveInfo').textContent = 'Saved ' + name + ' (' + W + ' x ' + H + ').';
  };

  // ---------- readout
  function sync() {
    $$('[data-fbody]').forEach(b => b.classList.toggle('on', b.dataset.fbody === F.S.body));
    $$('[data-fstyle]').forEach(b => b.classList.toggle('on', b.dataset.fstyle === F.S.style));
    $('#fBuild').value = F.S.build; $('#fCartoon').value = Math.round(F.S.cartoon * 100); $('#fCartoon').nextElementSibling.textContent = Math.round(F.S.cartoon * 100) + '%';
    const h = F.heads(), ft = h.height * 3.28084, inch = Math.round((ft % 1) * 12);
    $('#fHeads').textContent = 'About ' + h.count.toFixed(1) + ' heads tall, ' + Math.floor(ft) + ' ft ' + inch + ' in (' + h.height.toFixed(2) + ' m).';
    const c = F.S.clip; $('#fPlay').textContent = F.S.playing ? 'Pause' : 'Play'; $('#fPlay').disabled = !c;
    $('#fClipLbl').textContent = c ? c.label : F.S.frozeFrom ? 'Still pose from ' + F.S.frozeFrom : 'Still pose';
    if (c) { const n = Math.max(1, Math.round(c.dur * F.FPS)), f = Math.min(n, F.frameOf(F.S.t)), k = (c.keys || []).find(k => k.frame === f); $('#fFrame').textContent = 'frame ' + f + ' of ' + n + ' at 24 fps' + (k ? ': ' + k.label : ''); } else $('#fFrame').textContent = '';
    const o = F.overLimits(); $('#fReadout').textContent = F.BODIES[F.S.body].label + ', ' + F.BUILDS[F.S.build].label.toLowerCase() + (F.S.cartoon ? ', ' + Math.round(F.S.cartoon * 100) + '% cartoon' : '') + '\n' + (o.length ? o.length + ' joint' + (o.length > 1 ? 's' : '') + ' past a real body\'s range' : 'All joints in range');
    drawTime(); if (!F.S.playing) { if (!$('#fJoint').contains(document.activeElement)) syncJoint(); syncOver(); }
  }
  let pend = 0; F.on(() => { if (pend) return; pend = requestAnimationFrame(() => { pend = 0; sync(); }); });
  new ResizeObserver(() => drawTime()).observe(tl);
  sync();
  return F;
}
