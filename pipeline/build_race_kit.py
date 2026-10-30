"""Blender 5.1 headless: the Cyber Rally kit (original designs). Every piece: origin at its base centre (wheels and the
steering wheel at their hub), front = +X, left = +Y, metres. Exported to public/assets/race-kit.glb (glTF Y up: Blender +Y
becomes -Z, so the left side of a piece is -Z in the game, like the characters).
  Car_Body, Car_Wheel_FL/FR/RL/RR, Car_Steer        the kart (single seat, Cyber rides on the rear wing)
  Gate_Arch (+ Gate_Sign)                           one lane of a decision gate; Lane material is recoloured per lane
  Finish_Arch, Pit_Station (+ Pit_Sign), Boost_Pad, Pickup_Shield, Popup_Block
  Dhow, Fort_Tower, Lamp_Post, House_Block, Watch_Tower
Run:  blender.exe -b --python pipeline/build_race_kit.py [-- --preview]
"""
import math
import os
import sys
import bpy
import bmesh
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, "..", "public", "assets", "race-kit.glb"))
PREVIEW = "--preview" in sys.argv
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


# ---------------------------------------------------------------- materials
def mat(name, rgb, rough=0.55, metal=0.0, emit=None, strength=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = strength
    m.diffuse_color = (*rgb, 1)
    return m


def srgb(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple((x / 12.92) if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


M = {
    "Paint": mat("Paint", srgb("#f4f1ea"), 0.32),                 # recoloured in game (car colour choice)
    "Stripe": mat("Stripe", srgb("#d72631"), 0.35),
    "Stripe2": mat("Stripe2", srgb("#1f9d55"), 0.35),
    "Trim": mat("Trim", srgb("#1c2a44"), 0.6),
    "Chrome": mat("Chrome", srgb("#d9dde3"), 0.18, 1.0),
    "Gold": mat("Gold", srgb("#d9a441"), 0.3, 1.0),
    "Rubber": mat("Rubber", srgb("#22252b"), 0.85),
    "Seat": mat("Seat", srgb("#b8442f"), 0.8),
    "Light": mat("Light", srgb("#fff6dc"), 0.2, emit=srgb("#fff3c8"), strength=3.0),
    "TailLight": mat("TailLight", srgb("#ff3b3b"), 0.2, emit=srgb("#ff2a2a"), strength=2.5),
    "Glow": mat("Glow", srgb("#38d6ff"), 0.2, emit=srgb("#38d6ff"), strength=3.0),
    "Lane": mat("Lane", srgb("#2f80ed"), 0.4, emit=srgb("#2f80ed"), strength=0.4),
    "Plaster": mat("Plaster", srgb("#efe6d6"), 0.85),
    "Sand": mat("Sand", srgb("#d9b98a"), 0.9),
    "Wood": mat("Wood", srgb("#8a5a35"), 0.7),
    "WoodDark": mat("WoodDark", srgb("#5a3a22"), 0.75),
    "Sail": mat("Sail", srgb("#f6efe0"), 0.9),
    "Window": mat("Window", srgb("#2b3550"), 0.4),
    "White": mat("White", srgb("#ffffff"), 0.6),
    "Black": mat("Black", srgb("#1a1a1a"), 0.6),
    "PopRed": mat("PopRed", srgb("#ff4d4f"), 0.4, emit=srgb("#ff4d4f"), strength=0.6),
    "PopScreen": mat("PopScreen", srgb("#ffe066"), 0.4, emit=srgb("#ffd23f"), strength=0.5),
    "Sign": mat("Sign", srgb("#ffffff"), 0.5),                     # replaced in game by a text texture
}


# ---------------------------------------------------------------- helpers
def new_obj(name, bm, mats):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    for m in mats:
        ob.data.materials.append(M[m])
    return ob


def bake(ob):
    """Apply all modifiers (headless-safe)."""
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    bpy.data.meshes.remove(old)
    return ob


def smooth(ob, angle=40):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        if len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(angle):
            e.smooth = False
    bm.to_mesh(ob.data)
    bm.free()


def box(bm, c, s, mi=0):
    r = bmesh.ops.create_cube(bm, size=1.0)
    for v in r["verts"]:
        v.co = Vector((c[0] + v.co.x * s[0], c[1] + v.co.y * s[1], c[2] + v.co.z * s[2]))
    for f in {f for v in r["verts"] for f in v.link_faces}:
        f.material_index = mi
    return r["verts"]


def cyl(bm, c, r1, r2, h, mi=0, segs=24, axis="Z"):
    r = bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r1, radius2=r2, depth=h)
    rot = Matrix.Identity(3) if axis == "Z" else Matrix.Rotation(math.radians(90), 3, "X") if axis == "Y" else Matrix.Rotation(math.radians(90), 3, "Y")
    for v in r["verts"]:
        v.co = rot @ v.co + Vector(c)
    for f in {f for v in r["verts"] for f in v.link_faces}:
        f.material_index = mi
    return r["verts"]


def sphere(bm, c, r, mi=0, scale=(1, 1, 1), segs=16):
    res = bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=max(8, segs // 2), radius=r)
    for v in res["verts"]:
        v.co = Vector((c[0] + v.co.x * scale[0], c[1] + v.co.y * scale[1], c[2] + v.co.z * scale[2]))
    for f in {f for v in res["verts"] for f in v.link_faces}:
        f.material_index = mi
    return res["verts"]


def extrude_outline(bm, pts, y0, y1, mi=0):
    """A flat shape in the XZ plane (pts = [(x, z)]), thick along Y from y0 to y1."""
    a = [bm.verts.new((x, y0, z)) for x, z in pts]
    b = [bm.verts.new((x, y1, z)) for x, z in pts]
    fs = [bm.faces.new(a[::-1]), bm.faces.new(b)]
    n = len(pts)
    for i in range(n):
        fs.append(bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i])))
    for f in fs:
        f.material_index = mi
    bmesh.ops.recalc_face_normals(bm, faces=fs)
    return fs


def frame_outline(bm, outer, inner, y0, y1, mi=0):
    """A ring between two outlines with the same number of points (an arch or a frame), thick along Y."""
    n = len(outer)
    fs = []
    for y in (y0, y1):
        oo = [bm.verts.new((x, y, z)) for x, z in outer]
        ii = [bm.verts.new((x, y, z)) for x, z in inner]
        for i in range(n - 1):
            q = (oo[i], oo[i + 1], ii[i + 1], ii[i])
            fs.append(bm.faces.new(q if y == y1 else q[::-1]))
        if y == y0:
            o0, i0 = oo, ii
        else:
            o1, i1 = oo, ii
    for ring0, ring1 in ((o0, o1), (i0, i1)):
        for i in range(n - 1):
            fs.append(bm.faces.new((ring0[i], ring0[i + 1], ring1[i + 1], ring1[i])))
    for e0, e1 in ((0, 0), (n - 1, n - 1)):
        fs.append(bm.faces.new((o0[e0], i0[e0], i1[e0], o1[e0])))
    for f in fs:
        f.material_index = mi
    bmesh.ops.recalc_face_normals(bm, faces=fs)
    return fs


def pointed_arch(w, h, rise, n=12):
    """Outline (x along width, z up) of an Omani pointed arch opening: from bottom-left up and over to bottom-right."""
    pts = [(-w / 2, 0.0), (-w / 2, h - rise)]
    for i in range(1, n):
        t = i / n
        if t <= 0.5:
            a = t / 0.5
            pts.append((-w / 2 + (w / 2) * math.sin(a * math.pi / 2), h - rise + rise * (1 - (1 - a) ** 1.6)))
        else:
            a = (t - 0.5) / 0.5
            pts.append(((w / 2) * math.sin(a * math.pi / 2), h - rise + rise * (1 - a ** 1.6)))
    pts += [(w / 2, h - rise), (w / 2, 0.0)]
    return pts


def merlons(bm, x0, x1, y, z, mi, step=0.5, size=(0.22, 0.22, 0.3)):
    x = x0
    while x <= x1 + 1e-6:
        box(bm, (x, y, z + size[2] / 2), size, mi)
        x += step


# ---------------------------------------------------------------- the car
def car_body():
    bm = bmesh.new()
    r = bmesh.ops.create_cube(bm, size=2.0)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=5, use_grid_fill=True)
    L, W = 1.25, 0.62
    for v in bm.verts:
        u, s, t = v.co.x, v.co.y, (v.co.z + 1) / 2                   # u -1 rear .. 1 nose; t 0 bottom .. 1 top
        nose = max(0.0, u)
        zt = 0.74 - 0.27 * nose ** 1.4 - 0.05 * max(0.0, -u - 0.5)
        zb = 0.22 + 0.07 * nose ** 2
        w = W * (1 - 0.30 * nose ** 2) * (1 - 0.10 * t * t)
        v.co = Vector((u * L, s * w, zb + t * (zt - zb)))
    ob = new_obj("Car_Body", bm, ["Paint", "Stripe", "Stripe2", "Trim", "Seat", "Chrome", "Light", "TailLight", "Gold", "Rubber"])
    ob.modifiers.new("sub", "SUBSURF").levels = 2
    bake(ob)
    # wheel wells and the cockpit
    cutters = []
    for x in (0.82, -0.80):
        for y in (0.62, -0.62):
            cb = bmesh.new()
            cyl(cb, (x, y, 0.36), 0.47, 0.47, 0.5, segs=32, axis="Y")
            cutters.append(new_obj("cut", cb, []))
    cb = bmesh.new()
    box(cb, (-0.22, 0, 0.92), (0.95, 0.66, 0.6))
    ck = new_obj("cut", cb, [])
    ck.modifiers.new("bev", "BEVEL").width = 0.16
    ck.modifiers["bev"].segments = 4
    bake(ck)
    cutters.append(ck)
    for c in cutters:
        mod = ob.modifiers.new("b", "BOOLEAN")
        mod.operation = "DIFFERENCE"
        mod.object = c
        mod.solver = "EXACT"
        bake(ob)
        bpy.data.objects.remove(c)
    # paint scheme by face position
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for f in bm.faces:
        c, n = f.calc_center_median(), f.normal
        mi = 0
        if c.z < 0.30:
            mi = 3                                                  # dark skirt
        elif abs(c.y) < 0.33 and -0.72 < c.x < 0.27 and c.z > 0.40 and n.z < 0.75:
            mi = 3                                                  # cockpit inside
        elif n.z > 0.55 and abs(c.y) < 0.09 and not (-0.72 < c.x < 0.27):
            mi = 1                                                  # red centre stripe
        elif n.z > 0.55 and 0.09 <= abs(c.y) < 0.15 and not (-0.72 < c.x < 0.27):
            mi = 2                                                  # green edge stripes
        f.material_index = mi
    # details: seat, headlights, tail lights, grille, exhausts, rear wing with the shield, side mirrors
    box(bm, (-0.42, 0, 0.42), (0.36, 0.5, 0.16), 4)                 # seat cushion
    box(bm, (-0.60, 0, 0.66), (0.12, 0.5, 0.46), 4)                 # backrest
    for y in (0.27, -0.27):
        sphere(bm, (1.12, y, 0.45), 0.11, 6, (0.5, 1.0, 0.8))
        box(bm, (-1.235, y * 1.3, 0.58), (0.04, 0.2, 0.08), 7)
        cyl(bm, (-1.27, y * 0.7, 0.30), 0.055, 0.055, 0.18, 5, 16, "X")
    box(bm, (1.19, 0, 0.32), (0.06, 0.42, 0.08), 3)                 # grille
    for y in (0.5, -0.5):                                           # wing struts
        box(bm, (-1.0, y * 0.75, 0.86), (0.08, 0.05, 0.26), 3)
    box(bm, (-1.02, 0, 1.0), (0.34, 1.12, 0.05), 3)                 # wing
    box(bm, (-1.02, 0.58, 0.96), (0.38, 0.03, 0.16), 1)
    box(bm, (-1.02, -0.58, 0.96), (0.38, 0.03, 0.16), 1)
    bm.to_mesh(ob.data)
    bm.free()
    smooth(ob, 35)
    return ob


def wheel(name, x, y, r=0.36, w=0.3):
    bm = bmesh.new()
    t = bmesh.ops.create_cone(bm, cap_ends=True, segments=32, radius1=r, radius2=r, depth=w)
    for f in {f for v in t["verts"] for f in v.link_faces}:
        f.material_index = 0
    rim_side = 1 if y > 0 else -1
    cyl(bm, (0, 0, rim_side * (w / 2 - 0.02)), r * 0.62, r * 0.62, 0.05, 1, 24)
    cyl(bm, (0, 0, rim_side * (w / 2 + 0.005)), r * 0.16, r * 0.16, 0.04, 2, 16)
    for i in range(5):
        a = i * 2 * math.pi / 5
        vs = box(bm, (0, 0, rim_side * (w / 2 + 0.002)), (r * 1.08, 0.07, 0.03), 2)
        rot = Matrix.Rotation(a, 3, "Z")
        for v in vs:
            v.co = rot @ v.co
    rot = Matrix.Rotation(math.radians(-90), 3, "X")                # axle along Y
    for v in bm.verts:
        v.co = rot @ v.co
    ob = new_obj(name, bm, ["Rubber", "Chrome", "Gold"])
    bev = ob.modifiers.new("bev", "BEVEL")
    bev.width = 0.05
    bev.segments = 3
    bev.limit_method = "ANGLE"
    bake(ob)
    smooth(ob, 50)
    ob.location = (x, y, r)
    return ob


def steering():
    bm = bmesh.new()
    t = bmesh.ops.create_circle(bm, cap_ends=False, segments=24, radius=0.17)
    ring = t["verts"]
    prof = bmesh.ops.extrude_edge_only(bm, edges=[e for e in bm.edges])
    for v in [v for v in prof["geom"] if isinstance(v, bmesh.types.BMVert)]:
        v.co *= 0.82
    bm.free()
    bm = bmesh.new()
    n, R, rr = 24, 0.17, 0.025
    rows = []
    for i in range(n):
        a = i * 2 * math.pi / n
        c = Vector((math.cos(a) * R, math.sin(a) * R, 0))
        out = Vector((math.cos(a), math.sin(a), 0))
        rows.append([bm.verts.new(c + (out * math.cos(b) + Vector((0, 0, 1)) * math.sin(b)) * rr) for b in [j * 2 * math.pi / 8 for j in range(8)]])
    for i in range(n):
        for j in range(8):
            bm.faces.new((rows[i][j], rows[(i + 1) % n][j], rows[(i + 1) % n][(j + 1) % 8], rows[i][(j + 1) % 8]))
    for f in bm.faces:
        f.material_index = 0
    for a in (90, 210, 330):
        vs = box(bm, (0, 0, 0), (0.17, 0.03, 0.02), 0)
        rot = Matrix.Rotation(math.radians(a), 3, "Z")
        for v in vs:
            v.co = rot @ (v.co + Vector((0.085, 0, 0)))
    cyl(bm, (0, 0, 0), 0.05, 0.05, 0.05, 1, 16)
    rot = Matrix.Rotation(math.radians(-70), 3, "Y")                # facing the driver, tilted
    for v in bm.verts:
        v.co = rot @ v.co
    ob = new_obj("Car_Steer", bm, ["Trim", "Gold"])
    smooth(ob, 50)
    ob.location = (0.05, 0, 0.72)
    return ob


# ---------------------------------------------------------------- race pieces
def gate_arch():
    bm = bmesh.new()
    w, h = 2.6, 3.6
    outer = pointed_arch(w + 0.5, h + 0.35, 1.0)
    inner = pointed_arch(w, h, 0.85)
    # rotate the outline into the YZ plane (the gate spans the lane across Y; it faces +X)
    fs = frame_outline(bm, outer, inner, -0.15, 0.15, 0)
    for v in {v for f in fs for v in f.verts}:
        v.co = Vector((v.co.y, v.co.x, v.co.z))
    box(bm, (0, 0, h + 0.75), (0.2, w + 0.7, 0.18), 1)              # top beam under the sign
    for y in (w / 2 + 0.15, -w / 2 - 0.15):
        box(bm, (0, y, 0.15), (0.5, 0.5, 0.3), 1)                   # plinths
        sphere(bm, (0, y, h + 1.0), 0.13, 2, segs=12)              # finials
    ob = new_obj("Gate_Arch", bm, ["Lane", "Plaster", "Gold"])
    smooth(ob, 40)
    sb = bmesh.new()
    box(sb, (0.0, 0, 0), (0.06, w + 0.4, 1.05), 0)
    sign = new_obj("Gate_Sign", sb, ["Sign"])
    sign.location = (0.13, 0, h + 1.45)
    sign.parent = ob
    return ob


def finish_arch():
    bm = bmesh.new()
    W, H = 10.0, 5.2
    for y in (W / 2, -W / 2):
        box(bm, (0, y, H / 2), (0.7, 0.7, H), 0)
        merlons(bm, -0.2, 0.2, y, H, 0, 0.4)
        cyl(bm, (0, y, H + 0.55), 0.22, 0.05, 0.5, 2, 12)
    cols, rows = 20, 2
    for i in range(cols):
        for j in range(rows):
            box(bm, (0, -W / 2 + 0.35 + (i + 0.5) * (W - 0.7) / cols, H - 0.4 - j * 0.45), (0.25, (W - 0.7) / cols, 0.45), 3 + (i + j) % 2)
    box(bm, (0, 0, H + 0.05), (0.4, W + 0.6, 0.2), 1)
    ob = new_obj("Finish_Arch", bm, ["Plaster", "WoodDark", "Gold", "White", "Black"])
    return ob


def pit_station():
    bm = bmesh.new()
    for x in (-2.6, 2.6):
        for y in (-2.0, 2.0):
            box(bm, (x, y, 1.7), (0.35, 0.35, 3.4), 0)
    box(bm, (0, 0, 3.55), (6.4, 4.8, 0.3), 1)                       # roof
    merlons(bm, -3.0, 3.0, 2.3, 3.7, 0, 0.6)
    merlons(bm, -3.0, 3.0, -2.3, 3.7, 0, 0.6)
    box(bm, (0, 0, 0.02), (6.0, 4.4, 0.04), 3)                       # glowing pad
    box(bm, (0, 2.6, 1.0), (1.2, 0.6, 2.0), 1)                       # kiosk
    box(bm, (0.62, 2.6, 1.3), (0.05, 0.5, 0.6), 2)                   # kiosk screen
    ob = new_obj("Pit_Station", bm, ["Plaster", "Trim", "Glow", "Lane"])
    sb = bmesh.new()
    box(sb, (0, 0, 0), (0.08, 4.4, 1.2), 0)
    s = new_obj("Pit_Sign", sb, ["Sign"])
    s.location = (3.25, 0, 4.4)
    s.parent = ob
    return ob


def boost_pad():
    bm = bmesh.new()
    box(bm, (0, 0, 0.02), (2.0, 2.0, 0.04), 0)
    for i in range(3):
        x = -0.55 + i * 0.55
        for s in (1, -1):
            vs = box(bm, (0, 0, 0), (0.5, 0.12, 0.03), 1)
            rot = Matrix.Rotation(math.radians(-38 * s), 3, "Z")
            for v in vs:
                v.co = rot @ v.co + Vector((x, 0.16 * s, 0.055))
    return new_obj("Boost_Pad", bm, ["Trim", "Glow"])


def pickup_shield():
    bm = bmesh.new()
    pts = []
    for i in range(17):
        t = i / 16
        a = math.pi * t
        pts.append((0.32 * math.cos(a), 0.12 + 0.18 * math.sin(a)))            # rounded top
    pts = [(x, z) for x, z in pts]
    pts += [(-0.30, -0.05), (-0.18, -0.24), (0.0, -0.36), (0.18, -0.24), (0.30, -0.05)]
    pts = [(x, z) for x, z in pts]
    fs = extrude_outline(bm, pts, -0.05, 0.05, 0)
    for v in {v for f in fs for v in f.verts}:
        v.co = Vector((v.co.y, v.co.x, v.co.z + 0.36))
    ob = new_obj("Pickup_Shield", bm, ["Gold", "Glow"])
    bev = ob.modifiers.new("bev", "BEVEL")
    bev.width = 0.03
    bev.segments = 2
    bake(ob)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    sphere(bm, (0.07, 0, 0.42), 0.07, 1, (0.6, 1, 1), 10)                      # cyan gem
    sphere(bm, (-0.07, 0, 0.42), 0.07, 1, (0.6, 1, 1), 10)
    bm.to_mesh(ob.data)
    bm.free()
    smooth(ob, 40)
    return ob


def popup_block():
    bm = bmesh.new()
    box(bm, (0, 0, 0.85), (0.35, 1.9, 1.3), 1)                      # the "window"
    box(bm, (0.12, 0, 1.38), (0.15, 1.9, 0.24), 0)                  # title bar
    box(bm, (0.21, -0.75, 1.38), (0.06, 0.22, 0.18), 2)            # the X button
    box(bm, (0.19, 0, 0.75), (0.05, 1.1, 0.35), 3)                 # fake "win" button
    ob = new_obj("Popup_Block", bm, ["PopRed", "PopScreen", "White", "Glow"])
    bev = ob.modifiers.new("bev", "BEVEL")
    bev.width = 0.04
    bev.segments = 2
    bake(ob)
    smooth(ob, 40)
    return ob


def dhow():
    bm = bmesh.new()
    L, B, D = 8.0, 2.2, 1.3
    rows, cols = 13, 9
    grid = []
    for i in range(rows):
        u = -1 + 2 * i / (rows - 1)
        half = B / 2 * (1 - abs(u) ** 2.2) ** 0.7
        sheer = 0.5 * u ** 2 + (0.6 * max(0, u) ** 3)               # the prow rises
        ring = []
        for j in range(cols):
            a = math.pi * j / (cols - 1)
            y = half * math.cos(a)
            z = D + sheer - D * math.sin(a) ** 0.8 * (1 - abs(u) ** 6 * 0.5)
            ring.append(bm.verts.new((u * L / 2 * (1 + 0.15 * max(0, u)), y, z)))
        grid.append(ring)
    for i in range(rows - 1):
        for j in range(cols - 1):
            bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
    for f in bm.faces:
        f.material_index = 0
    cyl(bm, (0.6, 0, D + 3.0), 0.09, 0.06, 6.0, 1, 10)              # mast
    sail = [bm.verts.new(p) for p in ((-3.0, 0.05, D + 1.2), (2.6, 0.05, D + 5.6), (1.8, 0.05, D + 1.0))]
    f = bm.faces.new(sail)
    f.material_index = 2
    f2 = bm.faces.new([bm.verts.new((p.co.x, -0.05, p.co.z)) for p in sail][::-1])
    f2.material_index = 2
    cyl(bm, (-0.2, 0, D + 3.3), 0.04, 0.04, 6.4, 1, 8, "X")
    ob = new_obj("Dhow", bm, ["Wood", "WoodDark", "Sail"])
    ob.modifiers.new("solid", "SOLIDIFY").thickness = 0.06
    bake(ob)
    smooth(ob, 45)
    return ob


def fort_tower():
    bm = bmesh.new()
    cyl(bm, (0, 0, 3.0), 2.4, 2.0, 6.0, 0, 28)
    cyl(bm, (0, 0, 6.15), 2.15, 2.15, 0.3, 0, 28)
    for i in range(14):
        a = i * 2 * math.pi / 14
        box(bm, (math.cos(a) * 2.0, math.sin(a) * 2.0, 6.55), (0.45, 0.45, 0.5), 0)
    for i in range(4):
        a = i * math.pi / 2 + 0.4
        box(bm, (math.cos(a) * 2.25, math.sin(a) * 2.25, 4.2), (0.12, 0.35, 0.7), 1)
    ob = new_obj("Fort_Tower", bm, ["Sand", "Window"])
    smooth(ob, 30)
    return ob


def watch_tower():
    bm = bmesh.new()
    box(bm, (0, 0, 2.5), (2.2, 2.2, 5.0), 0)
    box(bm, (0, 0, 5.1), (2.5, 2.5, 0.2), 0)
    for x in (-1.0, -0.33, 0.33, 1.0):
        for y in (1.15, -1.15):
            box(bm, (x, y, 5.45), (0.3, 0.2, 0.5), 0)
            box(bm, (y, x, 5.45), (0.2, 0.3, 0.5), 0)
    box(bm, (1.11, 0, 3.6), (0.04, 0.4, 0.8), 1)
    ob = new_obj("Watch_Tower", bm, ["Plaster", "Window"])
    return ob


def lamp_post():
    bm = bmesh.new()
    cyl(bm, (0, 0, 0.15), 0.18, 0.14, 0.3, 0, 12)
    cyl(bm, (0, 0, 2.0), 0.06, 0.05, 3.6, 0, 10)
    box(bm, (0, 0, 3.95), (0.34, 0.34, 0.5), 1)
    cyl(bm, (0, 0, 4.35), 0.22, 0.02, 0.32, 0, 12)
    sphere(bm, (0, 0, 4.55), 0.06, 0, segs=8)
    ob = new_obj("Lamp_Post", bm, ["Gold", "Light"])
    smooth(ob, 40)
    return ob


def house_block():
    bm = bmesh.new()
    box(bm, (0, 0, 2.0), (5.0, 5.0, 4.0), 0)
    merlons(bm, -2.3, 2.3, 2.4, 4.0, 0, 0.46)
    merlons(bm, -2.3, 2.3, -2.4, 4.0, 0, 0.46)
    for z in (1.2, 2.9):
        for y in (-1.4, 0.0, 1.4):
            box(bm, (2.51, y, z), (0.04, 0.6, 0.9), 1)
    box(bm, (2.52, 0.0, 0.9), (0.04, 0.9, 1.8), 2)                  # door
    ob = new_obj("House_Block", bm, ["Plaster", "Window", "WoodDark"])
    return ob


body = car_body()
wheels = [wheel("Car_Wheel_FL", 0.82, 0.69), wheel("Car_Wheel_FR", 0.82, -0.69), wheel("Car_Wheel_RL", -0.80, 0.69, 0.38, 0.34),
          wheel("Car_Wheel_RR", -0.80, -0.69, 0.38, 0.34)]
steer = steering()
pieces = [gate_arch(), finish_arch(), pit_station(), boost_pad(), pickup_shield(), popup_block(), dhow(), fort_tower(), watch_tower(),
          lamp_post(), house_block()]

if PREVIEW:
    sc = scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.light = "STUDIO"
    sc.display.shading.color_type = "MATERIAL"
    sc.display.shading.show_shadows = True
    sc.render.resolution_x, sc.render.resolution_y = 1200, 800
    sc.world = bpy.data.worlds.new("w")
    sc.world.color = (0.75, 0.85, 0.95)
    # line the pieces up behind the car for the picture
    for i, p in enumerate(pieces):
        p.location = (-8 - (i % 4) * 9, -8 + (i // 4) * 9, 0)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    sc.camera = cam
    for name, loc, look, lens, path in (("car", (4.2, 3.0, 2.0), (0, 0, 0.5), 50, "car"), ("kit", (14, 22, 16), (-18, 2, 2), 28, "kit")):
        cam.location = loc
        d = Vector(look) - Vector(loc)
        cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        cam.data.lens = lens
        sc.render.filepath = os.path.join(HERE, "preview_" + path + ".png")
        bpy.ops.render.render(write_still=True)
    for i, p in enumerate(pieces):
        p.location = (0, 0, 0)

bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_apply=True)
print("race-kit written:", OUT, os.path.getsize(OUT))
