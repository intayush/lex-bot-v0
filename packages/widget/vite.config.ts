import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

export default defineConfig(({ command, mode }) => {
  // Production-deploy guardrail. Vite production builds without
  // VITE_API_URL silently fell back to a localhost default in
  // ChatWidget.tsx, which has historically shipped broken bundles to
  // Netlify. Refuse to start the build when:
  //   - command === 'build'  (`vite build`)  AND
  //   - mode === 'production' (the default for `vite build`)  AND
  //   - we're running on a hosted-deploy environment (Netlify or
  //     Vercel — both set well-known env vars)  AND
  //   - VITE_API_URL is unset or empty
  // Local turbo `^build` invocations and the dev server are unaffected
  // because none of the deploy-detection vars are set there. This
  // means a missing VITE_API_URL on a local `pnpm build` produces a
  // localhost-defaulted bundle (which is fine; it never ships) but a
  // missing VITE_API_URL on Netlify fails the deploy loudly.
  if (command === 'build') {
    const env = loadEnv(mode, process.cwd(), '');
    const isHostedDeploy =
      process.env.NETLIFY === 'true' ||
      process.env.VERCEL === '1' ||
      process.env.CI === 'true';
    if (
      mode === 'production' &&
      isHostedDeploy &&
      (!env.VITE_API_URL || env.VITE_API_URL.length === 0)
    ) {
      throw new Error(
        'VITE_API_URL is required for production widget builds on this host.\n' +
          '  Set it in your Netlify (or other host) environment variables.\n' +
          '  Example: VITE_API_URL=https://lex-bot-v0.netlify.app/api/chat\n' +
          '  See packages/widget/README.md and the Netlify site’s\n' +
          '  Site configuration → Environment variables panel.',
      );
    }
  }

  return {
    plugins: [
      react(),
      {
        name: 'serve-chatbot-context',
        configureServer(server) {
          const contextDir = path.resolve(__dirname, '../../chatbot-context');
          server.middlewares.use('/chatbot-context', (req, _res, next) => {
            const filePath = path.join(contextDir, req.url || '');
            if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
              _res.setHeader('Access-Control-Allow-Origin', '*');
              _res.setHeader('Content-Type', filePath.endsWith('.json') ? 'application/json' : 'text/markdown');
              fs.createReadStream(filePath).pipe(_res);
            } else {
              next();
            }
          });
        },
      },
    ],
    server: {
      port: 5173,
    },
  };
});
