"""
animtk.cycles
Reference motion for cycles, as stick skeletons. Starts with a cat walk.

Everything is in "body units": x = forward, y = up, the ground is y = 0, and 1.0 = the distance from
shoulder to hip. cycle_guide.py scales that to the character and draws it.

ADDING A CYCLE (human walk, run, ...): write a function pose(phase) -> Pose for phase 0..1 and add it
to CYCLES at the bottom with its name, its feet, and its pose names. Nothing else needs to change.
    Pose.joints   {name: (x, y)}
    Pose.bones    [(joint_a, joint_b, group)]   group = 'body', 'near' (limbs on the viewer's side) or 'far'
    Pose.circles  [(joint, radius, group)]      head, ribcage, hips...
    Pose.down     {foot_name: True/False}       which feet are on the ground
    Pose.gesture  [joint names]                 the line of action, drawn as one smooth stroke
"""
from dataclasses import dataclass, field
import numpy as np

@dataclass
class Pose:
    joints: dict
    bones: list
    circles: list = field(default_factory=list)
    down: dict = field(default_factory=dict)
    gesture: list = field(default_factory=list)

def two_bone(root, target, l1, l2, bend):
    """middle joint of a two-bone limb (elbow / knee). bend = +1 pokes forward (+x), -1 pokes backward."""
    root, target = np.asarray(root, float), np.asarray(target, float)
    d = target - root; dist = np.hypot(*d)
    dist = min(max(dist, abs(l1 - l2) + 1e-6), l1 + l2 - 1e-6)
    a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist)
    h = np.sqrt(max(l1 * l1 - a * a, 0))
    u = d / (np.hypot(*d) + 1e-12); n = np.array([-u[1], u[0]])
    m = root + u * a
    c1, c2 = m + n * h, m - n * h
    return c1 if (c1[0] - c2[0]) * bend > 0 else c2

def foot_path(phase, touch, duty, stride, lift):
    """where a foot is, relative to the spot under its hip or shoulder.
       On the ground it slides back at a steady rate; in the air it swings forward in an arc.
       Returns (x, y, on_ground)."""
    u = (phase - touch) % 1.0
    if u < duty:
        return stride / 2 - stride * (u / duty), 0.0, True
    v = (u - duty) / (1 - duty)                        # 0..1 through the swing
    e = (1 - np.cos(np.pi * v)) / 2                    # eases off the ground and back onto it
    return -stride / 2 + stride * e, lift * np.sin(np.pi * v) ** 0.9, False

# ----------------------------------------------------------------- cat walk
# Lateral-sequence walk, the way cats (and most four-legged animals) walk:
#   left hind, left fore, right hind, right fore, each a quarter of the cycle apart.
#   Every foot stays down for about 65% of the cycle, so there are always 2 or 3 feet on the ground.
CAT = dict(duty=0.65, stride=0.56, lift=0.13,
           touch=dict(LH=0.00, LF=0.25, RH=0.50, RF=0.75),
           shoulder=(0.50, 0.70), hip=(-0.50, 0.72),
           upper_arm=0.36, forearm=0.36, thigh=0.36, shank=0.34, hock_h=0.20, hock_back=0.07, wrist_h=0.06,
           bob=0.022, head_bob=0.008)

def cat_walk(phase, near='R'):
    """one pose of the cat walk. phase 0 = left hind touches down. near = which side faces the viewer."""
    P = CAT; J = {}; down = {}
    def mid_stance(foot): return P['touch'][foot] + P['duty'] / 2
    # body bob: each end of the body is highest when its supporting leg is upright, lowest just after a touchdown
    sh_y = P['shoulder'][1] + P['bob'] * np.cos(4 * np.pi * (phase - mid_stance('LF')))
    hip_y = P['hip'][1] + P['bob'] * np.cos(4 * np.pi * (phase - mid_stance('LH')))
    sway = 0.012 * np.sin(2 * np.pi * (phase - mid_stance('LF')))          # tiny forward-back give
    J['shoulder'] = np.array([P['shoulder'][0] + sway, sh_y]); J['hip'] = np.array([P['hip'][0] + sway, hip_y])
    J['spine'] = (J['shoulder'] + J['hip']) / 2 + [0, 0.035 - 0.012 * np.cos(4 * np.pi * (phase - mid_stance('LF')))]
    J['chest'] = J['shoulder'] + [-0.12, -0.10]; J['pelvis'] = J['hip'] + [0.06, -0.06]
    # head stays steadier than the shoulders and dips a touch as a front foot takes weight
    head_y = P['shoulder'][1] + 0.30 + P['head_bob'] * np.cos(4 * np.pi * (phase - mid_stance('LF')) - 0.9)
    J['neck'] = J['shoulder'] + [0.16, 0.14]; J['head'] = np.array([P['shoulder'][0] + 0.40 + sway, head_y])
    J['nose'] = J['head'] + [0.20, -0.06]
    t = 2 * np.pi * phase
    J['tail1'] = J['hip'] + [-0.22, 0.10 + 0.02 * np.sin(t)]; J['tail2'] = J['tail1'] + [-0.24, 0.16 + 0.04 * np.sin(t - 0.8)]
    J['tail3'] = J['tail2'] + [-0.10, 0.22 + 0.05 * np.sin(t - 1.6)]
    for foot in ('LF', 'RF', 'LH', 'RH'):
        fx, fy, on = foot_path(phase, P['touch'][foot], P['duty'], P['stride'], P['lift']); down[foot] = on
        fore = foot[1] == 'F'; root = J['shoulder'] if fore else J['hip']
        base_x = (P['shoulder'][0] if fore else P['hip'][0])
        toe = np.array([base_x + fx, fy]); J[foot + '_toe'] = toe
        if fore:
            wrist = toe + [-0.03, P['wrist_h'] + (0.05 if not on else 0)]
            J[foot + '_wrist'] = wrist; J[foot + '_elbow'] = two_bone(root, wrist, P['upper_arm'], P['forearm'], -1)
        else:
            hock = toe + [-P['hock_back'] - (0.05 if not on else 0), P['hock_h'] + (0.04 if not on else 0)]
            J[foot + '_hock'] = hock; J[foot + '_knee'] = two_bone(root, hock, P['thigh'], P['shank'], +1)
    bones = [('hip', 'pelvis', 'body'), ('shoulder', 'chest', 'body'), ('shoulder', 'neck', 'body'), ('neck', 'head', 'body'),
             ('head', 'nose', 'body'), ('hip', 'tail1', 'body'), ('tail1', 'tail2', 'body'), ('tail2', 'tail3', 'body')]
    for foot in ('LF', 'RF', 'LH', 'RH'):
        g = 'near' if foot[0] == near else 'far'
        if foot[1] == 'F': bones += [('shoulder', foot + '_elbow', g), (foot + '_elbow', foot + '_wrist', g), (foot + '_wrist', foot + '_toe', g)]
        else: bones += [('hip', foot + '_knee', g), (foot + '_knee', foot + '_hock', g), (foot + '_hock', foot + '_toe', g)]
    circles = [('head', 0.15, 'body'), ('chest', 0.20, 'body'), ('pelvis', 0.16, 'body')]
    return Pose({k: (float(v[0]), float(v[1])) for k, v in J.items()}, bones, circles, down, ['tail2', 'tail1', 'hip', 'spine', 'shoulder', 'neck', 'head'])

def cat_pose_names():
    """named poses and the phase each one happens at, for the near (R) and far (L) front leg"""
    out = {}
    for side, foot in (('far', 'LF'), ('near', 'RF')):
        t = CAT['touch'][foot]
        out[t % 1] = 'contact (%s fore)' % side; out[(t + 0.10) % 1] = 'down'; out[(t + 0.25) % 1] = 'passing'; out[(t + 0.375) % 1] = 'up'
    return out

# name -> dict(pose=function(phase, near), feet=[...], names=function() -> {phase: label}, start=phase of frame 1,
#              height=tallest point in body units (for sizing), about=one line)
CYCLES = {
    'cat_walk': dict(pose=cat_walk, feet=['LH', 'LF', 'RH', 'RF'], names=cat_pose_names, start=CAT['touch']['RF'],
                     height=1.18, length=1.75, speed=CAT['stride'] / CAT['duty'],
                     about='Four-legged walk: left hind, left fore, right hind, right fore. 2 or 3 feet down at all times.'),
}
