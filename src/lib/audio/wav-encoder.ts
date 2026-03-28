/**
 * WAV encoder — encodes an AudioBuffer to a WAV ArrayBuffer.
 * Supports 16-bit PCM, 24-bit PCM, and 32-bit IEEE float.
 */

/** Supported bit depths for WAV export */
export type BitDepth = 16 | 24 | 32;

const FORMAT_PCM = 1;
const FORMAT_IEEE_FLOAT = 3;

/**
 * Encode an AudioBuffer as a WAV file.
 *
 * @param buffer    Source audio
 * @param bitDepth  16 (PCM int), 24 (PCM int), or 32 (IEEE float)
 * @returns ArrayBuffer containing a valid RIFF/WAV file
 */
export function encodeWav(buffer: AudioBuffer, bitDepth: BitDepth): ArrayBuffer {
  const numChannels = buffer.numberOfChannels;
  const numSamples = buffer.length;
  const sampleRate = buffer.sampleRate;
  const bytesPerSample = bitDepth / 8;
  const dataSize = numSamples * numChannels * bytesPerSample;
  const fileSize = 44 + dataSize;

  const arrayBuffer = new ArrayBuffer(fileSize);
  const view = new DataView(arrayBuffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  const formatTag = bitDepth === 32 ? FORMAT_IEEE_FLOAT : FORMAT_PCM;

  // RIFF chunk
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");

  // fmt  chunk
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);                                     // chunk size
  view.setUint16(20, formatTag, true);                              // format tag
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true); // byte rate
  view.setUint16(32, numChannels * bytesPerSample, true);           // block align
  view.setUint16(34, bitDepth, true);

  // data chunk
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  // Interleave channels into data region
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      if (bitDepth === 32) {
        view.setFloat32(offset, sample, true);
        offset += 4;
      } else if (bitDepth === 24) {
        // Convert to signed 24-bit integer
        const int24 = Math.round(sample * 8388607);
        view.setUint8(offset, int24 & 0xff);
        view.setUint8(offset + 1, (int24 >> 8) & 0xff);
        view.setUint8(offset + 2, (int24 >> 16) & 0xff);
        offset += 3;
      } else {
        // 16-bit PCM
        view.setInt16(offset, Math.round(sample * 0x7fff), true);
        offset += 2;
      }
    }
  }

  return arrayBuffer;
}
