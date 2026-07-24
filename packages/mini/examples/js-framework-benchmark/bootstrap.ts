import { createBenchmarkApp } from './main'

// Entry point for `index.html`. Mounts the benchmark app into the harness's
// `#main` container. Run with a bundler that resolves `@amritk/mini` — e.g.
// `npx vite` from this directory (see README).
document.getElementById('main')?.appendChild(createBenchmarkApp().element)
