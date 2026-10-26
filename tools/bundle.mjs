// Builds upstream's Bun-run TypeScript helpers (watch-pr, orch) into single
// Node scripts, so they run on any laptop without Bun (PRD C8). commander is
// bundled in, which makes upstream's install-on-first-run bootstrap unneeded.
import { build } from 'esbuild';
import { join } from 'node:path';

const BANNER = "#!/usr/bin/env node\nimport { createRequire as flowCreateRequire } from 'node:module';\nconst require = flowCreateRequire(import.meta.url);";

const noBootstrap = {
  name: 'no-bootstrap',
  setup(b) {
    b.onResolve({ filter: /bootstrap\.ts$/ }, () => ({ path: 'bootstrap', namespace: 'flow-stub' }));
    b.onLoad({ filter: /.*/, namespace: 'flow-stub' }, () => ({ contents: 'export function ensureDependenciesInstalled() {}', loader: 'js' }));
  },
};

// name -> how to start it. watch-pr's upstream entry is a Bun shebang file
// that imports cli.ts; orch.ts runs itself under `import.meta.main`.
export const BUNDLES = {
  'watch-pr': { resolveDir: 'watch-pr', contents: "import { main } from './cli.ts';\nprocess.exitCode = await main(process.argv.slice(2));\n" },
  orch: { resolveDir: 'orch', contents: "import './orch.ts';\n" },
};

// Returns { name: source } for every bundle, built from `scriptsDir`
// (upstream's skills/poteto-mode/scripts).
export async function bundleScripts(scriptsDir, nodeModules) {
  const out = {};
  for (const [name, entry] of Object.entries(BUNDLES)) {
    const result = await build({
      stdin: { contents: entry.contents, resolveDir: join(scriptsDir, entry.resolveDir), loader: 'ts', sourcefile: `${name}-entry.ts` },
      bundle: true,
      write: false,
      platform: 'node',
      format: 'esm',
      target: 'node20',
      plugins: [noBootstrap],
      define: { 'import.meta.main': 'true' },
      banner: { js: BANNER },
      legalComments: 'none',
      logLevel: 'silent',
      nodePaths: [nodeModules],
      charset: 'utf8',
    });
    // esbuild marks each module with its source path; keep only the part below scripts/.
    out[name] = result.outputFiles[0].text.replace(/^\/\/ .*?\/scripts\//gm, '// ');
  }
  return out;
}
