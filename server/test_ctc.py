"""Parity test: server CTC math must match the reference fixture that also locks the (former)
TS implementation — web/scripts/ctc-fixture.json. Run: python test_ctc.py"""
import json
import os
import sys

import numpy as np

from ctc import forced_align_gop, greedy_decode, softmax_rows

FIXTURE = os.path.join(os.path.dirname(__file__), "..", "web", "scripts", "ctc-fixture.json")

with open(FIXTURE, encoding="utf-8") as f:
    fx = json.load(f)

logits = np.array(fx["logits"], np.float32).reshape(fx["frames"], fx["vocab"])
probs = softmax_rows(logits)
id_to_token = {i: t for t, i in fx["vocabMap"].items()}

fails = 0


def check(name: str, cond: bool, got=None, want=None) -> None:
    global fails
    if not cond:
        fails += 1
        print(f"FAIL: {name} | got {got} | want {want}")


greedy = greedy_decode(probs, id_to_token, fx["blank"], fx["delimiter"])
check("greedy parity", greedy == fx["expectedGreedy"], greedy, fx["expectedGreedy"])

gop = forced_align_gop(probs, fx["targetIds"], fx["blank"])
check("gop length", len(gop) == len(fx["expectedGop"]))
max_diff = max(abs(a - b) for a, b in zip(gop, fx["expectedGop"]))
check("gop parity <1e-4", max_diff < 1e-4, max_diff)
percent = round(100 * sum(gop) / len(gop))
check("percent parity", percent == fx["expectedPercent"], percent, fx["expectedPercent"])

check("empty ids -> []", forced_align_gop(probs, [], fx["blank"]) == [])
check("zero frames -> []", forced_align_gop(probs[:0], fx["targetIds"], fx["blank"]) == [])

print(f"parity: greedy={greedy!r} percent={percent} maxGopDiff={max_diff:.2e}")
print("ALL TESTS PASSED" if fails == 0 else f"{fails} TEST(S) FAILED")
sys.exit(0 if fails == 0 else 1)
