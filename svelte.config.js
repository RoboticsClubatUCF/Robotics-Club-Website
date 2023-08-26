import preprocess from 'svelte-preprocess';
import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/kit/vite';
import { imagePreprocessor } from 'svimg';
/** @type {import('@sveltejs/kit').Config} */
const config = {
  // Consult https://kit.svelte.dev/docs/integrations#preprocessors
  // for more information about preprocessors
  preprocess: [
    imagePreprocessor({
      inputDir: 'static',
      outputDir: 'static/g',
      webp: true,
      avif: true
    }),
    vitePreprocess(),
    preprocess({
      postcss: true
    })
  ],

  kit: {
    csrf: { checkOrigin: false, },
    // adapter-auto only supports some environments, see https://kit.svelte.dev/docs/adapter-auto for a list.
    // If your environment is not supported or you settled on a specific environment, switch out the adapter.
    // See https://kit.svelte.dev/docs/adapters for more information about adapters.
    adapter: adapter(),
  }
};

export default config;
