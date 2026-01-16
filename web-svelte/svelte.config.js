import adapter from "@sveltejs/adapter-node";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),

  kit: {
    adapter: adapter({
      // Node adapter options
      precompress: true,
    }),

    // CSRF protection
    csrf: {
      checkOrigin: true,
    },

    // Security settings for embedded apps
    embedded: false,

    // Strict aliasing
    alias: {},

    // Environment variable prefix (only PUBLIC_ vars exposed to client)
    env: {
      publicPrefix: "PUBLIC_",
      privatePrefix: "",
    },
  },
};

export default config;
