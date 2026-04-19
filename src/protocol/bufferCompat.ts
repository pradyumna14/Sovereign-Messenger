/**
 * Crypto Buffer Compatibility
 * 
 * Node 24 / TypeScript 5.7+ introduces stricter ArrayBuffer generics.
 * Uint8Array<ArrayBufferLike> is not directly assignable to BufferSource.
 * This helper provides safe casting for Web Crypto API calls.
 */

/** Cast any typed array to BufferSource for Web Crypto API compatibility */
export function toBuffer(data: Uint8Array | ArrayBuffer): BufferSource {
  if (data instanceof ArrayBuffer) return data;
  // Force cast through unknown to satisfy TS 5.7+ strict ArrayBuffer generics
  return new Uint8Array(data) as unknown as BufferSource;
}

/** Create an AES-GCM params object with properly typed IV */
export function aesGcmParams(iv: Uint8Array, tagLength: number = 128): AesGcmParams {
  return { name: "AES-GCM", iv: new Uint8Array(iv) as unknown as Uint8Array<ArrayBuffer>, tagLength };
}
