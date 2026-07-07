/**
 * MP3 encoder — encodes an AudioBuffer to an MP3 (LAME) ArrayBuffer.
 *
 * Uses `wasm-media-encoders` (LAME compiled to WebAssembly). Chosen over
 * `lamejs` because it wraps the reference LAME encoder rather than a hand-ported
 * JS reimplementation, is actively maintained, ships first-class TypeScript
 * types, and the WASM path is markedly faster/more accurate than pure-JS LAME.
 * The module is dynamically imported so the ~130 KiB WASM only loads when a user
 * actually exports MP3.
 */

/** Constant bitrates (kbps) the LAME encoder accepts. */
export type Mp3Bitrate =
  | 8 | 16 | 24 | 32 | 40 | 48 | 64 | 80 | 96 | 112 | 128 | 160 | 192 | 224 | 256 | 320;

/** Encode ~100 frames per block (1152 samples/frame) to bound peak memory. */
const CHUNK_SAMPLES = 1152 * 100;

/**
 * Encode an AudioBuffer as a constant-bitrate MP3.
 *
 * @param buffer   Rendered audio (mono or stereo; >2 channels are downmixed to stereo).
 * @param bitrate  Constant bitrate in kbps (default 320).
 * @returns ArrayBuffer containing the MP3 stream.
 */
export async function encodeMp3(
  buffer: AudioBuffer,
  bitrate: Mp3Bitrate = 320,
): Promise<ArrayBuffer> {
  const { createMp3Encoder } = await import("wasm-media-encoders");
  const encoder = await createMp3Encoder();

  const channels: 1 | 2 = buffer.numberOfChannels >= 2 ? 2 : 1;
  encoder.configure({
    sampleRate: buffer.sampleRate as 44100,
    channels,
    bitrate,
  });

  const left = buffer.getChannelData(0);
  const right = channels === 2 ? buffer.getChannelData(1) : left;

  const parts: Uint8Array[] = [];
  for (let i = 0; i < buffer.length; i += CHUNK_SAMPLES) {
    const end = Math.min(i + CHUNK_SAMPLES, buffer.length);
    const block =
      channels === 2
        ? encoder.encode([left.subarray(i, end), right.subarray(i, end)])
        : encoder.encode([left.subarray(i, end)]);
    // The returned view is owned by the encoder and reused — copy it.
    if (block.length > 0) parts.push(new Uint8Array(block));
  }
  const tail = encoder.finalize();
  if (tail.length > 0) parts.push(new Uint8Array(tail));

  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out.buffer;
}
