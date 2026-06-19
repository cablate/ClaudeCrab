import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

interface Step {
  label: string;
  args: string[];
}

function main(): void {
  const passThroughArgs = process.argv.slice(2);
  const steps: Step[] = [
    { label: 'setup check', args: ['run', 'setup:check', '--', ...passThroughArgs] },
    {
      label: 'example schedule check',
      args: ['run', 'schedule:check', '--', 'agents/example/schedules/example-daily-check.yaml', '--strict'],
    },
    { label: 'typecheck', args: ['run', 'typecheck'] },
    { label: 'build', args: ['run', 'build'] },
  ];

  for (const step of steps) {
    console.log(`\n== ${step.label} ==`);
    const result = runNpm(step.args);
    if (result.error) {
      console.error(`setup:verify failed to start ${step.label}: ${result.error.message}`);
      process.exitCode = 1;
      return;
    }
    if (result.status !== 0) {
      console.error(`setup:verify failed at ${step.label}`);
      process.exitCode = result.status ?? 1;
      return;
    }
  }

  console.log('\nsetup:verify passed. This did not send Discord messages; run discord:check separately when real token/channel are ready.');
}

function runNpm(args: string[]): ReturnType<typeof spawnSync> {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath) {
    return spawnSync(process.execPath, [npmExecPath, ...args], { stdio: 'inherit', shell: false });
  }
  return spawnSync('npm', args, { stdio: 'inherit', shell: true });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
