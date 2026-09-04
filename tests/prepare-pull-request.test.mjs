import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflowPath = new URL('../.github/workflows/prepare-pull-request.yml', import.meta.url);
const workflow = fs.readFileSync(workflowPath, 'utf8');
const workflowLines = workflow.split('\n');
const scriptStart = workflowLines.findIndex((line) => line.trim() === 'script: |');
const workflowScript = workflowLines
  .slice(scriptStart + 1)
  .map((line) => line.replace(/^            /, ''))
  .join('\n');

async function runWorkflow({
  commitMessages,
  files,
  body: initialBody = '[CARD-NUMBER] Title starting with imperative verb\n\n### Preview:\n\n<!-- link to preview if changes impact the UI -->',
  templateOverrides = [],
}) {
  let updatedBody;
  let paginateCalls = 0;
  const listCommits = () => {};
  const listFiles = () => {};

  const github = {
    rest: {
      repos: {
        getContent: async ({ path, ref }) => {
          assert.equal(ref, 'base-sha');
          if (templateOverrides.includes(path)) {
            return { type: 'file' };
          }

          const error = new Error('Not found');
          error.status = 404;
          throw error;
        },
      },
      pulls: {
        listCommits,
        listFiles,
        update: async ({ body }) => {
          updatedBody = body;
        },
      },
    },
    paginate: async (endpoint) => {
      paginateCalls += 1;
      if (endpoint === listCommits) {
        return commitMessages.map((message) => ({ commit: { message } }));
      }

      return files.map((filename) => ({ filename }));
    },
  };
  const context = {
    repo: { owner: 'example', repo: 'repo' },
    payload: {
      pull_request: {
        number: 7,
        body: initialBody,
        base: { sha: 'base-sha' },
      },
    },
  };

  await new Function('github', 'context', `return (async () => {\n${workflowScript}\n})()`)(github, context);

  return { paginateCalls, updatedBody };
}

test('formats the card number and keeps Preview for matching source files', async () => {
  const result = await runWorkflow({
    commitMessages: [
      'feat: added thingy [CAV-119]\n\nDetails',
      'fix: correct a typo',
    ],
    files: ['src/view.tsx'],
  });

  assert.match(result.updatedBody, /^\[CAV-119\] added thingy/m);
  assert.match(result.updatedBody, /### Preview:/);
});

test('removes Preview when no matching source files changed', async () => {
  const result = await runWorkflow({
    commitMessages: ['fix: updated documentation [CAV-120]'],
    files: ['README.md'],
  });

  assert.doesNotMatch(result.updatedBody, /### Preview:/);
});

test('leaves the existing first line when no PR commit matches', async () => {
  const selectedBody = '[CAV-119] GitHub-selected title\n\n### Preview:\n\n<!-- link to preview if changes impact the UI -->';
  const result = await runWorkflow({
    commitMessages: ['update the thing', 'fix a follow-up issue'],
    files: ['src/view.tsx'],
    body: selectedBody,
  });

  assert.equal(result.updatedBody, undefined);
});

test('leaves pull requests with a repository template override untouched', async () => {
  const result = await runWorkflow({
    commitMessages: ['feat: added thingy [CAV-119]'],
    files: ['src/view.tsx'],
    templateOverrides: ['.github/pull_request_template.md'],
  });

  assert.equal(result.paginateCalls, 0);
  assert.equal(result.updatedBody, undefined);
});