// RAZ-71: vitest stub for the `server-only` Next.js package.
// The real package is a build-time guard: it throws when bundled
// into a client build, but is otherwise a no-op. Under vitest we
// just need an importable empty module so server-only files (which
// use `import "server-only"` at the top) can be loaded into the
// node test environment.
export {};
