"""
animtk.anatomy
Checks a drawn figure against itself: are the two arms the same length, does the weight sit over the
feet, do the cat's legs bend the right way, do the knuckles sit on one arc.

There is no pose detector in here. The landmarks (where the joints are in the drawing) come from whoever
runs the tool: a Claude reading the grid picture anatomy_guide.py makes, or the artist. Everything is
judged against the drawing's own proportions, or against a model sheet marked up the same way, never
against a generic realistic body: the style is hers.

A landmark file is JSON:
    {"rig": "human", "points": {"head_top": [x, y], "chin": [x, y], ...}, "airborne": false}
Leave out (or set to null) any point that is hidden or not drawn. Each check only runs when its points exist.
"""
import math
import numpy as np

RIGS = {
    'human': dict(
        about='A person, any pose. l_ and r_ are the character\'s own left and right; if you cannot tell, just stay consistent.',
        points=[('head_top', 'top of the skull'), ('chin', 'bottom of the chin'), ('neck', 'pit of the neck, between the collar bones'),
                ('l_shoulder', 'shoulder joint'), ('r_shoulder', ''), ('l_elbow', ''), ('r_elbow', ''), ('l_wrist', ''), ('r_wrist', ''),
                ('l_hand', 'fingertips (optional)'), ('r_hand', ''),
                ('pelvis', 'bottom of the torso, between the legs'), ('l_hip', 'hip joint, top of the thigh'), ('r_hip', ''),
                ('l_knee', ''), ('r_knee', ''), ('l_ankle', ''), ('r_ankle', ''), ('l_toe', 'tip of the foot (optional)'), ('r_toe', '')],
        bones=[('head_top', 'chin', 'mid'), ('chin', 'neck', 'mid'), ('neck', 'pelvis', 'mid'), ('l_shoulder', 'r_shoulder', 'mid'), ('l_hip', 'r_hip', 'mid'),
               ('l_shoulder', 'l_elbow', 'l'), ('l_elbow', 'l_wrist', 'l'), ('l_wrist', 'l_hand', 'l'), ('r_shoulder', 'r_elbow', 'r'), ('r_elbow', 'r_wrist', 'r'), ('r_wrist', 'r_hand', 'r'),
               ('l_hip', 'l_knee', 'l'), ('l_knee', 'l_ankle', 'l'), ('l_ankle', 'l_toe', 'l'), ('r_hip', 'r_knee', 'r'), ('r_knee', 'r_ankle', 'r'), ('r_ankle', 'r_toe', 'r')],
        segments=dict(upper_arm=('shoulder', 'elbow'), forearm=('elbow', 'wrist'), thigh=('hip', 'knee'), shin=('knee', 'ankle')),
        extra=dict(airborne='true if the character is jumping, falling or held up (skips the balance check)',
                   support='optional [[x, y], [x, y]]: the two ends of whatever holds the character up, if it is not the feet (a chair seat, a hand on a wall)')),
    'cat': dict(
        about='A cat seen roughly from the side. f_ = the front leg nearest to us, h_ = the hind leg nearest to us, ff_ and hf_ = the far legs (optional).',
        points=[('nose', 'tip of the nose'), ('crown', 'top of the head between the ears'), ('nape', 'back of the skull, where the neck starts'),
                ('withers', 'top of the shoulders'), ('rump', 'top of the hips'), ('tail_base', ''), ('tail_tip', ''), ('chest', 'bottom of the ribcage, just behind the front legs'),
                ('f_shoulder', 'front leg: shoulder joint, at the front of the chest'), ('f_elbow', 'elbow, up against the ribcage'), ('f_wrist', 'wrist, the joint that looks like a knee'), ('f_paw', 'where the paw touches down'),
                ('h_hip', 'hind leg: hip joint'), ('h_knee', 'knee, at the front of the thigh'), ('h_hock', 'hock, the heel that sticks out backward'), ('h_paw', 'where the paw touches down'),
                ('ff_elbow', 'far front leg'), ('ff_wrist', ''), ('ff_paw', ''), ('hf_knee', 'far hind leg'), ('hf_hock', ''), ('hf_paw', '')],
        bones=[('nose', 'crown', 'mid'), ('crown', 'nape', 'mid'), ('nape', 'withers', 'mid'), ('withers', 'rump', 'mid'), ('rump', 'tail_base', 'mid'), ('tail_base', 'tail_tip', 'mid'),
               ('withers', 'f_shoulder', 'l'), ('f_shoulder', 'f_elbow', 'l'), ('f_elbow', 'f_wrist', 'l'), ('f_wrist', 'f_paw', 'l'),
               ('rump', 'h_hip', 'l'), ('h_hip', 'h_knee', 'l'), ('h_knee', 'h_hock', 'l'), ('h_hock', 'h_paw', 'l'),
               ('f_shoulder', 'ff_elbow', 'r'), ('ff_elbow', 'ff_wrist', 'r'), ('ff_wrist', 'ff_paw', 'r'), ('h_hip', 'hf_knee', 'r'), ('hf_knee', 'hf_hock', 'r'), ('hf_hock', 'hf_paw', 'r')],
        extra=dict(airborne='true if the cat is mid-jump (skips the balance check)',
                   planted='optional list of the paws that are on the ground in this drawing, for example ["f_paw", "hf_paw"]. Default: every paw near the lowest one.')),
    'hand': dict(
        about='One hand. Each finger is marked from the knuckle outward: _1 = the knuckle where it joins the palm, _2 and _3 = the next two joints, _tip = the fingertip. The thumb has thumb_1 (its base near the wrist), thumb_2, thumb_tip.',
        points=[('wrist_a', 'edge of the wrist on the thumb side'), ('wrist_b', 'edge of the wrist on the little finger side'),
                ('thumb_1', ''), ('thumb_2', ''), ('thumb_3', '(optional)'), ('thumb_tip', '')] +
               [('%s_%s' % (f, j), '') for f in ('index', 'middle', 'ring', 'pinky') for j in ('1', '2', '3', 'tip')],
        bones=[('wrist_a', 'wrist_b', 'mid'), ('wrist_a', 'thumb_1', 'mid'), ('wrist_a', 'index_1', 'mid'), ('wrist_b', 'pinky_1', 'mid'),
               ('index_1', 'middle_1', 'mid'), ('middle_1', 'ring_1', 'mid'), ('ring_1', 'pinky_1', 'mid')],
        chains=[(['thumb_1', 'thumb_2', 'thumb_3', 'thumb_tip'], 'r')] + [(['%s_%s' % (f, j) for j in ('1', '2', '3', 'tip')], 'l') for f in ('index', 'middle', 'ring', 'pinky')],
        extra=dict()),
}

def template(rig):
    r = RIGS[rig]
    return dict(rig=rig, about=r['about'], points={k: None for k, _ in r['points']}, help={k: d for k, d in r['points'] if d}, options=r['extra'])

def clean(points):
    return {k: np.array(v[:2], float) for k, v in (points or {}).items() if v is not None and len(v) >= 2 and v[0] is not None}

def _len(P, a, b): return float(np.linalg.norm(P[a] - P[b])) if a in P and b in P else None
def _mid(P, a, b): return (P[a] + P[b]) / 2
def _pct(a, b): return abs(a - b) / max(a, b) * 100
def _path(P, names):
    names = [n for n in names if n in P]
    return sum(float(np.linalg.norm(P[a] - P[b])) for a, b in zip(names[:-1], names[1:])) if len(names) > 1 else None
def _side(a, b, p):
    """which side of the line a->b the point p is on (sign), and how far, as a share of the line's length"""
    d = b - a; n = float(np.hypot(*d)) or 1.0
    return float(d[0] * (p[1] - a[1]) - d[1] * (p[0] - a[0])) / (n * n)
def _tilt(a, b):
    d = b - a if b[0] >= a[0] else a - b
    return math.degrees(math.atan2(-d[1], abs(d[0]) + 1e-9))          # + = the right-hand end of the line is higher on the page

class Report:
    def __init__(self): self.flags = []; self.notes = []; self.marks = []
    def flag(self, at, text): self.flags.append(dict(at=[round(float(at[0]), 1), round(float(at[1]), 1)], text=text))
    def note(self, text): self.notes.append(text)
    def mark(self, kind, **kw): self.marks.append(dict(kind=kind, **kw))        # extra things to draw: plumb line, support bar, arcs

# ----------------------------------------------------------------- human
W_SEG = dict(head=0.08, torso=0.50, upper_arm=0.027, forearm=0.023, thigh=0.10, shin=0.06)

def _human_measures(P):
    """segment lengths in head heights, so two drawings at different sizes can be compared"""
    head = _len(P, 'head_top', 'chin'); out = {}
    if not head: return out, None
    for name, (a, b) in RIGS['human']['segments'].items():
        v = [x for x in (_len(P, 'l_' + a, 'l_' + b), _len(P, 'r_' + a, 'r_' + b)) if x]
        if v: out[name] = max(v) / head                                  # the longer of the two is the less foreshortened one
    t = _path(P, ['chin', 'neck', 'pelvis'])
    if t: out['torso'] = t / head
    if 'l_shoulder' in P and 'r_shoulder' in P: out['shoulder_width'] = _len(P, 'l_shoulder', 'r_shoulder') / head
    legs = [x for x in (_path(P, ['l_hip', 'l_knee', 'l_ankle']), _path(P, ['r_hip', 'r_knee', 'r_ankle'])) if x]
    if t and legs: out['heads_tall'] = (head + t + max(legs)) / head
    return out, head

def check_human(P, opt, model=None):
    R = Report(); M, head = _human_measures(P)
    names = dict(upper_arm='upper arm', forearm='forearm', thigh='thigh', shin='shin')
    for seg, (a, b) in RIGS['human']['segments'].items():                 # left against right
        L, Rr = _len(P, 'l_' + a, 'l_' + b), _len(P, 'r_' + a, 'r_' + b)
        if L and Rr and _pct(L, Rr) > 22:
            short = 'l' if L < Rr else 'r'
            R.flag(_mid(P, short + '_' + a, short + '_' + b), 'The %s %s is %d%% shorter than the other one. Fine if it points toward or away from the camera; if both are side-on, look here.' % ('left' if short == 'l' else 'right', names[seg], round(_pct(L, Rr))))
    if 'heads_tall' in M: R.note('About %.1f heads tall when stretched out (head = %d px).' % (M['heads_tall'], round(head)))
    if model:                                                             # against the model sheet
        MM, _ = _human_measures(model); pretty = dict(names, torso='torso', shoulder_width='shoulder width', heads_tall='height in heads')
        for k in ('heads_tall', 'torso', 'shoulder_width', 'upper_arm', 'forearm', 'thigh', 'shin'):
            if k in M and k in MM and _pct(M[k], MM[k]) > 15:
                at = dict(torso=('neck', 'pelvis'), shoulder_width=('l_shoulder', 'r_shoulder'), heads_tall=('head_top', 'chin')).get(k)
                if not at:
                    a, b = RIGS['human']['segments'][k]; s = 'l' if _len(P, 'l_' + a, 'l_' + b) else 'r'; at = (s + '_' + a, s + '_' + b)
                R.flag(_mid(P, *at), 'Off model: %s is %.2f heads here, %.2f on the model sheet (%s%d%%). Foreshortening can explain a shorter limb.' % (pretty[k], M[k], MM[k], '+' if M[k] > MM[k] else '-', round(abs(M[k] - MM[k]) / MM[k] * 100)))
    # shoulders against hips
    if all(k in P for k in ('l_shoulder', 'r_shoulder', 'l_hip', 'r_hip')):
        s, h = _tilt(P['l_shoulder'], P['r_shoulder']), _tilt(P['l_hip'], P['r_hip'])
        if abs(s) < 3 and abs(h) < 3: R.note('Shoulders and hips are both level (%.0f and %.0f degrees): a square, upright pose. Tilting one against the other adds life if that is wanted.' % (s, h))
        elif s * h < 0: R.note('Shoulders tilt %.0f degrees one way and hips %.0f the other: they play against each other, which reads as weight on one leg.' % (abs(s), abs(h)))
        else: R.note('Shoulders (%.0f degrees) and hips (%.0f) tilt the same way: the whole torso leans as one block.' % (abs(s), abs(h)))
    # line of action: head, neck, pelvis, the foot carrying the weight
    feet = [k for k in ('l_ankle', 'r_ankle') if k in P]
    if all(k in P for k in ('head_top', 'neck', 'pelvis')) and feet:
        foot = max(feet, key=lambda k: P[k][1]); pts = [P['head_top'], P['neck'], P['pelvis'], P[foot]]
        d = [_side(pts[0], pts[-1], p) for p in pts[1:-1]]; bend = max(abs(v) for v in d) * 100
        R.mark('curve', pts=[p.tolist() for p in pts])
        R.note('Line of action (head to the weight-bearing foot) ' + ('is nearly straight.' if bend < 4 else 'is an S curve, bending up to %d%% of its length.' % round(bend) if d[0] * d[1] < 0 and min(abs(v) for v in d) * 100 > 3 else 'is a C curve, bending %d%% of its length.' % round(bend)))
    # balance: is the weight over whatever holds the character up
    if not opt.get('airborne') and head:
        parts = []
        if 'head_top' in P and 'chin' in P: parts.append((W_SEG['head'], _mid(P, 'head_top', 'chin')))
        if 'neck' in P and 'pelvis' in P: parts.append((W_SEG['torso'], _mid(P, 'neck', 'pelvis')))
        for s in 'lr':
            for seg, (a, b) in RIGS['human']['segments'].items():
                if s + '_' + a in P and s + '_' + b in P: parts.append((W_SEG[seg], _mid(P, s + '_' + a, s + '_' + b)))
        sup = opt.get('support')
        if sup: xs = [float(p[0]) for p in sup]; gy = max(float(p[1]) for p in sup)
        else:
            low = max((P[k][1] for k in ('l_ankle', 'r_ankle', 'l_toe', 'r_toe') if k in P), default=None); xs = []; gy = low
            if low is not None:
                for s in 'lr':
                    if s + '_ankle' in P and low - max(P[s + '_ankle'][1], P.get(s + '_toe', P[s + '_ankle'])[1]) < head * 0.35:
                        xs += [P[s + '_ankle'][0]] + ([P[s + '_toe'][0]] if s + '_toe' in P else [])
        if xs and sum(w for w, _ in parts) > 0.5:
            tw = sum(w for w, _ in parts); com = sum(w * c for w, c in parts) / tw; pad = head * 0.18
            lo, hi = min(xs) - pad, max(xs) + pad
            R.mark('balance', com=com.tolist(), ground=float(gy), lo=lo, hi=hi)
            off = lo - com[0] if com[0] < lo else com[0] - hi if com[0] > hi else 0
            if off > 0: R.flag((com[0], gy), 'The weight sits %d px %s of what the character stands on. That reads as falling, leaning on something, or mid-step. If the character should be standing still, look here.' % (round(off), 'left' if com[0] < lo else 'right'))
            else: R.note('Balanced: the weight sits over the feet.')
    return R, M

# ----------------------------------------------------------------- cat
def _cat_measures(P):
    head = _len(P, 'nose', 'nape'); out = {}
    if not head: return out, None
    for k, names in (('body', ['withers', 'rump']), ('front_leg', ['f_shoulder', 'f_elbow', 'f_wrist', 'f_paw']), ('hind_leg', ['h_hip', 'h_knee', 'h_hock', 'h_paw']),
                     ('front_upper', ['f_shoulder', 'f_elbow']), ('front_fore', ['f_elbow', 'f_wrist']), ('front_foot', ['f_wrist', 'f_paw']),
                     ('hind_thigh', ['h_hip', 'h_knee']), ('hind_shin', ['h_knee', 'h_hock']), ('hind_foot', ['h_hock', 'h_paw']), ('tail', ['tail_base', 'tail_tip'])):
        if all(n in P for n in names): out[k] = _path(P, names) / head
    return out, head

def check_cat(P, opt, model=None):
    R = Report(); M, head = _cat_measures(P)
    if 'withers' in P and 'rump' in P and (('nose' in P) or ('crown' in P)):
        face = 1.0 if P.get('nose', P.get('crown'))[0] > P['rump'][0] else -1.0           # +1 = facing right on the page
        def bend(a, b, c, want, what, fix):
            """the joint b should stick out toward `want` (+1 = the way the cat faces, -1 = toward the tail)"""
            if not all(k in P for k in (a, b, c)): return
            s = _side(P[a], P[c], P[b]); down = 1.0 if P[c][1] >= P[a][1] else -1.0
            fwd = -s * down * face                                        # + = the joint sits ahead of the line, toward the head
            if abs(s) > 0.08 and fwd * want < 0: R.flag(P[b], '%s bends the wrong way. %s' % (what, fix))
        for pre, far in (('f_', False), ('ff_', True)):
            sh = 'f_shoulder'; who = 'The far front leg' if far else 'The front leg'
            bend(sh, pre + 'elbow', pre + 'wrist', -1, who, 'On a cat the elbow points back toward the tail and sits up against the ribcage.')
        for pre, far in (('h_', False), ('hf_', True)):
            who = 'The far hind leg' if far else 'The hind leg'
            bend('h_hip', pre + 'knee', pre + 'hock', +1, who + ' at the knee', 'The knee points forward, toward the belly.')
            bend(pre + 'knee', pre + 'hock', pre + 'paw', -1, who + ' at the hock', 'The hock is the heel: it points back, away from the head.')
    for near, far, nm in ((['f_shoulder', 'f_elbow', 'f_wrist', 'f_paw'], ['f_shoulder', 'ff_elbow', 'ff_wrist', 'ff_paw'], 'front'), (['h_hip', 'h_knee', 'h_hock', 'h_paw'], ['h_hip', 'hf_knee', 'hf_hock', 'hf_paw'], 'hind')):
        if all(k in P for k in near) and all(k in P for k in far):
            a, b = _path(P, near), _path(P, far)
            if _pct(a, b) > 22: R.flag(P[(far if b < a else near)[2]], 'The %s %s leg is %d%% shorter than the %s one when stretched out. A little is perspective; this much, look here.' % ('far' if b < a else 'near', nm, round(_pct(a, b)), 'near' if b < a else 'far'))
    if 'front_leg' in M and 'hind_leg' in M:
        R.note('Stretched out, the front leg is %.1f head lengths and the hind leg %.1f (hind legs are normally the longer pair).' % (M['front_leg'], M['hind_leg']))
        if M['hind_leg'] < M['front_leg'] * 0.85: R.flag(P['h_knee'], 'The hind leg is %d%% shorter than the front leg. Cats carry longer hind legs, folded up more. Look here unless the hind leg is foreshortened.' % round(_pct(M['hind_leg'], M['front_leg'])))
    if 'body' in M: R.note('Body (shoulders to hips) is %.1f head lengths long (head = %d px, nose to the back of the skull).' % (M['body'], round(head)))
    if model:
        MM, _ = _cat_measures(model); pretty = dict(body='body length', front_leg='front leg', hind_leg='hind leg', tail='tail')
        for k, at in (('body', ('withers', 'rump')), ('front_leg', ('f_elbow', 'f_wrist')), ('hind_leg', ('h_knee', 'h_hock')), ('tail', ('tail_base', 'tail_tip'))):
            if k in M and k in MM and _pct(M[k], MM[k]) > 15:
                R.flag(_mid(P, *at), 'Off model: %s is %.2f head lengths here, %.2f on the model sheet (%s%d%%).' % (pretty[k], M[k], MM[k], '+' if M[k] > MM[k] else '-', round(abs(M[k] - MM[k]) / MM[k] * 100)))
    if not opt.get('airborne') and 'withers' in P and 'rump' in P and head:
        paws = [k for k in ('f_paw', 'ff_paw', 'h_paw', 'hf_paw') if k in P]
        if paws:
            low = max(P[k][1] for k in paws); planted = [k for k in (opt.get('planted') or paws) if k in P and (opt.get('planted') or low - P[k][1] < head * 0.3)]
            body = P['withers'] * 0.55 + P['rump'] * 0.45                 # a cat carries a bit more than half its weight on the front
            if 'chest' in P: body = body * 0.6 + (P['chest'] * 0.55 + P['rump'] * 0.45) * 0.4
            com = body * 0.88 + (_mid(P, 'nose', 'nape') if 'nose' in P and 'nape' in P else body) * 0.12
            if len(planted) >= 1:
                xs = [P[k][0] for k in planted]; pad = head * 0.25; lo, hi = min(xs) - pad, max(xs) + pad
                R.mark('balance', com=com.tolist(), ground=float(low), lo=lo, hi=hi)
                off = lo - com[0] if com[0] < lo else com[0] - hi if com[0] > hi else 0
                if off > 0: R.flag((com[0], low), 'The weight sits %d px outside the paws that are on the ground. Fine in a run or a pounce; in a walk or a stand, look here.' % round(off))
                else: R.note('Balanced: the weight sits between the paws on the ground (%s).' % ', '.join(planted))
    return R, M

# ----------------------------------------------------------------- hand
FINGERS = ('index', 'middle', 'ring', 'pinky')

def _hand_measures(P):
    out = {}; palm = _len(P, 'index_1', 'pinky_1')
    if not palm: return out, None
    for f in FINGERS:
        v = _path(P, [f + '_1', f + '_2', f + '_3', f + '_tip'])
        if v and f + '_tip' in P and f + '_1' in P: out[f] = v / palm
    t = _path(P, ['thumb_1', 'thumb_2', 'thumb_3', 'thumb_tip'])
    if t: out['thumb'] = t / palm
    w = _len(P, 'wrist_a', 'wrist_b')
    if w: out['wrist'] = w / palm
    return out, palm

def check_hand(P, opt, model=None):
    R = Report(); M, palm = _hand_measures(P)
    k = [f + '_1' for f in FINGERS]
    if all(n in P for n in k):                                           # the four knuckles sit on one arc
        s1, s2 = _side(P[k[0]], P[k[3]], P[k[1]]), _side(P[k[0]], P[k[3]], P[k[2]])
        R.mark('curve', pts=[P[n].tolist() for n in k])
        if s1 * s2 < 0 and min(abs(s1), abs(s2)) > 0.03: R.flag(P[k[1]] if abs(s1) > abs(s2) else P[k[2]], 'The four knuckles zigzag. They sit on one smooth arc, highest at the middle finger. Look here.')
        elif all(n in P for n in ('wrist_a', 'wrist_b')):
            w = _side(P[k[0]], P[k[3]], _mid(P, 'wrist_a', 'wrist_b'))
            if max(abs(s1), abs(s2)) > 0.04 and (s1 + s2) * w > 0: R.flag(_mid(P, k[1], k[2]), 'The knuckle arc bows toward the wrist. It bows the other way, out toward the fingertips. Look here unless the hand is seen from a steep angle.')
        gaps = [_len(P, a, b) for a, b in zip(k[:-1], k[1:])]
        if max(gaps) > min(gaps) * 2.0: R.flag(_mid(P, k[gaps.index(max(gaps))], k[gaps.index(max(gaps)) + 1]), 'The knuckles are unevenly spaced: one gap is %.1f times another. Look here unless the hand is turning away.' % (max(gaps) / min(gaps)))
    have = [f for f in FINGERS if f in M]
    if len(have) == 4:                                                   # finger lengths, measured along the bends so a curled finger still counts
        R.note('Finger lengths along the joints, in palm widths: ' + ', '.join('%s %.2f' % (f, M[f]) for f in have) + ('.' if 'thumb' not in M else ', thumb %.2f.' % M['thumb']))
        if M['middle'] < max(M['index'], M['ring']) * 0.9: R.flag(P['middle_2'] if 'middle_2' in P else P['middle_1'], 'The middle finger is shorter than its neighbours. It is the longest finger. Foreshortening can do this; otherwise look here.')
        if M['pinky'] > min(M['index'], M['ring']) * 1.05: R.flag(P['pinky_2'] if 'pinky_2' in P else P['pinky_1'], 'The little finger is as long as the index or ring finger. It is the shortest of the four. Look here.')
    for f in FINGERS:                                                    # each finger tapers: every segment shorter than the one before
        segs = [_len(P, f + '_' + a, f + '_' + b) for a, b in (('1', '2'), ('2', '3'), ('3', 'tip'))]
        if all(segs):
            if segs[1] > segs[0] * 1.2: R.flag(_mid(P, f + '_2', f + '_3'), 'On the %s finger the middle segment is longer than the first. Segments get shorter toward the tip. Look here unless the first one is foreshortened.' % f)
            elif segs[2] > segs[1] * 1.25: R.flag(_mid(P, f + '_3', f + '_tip'), 'On the %s finger the tip segment is longer than the middle one. Segments get shorter toward the tip. Look here.' % f)
    if 'wrist' in M:
        R.note('Wrist is %.2f of the palm width.' % M['wrist'])
        if M['wrist'] > 1.12: R.flag(_mid(P, 'wrist_a', 'wrist_b'), 'The wrist is wider than the palm across the knuckles. Look here unless that is the style.')
    if model:
        MM, _ = _hand_measures(model)
        for f in list(FINGERS) + ['thumb', 'wrist']:
            if f in M and f in MM and _pct(M[f], MM[f]) > 18:
                at = P.get(f + '_2', P.get(f + '_1')) if f != 'wrist' else _mid(P, 'wrist_a', 'wrist_b')
                R.flag(at, 'Off model: %s is %.2f palm widths here, %.2f on the model sheet.' % (f if f in ('thumb', 'wrist') else f + ' finger', M[f], MM[f]))
    return R, M

CHECKS = dict(human=check_human, cat=check_cat, hand=check_hand)

def check(data, model=None, max_flags=6):
    """data = a landmark dict. Returns dict(rig, flags, notes, marks, measures, points)."""
    rig = data.get('rig', 'human')
    if rig not in RIGS: raise SystemExit('Unknown rig "%s". Use one of: %s' % (rig, ', '.join(RIGS)))
    P = clean(data.get('points')); known = {k for k, _ in RIGS[rig]['points']}
    unknown = sorted(set(P) - known)
    if len(P) < 3: raise SystemExit('The landmark file has fewer than 3 points filled in.')
    R, M = CHECKS[rig](P, data, clean(model.get('points')) if model else None)
    if unknown: R.note('Ignored points this rig does not know: ' + ', '.join(unknown))
    extra = len(R.flags) - max_flags
    flags = R.flags[:max_flags]
    for i, f in enumerate(flags): f['n'] = i + 1
    if extra > 0: R.note('%d more possible issue%s not shown (raise --max-flags to see them).' % (extra, '' if extra == 1 else 's'))
    return dict(rig=rig, flags=flags, notes=R.notes, marks=R.marks, measures={k: round(v, 3) for k, v in M.items()}, points={k: v.tolist() for k, v in P.items()})
