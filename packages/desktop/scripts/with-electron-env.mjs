import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(packageRoot, '../..');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('Usage: node scripts/with-electron-env.mjs <command> [args...]');
  process.exit(1);
}

const executable =
  command === 'electron'
    ? path.join(repoRoot, 'node_modules/electron/cli.js')
    : command === 'electron-builder'
      ? path.join(repoRoot, 'node_modules/electron-builder/cli.js')
      : command;

const commandArgs =
  command === 'electron'
    ? [executable, ...args]
    : command === 'electron-builder'
      ? [executable, ...args]
      : [command, ...args];

const runner = command === 'electron' || command === 'electron-builder' ? process.execPath : command;

const result = spawnSync(runner, commandArgs, {
  cwd: packageRoot,
  env,
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
