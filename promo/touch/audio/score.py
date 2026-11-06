"""The music and sound of 《请勿触摸》.

A small jazz trio, synthesised with numpy: a piano with real inharmonicity and a damper, an
upright bass plucked by a Karplus-Strong string, and a drummer on brushes and ride. 96 BPM in
F, swung; 22 bars of 2.5 s, so every bar line falls on a cut. The first three bars are only the
hush of a museum at night; the band comes in on the downbeat where the sign has been changed.
Over the music, the sounds of the picture, placed from the cue sheet the timeline exports.

    python3 -I audio/score.py out/cues.json out/score.wav
"""

import json
import sys

import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 48000
DUR = 55.0
N = int(SR * (DUR + 4))
BPM = 96
BEAT = 60 / BPM
BAR = 4 * BEAT
SWING = 0.62  # where the off-beat eighth falls inside the beat
R = np.random.default_rng(2026)

music = np.zeros((2, N))
sfx = np.zeros((2, N))
room = np.zeros((2, N))


def note(name):
    names = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
    k = names[name[0]]
    i = 1
    while name[i] in "#b":
        k += 1 if name[i] == "#" else -1
        i += 1
    return 440.0 * 2 ** ((k + 12 * (int(name[i:]) + 1) - 69) / 12)


def times(d):
    return np.arange(int(d * SR)) / SR


def put(bus, t, x, pan=0.0, gain=1.0):
    i = int(round(t * SR))
    if x.ndim == 1:
        a = (pan + 1) * np.pi / 4
        x = np.vstack([x * np.cos(a), x * np.sin(a)])
    if i < 0:
        x = x[:, -i:]
        i = 0
    j = min(N, i + x.shape[1])
    if j > i:
        bus[:, i:j] += gain * x[:, : j - i]


def sos(kind, f, order=2):
    return signal.butter(order, f, btype=kind, fs=SR, output="sos")


def lp(x, f, o=2):
    return signal.sosfilt(sos("low", f, o), x)


def hp(x, f, o=2):
    return signal.sosfilt(sos("high", f, o), x)


def bp(x, a, b, o=2):
    return signal.sosfilt(sos("band", [a, min(b, SR / 2 - 200)], o), x)


def noise(n):
    return R.standard_normal(n)


def fade(x, a=0.002, r=0.02):
    n = len(x)
    e = np.ones(n)
    na, nr = max(1, int(a * SR)), max(1, int(r * SR))
    e[: min(na, n)] = np.linspace(0, 1, min(na, n))
    e[-min(nr, n) :] *= np.linspace(1, 0, min(nr, n))
    return x * e


# ------------------------------------------------------------------ the trio
def piano(f, dur, vel=0.7):
    """Partials stretched by the string's stiffness, each decaying twice (prompt, then
    after-sound), two strings a hair apart, a felt hammer, and a damper at the end."""
    n = int((dur + 1.0) * SR)
    t = np.arange(n) / SR
    B = 0.0004 * (f / 262) ** 0.8
    y = np.zeros(n)
    bright = 0.45 + 0.55 * vel
    for k in range(1, 16):
        fk = k * f * np.sqrt(1 + B * k * k)
        if fk > 11000:
            break
        amp = k ** -1.05 * np.exp(-(k - 1) * (0.32 - 0.22 * bright))
        d1 = (2.2 + 0.7 * k) * (f / 262) ** 0.35
        d2 = (0.32 + 0.06 * k) * (f / 262) ** 0.5
        env = 0.62 * np.exp(-t * d1) + 0.38 * np.exp(-t * d2)
        ph = R.random() * 6
        y += amp * env * (np.sin(2 * np.pi * fk * t + ph) + 0.55 * np.sin(2 * np.pi * fk * 1.0011 * t + ph * 1.3))
    hammer = lp(noise(n), 2400) * np.exp(-t * 180) * 0.06 * vel
    y = y + hammer
    damp = np.ones(n)
    k0 = int(dur * SR)
    damp[k0:] = np.exp(-np.arange(n - k0) / SR * 14)
    return fade(y * damp, 0.001, 0.05) * vel * 0.16


def upright(f, dur, vel=0.8):
    """A plucked string: a burst of noise circulating in a delay line one period long,
    softened a little each time round, then the body's warmth and the finger's thump."""
    n = int((dur + 0.5) * SR)
    P = int(round(SR / f))
    y = np.zeros(n + P + 2)
    y[: P + 1] = lp(noise(P + 1), 900, 1) * 1.4
    pos = P + 1
    loss = 0.4985
    while pos < len(y):
        m = min(P, len(y) - pos)
        y[pos : pos + m] = loss * (y[pos - P : pos - P + m] + y[pos - P - 1 : pos - P - 1 + m])
        pos += m
    y = y[P + 1 : P + 1 + n]
    t = np.arange(n) / SR
    thump = np.sin(2 * np.pi * f * t) * np.exp(-t * 9) * 0.6 + lp(noise(n), 300) * np.exp(-t * 70) * 0.3
    y = lp(y, 1100) + thump
    damp = np.ones(n)
    k0 = int(dur * SR)
    damp[k0:] = np.exp(-np.arange(n - k0) / SR * 18)
    return fade(y * damp * np.exp(-t * 0.9), 0.003, 0.03) * vel * 0.42


def ride(vel=0.7):
    t = times(2.2)
    n = len(t)
    ratios = [1.0, 1.483, 1.932, 2.546, 2.63, 3.897]
    m = np.zeros(n)
    for r in ratios:
        m += np.sign(np.sin(2 * np.pi * 412 * r * t + R.random() * 6))
    m = bp(m, 3200, 11000)
    ping = np.sin(2 * np.pi * 4450 * t) * np.exp(-t * 7) * 0.25
    wash = hp(noise(n), 6500) * np.exp(-t * 2.8) * 0.5
    return (m * 0.18 * np.exp(-t * 1.9) + ping + wash) * np.minimum(1, t / 0.002) * vel * 0.075


def chick(vel=0.6):
    t = times(0.12)
    return hp(noise(len(t)), 6000) * np.exp(-t * 55) * vel * 0.05


def tap(vel=0.6):
    t = times(0.3)
    n = len(t)
    x = bp(noise(n), 900, 6000) * np.exp(-t * 28)
    body = np.sin(2 * np.pi * 196 * t) * np.exp(-t * 34) * 0.4
    return (x + body) * vel * 0.12


def kick(vel=0.5):
    t = times(0.4)
    f = 52 + 40 * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9) * vel * 0.32


def swirl(dur, vel=0.5):
    """Brushes stirred round the head of the snare, one turn a beat."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = bp(noise(n), 1800, 7500)
    turn = np.abs(np.sin(np.pi * t / BEAT)) ** 0.7
    return x * (0.35 + 0.65 * turn) * vel * 0.016


def vibes(f, dur=2.4, vel=0.5):
    t = times(dur)
    trem = 1 + 0.25 * np.sin(2 * np.pi * 5.2 * t)
    y = np.sin(2 * np.pi * f * t) + 0.25 * np.sin(2 * np.pi * f * 3.98 * t) * np.exp(-t * 6) + 0.08 * np.sin(2 * np.pi * f * 9.1 * t) * np.exp(-t * 14)
    return fade(y * trem * np.exp(-t * 1.6), 0.002, 0.2) * vel * 0.12


def air(freqs, dur, vel=0.5, att=1.2):
    """A sustained chord, very soft, for the empty room."""
    t = times(dur)
    n = len(t)
    y = np.zeros((2, n))
    for i, f in enumerate(freqs):
        for d, side in ((-0.003, 0), (0.003, 1)):
            ph = R.random() * 6
            s = np.sin(2 * np.pi * f * (1 + d) * t + ph) + 0.3 * np.sin(4 * np.pi * f * (1 + d) * t + ph)
            y[side] += s
    e = np.minimum(1, t / att) * np.minimum(1, (dur - t) / 1.4).clip(0)
    return lp(y * e, 2400) * vel * 0.02


# ------------------------------------------------------------------ the tune
def swung(bar, eighth):
    beat, half = divmod(eighth, 2)
    return bar * BAR + (beat + (SWING if half else 0)) * BEAT


CH = {
    "Fmaj9": ("F", "A3 C4 E4 G4"),
    "Fmaj7": ("F", "A3 C4 E4 F4"),
    "Dm9": ("D", "F3 A3 C4 E4"),
    "Gm9": ("G", "Bb3 D4 F4 A4"),
    "Gm7": ("G", "Bb3 D4 F4"),
    "C13": ("C", "E3 Bb3 D4 A4"),
    "C7": ("C", "E3 Bb3 D4 G4"),
    "C7sus": ("C", "Bb3 D4 F4 G4"),
    "Am7": ("A", "G3 C4 E4"),
    "D7b9": ("D", "F#3 C4 Eb4 A4"),
    "D7": ("D", "F#3 C4 E4 A4"),
    "Bbmaj7": ("Bb", "A3 D4 F4"),
    "Bbmaj9": ("Bb", "A3 C4 D4 F4"),
    "Bb13": ("Bb", "Ab3 D4 G4 C5"),
}
ROOT = {"F": "F2", "D": "D2", "G": "G2", "C": "C2", "A": "A2", "Bb": "Bb1"}
# one or two chords a bar; None where the room is empty
PLAN = [
    None, ["Fmaj9"], ["Bbmaj7", "C7sus"],
    ["Fmaj7"], ["Dm9"], ["Gm9"], ["C13"], ["Fmaj9"], ["Am7", "D7b9"],
    ["Gm9"], ["C7sus", "C7"],
    ["Fmaj7"], ["D7"], ["Gm7", "C7"], ["Am7", "D7"], ["Gm9"], ["C13"], ["Fmaj9", "Bb13"],
    ["Bbmaj9"], ["Gm9", "C7sus"], ["C7sus", "Fmaj9"], ["Fmaj9"],
]
BAND = set(range(3, 18))
WALK = set(range(5, 9)) | set(range(11, 18))


def chord_at(b, half):
    p = PLAN[b]
    if p is None:
        return None
    return p[min(half, len(p) - 1)]


# piano comping: a Charleston on most bars, held chords in the quiet ones
for b in range(22):
    p = PLAN[b]
    if p is None:
        continue
    for half in range(len(p)):
        name = p[half]
        voicing = [note(x) for x in CH[name][1].split()]
        start = half * 4
        if b in (1, 2, 18, 19, 20, 21) or b == 9:
            when = [(start, 3.6 if len(p) > 1 else 7.6, 0.5)]
            if b == 20 and half == 1:
                when = [(4, 9.0, 0.62)]
            if b == 21:
                when = []
        else:
            hits = [(0, 1.0, 0.55), (3, 1.4, 0.48)] if len(p) == 1 else [(0, 1.0, 0.55), (3, 0.6, 0.45)]
            if len(p) == 1:
                hits += [(5, 0.8, 0.4)] if b % 2 else [(6, 1.4, 0.42)]
            when = [(start + e, d, v) for e, d, v in hits if start + e < start + 4 or len(p) == 1]
        for e, d, v in when:
            t0 = swung(b, e) + R.uniform(-0.006, 0.006)
            for i, f in enumerate(voicing):
                put(music, t0 + i * 0.008, piano(f, d * BEAT / 2 * 2, v), pan=-0.35 + 0.18 * i, gain=0.5)

# the bass: half notes when the band is gentle, walking when it moves
for b in range(3, 21):
    p = PLAN[b]
    if p is None:
        continue
    names = [CH[c][0] for c in p]
    nxt = PLAN[b + 1] if b + 1 < 22 and PLAN[b + 1] else p
    nroot = note(ROOT[CH[nxt[0]][0]])
    if b in WALK:
        for beat in range(4):
            half = beat // 2 if len(p) > 1 else 0
            r = note(ROOT[names[min(half, len(names) - 1)]])
            if beat == 0 or (len(p) > 1 and beat == 2):
                f = r
            elif beat == 3:
                f = nroot * (2 ** (1 / 12) if R.random() < 0.5 else 2 ** (-1 / 12))
            else:
                f = r * (2 ** (7 / 12) if beat == 2 else 2 ** (4 / 12 if R.random() < 0.5 else 3 / 12))
            put(music, b * BAR + beat * BEAT + R.uniform(-0.004, 0.004), upright(f, BEAT * 0.95, 0.85 if beat % 2 == 0 else 0.72), pan=0.05)
    elif b in BAND or b in (18, 19):
        for half in range(2):
            r = note(ROOT[names[min(half, len(names) - 1)]])
            put(music, b * BAR + half * 2 * BEAT, upright(r, BEAT * 1.9, 0.8), pan=0.05)
    elif b == 20:
        put(music, b * BAR, upright(note("C2"), BEAT * 1.9, 0.75))
        put(music, b * BAR + 2 * BEAT, upright(note("F2"), BAR * 1.8, 0.9))

# the drummer
for b in range(3, 18):
    if b in (9, 10):
        put(music, b * BAR, swirl(BAR, 0.8), pan=-0.2)
        for beat in (1, 3):
            put(music, b * BAR + beat * BEAT, tap(0.35), pan=-0.15)
        continue
    rideOn = b >= 11 or b in (6, 7, 8)
    for beat in range(4):
        t0 = b * BAR + beat * BEAT
        if rideOn:
            put(music, t0, ride(0.75 if beat % 2 == 0 else 0.6), pan=0.35)
            if beat in (1, 3):
                put(music, t0 + SWING * BEAT, ride(0.42), pan=0.35)
            if beat in (1, 3):
                put(music, t0, chick(0.7), pan=0.25)
        if beat in (1, 3):
            put(music, t0 + 0.004, tap(0.55 if b < 11 else 0.65), pan=-0.15)
        if beat in (0, 2):
            put(music, t0, kick(0.42))
    if not rideOn:
        put(music, b * BAR, swirl(BAR, 0.9), pan=-0.2)
    if b == 14:
        pass
# a brush roll into the roast, and into the last chord
for t0, d in ((26.25, 1.25), (48.9, 2.35)):
    n = int(d * SR)
    tt = np.arange(n) / SR
    x = bp(noise(n), 1500, 7000) * (tt / d) ** 2 * 0.06
    put(music, t0, x, pan=-0.1)
# a cymbal breathing in before the band arrives
n = int(1.25 * SR)
tt = np.arange(n) / SR
put(music, 6.25, hp(noise(n), 5000) * (tt / 1.25) ** 3 * 0.09, pan=0.3)

# melody, the piano's right hand
MEL = {
    1: [(0, "A4", 3), (4, "C5", 2), (6, "E5", 2)],
    2: [(0, "D5", 4), (4, "C5", 3)],
    3: [(0, "F5", 2), (2, "E5", 1), (3, "C5", 3), (6, "A4", 2)],
    4: [(0, "D5", 2), (2, "C5", 1), (3, "A4", 2), (6, "F4", 2)],
    5: [(0, "Bb4", 2), (2, "D5", 1), (3, "F5", 3), (6, "E5", 2)],
    6: [(0, "E5", 3), (3, "D5", 1), (4, "Bb4", 4)],
    7: [(0, "A4", 2), (2, "C5", 1), (3, "F5", 2), (5, "G5", 1), (6, "A5", 2)],
    8: [(0, "G5", 2), (2, "E5", 1), (3, "C5", 2), (5, "F#5", 1), (6, "A5", 2)],
    10: [(4, "G5", 2), (6, "Bb5", 2)],
    11: [(0, "A5", 3), (3, "G5", 1), (4, "F5", 2), (6, "C5", 2)],
    12: [(0, "F#5", 2), (2, "A5", 1), (3, "C6", 3), (6, "A5", 2)],
    13: [(0, "Bb5", 2), (2, "A5", 1), (3, "G5", 2), (5, "E5", 1), (6, "C5", 2)],
    14: [(0, "C5", 2), (2, "E5", 1), (3, "G5", 2), (5, "F#5", 1), (6, "A5", 2)],
    15: [(0, "Bb5", 3), (3, "A5", 1), (4, "F5", 4)],
    16: [(0, "E5", 2), (2, "G5", 1), (3, "Bb5", 2), (5, "A5", 1), (6, "G5", 2)],
    17: [(0, "A5", 2), (2, "C6", 2), (4, "D6", 2), (6, "C6", 2)],
    18: [(0, "D5", 3), (4, "C5", 2), (6, "A4", 2)],
    19: [(0, "Bb4", 2), (2, "D5", 2), (4, "G5", 4)],
    20: [(4, "A5", 8)],
}
for b, notes in MEL.items():
    for e, n, ln in notes:
        v = 0.62 if b in (1, 2, 18, 19) else 0.78
        put(music, swung(b, e) + R.uniform(-0.005, 0.005), piano(note(n), ln * BEAT / 2, v), pan=0.18, gain=1.3)
# the room's own chord under the opening and the close
put(music, 2.4, air([note(x) for x in "A4 C5 E5".split()], 5.3, 0.6, 2.0))
put(music, 45.0, air([note(x) for x in "D5 F5 A5".split()], 6.2, 0.7, 1.5))
put(music, 51.25, air([note(x) for x in "A4 C5 E5 G5".split()], 3.8, 0.9, 0.3))
# the drop, and the last chord ringing on vibes
for i, n in enumerate(["F5", "A5", "C6", "E6", "G6"]):
    put(music, 51.25 + i * 0.07, vibes(note(n), 3.6, 0.55 - i * 0.05), pan=-0.4 + i * 0.2)
for i, n in enumerate(["C5", "E5", "G5", "C6"]):
    put(music, 7.5 + i * 0.06, vibes(note(n), 2.2, 0.32), pan=-0.3 + i * 0.2)


# ------------------------------------------------------------------ the sounds of the picture
def whoosh(d, lo, hi, up=True, peak=0.7, g=1.0):
    n = int(d * SR)
    t = np.arange(n) / SR
    u = t / d
    x = noise(n)
    out = np.zeros(n)
    bands = np.geomspace(lo, hi, 14)
    pos = (u if up else 1 - u) * (len(bands) - 1)
    for i, f in enumerate(bands):
        out += bp(x, f / 1.3, f * 1.3) * np.clip(1 - np.abs(pos - i) / 1.5, 0, 1)
    e = np.where(u < peak, (u / peak) ** 2, ((1 - u) / (1 - peak)) ** 1.4)
    return out * e * g * 0.4


def click_sound():
    t = times(0.09)
    y = hp(noise(len(t)), 2500) * (np.exp(-t * 1400) + 0.5 * np.where(t > 0.045, np.exp(-(t - 0.045) * 1400), 0))
    return y * 0.25


def key_sound():
    t = times(0.08)
    y = bp(noise(len(t)), 1500, 6000) * np.exp(-t * 500) * 0.35 + np.sin(2 * np.pi * 140 * t) * np.exp(-t * 90) * 0.25
    return y * 0.5


def wood(f=900, g=0.3):
    t = times(0.12)
    return (np.sin(2 * np.pi * f * t) * np.exp(-t * 60) + 0.4 * np.sin(2 * np.pi * f * 2.7 * t) * np.exp(-t * 90)) * g * 0.3


def water_drop(f0=900, g=0.3):
    t = times(0.3)
    f = f0 + 1500 * (1 - np.exp(-t * 28))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 16) * fade(np.ones(len(t)), 0.002, 0.04) * g * 0.35


def rustle(d, g=1.0):
    n = int(d * SR)
    t = np.arange(n) / SR
    x = bp(noise(n), 900, 5500)
    m = lp(np.abs(noise(n)), 30, 1)
    m /= m.max() + 1e-9
    return x * (0.4 + 0.6 * m) * np.minimum(1, t / 0.05) * np.minimum(1, (d - t) / 0.1).clip(0) * g * 0.05


cues = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "out/cues.json"))
for c in cues:
    t, k = c["t"], c["type"]
    g = c.get("gain", 1.0)
    if k == "room":
        d = c["dur"]
        n = int(d * SR)
        x = lp(noise(n), 380, 2) * 0.03 + bp(noise(n), 80, 220) * 0.012
        e = np.minimum(1, np.arange(n) / SR / 1.0) * np.minimum(1, (d - np.arange(n) / SR) / 1.5).clip(0)
        put(room, t, np.vstack([x * e, lp(noise(n), 380, 2) * 0.03 * e]))
    elif k == "footstep":
        tt = times(0.25)
        y = lp(noise(len(tt)), 1800) * np.exp(-tt * 60) * 0.25 + np.sin(2 * np.pi * 90 * tt) * np.exp(-tt * 40) * 0.2
        put(sfx, t, y * 0.6, pan=R.uniform(-0.7, -0.3))
    elif k == "click":
        put(sfx, t, click_sound())
    elif k == "key":
        put(sfx, t, key_sound(), pan=R.uniform(-0.1, 0.1))
    elif k == "select":
        put(sfx, t, whoosh(c["dur"] + 0.1, 2000, 7000, True, 0.8, 0.2))
    elif k == "scramble":
        d = c["dur"]
        for i in range(int(d * 34)):
            put(sfx, t + i / 34, wood(2200 + R.random() * 1800, 0.18), pan=R.uniform(-0.3, 0.3))
    elif k == "commit":
        put(sfx, t, whoosh(0.8, 3000, 9000, True, 0.15, 0.25))
    elif k == "lightup":
        tt = times(2.0)
        put(sfx, t, np.sin(2 * np.pi * 55 * tt) * np.minimum(1, tt / 0.4) * np.exp(-tt * 1.6) * 0.12)
    elif k == "steam":
        d = c["dur"]
        n = int(d * SR)
        tt = np.arange(n) / SR
        put(sfx, t, hp(noise(n), 3500) * np.minimum(1, tt / 0.8) * np.minimum(1, (d - tt) / 1.2).clip(0) * 0.012, pan=0.1)
    elif k == "seam":
        tt = times(0.5)
        y = bp(noise(len(tt)), 300, 1800) * np.exp(-tt * 20) * 0.2
        put(sfx, t, y * g)
        put(sfx, t + 0.05, whoosh(0.9, 2500, 9000, True, 0.4, 0.4 * g))
    elif k == "dive":
        d = c["dur"]
        put(sfx, t, whoosh(d + 0.3, 150, 5200, True, 0.72, 1.1 * g))
        tt = times(1.0)
        put(sfx, t + d - 0.05, np.sin(2 * np.pi * np.cumsum(62 - 22 * tt) / SR) * np.exp(-tt * 3.6) * fade(np.ones(len(tt)), 0.02, 0.2) * 0.3 * g)
    elif k == "plop":
        tt = times(0.2)
        put(sfx, t, np.sin(2 * np.pi * np.cumsum(260 - 120 * tt) / SR) * np.exp(-tt * 28) * 0.25 * g, pan=-0.3)
    elif k == "splash":
        for i in range(10):
            put(sfx, t + R.uniform(0, 0.18), bp(noise(int(0.06 * SR)), 1200, 6000) * np.exp(-times(0.06) * 60) * R.uniform(0.05, 0.12), pan=R.uniform(-0.4, 0))
        for i in range(4):
            put(sfx, t + 0.05 + i * 0.07, water_drop(500 + R.random() * 600, 0.25), pan=-0.2)
    elif k == "peel":
        tt = times(0.25)
        put(sfx, t, bp(noise(len(tt)), 500, 2500) * np.sin(np.pi * tt / 0.25) * 0.08)
    elif k == "tick":
        put(sfx, t, wood(1100 + R.random() * 500, 0.5), pan=R.uniform(-0.2, 0.2))
    elif k == "rattle":
        for i in range(14):
            put(sfx, t + R.uniform(0, 0.35), wood(1300 + R.random() * 1400, 0.22), pan=R.uniform(-0.2, 0.3))
    elif k == "fire":
        d = c["dur"]
        n = int(d * SR)
        tt = np.arange(n) / SR
        put(sfx, t, lp(noise(n), 900) * np.sin(np.pi * tt / d) ** 1.5 * 0.08, pan=0.1)
    elif k == "pop":
        for i in range(3):
            put(sfx, t + i * 0.06, bp(noise(int(0.02 * SR)), 1500, 7000) * np.exp(-times(0.02) * 220) * 0.18)
    elif k == "pour":
        d = c["dur"]
        n = int(d * SR)
        tt = np.arange(n) / SR
        x = bp(noise(n), 700, 3200) * (0.6 + 0.4 * np.sin(2 * np.pi * 9 * tt + 3 * np.sin(2 * np.pi * 2.3 * tt)))
        put(sfx, t, x * np.sin(np.pi * tt / d) ** 0.6 * 0.035, pan=0.3)
    elif k == "drip":
        for i in range(3):
            put(sfx, t + i * 0.32, water_drop(800 + 120 * i, 0.3), pan=0.3)
    elif k == "pullback":
        put(sfx, t, whoosh(c["dur"] + 0.3, 5000, 200, False, 0.3, 0.7 * g))
    elif k == "snap":
        put(sfx, t, wood(2600, 0.3))
        put(sfx, t + 0.05, wood(3400, 0.25))
    elif k == "pill":
        tt = times(0.18)
        put(sfx, t, np.sin(2 * np.pi * np.cumsum(700 + 500 * tt / 0.18) / SR) * np.exp(-tt * 18) * 0.08, pan=0.1)
    elif k == "send":
        put(sfx, t, whoosh(0.7, 500, 7000, True, 0.4, 0.5))
        put(sfx, t + 0.06, vibes(note("C6"), 1.2, 0.5))
        put(sfx, t + 0.15, vibes(note("G6"), 1.2, 0.45))
    elif k == "creak":
        tt = times(0.45)
        f = (380 if c.get("back") else 300) + 120 * np.sin(np.pi * tt / 0.45)
        y = np.sign(np.sin(2 * np.pi * np.cumsum(f) / SR)) * (0.5 + 0.5 * np.sin(2 * np.pi * 37 * tt))
        put(sfx, t, bp(y, 400, 3000) * np.sin(np.pi * tt / 0.45) * 0.035)
    elif k == "unroll":
        put(sfx, t, rustle(c["dur"], 1.4))
        if not c.get("back"):
            put(sfx, t + c["dur"] - 0.05, wood(420, 0.5))
    elif k == "bean":
        put(sfx, t, wood(700 + 90 * c["k"], 0.55), pan=-0.5 + c["k"] * 0.12)
    elif k == "crack":
        for i in range(12):
            put(sfx, t + R.uniform(0, 0.5), bp(noise(int(0.015 * SR)), 1500, 8000) * np.exp(-times(0.015) * 300) * R.uniform(0.12, 0.3), pan=R.uniform(-0.3, 0.4))
    elif k == "draw":
        put(sfx, t, rustle(c["dur"], 0.6), pan=-0.2)
    elif k == "rollup":
        put(sfx, t, rustle(c["dur"], 1.6), pan=0.2)
        put(sfx, t, whoosh(c["dur"], 3000, 400, False, 0.4, 0.3))
    elif k == "thock":
        put(sfx, t, wood(330, 0.8))
    elif k == "fly":
        put(sfx, t, whoosh(c["dur"], 300, 5000, True, 0.55, 0.6))
    elif k == "phone":
        put(sfx, t, whoosh(c["dur"], 200, 2600, True, 0.75, 0.45))
    elif k == "open":
        for i, n in enumerate(["F6", "A6", "C7"]):
            put(sfx, t + i * 0.05, vibes(note(n), 1.0, 0.35), pan=-0.3 + 0.3 * i)
    elif k == "tap":
        tt = times(0.1)
        put(sfx, t, lp(noise(len(tt)), 1500) * np.exp(-tt * 90) * 0.3)
    elif k == "push":
        put(sfx, t, whoosh(c["dur"] + 0.3, 200, 4500, True, 0.9, 0.5))
    elif k == "lamp":
        tt = times(1.4)
        clunk = lp(noise(len(tt)), 900) * np.exp(-tt * 45) * 0.5 + np.sin(2 * np.pi * 70 * tt) * np.exp(-tt * 25) * 0.4
        hum = np.sin(2 * np.pi * 100 * tt) * np.minimum(1, tt / 0.3) * np.exp(-tt * 1.4) * 0.03
        put(sfx, t, (clunk + hum) * 0.5, pan=-0.6 if t < 47.5 else 0.6)
    elif k == "fall":
        tt = times(0.32)
        put(sfx, t, np.sin(2 * np.pi * np.cumsum(2400 - 1400 * tt / 0.32) / SR) * (tt / 0.32) ** 2 * 0.02)
    elif k == "dropring":
        put(sfx, t, water_drop(600, 0.55))
        put(sfx, t + 0.02, bp(noise(int(0.08 * SR)), 2000, 8000) * np.exp(-times(0.08) * 50) * 0.08)
    elif k == "brand":
        put(sfx, t, whoosh(1.2, 4000, 10000, True, 0.3, 0.15))


# ------------------------------------------------------------------ mix
def reverb(x, sec, damp, pre=0.02):
    n = int(sec * SR)
    t = np.arange(n) / SR
    out = []
    for ch in range(2):
        ir = noise(n) * np.exp(-t * 6.9 / sec)
        ir = lp(ir, damp) * 0.7 + ir * 0.3 * np.exp(-t * 20)
        ir[: int(pre * SR)] = 0
        ir /= np.sqrt(np.sum(ir**2))
        out.append(signal.fftconvolve(x[ch], ir)[: x.shape[1]])
    return np.vstack(out)


mix = 0.9 * (music + 0.28 * reverb(music, 1.9, 5000)) + 1.6 * (sfx + 0.22 * reverb(sfx, 2.6, 4200, 0.03)) + room
mix = np.vstack([hp(mix[0], 30), hp(mix[1], 30)])[:, : int(DUR * SR)]
f_out = int(1.6 * SR)
mix[:, -f_out:] *= np.linspace(1, 0, f_out) ** 1.5
mix[:, : int(0.03 * SR)] *= np.linspace(0, 1, int(0.03 * SR))
level = np.sqrt(lp(np.maximum(mix[0] ** 2, mix[1] ** 2), 3, 1).clip(1e-9))
ref = np.percentile(level, 90)
mix *= np.minimum(1.0, (ref / level) ** 0.3)
mix /= np.abs(mix).max()
mix = np.tanh(mix * 1.1) / np.tanh(1.1) * 0.9
out = sys.argv[2] if len(sys.argv) > 2 else "out/score.wav"
wavfile.write(out, SR, (mix.T * 32767).astype(np.int16))
print("wrote", out, mix.shape[1] / SR, "s")
