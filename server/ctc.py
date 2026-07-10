"""Pure CTC math for Kyrgyz ASR: softmax, greedy decode, Viterbi forced-alignment GOP.

Mirrors web/src/lib/ctc.ts (which it replaced as the runtime implementation) and is locked to
the same reference fixture — web/scripts/ctc-fixture.json — by test_ctc.py.
"""
from __future__ import annotations

import numpy as np


def softmax_rows(logits: np.ndarray) -> np.ndarray:
    """Row-wise softmax over the vocab dimension of a [frames, vocab] array."""
    z = logits - logits.max(-1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(-1, keepdims=True)


def greedy_decode(probs: np.ndarray, id_to_token: dict[int, str], blank: int, delimiter: str) -> str:
    """Greedy CTC decode: drop repeats, drop blank, skip special tokens, delimiter -> space."""
    ids = probs.argmax(-1)
    prev = -1
    out: list[str] = []
    for i in ids:
        i = int(i)
        if i != prev and i != blank:
            tok = id_to_token.get(i, "")
            if tok and tok[0] not in "[<":
                out.append(tok)
        prev = i
    return " ".join("".join(out).replace(delimiter, " ").split())


def forced_align_gop(probs: np.ndarray, ids: list[int], blank: int) -> list[float]:
    """CTC Viterbi forced alignment of target ids; per-token mean acoustic posterior (0..1).

    Extended sequence interleaves blanks: [blank, y0, blank, y1, ..., blank].
    """
    frames = probs.shape[0]
    if not ids or frames == 0:
        return []
    ext = [blank]
    for t in ids:
        ext += [t, blank]
    S = len(ext)
    NEG = -1e30
    logp = np.log(probs + 1e-30)

    dp = np.full((frames, S), NEG)
    bp = np.zeros((frames, S), np.int32)
    dp[0, 0] = logp[0, ext[0]]
    if S > 1:
        dp[0, 1] = logp[0, ext[1]]
    for t in range(1, frames):
        for s in range(S):
            best, arg = dp[t - 1, s], s
            if s > 0 and dp[t - 1, s - 1] > best:
                best, arg = dp[t - 1, s - 1], s - 1
            if s > 1 and ext[s] != blank and ext[s] != ext[s - 2] and dp[t - 1, s - 2] > best:
                best, arg = dp[t - 1, s - 2], s - 2
            dp[t, s] = logp[t, ext[s]] + best
            bp[t, s] = arg
    s = S - 1 if dp[frames - 1, S - 1] >= dp[frames - 1, S - 2] else S - 2
    align = np.zeros(frames, np.int32)
    for t in range(frames - 1, -1, -1):
        align[t] = s
        s = bp[t, s]

    scores: list[float] = []
    for j, tok in enumerate(ids):
        mask = align == 2 * j + 1
        scores.append(float(probs[mask, tok].mean()) if mask.any() else 0.0)
    return scores
