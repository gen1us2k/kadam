// Pure CTC helpers — no runtime dependencies, unit-tested against the reference fixture
// (web/scripts/ctc-fixture.json, exported from the original Python pipeline). main.ts wires
// these to onnxruntime-node output.

/** Row-wise softmax over the vocab dimension of a [frames, vocab] logits buffer. */
export function softmaxRows(logits: Float32Array | number[], frames: number, vocab: number): Float32Array {
  const out = new Float32Array(frames * vocab);
  for (let t = 0; t < frames; t++) {
    const base = t * vocab;
    let max = -Infinity;
    for (let v = 0; v < vocab; v++) max = Math.max(max, logits[base + v]);
    let sum = 0;
    for (let v = 0; v < vocab; v++) {
      const e = Math.exp(logits[base + v] - max);
      out[base + v] = e;
      sum += e;
    }
    for (let v = 0; v < vocab; v++) out[base + v] /= sum;
  }
  return out;
}

/** Greedy CTC decode from softmax probs: drop repeats, drop blank, join, delimiter -> space. */
export function greedyDecode(
  probs: Float32Array | number[],
  frames: number,
  vocab: number,
  idToToken: Map<number, string>,
  blank: number,
  delimiter: string,
): string {
  let prev = -1;
  const tokens: string[] = [];
  for (let t = 0; t < frames; t++) {
    const base = t * vocab;
    let best = 0;
    let bestVal = probs[base];
    for (let v = 1; v < vocab; v++) {
      if (probs[base + v] > bestVal) {
        bestVal = probs[base + v];
        best = v;
      }
    }
    if (best !== prev && best !== blank) {
      const tok = idToToken.get(best) ?? '';
      // Skip special tokens ([UNK], [PAD], <s>, </s>) so they don't leak into the transcript.
      if (tok && tok[0] !== '[' && tok[0] !== '<') tokens.push(tok);
    }
    prev = best;
  }
  return tokens.join('').split(delimiter).join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * CTC Viterbi forced alignment of target ids to frames, returning each target token's mean
 * acoustic posterior (Goodness-of-Pronunciation, 0..1). Extended sequence interleaves blanks:
 * [blank, y0, blank, y1, ..., blank].
 */
export function forcedAlignGop(
  probs: Float32Array | number[],
  frames: number,
  vocab: number,
  ids: number[],
  blank: number,
): number[] {
  if (ids.length === 0 || frames === 0) return [];
  const ext: number[] = [blank];
  for (const id of ids) ext.push(id, blank);
  const S = ext.length;
  const NEG = -1e30;
  const lp = (t: number, tok: number) => Math.log(probs[t * vocab + tok] + 1e-30);

  const dp = new Float64Array(frames * S).fill(NEG);
  const bp = new Int32Array(frames * S);
  dp[0] = lp(0, ext[0]);
  if (S > 1) dp[1] = lp(0, ext[1]);
  for (let t = 1; t < frames; t++) {
    for (let s = 0; s < S; s++) {
      let best = dp[(t - 1) * S + s];
      let arg = s;
      if (s > 0 && dp[(t - 1) * S + s - 1] > best) {
        best = dp[(t - 1) * S + s - 1];
        arg = s - 1;
      }
      if (s > 1 && ext[s] !== blank && ext[s] !== ext[s - 2] && dp[(t - 1) * S + s - 2] > best) {
        best = dp[(t - 1) * S + s - 2];
        arg = s - 2;
      }
      dp[t * S + s] = lp(t, ext[s]) + best;
      bp[t * S + s] = arg;
    }
  }
  let s = dp[(frames - 1) * S + S - 1] >= dp[(frames - 1) * S + S - 2] ? S - 1 : S - 2;
  const align = new Int32Array(frames);
  for (let t = frames - 1; t >= 0; t--) {
    align[t] = s;
    s = bp[t * S + s];
  }
  const scores: number[] = [];
  for (let j = 0; j < ids.length; j++) {
    const es = 2 * j + 1;
    let sum = 0;
    let n = 0;
    for (let t = 0; t < frames; t++) {
      if (align[t] === es) {
        sum += probs[t * vocab + ids[j]];
        n++;
      }
    }
    scores.push(n > 0 ? sum / n : 0);
  }
  return scores;
}
