import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const child = spawn(
  process.execPath,
  [
    fileURLToPath(new URL('../node_modules/astro/bin/astro.mjs', import.meta.url)),
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit', env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' } },
);
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
