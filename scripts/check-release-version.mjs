import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

const rootPkg = JSON.parse(
  readFileSync(resolve('package.json'), 'utf8')
);
const desktopPkg = JSON.parse(
  readFileSync(resolve('packages/desktop/package.json'), 'utf8')
);

const errors = [];

if (rootPkg.version !== expectedVersion) {
  errors.push(
    `Root package.json version is "${rootPkg.version}", expected "${expectedVersion}" for tag ${tag}`
  );
}

if (desktopPkg.version !== expectedVersion) {
  errors.push(
    `packages/desktop/package.json version is "${desktopPkg.version}", expected "${expectedVersion}" for tag ${tag}`
  );
}

if (errors.length > 0) {
  console.error('Release version check failed:\n');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Release version check passed for ${tag}`);
