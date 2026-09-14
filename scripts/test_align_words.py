#!/usr/bin/env python3
"""Synthetic checks for merge_clitics() in align_words.py.

Runs without the alignment stack (torch etc. are imported lazily), plain:

  python3 scripts/test_align_words.py

Exit code 0 = all checks passed. Each check prints PASS/FAIL; add cases next
to the related ones when the merge rules change.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from align_words import CLITIC_BWD, CLITIC_FWD, Word, merge_clitics

DEFAULTS = dict(
    gap_ms=200.0, fwd=CLITIC_FWD, bwd=CLITIC_BWD,
    short_ms=80.0, min_playable_ms=150.0, max_words=3, max_ms=1000.0,
)


def W(text, start, end, raw_start=None, raw_end=None):
    """A Word with final timings set and optional raw acoustic ones."""
    return Word(text=text, start=start, orig_start=start, end=end,
                raw_start=raw_start, raw_end=raw_end)


def run(words, **over):
    kw = dict(DEFAULTS)
    kw.update(over)
    out, stats = merge_clitics(words, **kw)
    return [w.text for w in out], out, stats


failures = []


def check(name, got, want):
    ok = got == want
    print(f"{'PASS' if ok else 'FAIL'} {name}: {got}" + ("" if ok else f"  want {want}"))
    if not ok:
        failures.append(name)


# --- rule 1: forward clitics ------------------------------------------------

texts, out, st = run([
    W("of", 1000, 1300, 1000, 1040),
    W("course", 1300, 1900, 1100, 1825),
])
check("fwd clitic", texts, ["of course"])
check("fwd timings", (out[0].start, out[0].end), (1000, 1900))
check("fwd rule stat", st["rules"][1], 1)

texts, _, _ = run([
    W("of", 1000, 1300, 1000, 1040),
    W("course", 1700, 2300, 1600, 2225),  # raw gap 560 > 200
])
check("fwd clitic + pause", texts, ["of", "course"])

# Punctuation/case are stripped for matching; fallback words (raw=None) count
# as "no pause", like the old end = next-word's-start heuristic.
texts, _, _ = run([
    W("The,", 0, 300, None, None),
    W("answer", 300, 900, None, None),
])
check("punct + fallback", texts, ["The, answer"])

# --- sentence boundaries are never crossed ----------------------------------

texts, _, _ = run([
    W("end.", 1000, 1600, 1000, 1525),
    W("Next", 1600, 2200, 1550, 2125),
])
check("sentence boundary", texts, ["end.", "Next"])

# --- rule 2: backward clitics ------------------------------------------------

texts, _, st = run([
    W("give", 0, 500, 0, 460),
    W("him", 500, 900, 490, 880),
])
check("bwd clitic", texts, ["give him"])
check("bwd rule stat", st["rules"][2], 1)

# --- rule 3: short-by-sound words --------------------------------------------

texts, _, st = run([
    W("well", 3000, 3400, 2900, 3300),
    W("uh", 3400, 3700, 3405, 3455),   # raw 50 ms
    W("okay", 3700, 4200, 3500, 4100),
])
check("short word R3", texts, ["well", "uh okay"])
check("short rule stat", st["rules"][3], 1)

texts, _, _ = run([
    W("well", 3000, 3400, 2900, 3300),
    W("uh", 3400, 3700, 3600, 3640),   # pause both sides
    W("okay", 3700, 4200, 3900, 4100),
])
check("short + pauses", texts, ["well", "uh", "okay"])

# --- rule 4: unplayable units are rescued ------------------------------------

texts, _, st = run([
    W("went", 4400, 5000, 4400, 4980),
    W("then", 5000, 5140, 5000, 5120),  # 140 ms final, raw 120 ms
    W("home", 5600, 6200, 5600, 6100),  # raw gap 480 -> pause right
])
check("unplayable R4", texts, ["went then", "home"])
check("unplayable stat", st["rules"][4], 1)

# --- caps ---------------------------------------------------------------------

texts, _, st = run([
    W("the", 0, 300, 0, 60),
    W("a", 300, 600, 70, 120),
    W("of", 600, 900, 130, 190),
    W("course", 900, 1500, 200, 1425),
])
check("word cap", texts, ["the a of", "course"])
check("max group", st["max"], 3)

texts, _, st = run([
    W("the", 0, 300, 0, 60),
    W("a", 300, 600, 70, 120),
    W("of", 600, 850, 130, 190),
    W("course", 850, 960, 200, 1000),  # final 110 ms -> must join
])
check("R4 beats word cap", texts, ["the a of course"])
check("R4 cap group size", st["max"], 4)

# R4 pulls an unplayable tail into the group even slightly past max_ms
# (allowance = min_playable_ms), instead of leaving it silent.
texts, _, _ = run([
    W("the", 0, 600, 0, 60),
    W("stuff", 600, 1000, 70, 960),
    W("tail", 1000, 1010, 970, 1000),
])
check("R4 duration allowance", texts, ["the stuff tail"])

# Hard edge: even the allowance cannot fit the group from its start -> the
# tiny word bonds to the previous word only.
texts, _, _ = run([
    W("the", 0, 600, 0, 60),
    W("stuff", 600, 1100, 70, 1060),
    W("tail", 1100, 1110, 1070, 1100),
])
check("R4 allowance limit", texts, ["the", "stuff tail"])

texts, _, _ = run([
    W("the", 0, 400, 0, 60),
    W("a", 400, 800, 70, 120),
    W("stuff", 800, 1400, 130, 1325),  # span from 0 -> 1400 ms
    W("more", 1400, 2010, 1330, 1990),
])
check("duration cap cuts", texts, ["the a", "stuff", "more"])

texts, _, _ = run([
    W("the", 0, 300, 0, 60),
    W("a", 300, 600, 70, 120),
    W("stuff", 600, 1000, 130, 960),  # span exactly 1000 ms
    W("more", 1000, 1610, 970, 1590),
])
check("duration cap boundary", texts, ["the a stuff", "more"])

# --- mixed chains (real-data shapes) ------------------------------------------

texts, _, _ = run([
    W("a", 0, 250, 0, 50),
    W("lot", 250, 700, 80, 660),
    W("of", 700, 760, 690, 740),
    W("the", 760, 820, 750, 800),
    W("stuff", 820, 1330, 810, 1300),
])
check("mixed chain", texts, ["a lot", "of the stuff"])

# A tiny clitic cluster fused to the left neighbour and separated from the
# right one by a pause: the whole provisional group ('casually up to') is
# rescued left, and the split lands on the real pause.
texts, _, _ = run([
    W("casually", 722207, 722627, 722210, 722600),
    W("up", 722627, 722640, 722630, 722636),
    W("to", 722640, 722662, 722641, 722660),
    W("provosts", 722662, 723511, 722900, 723500),  # raw gap 240 ms -> pause
])
check("playable side chosen", texts, ["casually up to", "provosts"])

# A 10 ms 'held' before a long paused word bonds left into a full 3-word
# group (R4 bypasses the word cap).
texts, _, _ = run([
    W("at", 594547, 594700, 594550, 594690),
    W("the", 594700, 594900, 594705, 594880),
    W("enemy", 594900, 595129, 594905, 595120),
    W("held", 595129, 595139, 595125, 595135),
    W("horizons", 595139, 597282, 595500, 597200),  # pause right (raw gap 365)
])
check("R4 left into full group", texts, ["at the enemy held", "horizons"])

# A 150 ms group fused to a 984 ms word crosses max_ms thanks to the
# allowance (real 'the officer's epaulettes' case from Sharpe).
texts, _, _ = run([
    W("the", 784303, 784380, 784305, 784370),
    W("officer's", 784380, 784453, 784390, 784445),
    W("epaulettes", 784453, 785437, 784460, 785420),
])
check("R4 max_ms allowance", texts, ["the officer's epaulettes"])

# Degenerate: a tiny word with pauses on both sides still latches onto a
# playable neighbour (across a pause if nothing closer exists).
texts, _, _ = run([
    W("big", 0, 500, 0, 480),
    W("tiny", 1090, 1100, 700, 710),   # raw gaps 220/410 -> pauses both sides
    W("tail", 1100, 1110, 1120, 1130),
    W("word", 1200, 1700, 1210, 1680),
])
check("last resort bond", texts, ["big", "tiny tail word"])

# The final pass iterates: two adjacent unplayable groups merge first, then
# the still-unplayable result merges further. Real 'pursue and she'll' case
# from Sharpe: the aligner scrambled the raw spans, leaving 10 ms 'pursue'
# and 'and' between a full 4-word group and a long "she'll".
texts, _, _ = run([
    W("how", 4753103.5, 4753203.7, 4753153.5, 4753213.6),
    W("to", 4753203.7, 4753344.1, 4753253.7, 4753273.8),
    W("ambush", 4753344.1, 4753725.0, 4753394.1, 4753714.9),
    W("to", 4753725.0, 4753735.0, 4753775.0, 4753815.1),
    W("pursue", 4753735.0, 4753745.0, 4753528.4, 4754179.6),
    W("and", 4753745.0, 4753755.0, 4753477.1, 4753517.2),
    W("she'll", 4753755.0, 4755097.4, 4753677.8, 4755022.4),
])
check("final pass iterates", texts, ["how to ambush to", "pursue and she'll"])

# A sentence boundary still wins over playability when it blocks BOTH sides:
# a tiny group at the very start of a sentence that also ends it has no
# legal neighbour and stays as is.
texts, _, _ = run([
    W("start.", 0, 400, 0, 380),
    W("fought", 400, 410, 405, 408),
    W("hard.", 410, 420, 415, 418),
    W("Next", 900, 1400, 905, 1380),
])
check("isolated tiny sentence", texts, ["start.", "fought hard.", "Next"])

# --- disabling ----------------------------------------------------------------

texts, _, _ = run(
    [W("of", 1000, 1300, 1000, 1040), W("course", 1300, 1900, 1100, 1825)],
    fwd=frozenset(), bwd=frozenset(), short_ms=0, min_playable_ms=0,
)
check("all disabled", texts, ["of", "course"])


print()
if failures:
    print(f"{len(failures)} FAILURES: {failures}")
    sys.exit(1)
print("all checks passed")
