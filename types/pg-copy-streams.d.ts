// Minimal type declarations for pg-copy-streams. The package ships JS
// only; we only use the `from` factory which returns a writable stream
// that is also `Submittable` (so it can be passed to pg.query).
declare module "pg-copy-streams" {
  import { Writable } from "node:stream";
  import { Submittable } from "pg";
  type CopyFromStream = Writable & Submittable;
  type CopyToStream = NodeJS.ReadableStream & Submittable;
  export function from(query: string): CopyFromStream;
  export function to(query: string): CopyToStream;
  const def: { from: typeof from; to: typeof to };
  export default def;
}
