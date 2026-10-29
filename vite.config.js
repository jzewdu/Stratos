import { defineConfig } from 'vite';

// The Pages workflow sets BASE to "/<repo-name>/" so the bundle also works from
// https://<user>.github.io/<repo>/. Local dev and root hosting fall back to "/".
const base = process.env.BASE || '/';

export default defineConfig({
  base,
});
