import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    main: 'src/main.ts',
    seed: 'prisma/seed.ts',
  },
  splitting: false,
  sourcemap: true,
  clean: true,
  format: ['cjs'],
  target: 'node22',
  outDir: 'dist',
  minify: false, // Minification isn't strictly necessary for backend and can make debugging harder, but tsup is fast either way.
});
