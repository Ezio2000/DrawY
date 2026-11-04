"""The score and the sound of 《请勿触摸》, DrawY's fifty-five seconds.

An original piece in D major at 96 BPM: 22 bars of 2.5 s, so every bar line falls on a cut.
The first three bars are a quiet gallery (room tone, a far footstep, a music box wondering);
the piece begins on the downbeat where the sign has been changed and the rope comes off its
hook. The instruments are the ones in score.py, synthesised with numpy. Over the music, the
sounds of the picture, placed from the cue sheet the timeline exports.

    python3 audio/touch.py out/touch/cues.json out/touch/score.wav
"""

import json
import sys

import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 48000
DUR = 55.0
N = int(SR * (DUR + 3))
BPM = 96
BEAT = 60 / BPM
BAR = 4 * BEAT
E8 = BEAT / 2
rng = np.random.default_rng(11)

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


# ------------------------------------------------------------------ the piece
# 22 bars of 2.5 s. A quiet room for the first three; the piece begins on the downbeat
# where the sign has been changed and the rope comes off its hook (7.5 s).
CHORDS = [
    "D4 A4 E5 F#5",  # 0 the gallery: open, high, quiet
    "B3 F#4 A4 D5",  # 1
    "G3 D4 F#4 A4",  # 2 → A sus, held breath
    "D3 F#3 A3 C#4 E4",  # 3 请你动手
    "B2 D3 F#3 A3",  # 4 into the bean
    "G2 B2 D3 F#3 A3",  # 5 the road
    "D3 F#3 A3 C#4",  # 6
    "E2 G2 B2 D3",  # 7
    "A2 D3 E3 G3",  # 8 sus → A
    "B2 D3 F#3 A3",  # 9 a step is chosen
    "G2 B2 D3 F#3",  # 10 typing → A
    "D3 F#3 A3 C#4 E4",  # 11 into the roast
    "F#2 A2 C#3 E3",  # 12
    "G2 B2 D3 F#3 A3",  # 13
    "A2 D3 E3 G3",  # 14 back out, the menu (sus → A)
    "D3 F#3 A3 C#4",  # 15 the file
    "B2 D3 F#3 A3",  # 16 the phone
    "G2 B2 D3 F#3",  # 17 → A
    "G2 B2 D3 F#3 A3",  # 18 the gallery again
    "A2 D3 E3 G3",  # 19 the push (sus → A)
    "D3 A3 E4 F#4",  # 20 the lantern
    "D3 F#3 A3 C#4 E4",  # 21
]
ROOTS = ["D2", "B1", "G1", "D2", "B1", "G1", "D2", "E2", "A1", "B1", "G1", "D2", "F#2", "G1", "A1", "D2", "B1", "G1", "G1", "A1", "D2", "D2"]
SUS = {2, 8, 10, 14, 17, 19}
chords = [[hz(n) for n in c.split()] for c in CHORDS]
A_MAJ = [hz(n) for n in "A2 C#3 E3 A3".split()]


def bar_t(b, eighth=0.0):
    return b * BAR + eighth * E8


def hum(x=0.006):
    return (rng.random() - 0.5) * 2 * x


pad_gain = {0: 0.42, 1: 0.48, 2: 0.55, **{b: 0.8 for b in range(3, 9)}, 9: 0.68, 10: 0.72, **{b: 0.8 for b in range(11, 18)}, 18: 0.95, 19: 1.1, 20: 1.3, 21: 1.3}
for b in range(22):
    fr = chords[b]
    if b in SUS:
        place(music, bar_t(b), pad(fr, BAR * 0.5 + 0.2, pad_gain[b], bright=0.8 if b < 3 else 1.0))
        place(music, bar_t(b, 4), pad(A_MAJ if b != 2 else [hz(n) for n in "A3 D4 E4 G4".split()], BAR * 0.5, pad_gain[b], att=0.3))
    else:
        place(music, bar_t(b), pad(fr, BAR + (1.6 if b == 21 else 0.15), pad_gain[b], att=1.6 if b == 0 else 0.5, bright=0.7 if b < 3 else 1.0))

# the gallery's music box: a few notes, wondering
OPEN = {
    0: [(4, "A5", 2), (6, "F#5", 2)],
    1: [(0, "D6", 3), (3, "B5", 1), (4, "A5", 4)],
    2: [(0, "G5", 2), (2, "F#5", 2), (4, "E5", 2), (6, "A5", 2)],
}
for b, notes in OPEN.items():
    for e8, n, ln in notes:
        place(music, bar_t(b, e8) + hum(), musicbox(hz(n), 2.8, 0.42), pan=0.15)

# music box arpeggios once the sign says 请你动手
PATTERN = [0, 2, 4, 3, 1, 3, 5, 4]
for b in range(3, 7):
    fr = sorted(set([f * 2 for f in chords[b]] + [f * 4 for f in chords[b][:3]]))
    for k in range(8):
        f = fr[PATTERN[k] % len(fr)]
        while f < 520:
            f *= 2
        vel = (0.5 if b < 5 else 0.34) * (1.0 if k % 2 == 0 else 0.75)
        place(music, bar_t(b, k) + hum(), musicbox(f, 2.2, vel), pan=0.35 * np.sin(k))

# electric piano comping
for b in list(range(5, 11)) + list(range(11, 18)):
    fr = [f * 2 for f in chords[b][1:4]]
    hits = [1.5, 3.5] if b < 7 or b in (9, 10) else [1.0, 2.5, 3.5]
    for k in hits:
        if b in SUS and k > 2.4:
            fr2 = [f * 2 for f in A_MAJ[1:4]]
        else:
            fr2 = fr
        for i, f in enumerate(fr2):
            place(music, bar_t(b, k * 2) + i * 0.012 + hum(0.004), epiano(f, 0.5, 0.55 if b < 15 else 0.62), pan=-0.25 + i * 0.25)

# bass
for b in range(3, 20):
    r = hz(ROOTS[b])
    hits = [(0, 1.4), (3, 0.5), (4, 1.2), (7, 0.4)] if b in range(6, 9) or b in range(11, 18) else [(0, 2.2), (4, 2.0)]
    if b == 3:
        hits = [(0, 4.0)]
    if b == 18:
        hits = [(0, 4.0)]
    for e8, d in hits:
        f = r if e8 != 7 else r * 1.5
        if b in SUS and e8 >= 4:
            f = hz("A1")
        place(music, bar_t(b, e8) + hum(0.003), bass(f, d * E8 * 1.8, 0.95 if e8 == 0 else 0.7))
place(music, bar_t(19, 4), bass(hz("A1"), BAR * 0.5, 0.8))
place(music, bar_t(20), bass(hz("D2"), BAR * 2 + 1.0, 0.95))

# drums: in with the walk down the road, out while the request is typed, back for the
# roast and the file, out again in the gallery
DRUMS = set(range(6, 9)) | set(range(11, 18))
for b in DRUMS:
    for beat in range(4):
        t0 = bar_t(b) + beat * BEAT
        if b == 14 and beat >= 2:
            continue
        if beat in (0, 2):
            place(music, t0, kick(1.0 if beat == 0 else 0.85))
        if beat in (1, 3):
            place(music, t0 + 0.004, snap(0.72 if b < 15 else 0.86), pan=0.1)
        if b >= 12 and beat == 2:
            place(music, t0 + E8, kick(0.45))
    for s in range(16):
        place(music, bar_t(b) + s * BEAT / 4 + hum(0.004), shaker(0.9 if s % 4 == 2 else 0.55), pan=0.45)
for b in (5, 9, 10):  # the shaker alone
    for s in range(0, 16, 2):
        place(music, bar_t(b) + s * BEAT / 4, shaker(0.45), pan=0.45)

# melody
MEL = {
    5: [(0, "F#5", 2), (2, "A5", 1), (3, "B5", 2), (5, "A5", 1), (6, "F#5", 2)],
    6: [(0, "E5", 2), (2, "F#5", 1), (3, "A5", 3), (6, "D5", 2)],
    7: [(0, "G5", 2), (2, "F#5", 1), (3, "E5", 2), (5, "D5", 1), (6, "B4", 2)],
    8: [(0, "E5", 3), (3, "F#5", 1), (4, "A5", 4)],
    11: [(0, "F#5", 3), (3, "A5", 1), (4, "D6", 2), (6, "C#6", 2)],
    12: [(0, "A5", 2), (2, "C#6", 1), (3, "E6", 3), (6, "C#6", 2)],
    13: [(0, "B5", 2), (2, "D6", 1), (3, "F#6", 2), (5, "E6", 1), (6, "D6", 2)],
    14: [(0, "E6", 2), (2, "D6", 1), (3, "A5", 3)],
    15: [(0, "A5", 1), (1, "D6", 1), (2, "F#6", 2), (4, "E6", 1), (5, "D6", 1), (6, "A5", 2)],
    16: [(0, "B5", 1), (1, "D6", 1), (2, "F#6", 2), (4, "E6", 1), (5, "D6", 1), (6, "B5", 2)],
    17: [(0, "G5", 1), (1, "B5", 1), (2, "D6", 2), (4, "E6", 2), (6, "C#6", 2)],
    18: [(0, "D6", 3), (3, "B5", 1), (4, "A5", 4)],
    19: [(0, "G5", 2), (2, "A5", 2), (4, "B5", 2), (6, "C#6", 2)],
    21: [(0, "A5", 2), (2, "F#5", 2), (4, "D5", 4)],
}
for b, notes in MEL.items():
    for e8, n, ln in notes:
        f = hz(n)
        t0 = bar_t(b, e8) + hum(0.005)
        if b >= 18:
            place(music, t0, musicbox(f, 3.0, 0.72), pan=0.1)
            continue
        place(music, t0, marimba(f, 1.4, 0.85), pan=-0.15)
        if b >= 11:
            place(music, t0, musicbox(f * 2, 1.8, 0.28 if b < 15 else 0.38), pan=0.3)
# plucked sixteenths over the roast and the file
for b in (12, 13, 15, 16, 17):
    fr = sorted([f * 4 for f in chords[b][:4]])
    for s in range(16):
        f = fr[[0, 2, 1, 3, 2, 0, 3, 1][s % 8] % len(fr)]
        place(music, bar_t(b) + s * BEAT / 4 + hum(0.003), pluck(f, 0.5, 0.4 if s % 4 == 0 else 0.28, 0.6), pan=0.5 * np.sin(s * 0.9))
# a run up into each dive
for t0 in (10.95, 27.25, 41.7):
    run = ["D5", "F#5", "A5", "D6", "E6", "F#6", "A6", "D7"]
    for i, n in enumerate(run):
        place(music, t0 + i * 0.1, musicbox(hz(n), 1.6, (0.33 if t0 < 41 else 0.22) + i * 0.03), pan=-0.6 + i * 0.17)


def swell(dur, gain=1.0):
    """A cymbal played backwards: noise that rises into the downbeat."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = hp(noise(n), 4000) * 0.6 + bp(noise(n), 1500, 4000) * 0.4
    return np.vstack([x, hp(noise(n), 4000)]) * (t / dur) ** 2.6 * 0.07 * gain


# the held breath before the change, and before the roast
place(music, 6.25, swell(1.25, 1.0))
place(music, 26.3, swell(1.2, 0.7))
place(music, 48.8, swell(1.2, 0.8))
# the downbeat when the sign is changed
tq = tt(2.4)
place(music, 7.5, np.vstack([hp(noise(len(tq)), 3500), hp(noise(len(tq)), 3500)]) * np.exp(-tq * 2.4) * 0.055)
place(music, 7.5, kick(0.9))
sub = np.sin(2 * np.pi * np.cumsum(58 - 14 * tq) / SR) * np.exp(-tq * 1.6) * env_ar(len(tq), 0.01, 0.4) * 0.4
place(music, 7.5, sub)


# ------------------------------------------------------------------ the room and its things
def thud(gain=1.0, f=90, dur=0.35):
    t = tt(dur)
    y = lp(noise(len(t)), 380) * np.exp(-t * 26) * 0.8
    y += np.sin(2 * np.pi * np.cumsum(f * (1 + 0.6 * np.exp(-t * 30))) / SR) * np.exp(-t * 14) * 0.6
    return gain * y * 0.5


def clink():
    t = tt(0.6)
    y = np.zeros(len(t))
    for f, a, d in ((2140, 1.0, 9), (3420, 0.6, 12), (5230, 0.35, 16), (7760, 0.2, 22)):
        y += a * np.sin(2 * np.pi * f * t + rng.random() * 6) * np.exp(-t * d)
    y += hp(noise(len(t)), 3000) * np.exp(-t * 300) * 0.5
    return y * 0.06


def footstep():
    """A heel, far off, on a hard floor."""
    y = thud(0.22, 70, 0.3)
    n = int(0.03 * SR)
    y[:n] += hp(noise(n), 2500) * np.exp(-np.arange(n) / (0.004 * SR)) * 0.05
    return lp(y, 2500)


PENTA = [hz(n) for n in ["D6", "E6", "F#6", "A6", "B6", "D7"]]
cues = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "out/touch/cues.json"))
dev_i = 0
for c in cues:
    t, k = c["t"], c["type"]
    if k == "room":
        d = c["dur"]
        n = int(d * SR)
        air = lp(noise(n), 500, 2) * 0.012 + bp(noise(n), 150, 900) * 0.006
        e = env_ar(n, 0.8, 1.2)
        place(sfx, t, np.vstack([air * e, lp(noise(n), 500, 2) * 0.012 * e]))
    elif k == "footstep":
        place(sfx, t, footstep(), pan=-0.55 + rng.random() * 0.3)
    elif k == "scribble" or k == "pencil":
        d = c["dur"]
        place(sfx, t, graphite(d, 1.3 * c.get("gain", 1), rate=1.6 / max(d, 0.1) if d > 0.25 else 0, grain=45), pan=rng.uniform(-0.25, 0.25))
    elif k == "write":
        d = c["dur"]
        place(sfx, t, graphite(d, 1.0 * c.get("gain", 1), rate=16, grain=60, bright=1.2), pan=rng.uniform(-0.3, 0.3))
    elif k == "road":
        place(sfx, t, graphite(c["dur"], 0.5, rate=0, grain=30, bright=0.8), pan=0)
    elif k == "develop":
        place(sfx, t, bell_ping(PENTA[dev_i % len(PENTA)] * (0.5 if dev_i % 3 else 1), 0.15), pan=rng.uniform(-0.5, 0.5))
        place(sfx, t, whoosh(0.5, 2000, 9000, True, 0.3, 0.12), pan=rng.uniform(-0.4, 0.4))
        dev_i += 1
    elif k == "marker":
        tq = tt(0.32)
        place(sfx, t, bp(noise(len(tq)), 2200, 5200) * np.sin(np.pi * tq / 0.32) ** 1.5 * 0.05, pan=0.2)
    elif k == "key":
        place(sfx, t, key_click(), pan=rng.uniform(-0.15, 0.15))
    elif k == "click":
        place(sfx, t, click())
    elif k == "select":
        d = c["dur"]
        place(sfx, t, whoosh(d + 0.1, 1500, 6000, True, 0.8, 0.18), pan=0.1)
    elif k == "erase":
        d = c["dur"]
        place(sfx, t, graphite(d, 0.9, rate=11, grain=24, bright=0.6), pan=0)
    elif k == "commit":
        place(sfx, t, bell_ping(hz("D6"), 0.3))
        place(sfx, t + 0.11, bell_ping(hz("A6"), 0.28))
    elif k == "unhook":
        place(sfx, t - 0.06, clink(), pan=0.45)
        place(sfx, t + 0.02, clink() * 0.6, pan=0.4)
    elif k == "thud":
        place(sfx, t, thud(0.55, 85, 0.4), pan=0.1)
        place(sfx, t + 0.16, thud(0.18, 95, 0.25), pan=0.15)
    elif k == "send":
        place(sfx, t, whoosh(0.7, 400, 6000, True, 0.4, 0.5))
        place(sfx, t + 0.05, bell_ping(hz("D6"), 0.35))
        place(sfx, t + 0.17, bell_ping(hz("A6"), 0.32))
    elif k == "dive":
        d = c["dur"]
        g = c.get("gain", 1.0)
        place(sfx, t, whoosh(d + 0.3, 150, 5000, True, 0.7, 1.2 * g))
        tq = tt(1.2)
        place(sfx, t + d - 0.05, np.sin(2 * np.pi * np.cumsum(70 - 30 * tq) / SR) * np.exp(-tq * 3.5) * env_ar(len(tq), 0.02, 0.2) * 0.35 * g)
    elif k == "zoomout":
        d = c["dur"]
        place(sfx, t, whoosh(d + 0.3, 5000, 150, False, 0.35, 0.9))
    elif k == "arrive":
        f = PENTA[c["k"] % len(PENTA)] / 2
        place(sfx, t, marimba(f, 0.9, 0.6), pan=-0.5 + c["k"] * 0.33)
    elif k == "step":
        d = c["dur"]
        for i in range(int(d / 0.072)):
            tq = tt(0.03)
            place(sfx, t + i * 0.072, np.sin(2 * np.pi * (1800 + 200 * (i % 2)) * tq) * np.exp(-tq * 220) * 0.035, pan=-0.3 + 0.6 * i / max(1, d / 0.072))
    elif k == "hop":
        tq = tt(0.3)
        f = 500 + 900 * (tq / 0.3)
        place(sfx, t, np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tq * 9) * 0.08, pan=0.6)
    elif k == "drip":
        tq = tt(0.35)
        f = 700 + 1300 * (1 - np.exp(-tq * 30))
        place(sfx, t, np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tq * 16) * env_ar(len(tq), 0.002, 0.05) * 0.14, pan=0.65)
    elif k == "crack":
        for i in range(14):
            d0 = rng.uniform(0, 0.7)
            n = int(0.012 * SR)
            y = bp(noise(n), 1200, 7000) * np.exp(-np.arange(n) / (0.002 * SR))
            place(sfx, t + d0, y * rng.uniform(0.06, 0.16), pan=rng.uniform(-0.4, 0.4))
    elif k == "menu":
        tq = tt(0.12)
        place(sfx, t, np.sin(2 * np.pi * 1600 * tq) * np.exp(-tq * 60) * 0.06 + hp(noise(len(tq)), 3000) * np.exp(-tq * 200) * 0.05, pan=0.5)
    elif k == "fold":
        d = c["dur"]
        place(sfx, t, whoosh(d, 4000, 300, False, 0.3, 0.6))
        tq = tt(0.25)
        place(sfx, t + d - 0.1, bp(noise(len(tq)), 600, 3000) * np.exp(-tq * 18) * 0.12)
    elif k == "card":
        place(sfx, t, bell_ping(hz("A5"), 0.16))
    elif k == "fly":
        place(sfx, t, whoosh(c["dur"], 300, 5000, True, 0.6, 0.6))
    elif k == "phone":
        place(sfx, t, whoosh(c["dur"], 200, 2500, True, 0.75, 0.5))
        place(sfx, t + c["dur"] - 0.05, thud(0.2, 120, 0.2))
    elif k == "open":
        for i, n in enumerate(["D6", "F#6", "A6", "D7"]):
            place(sfx, t + i * 0.06, bell_ping(hz(n), 0.2), pan=-0.4 + i * 0.25)
    elif k == "tap":
        place(sfx, t, thud(0.2, 220, 0.12))
    elif k == "whip":
        w = whoosh(0.7, 300, 6000, True, 0.45, 1.4)
        pan_curve = np.linspace(0.9, -0.9, len(w))
        a = (pan_curve + 1) * np.pi / 4
        place(sfx, t - 0.1, np.vstack([w * np.cos(a), w * np.sin(a)]))
    elif k == "push":
        place(sfx, t, whoosh(c["dur"] + 0.4, 200, 4500, True, 0.92, 0.55))
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
out = sys.argv[2] if len(sys.argv) > 2 else "out/touch/score.wav"
if len(sys.argv) > 3:  # stems, for checking the balance
    for name, bus in (("music", music), ("sfx", sfx)):
        st = bus[:, : int(DUR * SR)] / max(1e-9, np.abs(music).max(), np.abs(sfx).max())
        wavfile.write(sys.argv[3] + f"-{name}.wav", SR, (st.T * 32767 * 0.5).astype(np.int16))
wavfile.write(out, SR, (mix.T * 32767).astype(np.int16))
print("wrote", out, mix.shape[1] / SR, "s")
