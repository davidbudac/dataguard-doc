import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/* The fact-check probes (test/fact-check/*.probe.ts). Deliberately a config of
   its own: the probes print what the engine does and never assert, so they do
   not belong in `npm test`. See docs/agents/fact-check.md. */
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['test/fact-check/**/*.probe.ts'],
    environment: 'node',
    reporters: ['verbose'],
  },
});
