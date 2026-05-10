import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

export default defineConfig({
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
});
