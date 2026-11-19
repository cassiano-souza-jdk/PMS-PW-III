// @vitest-environment node
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ESLint } from 'eslint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const WORKSPACE_ROOT = process.cwd();
const TMP_ALPHA_MODULE = '__tmp_boundary_alpha__';
const TMP_BETA_MODULE = '__tmp_boundary_beta__';
const TMP_ALPHA_DIR = path.resolve(WORKSPACE_ROOT, 'src/modules', TMP_ALPHA_MODULE);
const TMP_BETA_DIR = path.resolve(WORKSPACE_ROOT, 'src/modules', TMP_BETA_MODULE);

let eslint: ESLint;

async function lintSnippet(code: string, relativeFilePath: string) {
  const absolutePath = path.resolve(WORKSPACE_ROOT, relativeFilePath);
  const [result] = await eslint.lintText(code, { filePath: absolutePath });
  if (!result) {
    throw new Error(`ESLint returned no result for ${relativeFilePath}`);
  }
  return result.messages;
}

describe('Architecture boundaries and lint enforcement (ADR-0005 §5)', () => {
  beforeAll(async () => {
    await mkdir(path.join(TMP_ALPHA_DIR, 'infrastructure'), { recursive: true });
    await mkdir(path.join(TMP_BETA_DIR, 'domain'), { recursive: true });

    await writeFile(
      path.join(TMP_ALPHA_DIR, 'infrastructure', 'sample-repository.ts'),
      'export const sampleRepository = true;\n',
      'utf8',
    );
    await writeFile(
      path.join(TMP_BETA_DIR, 'domain', 'internal-entity.ts'),
      'export const internalEntity = true;\n',
      'utf8',
    );
    await writeFile(
      path.join(TMP_BETA_DIR, 'index.ts'),
      'export const betaPublicContract = true;\n',
      'utf8',
    );

    eslint = new ESLint({ cwd: WORKSPACE_ROOT });
  });

  afterAll(async () => {
    await rm(TMP_ALPHA_DIR, { recursive: true, force: true });
    await rm(TMP_BETA_DIR, { recursive: true, force: true });
  });

  it('blocks react, dexie and msw imports inside module-domain (no-restricted-imports)', async () => {
    const messages = await lintSnippet(
      [
        "import { useState } from 'react';",
        "import Dexie from 'dexie';",
        "import { http } from 'msw';",
        'export const probe = [useState, Dexie, http];',
      ].join('\n'),
      `src/modules/${TMP_ALPHA_MODULE}/domain/violation-external.ts`,
    );

    const restrictedErrors = messages.filter(
      (msg) => msg.ruleId === 'no-restricted-imports' && msg.severity === 2,
    );
    expect(restrictedErrors).toHaveLength(3);
  });

  it('blocks react-intl inside shared-kernel (src/shared/errors/)', async () => {
    const messages = await lintSnippet(
      ["import { createIntl } from 'react-intl';", 'export const forbiddenIntl = createIntl;'].join(
        '\n',
      ),
      'src/shared/errors/violation-intl.ts',
    );

    const restrictedErrors = messages.filter(
      (msg) => msg.ruleId === 'no-restricted-imports' && msg.severity === 2,
    );
    expect(restrictedErrors.length).toBeGreaterThanOrEqual(1);
  });

  it('blocks dexie and msw/browser imports inside module-presentation', async () => {
    const messages = await lintSnippet(
      [
        "import Dexie from 'dexie';",
        "import { setupWorker } from 'msw/browser';",
        'export const forbiddenPresentation = [Dexie, setupWorker];',
      ].join('\n'),
      `src/modules/${TMP_ALPHA_MODULE}/presentation/violation-storage.ts`,
    );

    const restrictedErrors = messages.filter(
      (msg) => msg.ruleId === 'no-restricted-imports' && msg.severity === 2,
    );
    expect(restrictedErrors).toHaveLength(2);
  });

  it('blocks module-domain from importing shared-ui or app-shell (boundaries/dependencies)', async () => {
    const messages = await lintSnippet(
      [
        "import { cn } from '@/shared/ui/cn';",
        "import { App } from '@/app/App';",
        'export const forbiddenDomainDeps = [cn, App];',
      ].join('\n'),
      `src/modules/${TMP_ALPHA_MODULE}/domain/violation-layers.ts`,
    );

    const boundaryErrors = messages.filter(
      (msg) => msg.ruleId === 'boundaries/dependencies' && msg.severity === 2,
    );
    expect(boundaryErrors).toHaveLength(2);
  });

  it('blocks app-shell from importing module-infrastructure directly (boundaries/dependencies)', async () => {
    const messages = await lintSnippet(
      [
        `import { sampleRepository } from '@/modules/${TMP_ALPHA_MODULE}/infrastructure/sample-repository';`,
        'export const forbiddenAppShellImport = sampleRepository;',
      ].join('\n'),
      'src/app/layout/violation-infra.ts',
    );

    const boundaryErrors = messages.filter(
      (msg) => msg.ruleId === 'boundaries/dependencies' && msg.severity === 2,
    );
    expect(boundaryErrors).toHaveLength(1);
  });

  it('blocks module-presentation from importing module-infrastructure or internals of another module', async () => {
    const messages = await lintSnippet(
      [
        `import { sampleRepository } from '@/modules/${TMP_ALPHA_MODULE}/infrastructure/sample-repository';`,
        `import { internalEntity } from '@/modules/${TMP_BETA_MODULE}/domain/internal-entity';`,
        'export const forbiddenPresentationImports = [sampleRepository, internalEntity];',
      ].join('\n'),
      `src/modules/${TMP_ALPHA_MODULE}/presentation/violation-cross-layer.ts`,
    );

    const boundaryErrors = messages.filter(
      (msg) => msg.ruleId === 'boundaries/dependencies' && msg.severity === 2,
    );
    expect(boundaryErrors).toHaveLength(2);
  });

  it('blocks explicit any usage (@typescript-eslint/no-explicit-any)', async () => {
    const messages = await lintSnippet(
      'export const forbiddenAny: any = 42;\n',
      `src/modules/${TMP_ALPHA_MODULE}/domain/violation-any.ts`,
    );

    const anyErrors = messages.filter(
      (msg) => msg.ruleId === '@typescript-eslint/no-explicit-any' && msg.severity === 2,
    );
    expect(anyErrors).toHaveLength(1);
  });

  it('allows legitimate module-domain import from shared-kernel (@/shared/errors) with 0 errors', async () => {
    const messages = await lintSnippet(
      [
        "import { ValidationError } from '@/shared/errors';",
        'export function createDomainValidationError(): ValidationError {',
        "  return new ValidationError('Invalid domain rule');",
        '}',
      ].join('\n'),
      `src/modules/${TMP_ALPHA_MODULE}/domain/valid-domain.ts`,
    );

    const errors = messages.filter((msg) => msg.severity === 2);
    expect(errors).toEqual([]);
  });

  it('allows legitimate module-presentation import from another module public API with 0 errors', async () => {
    const messages = await lintSnippet(
      [
        `import { betaPublicContract } from '@/modules/${TMP_BETA_MODULE}';`,
        'export const allowedCrossModulePublicApi = betaPublicContract;',
      ].join('\n'),
      `src/modules/${TMP_ALPHA_MODULE}/presentation/valid-public-api.ts`,
    );

    const errors = messages.filter((msg) => msg.severity === 2);
    expect(errors).toEqual([]);
  });
});
