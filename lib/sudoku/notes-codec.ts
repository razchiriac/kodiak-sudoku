import { BOARD_SIZE, type Notes } from "./board";

// Compact base64 encoding of a Notes buffer for autosave. Each cell uses 2
// bytes (Uint16 little-endian); the whole board is 162 bytes which encodes
// to ~216 base64 chars - far smaller than a JSON object and trivially
// decoded both in Node and the browser.

export function encodeNotes(notes: Notes): string {
  const bytes = new Uint8Array(notes.buffer.slice(notes.byteOffset, notes.byteOffset + notes.byteLength));
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function decodeNotes(s: string): Notes {
  if (!s) return new Uint16Array(BOARD_SIZE);
  let bytes: Uint8Array;
  if (typeof Buffer !== "undefined") {
    bytes = new Uint8Array(Buffer.from(s, "base64"));
  } else {
    const bin = atob(s);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  }
  if (bytes.byteLength !== BOARD_SIZE * 2) {
    return new Uint16Array(BOARD_SIZE);
  }
  return new Uint16Array(bytes.buffer, bytes.byteOffset, BOARD_SIZE);
}
