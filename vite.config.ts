import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Serves the Vercel functions of /api during `npm run dev`, with the variables of .env.local
 * (DATABASE_URL, API_KEY). Routing follows Vercel: api/x.ts, api/x/index.ts, api/x/[id].ts.
 */
function vercelApiDev(): Plugin {
  const root = path.resolve(__dirname, 'api');
  const resolve = (urlPath: string): { file: string; params: Record<string, string> } | undefined => {
    const parts = urlPath.replace(/^\/api\/?/, '').split('/').filter(Boolean);
    const direct = [path.join(root, ...parts) + '.ts', path.join(root, ...parts, 'index.ts')].find(existsSync);
    if (direct) return { file: direct, params: {} };
    const dynamic = path.join(root, ...parts.slice(0, -1), '[id].ts');
    if (parts.length && existsSync(dynamic)) return { file: dynamic, params: { id: decodeURIComponent(parts[parts.length - 1]) } };
    return undefined;
  };
  return {
    name: 'vercel-api-dev',
    configureServer(server) {
      Object.assign(process.env, loadEnv(server.config.mode, process.cwd(), ''));
      server.middlewares.use('/api', async (req, res) => {
        const url = new URL(req.originalUrl ?? req.url ?? '/', 'http://localhost');
        const target = resolve(url.pathname);
        const send = (status: number, payload: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(payload));
        };
        if (!target) return send(404, { error: `No function for ${url.pathname}` });
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const raw = Buffer.concat(chunks).toString();
        const mod = await server.ssrLoadModule(target.file);
        let status = 200;
        await mod.default(
          {
            method: req.method,
            headers: req.headers,
            query: { ...Object.fromEntries(url.searchParams), ...target.params },
            body: raw ? JSON.parse(raw) : undefined,
          },
          {
            status(code: number) {
              status = code;
              return this;
            },
            json: (payload: unknown) => send(status, payload),
            setHeader: (name: string, value: string) => res.setHeader(name, value),
          },
        );
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), vercelApiDev()],
});
