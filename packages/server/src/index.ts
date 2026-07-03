import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServerApp, startServer } from './app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveStaticDir(): string | undefined {
  const fromEnv = process.env.STATIC_DIR?.trim();
  if (fromEnv) {
    return path.resolve(fromEnv);
  }

  const defaultDir = path.resolve(__dirname, '../../web/dist');
  const indexHtml = path.join(defaultDir, 'index.html');
  return fs.existsSync(indexHtml) ? defaultDir : undefined;
}

const staticDir = resolveStaticDir();
const app = createServerApp(staticDir ? { staticDir } : {});

await startServer(app);
