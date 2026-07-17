import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/http/index.ts', 'src/nestjs/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
});
