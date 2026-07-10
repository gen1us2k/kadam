// Pure TTS helpers for the Meta MMS (facebook/mms-tts-kir) frontend — no I/O, unit-tested in
// test-tts.ts. main.ts wires tokenize() to the onnxruntime-node session and encodeWav() to the
// HTTP response. Ported verbatim from the former in-browser web/src/lib/tts.ts.

/** Parse the MMS tokens.txt ("<char> <id>"; the space char itself is a token: "  <id>"). */
export function parseTokens(text: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of text.split('\n')) {
    if (line.startsWith('  ')) {
      const id = Number(line.trim());
      if (Number.isFinite(id)) map.set(' ', id);
      continue;
    }
    const sep = line.indexOf(' ');
    if (sep <= 0) continue;
    const ch = line.slice(0, sep);
    const id = Number(line.slice(sep + 1));
    if (ch && Number.isFinite(id)) map.set(ch, id);
  }
  return map;
}

/** MMS frontend with add_blank=1: blank(0) interleaved between token ids. */
export function tokenize(text: string, tokens: Map<string, number>): BigInt64Array {
  const ids: number[] = [];
  for (const ch of text) {
    const id = tokens.get(ch) ?? tokens.get(ch.toLowerCase());
    if (id !== undefined) ids.push(id);
  }
  const x: bigint[] = [0n];
  for (const id of ids) x.push(BigInt(id), 0n);
  return BigInt64Array.from(x);
}

/** Encode a Float32 waveform as a 16-bit PCM mono WAV. */
export function encodeWav(wave: Float32Array, rate: number): Buffer {
  const buf = Buffer.alloc(44 + wave.length * 2);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + wave.length * 2, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(wave.length * 2, 40);
  for (let i = 0; i < wave.length; i++) {
    const s = Math.max(-1, Math.min(1, wave[i]));
    buf.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), 44 + i * 2);
  }
  return buf;
}
