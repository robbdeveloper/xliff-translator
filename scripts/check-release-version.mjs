import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const tag =
  process.env.GITHUB_REF_NAME ??
  process.argv.find((arg) => arg.startsWith('v')) ??
  process.argv[2];

if (!tag) {
  console.error(
    'Usage: node scripts/check-release-version.mjs <tag>\n' +
      'Example: node scripts/check-release-version.mjs v1.0.0'
  );
  process.exit(1);
}

const expectedVersion = tag.startsWith('v') ? tag.slice(1) : tag;

if (!/^\d+\.\d+\.\d+/.test(expectedVersion)) {
  console.error(`Invalid release tag format: ${tag}. Expected vX.Y.Z`);
  process.exit(1);
}

function collectPackageJsonPaths() {
  const paths = ['package.json'];
  const packagesDir = resolve('packages');

  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      paths.push(join('packages', entry.name, 'package.json'));
    }
  }

  return paths.sort();
}

const errors = [];

for (const pkgPath of collectPackageJsonPaths()) {
  const pkg = JSON.parse(readFileSync(resolve(pkgPath), 'utf8'));

  if (pkg.version !== expectedVersion) {
    errors.push(
      `${pkgPath} version is "${pkg.version}", expected "${expectedVersion}" for tag ${tag}`
    );
  }
}

if (errors.length > 0) {
  console.error('Release version check failed:\n');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(
  `Release version check passed for ${tag} (${collectPackageJsonPaths().length} packages)`
);
