"""The score and the sound of DrawY's sixty seconds.

An original piece in D major at 96 BPM (24 bars of 2.5 s, so every bar line falls on a cut),
synthesised from scratch with numpy: a music box, an FM electric piano, a marimba, plucked
strings, a warm pad, a soft kit. Over it, the sounds of the picture, placed from the cue
sheet the timeline exports: graphite on paper, keys, a shutter, whooshes into each scene,
and the lantern catching light.

    python3 audio/score.py out/cues.json out/score.wav
"""

import json
import sys

import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 48000
DUR = 60.0
N = int(SR * (DUR + 3))
BPM = 96
BEAT = 60 / BPM
BAR = 4 * BEAT
E8 = BEAT / 2
rng = np.random.default_rng(7)

music = np.zeros((2, N))
sfx = np.zeros((2, N))


def midi(name):
    names = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
    n = names[name[0]]
    i = 1
    while name[i] in "#b":
        n += 1 if name[i] == "#" else -1
        i += 1
    return n + 12 * (int(name[i:]) + 1)


def hz(x):
    m = midi(x) if isinstance(x, str) else x
    return 440.0 * 2 ** ((m - 69) / 12)


def place(bus, t, sig, pan=0.0, gain=1.0):
    """Mixes a mono or stereo signal into a bus at time t, panned with equal power."""
    i = int(round(t * SR))
    if i >= N:
        return
    if sig.ndim == 1:
        a = (pan + 1) * np.pi / 4
        st = np.vstack([sig * np.cos(a), sig * np.sin(a)])
    else:
        st = sig
    j = min(N, i + st.shape[1])
    if i < 0:
        st = st[:, -i:]
        i = 0
    bus[:, i:j] += gain * st[:, : j - i]


def tt(dur):
    return np.arange(int(dur * SR)) / SR


def env_ar(n, att, rel):
    e = np.ones(n)
    a = max(1, int(att * SR))
    r = max(1, int(rel * SR))
    e[:a] = np.linspace(0, 1, a)
    if r < n:
        e[-r:] *= np.linspace(1, 0, r)
    return e


def bp(x, lo, hi, order=2):
    sos = signal.butter(order, [lo, min(hi, SR / 2 - 100)], btype="band", fs=SR, output="sos")
    return signal.sosfilt(sos, x)


def lp(x, f, order=2):
    return signal.sosfilt(signal.butter(order, f, btype="low", fs=SR, output="sos"), x)


def hp(x, f, order=2):
    return signal.sosfilt(signal.butter(order, f, btype="high", fs=SR, output="sos"), x)


def noise(n):
    return rng.standard_normal(n)


# ------------------------------------------------------------------ instruments
def musicbox(f, dur=2.4, vel=1.0):
    t = tt(dur)
    parts = [(1, 1.0, 1.6), (2.0, 0.28, 2.6), (3.0, 0.12, 3.4), (4.16, 0.10, 5.0), (5.43, 0.04, 7.0)]
    y = np.zeros_like(t)
    for k, a, d in parts:
        y += a * np.sin(2 * np.pi * f * k * t + rng.random() * 6) * np.exp(-t * d)
    y *= env_ar(len(t), 0.002, 0.05)
    return vel * y * 0.5


def marimba(f, dur=1.4, vel=1.0):
    t = tt(dur)
    y = np.sin(2 * np.pi * f * t) * np.exp(-t * 4.5)
    y += 0.32 * np.sin(2 * np.pi * f * 3.93 * t) * np.exp(-t * 13)
    y += 0.08 * np.sin(2 * np.pi * f * 9.2 * t) * np.exp(-t * 30)
    click = bp(noise(len(t)), 1500, 6000) * np.exp(-t * 300) * 0.25
    return vel * (y + click) * env_ar(len(t), 0.001, 0.05) * 0.55


def epiano(f, dur=1.2, vel=1.0):
    t = tt(dur + 0.4)
    idx = 1.3 * np.exp(-t * 3.5) + 0.12
    y = np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * t))
    tine = 0.12 * np.sin(2 * np.pi * f * 7.0 * t) * np.exp(-t * 18)
    e = np.exp(-t * 1.1) * env_ar(len(t), 0.003, 0.35)
    e[int(dur * SR):] *= np.linspace(1, 0, len(t) - int(dur * SR))
    trem = 1 + 0.06 * np.sin(2 * np.pi * 5.0 * t)
    return vel * (y + tine) * e * trem * 0.32


def pluck(f, dur=1.0, vel=1.0, bright=0.5):
    """Karplus–Strong, computed a period at a time."""
    n = int(dur * SR)
    P = max(2, int(round(SR / f)))
    buf = lp(noise(P + 1), 1500 + 6000 * bright, 1) if P > 30 else noise(P + 1)
    y = np.zeros(n + P + 1)
    y[: P + 1] = buf
    k = P + 1
    damp = 0.996
    while k < len(y):
        m = min(P, len(y) - k)
        y[k : k + m] = damp * 0.5 * (y[k - P : k - P + m] + y[k - P - 1 : k - P - 1 + m])
        k += m
    out = y[P + 1 : P + 1 + n]
    return vel * out * env_ar(n, 0.001, 0.08) * 0.45


def bass(f, dur=0.6, vel=1.0):
    t = tt(dur + 0.1)
    y = np.sin(2 * np.pi * f * t) + 0.5 * np.sin(4 * np.pi * f * t) + 0.18 * np.sin(6 * np.pi * f * t)
    e = np.exp(-t * 2.2) * env_ar(len(t), 0.006, 0.09)
    return vel * lp(y * e, 900) * 0.42


def pad(freqs, dur, vel=1.0, att=0.7, rel=1.2, bright=1.0):
    t = tt(dur + rel)
    y = np.zeros((2, len(t)))
    for fi, f in enumerate(freqs):
        for v, det in enumerate([-0.0045, 0.0, 0.0047]):
            ff = f * (1 + det)
            vib = 1 + 0.0018 * np.sin(2 * np.pi * (0.21 + 0.07 * v) * t + v)
            s = np.zeros(len(t))
            for h in range(1, 14):
                if ff * h > 5200:
                    break
                s += np.sin(2 * np.pi * ff * h * np.cumsum(vib) / SR + rng.random() * 6) / h * np.exp(-h / (3.2 * bright))
            pan = (v - 1) * 0.6 + (fi - len(freqs) / 2) * 0.1
            a = (pan + 1) * np.pi / 4
            y[0] += s * np.cos(a)
            y[1] += s * np.sin(a)
    e = np.ones(len(t))
    a_n = int(att * SR)
    e[:a_n] = np.sin(np.linspace(0, np.pi / 2, a_n)) ** 2
    r0 = int(dur * SR)
    e[r0:] = np.linspace(1, 0, len(t) - r0) ** 2
    return vel * y * e * 0.05


# drums
def kick(vel=1.0):
    t = tt(0.45)
    f = 54 + 95 * np.exp(-t * 32)
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7.5)
    y += bp(noise(len(t)), 2000, 7000) * np.exp(-t * 400) * 0.15
    return vel * y * 0.8


def snap(vel=1.0):
    t = tt(0.35)
    n = bp(noise(len(t)), 1100, 6500)
    e = np.zeros(len(t))
    for d in (0.0, 0.009, 0.018):
        e += np.where(t >= d, np.exp(-(t - d) * 160), 0)
    e += np.exp(-t * 20) * 0.35
    body = np.sin(2 * np.pi * 190 * t) * np.exp(-t * 30) * 0.25
    return vel * (n * e * 0.33 + body)


def shaker(vel=1.0):
    t = tt(0.09)
    return vel * hp(noise(len(t)), 6500) * env_ar(len(t), 0.008, 0.06) * np.exp(-t * 30) * 0.1


# ------------------------------------------------------------------ the piece
CHORDS = [
    "D3 F#3 A3 C#4 E4",  # 0 Dmaj9
    "B2 D3 F#3 A3",  # 1 Bm7
    "G2 B2 D3 F#3 A3",  # 2 Gmaj9
    "A2 D3 E3 G3",  # 3 A7sus4
    "D3 F#3 A3 C#4",  # 4
    "F#2 A2 C#3 E3",  # 5 F#m7
    "G2 B2 D3 F#3",  # 6
    "B2 D3 F#3 A3",  # 7
    "G2 B2 D3 F#3",  # 8
    "F#2 A2 D3 C#4",  # 9 D/F#
    "E2 G2 B2 D3",  # 10 Em7 (→ A7)
    "G2 B2 D3 F#3 A3",  # 11 dive
    "D3 F#3 A3 C#4",  # 12
    "B2 D3 F#3 A3",  # 13
    "G2 B2 D3 F#3",  # 14
    "A2 D3 E3 G3",  # 15 sus → A
    "D3 F#3 A3 C#4 E4",  # 16
    "B2 D3 F#3 A3",  # 17
    "G2 B2 D3 F#3 A3",  # 18
    "A2 C#3 E3 G3",  # 19 A7
    "G2 B2 D3 F#3 A3",  # 20 reveal
    "A2 D3 E3 G3",  # 21 sus
    "D3 A3 E4 F#4",  # 22 Dadd9
    "D3 F#3 A3 C#4 E4",  # 23
]
ROOTS = ["D2", "B1", "G2", "A1", "D2", "F#2", "G2", "B1", "G2", "F#2", "E2", "G2", "D2", "B1", "G2", "A1", "D2", "B1", "G2", "A1", "G2", "A1", "D2", "D2"]
chords = [[hz(n) for n in c.split()] for c in CHORDS]


def bar_t(b, eighth=0.0):
    return b * BAR + eighth * E8


def hum(x=0.006):
    return (rng.random() - 0.5) * 2 * x


# pad: everywhere, breathing with the sections
pad_gain = {**{b: 0.75 for b in range(0, 4)}, **{b: 0.8 for b in range(4, 7)}, **{b: 0.7 for b in range(7, 16)}, **{b: 0.8 for b in range(16, 20)}, 20: 1.25, 21: 1.35, 22: 1.4, 23: 1.3}
for b in range(24):
    fr = chords[b]
    if b in (3, 15, 21):  # sus resolving to A major on the last two beats
        place(music, bar_t(b), pad(fr, BAR * 0.5 + 0.2, pad_gain[b]))
        place(music, bar_t(b, 4), pad([hz(n) for n in "A2 C#3 E3 A3".split()], BAR * 0.5, pad_gain[b], att=0.3))
    elif b == 10:
        place(music, bar_t(b), pad(fr, BAR * 0.5 + 0.2, pad_gain[b]))
        place(music, bar_t(b, 4), pad([hz(n) for n in "A2 C#3 E3 G3".split()], BAR * 0.5, pad_gain[b], att=0.3))
    else:
        place(music, bar_t(b), pad(fr, BAR + (1.6 if b == 23 else 0.15), pad_gain[b], att=0.5 if b else 1.2))

# music box arpeggios: the opening, and under the sketch
PATTERN = [0, 2, 4, 3, 1, 3, 5, 4]
for b in list(range(0, 7)):
    fr = sorted(set([f * 2 for f in chords[b]] + [f * 4 for f in chords[b][:3]]))
    for k in range(8):
        if b < 1 and k < 2:
            continue
        f = fr[PATTERN[k] % len(fr)]
        while f < 520:
            f *= 2
        vel = (0.55 if b < 4 else 0.38) * (1.0 if k % 2 == 0 else 0.75)
        place(music, bar_t(b, k) + hum(), musicbox(f, 2.2, vel), pan=0.35 * np.sin(k), gain=1.0)

# electric piano comping from the send on
for b in range(4, 20):
    if b == 11:
        continue
    fr = [f * 2 for f in chords[b][1:4]]
    for k in ([1.5, 3.5] if b < 7 else [1.0, 2.5, 3.5]):
        if b == 15 and k > 2.4:
            continue
        for i, f in enumerate(fr):
            place(music, bar_t(b, k * 2) + i * 0.012 + hum(0.004), epiano(f, 0.5, 0.55 if b < 16 else 0.62), pan=-0.25 + i * 0.25)

# bass
for b in range(4, 20):
    r = hz(ROOTS[b])
    hits = [(0, 1.4), (3, 0.5), (4, 1.2), (7, 0.4)] if b >= 7 else [(0, 2.2), (4, 2.0)]
    if b == 11:
        hits = [(0, 2.4)]
    if b == 15:
        hits = [(0, 1.0), (3, 0.6)]
    for e8, d in hits:
        f = r if e8 != 7 else r * 1.5
        if b in (3, 10, 15) and e8 >= 4:
            f = hz("A1")
        place(music, bar_t(b, e8) + hum(0.003), bass(f, d * E8 * 1.8, 0.9 if e8 == 0 else 0.7))
# a low hold under the reveal and the last chord
place(music, bar_t(20), bass(hz("G2"), BAR, 0.8))
place(music, bar_t(21), bass(hz("A1"), BAR, 0.8))
place(music, bar_t(22), bass(hz("D2"), BAR * 2 + 1.0, 0.95))

# drums: in with the developing pictures, out for the reveal
for b in range(7, 20):
    for beat in range(4):
        t0 = bar_t(b) + beat * BEAT
        if b == 11 and beat >= 2:
            continue
        if b == 15 and beat >= 2:
            continue
        if beat in (0, 2):
            place(music, t0, kick(1.0 if beat == 0 else 0.85))
        if beat in (1, 3):
            place(music, t0 + 0.004, snap(0.75 if b < 16 else 0.9), pan=0.1)
        if b >= 9 and beat == 2:
            place(music, t0 + E8, kick(0.45))
    for s in range(16):
        if (b in (11, 15)) and s >= 8:
            continue
        place(music, bar_t(b) + s * BEAT / 4 + hum(0.004), shaker(0.9 if s % 4 == 2 else 0.55), pan=0.45)
for b in range(5, 7):  # shaker alone, first
    for s in range(0, 16, 2):
        place(music, bar_t(b) + s * BEAT / 4, shaker(0.45), pan=0.45)

# melody
MEL = {
    7: [(0, "F#5", 2), (2, "A5", 1), (3, "B5", 2), (5, "A5", 1), (6, "F#5", 2)],
    8: [(0, "D5", 2), (2, "E5", 1), (3, "F#5", 3), (6, "B4", 2)],
    9: [(0, "F#5", 2), (2, "A5", 1), (3, "D6", 2), (5, "C#6", 1), (6, "A5", 2)],
    10: [(0, "B5", 2), (2, "A5", 1), (3, "G5", 1), (4, "E5", 2), (6, "C#5", 2)],
    12: [(0, "F#5", 3), (3, "A5", 1), (4, "D6", 2), (6, "C#6", 2)],
    13: [(0, "B5", 2), (2, "A5", 1), (3, "F#5", 3), (6, "D5", 2)],
    14: [(0, "G5", 2), (2, "B5", 1), (3, "D6", 3), (6, "F#6", 2)],
    15: [(0, "E6", 2), (2, "C#6", 2)],
    16: [(0, "A5", 1), (1, "D6", 1), (2, "F#6", 2), (4, "E6", 1), (5, "D6", 1), (6, "A5", 2)],
    17: [(0, "B5", 1), (1, "D6", 1), (2, "F#6", 2), (4, "E6", 1), (5, "D6", 1), (6, "B5", 2)],
    18: [(0, "G5", 1), (1, "B5", 1), (2, "D6", 2), (4, "F#6", 2), (6, "E6", 2)],
    19: [(0, "E6", 1), (1, "D6", 1), (2, "C#6", 2), (4, "A5", 2), (6, "E6", 1), (7, "C#6", 1)],
    20: [(0, "D6", 4), (4, "A5", 4)],
    21: [(0, "E6", 4), (4, "C#6", 2), (6, "A5", 2)],
    23: [(0, "A5", 2), (2, "F#5", 2), (4, "D5", 4)],
}
for b, notes in MEL.items():
    for e8, n, ln in notes:
        f = hz(n)
        t0 = bar_t(b, e8) + hum(0.005)
        if b >= 20:
            place(music, t0, musicbox(f, 3.0, 0.75), pan=0.1)
            continue
        place(music, t0, marimba(f, 1.4, 0.85), pan=-0.15)
        if b >= 12:
            place(music, t0, musicbox(f * 2, 1.8, 0.28 if b < 16 else 0.4), pan=0.3)
# plucked sixteenths over the styles and the montage
for b in range(16, 20):
    fr = sorted([f * 4 for f in chords[b][:4]])
    for s in range(16):
        f = fr[[0, 2, 1, 3, 2, 0, 3, 1][s % 8] % len(fr)]
        place(music, bar_t(b) + s * BEAT / 4 + hum(0.003), pluck(f, 0.5, 0.42 if s % 4 == 0 else 0.3, 0.6), pan=0.5 * np.sin(s * 0.9))
# a run of the music box up into each dive
for b0, t0 in ((11, 28.75), (13, 33.55)):
    run = ["D5", "F#5", "A5", "D6", "E6", "F#6", "A6", "D7"]
    for i, n in enumerate(run):
        place(music, t0 + i * 0.1, musicbox(hz(n), 1.6, 0.35 + i * 0.03), pan=-0.6 + i * 0.17)


# ------------------------------------------------------------------ sounds of the picture
def graphite(dur, gain=1.0, rate=0.0, grain=38.0, bright=1.0):
    """Graphite dragged over paper: band-limited noise with a ragged tooth."""
    n = max(int(dur * SR), 64)
    t = np.arange(n) / SR
    x = bp(noise(n), 1400, 5500 * bright + 800)
    x += 0.35 * bp(noise(n), 300, 1200)
    tooth = lp(np.abs(noise(n)), grain, 1)
    tooth = tooth / (np.abs(tooth).max() + 1e-9)
    m = 0.55 + 0.45 * tooth
    if rate:
        m *= 0.45 + 0.55 * np.abs(np.sin(np.pi * rate * t + rng.random() * 3)) ** 0.6
    e = env_ar(n, min(0.012, dur / 4), min(0.04, dur / 3))
    return gain * lp(x * m * e, 7500, 4) * 0.11


def key_click():
    t = tt(0.06)
    y = hp(noise(len(t)), 2500) * np.exp(-t * 900) * 0.6
    y += np.sin(2 * np.pi * (2300 + rng.random() * 600) * t) * np.exp(-t * 260) * 0.15
    y += np.sin(2 * np.pi * 170 * t) * np.exp(-t * 120) * 0.35
    return y * 0.5


def click():
    t = tt(0.12)
    y = hp(noise(len(t)), 3000) * (np.exp(-t * 1500) + 0.6 * np.where(t > 0.05, np.exp(-(t - 0.05) * 1500), 0))
    y += np.sin(2 * np.pi * 1200 * t) * np.exp(-t * 300) * 0.2
    return y * 0.35


def whoosh(dur, lo=250, hi=3500, up=True, peak=0.65, gain=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    bands = np.geomspace(lo, hi, 18)
    w = noise(n)
    out = np.zeros(n)
    u = t / dur
    pos = (u if up else 1 - u) * (len(bands) - 1)
    for i, f in enumerate(bands):
        y = bp(w, f / 1.25, f * 1.25)
        out += y * np.clip(1 - np.abs(pos - i) / 1.6, 0, 1)
    e = np.where(u < peak, (u / peak) ** 2, ((1 - u) / (1 - peak)) ** 1.5)
    return gain * out * e * 0.5


def bell_ping(f, gain=0.3):
    return musicbox(f, 1.6, gain)


PENTA = [hz(n) for n in ["D6", "E6", "F#6", "A6", "B6", "D7"]]
cues = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "out/cues.json"))
dev_i = 0
for c in cues:
    t, k = c["t"], c["type"]
    if k == "scribble":
        place(sfx, t, graphite(c["dur"], 1.1 * c.get("gain", 1), rate=7.5, grain=30), pan=0.1)
    elif k == "pencil":
        d = c["dur"]
        place(sfx, t, graphite(d, 1.3 * c.get("gain", 1), rate=1.6 / max(d, 0.1) if d > 0.25 else 0, grain=45), pan=rng.uniform(-0.25, 0.25))
    elif k == "write":
        d = c["dur"]
        place(sfx, t, graphite(d, 1.0 * c.get("gain", 1), rate=16, grain=60, bright=1.2), pan=rng.uniform(-0.3, 0.3))
    elif k == "develop":
        place(sfx, t, bell_ping(PENTA[dev_i % len(PENTA)] * (0.5 if dev_i % 3 else 1), 0.16), pan=rng.uniform(-0.5, 0.5))
        place(sfx, t, whoosh(0.5, 2000, 9000, True, 0.3, 0.12), pan=rng.uniform(-0.4, 0.4))
        dev_i += 1
    elif k == "pop":
        tq = tt(0.18)
        f = 520 + 260 * (1 - np.exp(-tq * 40))
        y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tq * 22) * 0.3
        place(sfx, t, y, pan=rng.uniform(-0.6, 0.6))
    elif k == "marker":
        tq = tt(0.32)
        y = bp(noise(len(tq)), 2200, 5200) * np.sin(np.pi * tq / 0.32) ** 1.5 * 0.05
        place(sfx, t, y, pan=0.2)
    elif k == "morph":
        d = c["dur"]
        place(sfx, t, whoosh(d, 200, 4000, True, 0.85, 0.75))
        tq = tt(d)
        f = 220 * 2 ** (2.2 * (tq / d) ** 1.5)
        y = np.sin(2 * np.pi * np.cumsum(f) / SR) * (tq / d) ** 2 * 0.07
        place(sfx, t, y)
        place(sfx, t + d, bell_ping(hz("A6"), 0.3))
        place(sfx, t + d + 0.06, bell_ping(hz("D7"), 0.25))
    elif k == "key":
        place(sfx, t, key_click(), pan=rng.uniform(-0.15, 0.15))
    elif k == "click":
        place(sfx, t, click())
    elif k == "send":
        place(sfx, t, whoosh(0.7, 400, 6000, True, 0.4, 0.5))
        place(sfx, t + 0.05, bell_ping(hz("D6"), 0.35))
        place(sfx, t + 0.17, bell_ping(hz("A6"), 0.32))
    elif k == "finder":
        for d0 in (0.0, 0.11):
            tq = tt(0.05)
            place(sfx, t + d0, np.sin(2 * np.pi * 2900 * tq) * env_ar(len(tq), 0.003, 0.02) * 0.06)
    elif k == "shutter":
        tq = tt(0.25)
        y = hp(noise(len(tq)), 1500) * (np.exp(-tq * 300) + 0.8 * np.where(tq > 0.07, np.exp(-(tq - 0.07) * 260), 0))
        y += bp(noise(len(tq)), 300, 1200) * np.exp(-tq * 30) * 0.3
        place(sfx, t, y * 0.3)
    elif k == "grow":
        tq = tt(0.8)
        f = 260 + 300 * (1 - np.exp(-tq * 8)) + 30 * np.sin(2 * np.pi * 9 * tq) * np.exp(-tq * 5)
        y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tq * 4) * env_ar(len(tq), 0.01, 0.1) * 0.12
        place(sfx, t, y)
    elif k == "dive":
        d = c["dur"]
        place(sfx, t, whoosh(d + 0.3, 150, 5000, True, 0.7, 1.2), pan=0)
        tq = tt(1.2)
        sub = np.sin(2 * np.pi * np.cumsum(70 - 30 * tq) / SR) * np.exp(-tq * 3.5) * env_ar(len(tq), 0.02, 0.2) * 0.35
        place(sfx, t + d - 0.05, sub)
    elif k == "whip":
        w = whoosh(0.7, 300, 6000, True, 0.45, 1.4)
        pan_curve = np.linspace(-0.9, 0.9, len(w))
        a = (pan_curve + 1) * np.pi / 4
        place(sfx, t - 0.1, np.vstack([w * np.cos(a), w * np.sin(a)]))
    elif k == "pan":
        place(sfx, t - 0.05, whoosh(0.55, 400, 5000, True, 0.45, 0.6), pan=rng.uniform(-0.3, 0.3))
    elif k == "swap":
        f = PENTA[c["k"] % len(PENTA)] / 2 * (2 if c["k"] >= 5 else 1)
        place(sfx, t, marimba(f, 0.8, 0.55), pan=-0.4 + c["k"] * 0.13)
    elif k == "spread":
        for i, n in enumerate(["D6", "F#6", "A6", "B6", "D7", "E7", "F#7"]):
            place(sfx, t + i * 0.05, bell_ping(hz(n), 0.22), pan=-0.6 + i * 0.2)
    elif k == "reveal":
        d = c["dur"]
        place(sfx, t, whoosh(d + 0.6, 3500, 200, False, 0.25, 0.8))
    elif k == "zoomin":
        d = c["dur"]
        place(sfx, t, whoosh(d + 1.0, 200, 4500, True, 0.92, 0.7))
    elif k == "ignite":
        tq = tt(1.6)
        fw = lp(noise(len(tq)), 700) * np.minimum(tq / 0.06, 1) * np.exp(-tq * 3.2) * 0.6
        sub = np.sin(2 * np.pi * np.cumsum(62 - 18 * tq) / SR) * np.exp(-tq * 2.2) * env_ar(len(tq), 0.01, 0.3) * 0.5
        place(sfx, t, (fw + sub) * 0.55)
        crack = np.zeros(len(tq))
        for _ in range(26):
            i = int(rng.uniform(0.02, 1.2) * SR)
            j = min(len(tq), i + 200)
            crack[i:j] += hp(noise(j - i), 2500) * np.exp(-np.arange(j - i) / 30) * rng.uniform(0.1, 0.4)
        place(sfx, t, crack * 0.12, pan=0.2)
        for i, n in enumerate(["D5", "A5", "E6", "F#6", "A6", "D7"]):
            place(sfx, t + 0.02 + i * 0.07, musicbox(hz(n), 3.5, 0.3 - i * 0.025), pan=-0.5 + i * 0.2)

# the hit when the styles begin
tq = tt(2.0)
crash = hp(noise(len(tq)), 3500) * np.exp(-tq * 2.6) * 0.07
place(sfx, 40.0, np.vstack([crash, hp(noise(len(tq)), 3500) * np.exp(-tq * 2.6) * 0.07]))
place(music, 40.0, kick(1.1))
# a riser into it
place(sfx, 38.95, whoosh(1.1, 300, 7000, True, 0.97, 0.5))


# ------------------------------------------------------------------ mix
def reverb(x, seconds=2.4, damp=5000):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = np.zeros((2, n))
    for ch in range(2):
        r = noise(n) * np.exp(-t * 6.9 / seconds)
        r = lp(r, damp) * 0.6 + r * 0.4 * np.exp(-t * 18)
        r[: int(0.018 * SR)] = 0
        ir[ch] = r / np.sqrt(np.sum(r**2))
    return np.vstack([signal.fftconvolve(x[ch], ir[ch])[: x.shape[1]] for ch in range(2)])


music_wet = reverb(music, 2.6, 4500)
sfx_wet = reverb(sfx, 1.4, 6000)
mix = 0.82 * (music + 0.34 * music_wet) + 2.0 * (sfx + 0.16 * sfx_wet)
mix = np.vstack([hp(mix[0], 28), hp(mix[1], 28)])
mix = mix[:, : int(DUR * SR)]
# the last breath
fade = int(1.2 * SR)
mix[:, -fade:] *= np.linspace(1, 0, fade) ** 1.6
fadein = int(0.02 * SR)
mix[:, :fadein] *= np.linspace(0, 1, fadein)
# gentle bus compression: level the loud passages, then a soft ceiling
level = np.sqrt(lp(np.maximum(mix[0] ** 2, mix[1] ** 2), 3, 1).clip(1e-9))
ref = np.percentile(level, 92)
gain = np.minimum(1.0, (ref / level) ** 0.35)
mix *= gain
mix /= np.abs(mix).max()
mix = np.tanh(mix * 1.15) / np.tanh(1.15) * 0.89
out = sys.argv[2] if len(sys.argv) > 2 else "out/score.wav"
if len(sys.argv) > 3:  # stems, for checking the balance
    for name, bus in (("music", music), ("sfx", sfx)):
        st = bus[:, : int(DUR * SR)] / max(1e-9, np.abs(music).max(), np.abs(sfx).max())
        wavfile.write(sys.argv[3] + f"-{name}.wav", SR, (st.T * 32767 * 0.5).astype(np.int16))
wavfile.write(out, SR, (mix.T * 32767).astype(np.int16))
print("wrote", out, mix.shape[1] / SR, "s")
