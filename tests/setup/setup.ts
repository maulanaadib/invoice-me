import { loadTestEnv } from "./env";

// Runs in every test worker before test files: guarantees process.env carries
// the hermetic test database + secrets before any src/server module imports.
loadTestEnv();
