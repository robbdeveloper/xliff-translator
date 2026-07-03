import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createProvider,
  loadXliffFiles,
  parseTranslationResponse,
  translateProject,
} from '@xliff-translator/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sample = readFileSync(join(__dirname, '../examples/sample-job-1.xliff'), 'utf8');

async function testFetch() {
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: 'Bearer invalid-key' },
    });
    console.log('fetch status:', response.status);
  } catch (error) {
    console.log('fetch error:', error instanceof Error ? error.message : error);
    console.log('fetch cause:', error instanceof Error ? error.cause : undefined);
  }
}

async function testMockProvider() {
  const project = loadXliffFiles([{ fileName: 'sample.xliff', content: sample }]);
  const provider = {
    name: 'mock',
    async translateBatch(items) {
      return items.map((item) => ({
        id: item.id,
        text: `[EN] ${item.text}`,
      }));
    },
  };

  await translateProject(project, {
    provider,
    sourceLanguage: 'it',
    targetLanguage: 'en',
    batchSize: 4,
    onProgress: (p) => console.log('mock progress:', p),
  });

  console.log(
    'mock results:',
    project.files[0].parsed.transUnits.map((u) => ({
      id: u.meta.id,
      status: u.status,
      target: (u.translatedTarget ?? '').slice(0, 40),
    }))
  );
}

function testBatchParse() {
  const items = [
    { id: 'u1', text: 'Ciao' },
    { id: 'u2', text: 'Mondo' },
  ];
  const parsed = parseTranslationResponse(
    JSON.stringify({
      translations: [
        { id: 'u1', text: 'Hello' },
        { id: 'u2', text: 'World' },
      ],
    }),
    items
  );
  console.log('batch parse:', parsed);
}

console.log('--- fetch test ---');
await testFetch();
console.log('--- batch parse test ---');
testBatchParse();
console.log('--- mock provider test ---');
await testMockProvider();
