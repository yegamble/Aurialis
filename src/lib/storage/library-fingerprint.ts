/**
 * Library file fingerprinting.
 *
 * `cheapFingerprint` is the primary key — instant, no I/O. `contentFingerprint`
 * is the SHA-256 disambiguator, called only when a cheap-key collision is
 * suspected (different physical file, identical name|size|lastModified).
 * `composeFingerprint` builds the secondary key for the colliding entry.
 */

export function cheapFingerprint(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

export async function contentFingerprint(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  // Wrap in a Uint8Array view — Node's webcrypto subtle is strict about
  // accepting only TypedArray / DataView / true ArrayBuffer, and jsdom's
  // FileReader-based polyfill can return a buffer that fails the typecheck.
  const view = new Uint8Array(buf);
  const digest = await crypto.subtle.digest("SHA-256", view);
  return bufferToHex(digest);
}

/** Build a stable secondary fingerprint for the SECOND distinct file with a given cheap key. */
export function composeFingerprint(cheap: string, sha256: string): string {
  return `${cheap}|${sha256.slice(0, 16)}`;
}

function bufferToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, "0");
  }
  return hex;
}
