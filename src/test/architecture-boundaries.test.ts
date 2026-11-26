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

describe(
  'Architecture boundaries and lint enforcement (ADR-0005 §5, ADR-0006 §6 & ADR-0007 §2)',
  { timeout: 15_000 },
  () => {
    beforeAll(async () => {
      await mkdir(path.join(TMP_ALPHA_DIR, 'infrastructure'), { recursive: true });
      await mkdir(path.join(TMP_ALPHA_DIR, 'presentation'), { recursive: true });
      await mkdir(path.join(TMP_ALPHA_DIR, 'domain'), { recursive: true });
      await mkdir(path.join(TMP_BETA_DIR, 'domain'), { recursive: true });

      await writeFile(
        path.join(TMP_ALPHA_DIR, 'infrastructure', 'sample-repository.ts'),
        'export const sampleRepository = true;\n',
        'utf8',
      );
      await writeFile(
        path.join(TMP_ALPHA_DIR, 'presentation', 'sample-view.ts'),
        'export const sampleView = true;\n',
        'utf8',
      );
      await writeFile(
        path.join(TMP_ALPHA_DIR, 'domain', 'cycle-a.ts'),
        "import { cycleB } from './cycle-b';\nexport const cycleA = (): string => cycleB();\n",
        'utf8',
      );
      await writeFile(
        path.join(TMP_ALPHA_DIR, 'domain', 'cycle-b.ts'),
        "import { cycleA } from './cycle-a';\nexport const cycleB = (): string => cycleA();\n",
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

    it('blocks zod inside src/shared/kernel/ and src/modules/*/domain/ (ADR-0006 §6)', async () => {
      const kernelMessages = await lintSnippet(
        ["import { z } from 'zod';", 'export const forbiddenKernelSchema = z.string();'].join('\n'),
        'src/shared/kernel/violation-zod.ts',
      );
      const domainMessages = await lintSnippet(
        ["import { z } from 'zod';", 'export const forbiddenDomainSchema = z.string();'].join('\n'),
        `src/modules/${TMP_ALPHA_MODULE}/domain/violation-zod.ts`,
      );

      expect(
        kernelMessages.filter(
          (msg) => msg.ruleId === 'no-restricted-imports' && msg.severity === 2,
        ),
      ).toHaveLength(1);
      expect(
        domainMessages.filter(
          (msg) => msg.ruleId === 'no-restricted-imports' && msg.severity === 2,
        ),
      ).toHaveLength(1);
    });

    it('blocks react-intl inside shared-kernel (src/shared/errors/)', async () => {
      const messages = await lintSnippet(
        [
          "import { createIntl } from 'react-intl';",
          'export const forbiddenIntl = createIntl;',
        ].join('\n'),
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

    it('blocks dexie and msw imports inside src/app/providers/ and src/app/App.tsx (ADR-0007 §2)', async () => {
      const providerMessages = await lintSnippet(
        [
          "import Dexie from 'dexie';",
          "import { setupWorker } from 'msw/browser';",
          'export const forbiddenProviderStorage = [Dexie, setupWorker];',
        ].join('\n'),
        'src/app/providers/violation-storage.tsx',
      );
      const appMessages = await lintSnippet(
        [
          "import Dexie from 'dexie';",
          "import { http } from 'msw';",
          'export const forbiddenAppStorage = [Dexie, http];',
        ].join('\n'),
        'src/app/App.tsx',
      );

      expect(
        providerMessages.filter(
          (msg) => msg.ruleId === 'no-restricted-imports' && msg.severity === 2,
        ),
      ).toHaveLength(2);
      expect(
        appMessages.filter((msg) => msg.ruleId === 'no-restricted-imports' && msg.severity === 2),
      ).toHaveLength(2);
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

    it('blocks module-public-api (src/modules/*/index.ts) from importing module-presentation or shared-ui (ADR-0006 §6)', async () => {
      const messages = await lintSnippet(
        [
          `import { sampleView } from '@/modules/${TMP_ALPHA_MODULE}/presentation/sample-view';`,
          "import { cn } from '@/shared/ui/cn';",
          'export const forbiddenPublicApiExports = [sampleView, cn];',
        ].join('\n'),
        `src/modules/${TMP_ALPHA_MODULE}/index.ts`,
      );

      const boundaryErrors = messages.filter(
        (msg) => msg.ruleId === 'boundaries/dependencies' && msg.severity === 2,
      );
      expect(boundaryErrors).toHaveLength(2);
    });

    it('blocks leaf module src/modules/authorization/** from importing any other module in src/modules/* (ADR-0006 §6)', async () => {
      const domainMessages = await lintSnippet(
        [
          `import { betaPublicContract } from '@/modules/${TMP_BETA_MODULE}';`,
          'export const forbiddenAuthzDomainImport = betaPublicContract;',
        ].join('\n'),
        'src/modules/authorization/domain/violation-cross-module.ts',
      );
      const appMessages = await lintSnippet(
        [
          "import { SUBTASK_STATUSES } from '@/modules/tasks';",
          'export const forbiddenAuthzAppImport = SUBTASK_STATUSES;',
        ].join('\n'),
        'src/modules/authorization/application/violation-cross-module.ts',
      );

      expect(
        domainMessages.filter(
          (msg) => msg.ruleId === 'boundaries/dependencies' && msg.severity === 2,
        ),
      ).toHaveLength(1);
      expect(
        appMessages.filter((msg) => msg.ruleId === 'boundaries/dependencies' && msg.severity === 2),
      ).toHaveLength(1);
    });

    it('blocks acyclic DAG violations across tasks, projects, dependencies and impediments (ADR-0010 §3.4 & ADR-0011 §3)', async () => {
      const tasksViolations = await lintSnippet(
        [
          "import { PROJECT_STATUSES } from '@/modules/projects';",
          "import { BOARD_COLUMN_ROLES } from '@/modules/kanban';",
          'export const forbiddenTasksImports = [PROJECT_STATUSES, BOARD_COLUMN_ROLES];',
        ].join('\n'),
        'src/modules/tasks/application/violation-dag.ts',
      );
      const projectsViolations = await lintSnippet(
        [
          "import { TeamService } from '@/modules/teams';",
          "import { BOARD_COLUMN_ROLES } from '@/modules/kanban';",
          'export const forbiddenProjectsImports = [TeamService, BOARD_COLUMN_ROLES];',
        ].join('\n'),
        'src/modules/projects/application/violation-dag.ts',
      );
      const dependenciesViolations = await lintSnippet(
        [
          "import { SUBTASK_STATUSES } from '@/modules/tasks';",
          "import { PROJECT_STATUSES } from '@/modules/projects';",
          "import { BOARD_COLUMN_ROLES } from '@/modules/kanban';",
          'export const forbiddenDependencyImports = [SUBTASK_STATUSES, PROJECT_STATUSES, BOARD_COLUMN_ROLES];',
        ].join('\n'),
        'src/modules/dependencies/application/violation-dag.ts',
      );
      const impedimentsViolations = await lintSnippet(
        [
          "import { SUBTASK_STATUSES } from '@/modules/tasks';",
          "import { PROJECT_STATUSES } from '@/modules/projects';",
          "import { BOARD_COLUMN_ROLES } from '@/modules/kanban';",
          'export const forbiddenImpedimentImports = [SUBTASK_STATUSES, PROJECT_STATUSES, BOARD_COLUMN_ROLES];',
        ].join('\n'),
        'src/modules/impediments/application/violation-dag.ts',
      );

      expect(
        tasksViolations.filter(
          (msg) => msg.ruleId === 'boundaries/dependencies' && msg.severity === 2,
        ),
      ).toHaveLength(2);
      expect(
        projectsViolations.filter(
          (msg) => msg.ruleId === 'boundaries/dependencies' && msg.severity === 2,
        ),
      ).toHaveLength(2);
      expect(
        dependenciesViolations.filter(
          (msg) => msg.ruleId === 'boundaries/dependencies' && msg.severity === 2,
        ),
      ).toHaveLength(3);
      expect(
        impedimentsViolations.filter(
          (msg) => msg.ruleId === 'boundaries/dependencies' && msg.severity === 2,
        ),
      ).toHaveLength(3);
    });

    it('allows legitimate DAG dependencies (tasks -> dependencies/impediments) and preserves test files', async () => {
      const validTasksAppMessages = await lintSnippet(
        [
          "import { assertNoDependencyCycle } from '@/modules/dependencies';",
          "import { IMPEDIMENT_CATEGORIES } from '@/modules/impediments';",
          'export const validTasksImports = [assertNoDependencyCycle, IMPEDIMENT_CATEGORIES];',
        ].join('\n'),
        'src/modules/tasks/application/valid-dag.ts',
      );
      const [coreInvariantsResult] = await eslint.lintFiles([
        path.resolve(WORKSPACE_ROOT, 'src/modules/tasks/domain/core-work-invariants.test.ts'),
      ]);

      expect(validTasksAppMessages.filter((msg) => msg.severity === 2)).toEqual([]);
      expect(coreInvariantsResult?.messages.filter((msg) => msg.severity === 2)).toEqual([]);
    });

    it('blocks acyclic DAG violations in bottlenecks and focus (ADR-0012 §3)', async () => {
      const bottlenecksViolations = await lintSnippet(
        [
          "import { FOCUS_MODES } from '@/modules/focus';",
          "import { SUBTASK_STATUSES } from '@/modules/tasks';",
          "import { PROJECT_STATUSES } from '@/modules/projects';",
          "import { BOARD_COLUMN_ROLES } from '@/modules/kanban';",
          "import { assertNoDependencyCycle } from '@/modules/dependencies';",
          "import { IMPEDIMENT_CATEGORIES } from '@/modules/impediments';",
          "import { ANALYTICS_PERIOD_PRESETS } from '@/modules/analytics';",
          'export const forbiddenBottleneckImports = [',
          '  FOCUS_MODES,',
          '  SUBTASK_STATUSES,',
          '  PROJECT_STATUSES,',
          '  BOARD_COLUMN_ROLES,',
          '  assertNoDependencyCycle,',
          '  IMPEDIMENT_CATEGORIES,',
          '  ANALYTICS_PERIOD_PRESETS,',
          '];',
        ].join('\n'),
        'src/modules/bottlenecks/application/violation-dag.ts',
      );
      const focusViolations = await lintSnippet(
        [
          "import { SUBTASK_STATUSES } from '@/modules/tasks';",
          "import { PROJECT_STATUSES } from '@/modules/projects';",
          "import { BOARD_COLUMN_ROLES } from '@/modules/kanban';",
          "import { assertNoDependencyCycle } from '@/modules/dependencies';",
          "import { IMPEDIMENT_CATEGORIES } from '@/modules/impediments';",
          "import { ANALYTICS_PERIOD_PRESETS } from '@/modules/analytics';",
          'export const forbiddenFocusImports = [',
          '  SUBTASK_STATUSES,',
          '  PROJECT_STATUSES,',
          '  BOARD_COLUMN_ROLES,',
          '  assertNoDependencyCycle,',
          '  IMPEDIMENT_CATEGORIES,',
          '  ANALYTICS_PERIOD_PRESETS,',
          '];',
        ].join('\n'),
        'src/modules/focus/application/violation-dag.ts',
      );

      expect(
        bottlenecksViolations.filter(
          (msg) => msg.ruleId === 'boundaries/dependencies' && msg.severity === 2,
        ),
      ).toHaveLength(7);
      expect(
        focusViolations.filter(
          (msg) => msg.ruleId === 'boundaries/dependencies' && msg.severity === 2,
        ),
      ).toHaveLength(6);
    });

    it('allows legitimate focus -> bottlenecks DAG dependency and preserves test files (ADR-0012 §3)', async () => {
      const validFocusAppMessages = await lintSnippet(
        [
          "import { BOTTLENECK_INDICATORS, calculateWorkloadScore } from '@/modules/bottlenecks';",
          'export const validFocusImports = [BOTTLENECK_INDICATORS, calculateWorkloadScore];',
        ].join('\n'),
        'src/modules/focus/application/valid-dag.ts',
      );
      const [analyticsFocusBottlenecksResult] = await eslint.lintFiles([
        path.resolve(
          WORKSPACE_ROOT,
          'src/modules/analytics/domain/analytics-focus-bottlenecks.test.ts',
        ),
      ]);
      const [bottleneckDomainTestResult] = await eslint.lintFiles([
        path.resolve(WORKSPACE_ROOT, 'src/modules/bottlenecks/domain/bottleneck.test.ts'),
      ]);

      expect(validFocusAppMessages.filter((msg) => msg.severity === 2)).toEqual([]);
      expect(analyticsFocusBottlenecksResult?.messages.filter((msg) => msg.severity === 2)).toEqual(
        [],
      );
      expect(bottleneckDomainTestResult?.messages.filter((msg) => msg.severity === 2)).toEqual([]);
    });

    it('blocks acyclic DAG violations in feedback and projects -> bottlenecks/feedback (ADR-0013 §4)', async () => {
      const feedbackViolations = await lintSnippet(
        [
          "import { SUBTASK_STATUSES } from '@/modules/tasks';",
          "import { PROJECT_STATUSES } from '@/modules/projects';",
          "import { BOARD_COLUMN_ROLES } from '@/modules/kanban';",
          "import { assertNoDependencyCycle } from '@/modules/dependencies';",
          "import { IMPEDIMENT_CATEGORIES } from '@/modules/impediments';",
          "import { FOCUS_MODES } from '@/modules/focus';",
          "import { BOTTLENECK_INDICATORS } from '@/modules/bottlenecks';",
          "import { ANALYTICS_PERIOD_PRESETS } from '@/modules/analytics';",
          "import { NOTIFICATION_CATEGORIES } from '@/modules/notifications';",
          "import { BACKUP_KINDS } from '@/modules/backups';",
          "import { TeamService } from '@/modules/teams';",
          "import { INVITATION_STATUSES } from '@/modules/invitations';",
          "import { DEMO_CREDENTIALS_BY_ROLE } from '@/modules/authentication';",
          "import { DEMO_SEED_VERSION } from '@/modules/demo';",
          "import { canSkipOnboardingStep } from '@/modules/onboarding';",
          "import { normalizeEmail } from '@/modules/users';",
          'export const forbiddenFeedbackImports = [',
          '  SUBTASK_STATUSES,',
          '  PROJECT_STATUSES,',
          '  BOARD_COLUMN_ROLES,',
          '  assertNoDependencyCycle,',
          '  IMPEDIMENT_CATEGORIES,',
          '  FOCUS_MODES,',
          '  BOTTLENECK_INDICATORS,',
          '  ANALYTICS_PERIOD_PRESETS,',
          '  NOTIFICATION_CATEGORIES,',
          '  BACKUP_KINDS,',
          '  TeamService,',
          '  INVITATION_STATUSES,',
          '  DEMO_CREDENTIALS_BY_ROLE,',
          '  DEMO_SEED_VERSION,',
          '  canSkipOnboardingStep,',
          '  normalizeEmail,',
          '];',
        ].join('\n'),
        'src/modules/feedback/application/violation-dag.ts',
      );
      const projectsPhase08And09Violations = await lintSnippet(
        [
          "import { BOTTLENECK_INDICATORS } from '@/modules/bottlenecks';",
          "import { FEEDBACK_STATUSES } from '@/modules/feedback';",
          'export const forbiddenProjectsImports = [BOTTLENECK_INDICATORS, FEEDBACK_STATUSES];',
        ].join('\n'),
        'src/modules/projects/application/violation-dag-phase09.ts',
      );
      const tasksFeedbackViolations = await lintSnippet(
        [
          "import { FEEDBACK_STATUSES } from '@/modules/feedback';",
          'export const forbiddenTasksFeedbackImport = FEEDBACK_STATUSES;',
        ].join('\n'),
        'src/modules/tasks/application/violation-dag-feedback.ts',
      );
      const dependenciesFeedbackViolations = await lintSnippet(
        [
          "import { FEEDBACK_STATUSES } from '@/modules/feedback';",
          'export const forbiddenDepsFeedbackImport = FEEDBACK_STATUSES;',
        ].join('\n'),
        'src/modules/dependencies/application/violation-dag-feedback.ts',
      );
      const impedimentsFeedbackViolations = await lintSnippet(
        [
          "import { FEEDBACK_STATUSES } from '@/modules/feedback';",
          'export const forbiddenImpedimentsFeedbackImport = FEEDBACK_STATUSES;',
        ].join('\n'),
        'src/modules/impediments/application/violation-dag-feedback.ts',
      );
      const focusFeedbackViolations = await lintSnippet(
        [
          "import { FEEDBACK_STATUSES } from '@/modules/feedback';",
          'export const forbiddenFocusFeedbackImport = FEEDBACK_STATUSES;',
        ].join('\n'),
        'src/modules/focus/application/violation-dag-feedback.ts',
      );
      const bottlenecksFeedbackViolations = await lintSnippet(
        [
          "import { FEEDBACK_STATUSES } from '@/modules/feedback';",
          'export const forbiddenBottlenecksFeedbackImport = FEEDBACK_STATUSES;',
        ].join('\n'),
        'src/modules/bottlenecks/application/violation-dag-feedback.ts',
      );
      const [feedbackGovernanceTestResult] = await eslint.lintFiles([
        path.resolve(WORKSPACE_ROOT, 'src/modules/feedback/domain/feedback-governance.test.ts'),
      ]);

      expect(
        feedbackViolations.filter(
          (msg) => msg.ruleId === 'boundaries/dependencies' && msg.severity === 2,
        ),
      ).toHaveLength(16);
      expect(
        projectsPhase08And09Violations.filter(
          (msg) => msg.ruleId === 'boundaries/dependencies' && msg.severity === 2,
        ),
      ).toHaveLength(2);
      expect(
        tasksFeedbackViolations.filter(
          (msg) => msg.ruleId === 'boundaries/dependencies' && msg.severity === 2,
        ),
      ).toHaveLength(1);
      expect(
        dependenciesFeedbackViolations.filter(
          (msg) => msg.ruleId === 'boundaries/dependencies' && msg.severity === 2,
        ),
      ).toHaveLength(1);
      expect(
        impedimentsFeedbackViolations.filter(
          (msg) => msg.ruleId === 'boundaries/dependencies' && msg.severity === 2,
        ),
      ).toHaveLength(1);
      expect(
        focusFeedbackViolations.filter(
          (msg) => msg.ruleId === 'boundaries/dependencies' && msg.severity === 2,
        ),
      ).toHaveLength(1);
      expect(
        bottlenecksFeedbackViolations.filter(
          (msg) => msg.ruleId === 'boundaries/dependencies' && msg.severity === 2,
        ),
      ).toHaveLength(1);
      expect(feedbackGovernanceTestResult?.messages.filter((msg) => msg.severity === 2)).toEqual(
        [],
      );
    });

    it('blocks circular dependencies between real files (import-x/no-cycle)', async () => {
      const [result] = await eslint.lintFiles([path.join(TMP_ALPHA_DIR, 'domain', 'cycle-a.ts')]);
      if (!result) {
        throw new Error('ESLint returned no result for cycle-a.ts');
      }

      const cycleErrors = result.messages.filter(
        (msg) => msg.ruleId === 'import-x/no-cycle' && msg.severity === 2,
      );
      expect(cycleErrors.length).toBeGreaterThanOrEqual(1);
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
  },
);
