import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import boundaries from 'eslint-plugin-boundaries';
import { importX } from 'eslint-plugin-import-x';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import { reactRefresh } from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const SAME_MODULE = { module: '{{ from.element.captured.module }}' };
const OTHER_MODULE = { module: '!{{ from.element.captured.module }}' };

const BOUNDARIES_ELEMENTS = [
  {
    type: 'app-composition',
    pattern: 'src/app/composition/**',
    mode: 'full',
  },
  {
    type: 'app-shell',
    pattern: 'src/app/**',
    mode: 'full',
  },
  {
    type: 'module-domain',
    pattern: 'src/modules/*/domain/**',
    mode: 'full',
    capture: ['module'],
  },
  {
    type: 'module-application',
    pattern: 'src/modules/*/application/**',
    mode: 'full',
    capture: ['module'],
  },
  {
    type: 'module-infrastructure',
    pattern: 'src/modules/*/infrastructure/**',
    mode: 'full',
    capture: ['module'],
  },
  {
    type: 'module-presentation',
    pattern: 'src/modules/*/presentation/**',
    mode: 'full',
    capture: ['module'],
  },
  {
    type: 'module-public-api',
    pattern: ['src/modules/*/index.ts', 'src/modules/*/index.tsx'],
    mode: 'full',
    capture: ['module'],
  },
  {
    type: 'shared-kernel',
    pattern: ['src/shared/errors/**', 'src/shared/kernel/**'],
    mode: 'full',
  },
  {
    type: 'shared-infra',
    pattern: ['src/shared/config/**', 'src/shared/logging/**'],
    mode: 'full',
  },
  {
    type: 'shared-ui',
    pattern: ['src/shared/ui/**', 'src/shared/i18n/**'],
    mode: 'full',
  },
  {
    type: 'test-support',
    pattern: 'src/test/**',
    mode: 'full',
  },
];

const BOUNDARIES_FILES = [
  {
    pattern: '**/*.{test,spec}.{ts,tsx}',
    category: 'test',
  },
];

const BOUNDARIES_POLICIES = [
  // shared-kernel: 100% puro, importa apenas shared-kernel
  {
    from: { element: { type: 'shared-kernel' } },
    allow: [{ to: { element: { type: 'shared-kernel' } } }],
  },
  // shared-infra: importa shared-kernel e shared-infra
  {
    from: { element: { type: 'shared-infra' } },
    allow: [{ to: { element: { type: ['shared-kernel', 'shared-infra'] } } }],
  },
  // shared-ui: importa shared-kernel, shared-infra e shared-ui
  {
    from: { element: { type: 'shared-ui' } },
    allow: [{ to: { element: { type: ['shared-kernel', 'shared-infra', 'shared-ui'] } } }],
  },
  // module-domain: importa apenas module-domain do mesmo módulo e shared-kernel
  {
    from: { element: { type: 'module-domain' } },
    allow: [
      { to: { element: { type: 'module-domain', captured: SAME_MODULE } } },
      { to: { element: { type: 'shared-kernel' } } },
    ],
  },
  // module-application: domain/application do mesmo módulo, public API de outros módulos, shared-kernel e shared-infra
  {
    from: { element: { type: 'module-application' } },
    allow: [
      {
        to: {
          element: {
            type: ['module-domain', 'module-application'],
            captured: SAME_MODULE,
          },
        },
      },
      { to: { element: { type: 'module-public-api', captured: OTHER_MODULE } } },
      { to: { element: { type: ['shared-kernel', 'shared-infra'] } } },
    ],
  },
  // module-infrastructure: domain/application/infrastructure do mesmo módulo, shared-kernel e shared-infra
  {
    from: { element: { type: 'module-infrastructure' } },
    allow: [
      {
        to: {
          element: {
            type: ['module-domain', 'module-application', 'module-infrastructure'],
            captured: SAME_MODULE,
          },
        },
      },
      { to: { element: { type: ['shared-kernel', 'shared-infra'] } } },
    ],
  },
  // module-presentation: application/presentation do mesmo módulo, public API de outros módulos, shared-kernel e shared-ui
  {
    from: { element: { type: 'module-presentation' } },
    allow: [
      {
        to: {
          element: {
            type: ['module-application', 'module-presentation'],
            captured: SAME_MODULE,
          },
        },
      },
      { to: { element: { type: 'module-public-api', captured: OTHER_MODULE } } },
      { to: { element: { type: ['shared-kernel', 'shared-ui'] } } },
    ],
  },
  // module-public-api (src/modules/<module>/index.ts): expõe apenas contratos de domain/application do mesmo módulo e shared-kernel (ADR-0006)
  {
    from: { element: { type: 'module-public-api' } },
    allow: [
      {
        to: {
          element: {
            type: ['module-domain', 'module-application'],
            captured: SAME_MODULE,
          },
        },
      },
      { to: { element: { type: 'shared-kernel' } } },
    ],
  },
  // Módulo-folha (ADR-0006): src/modules/authorization/** não pode importar nenhum outro módulo em src/modules/*
  {
    from: {
      element: {
        type: [
          'module-domain',
          'module-application',
          'module-infrastructure',
          'module-presentation',
          'module-public-api',
        ],
        captured: { module: 'authorization' },
      },
    },
    disallow: [
      {
        to: {
          element: {
            type: [
              'module-domain',
              'module-application',
              'module-infrastructure',
              'module-presentation',
              'module-public-api',
            ],
            captured: OTHER_MODULE,
          },
        },
        message:
          'O módulo-folha authorization não pode importar outros módulos em src/modules/* (ADR-0006).',
      },
    ],
  },
  // app-shell: app-shell, app-composition, module-presentation, module-public-api e shared-* (proibido module-infrastructure)
  {
    from: { element: { type: 'app-shell' } },
    allow: [
      {
        to: {
          element: {
            type: [
              'app-shell',
              'app-composition',
              'module-presentation',
              'module-public-api',
              'shared-kernel',
              'shared-infra',
              'shared-ui',
            ],
          },
        },
      },
    ],
  },
  // app-composition: único ponto autorizado a conectar module-infrastructure às portas da aplicação
  {
    from: { element: { type: 'app-composition' } },
    allow: [
      {
        to: {
          element: {
            type: [
              'app-composition',
              'module-domain',
              'module-application',
              'module-infrastructure',
              'module-presentation',
              'module-public-api',
              'shared-kernel',
              'shared-infra',
              'shared-ui',
            ],
          },
        },
      },
    ],
  },
  // test-support (src/test/**): suporte compartilhado de testes
  {
    from: { element: { type: 'test-support' } },
    allow: [
      {
        to: {
          element: {
            type: [
              'app-composition',
              'app-shell',
              'module-domain',
              'module-application',
              'module-infrastructure',
              'module-presentation',
              'module-public-api',
              'shared-kernel',
              'shared-infra',
              'shared-ui',
              'test-support',
            ],
          },
        },
      },
    ],
  },
  // Arquivos de teste (*.test.ts(x) / *.spec.ts(x)) podem importar test-support e módulos necessários para testes
  {
    from: { file: { categories: 'test' } },
    allow: [
      {
        to: {
          element: {
            type: [
              'app-composition',
              'app-shell',
              'module-domain',
              'module-application',
              'module-infrastructure',
              'module-presentation',
              'module-public-api',
              'shared-kernel',
              'shared-infra',
              'shared-ui',
              'test-support',
            ],
          },
        },
      },
    ],
  },
];

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'PMS_Documentacao/**',
      '.agents/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Configuração base de código TypeScript / React + Camada 3 (import-x, typescript-eslint, react-hooks, jsx-a11y)
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.browser,
      },
    },
    plugins: {
      'import-x': importX,
      'react-hooks': reactHooks,
    },
    settings: {
      'import-x/extensions': ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx'],
      'import-x/parsers': {
        '@typescript-eslint/parser': ['.ts', '.tsx', '.mts', '.cts'],
      },
      'import-x/resolver-next': [
        createTypeScriptImportResolver({
          alwaysTryTypes: true,
          project: './tsconfig.json',
        }),
      ],
    },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      'import-x/no-cycle': ['error', { maxDepth: '∞', ignoreExternal: true }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // Acessibilidade (JSX A11y) e Fast Refresh em componentes React (src/)
  {
    files: ['src/**/*.{jsx,tsx}'],
    ...jsxA11y.flatConfigs.recommended,
  },
  {
    ...reactRefresh.configs.vite(),
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/**/*.{test,spec}.{ts,tsx}', 'src/test/**'],
  },

  // Camada 1: Fronteiras arquiteturais estruturais (ADR-0005 §5)
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      boundaries,
    },
    settings: {
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          project: './tsconfig.app.json',
        },
      },
      'boundaries/elements': BOUNDARIES_ELEMENTS,
      'boundaries/files': BOUNDARIES_FILES,
      'boundaries/include': ['src/**/*'],
      'boundaries/legacy-warnings': false,
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: BOUNDARIES_POLICIES,
        },
      ],
    },
  },

  // Camada 2: Bloqueio de pacotes externos no Domínio e Shared Kernel (ADR-0005 §5)
  {
    files: [
      'src/modules/*/domain/**/*.{ts,tsx}',
      'src/shared/errors/**/*.{ts,tsx}',
      'src/shared/kernel/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react',
              message: 'Domínio e Shared Kernel devem permanecer 100% independentes de React.',
            },
            {
              name: 'react-dom',
              message: 'Domínio e Shared Kernel devem permanecer 100% independentes de React DOM.',
            },
            {
              name: 'react-router',
              message:
                'Domínio e Shared Kernel devem permanecer 100% independentes de React Router.',
            },
            {
              name: 'react-intl',
              message: 'Domínio e Shared Kernel não podem importar react-intl nem traduzir textos.',
            },
            {
              name: 'dexie',
              message: 'Domínio e Shared Kernel não podem depender de Dexie/IndexedDB.',
            },
            {
              name: 'msw',
              message: 'Domínio e Shared Kernel não podem depender de MSW.',
            },
            {
              name: 'recharts',
              message: 'Domínio e Shared Kernel não podem depender de bibliotecas de gráficos.',
            },
            {
              name: '@tabler/icons-react',
              message: 'Domínio e Shared Kernel não podem depender de bibliotecas de ícones.',
            },
            {
              name: 'zod',
              message:
                'Domínio e Shared Kernel devem permanecer 100% puros e independentes de Zod (validação de entrada pertence a application/shared-infra).',
            },
          ],
          patterns: [
            {
              group: ['react/*', 'react-dom/*', 'react-router/*'],
              message: 'Domínio e Shared Kernel devem permanecer independentes de React/Router.',
            },
            {
              group: ['dexie/*'],
              message: 'Domínio e Shared Kernel não podem depender de Dexie/IndexedDB.',
            },
            {
              group: ['msw/*'],
              message: 'Domínio e Shared Kernel não podem depender de MSW.',
            },
            {
              group: ['@dnd-kit/*'],
              message: 'Domínio e Shared Kernel não podem depender de @dnd-kit.',
            },
            {
              group: ['recharts/*'],
              message: 'Domínio e Shared Kernel não podem depender de Recharts.',
            },
            {
              group: ['@tabler/icons-react/*'],
              message: 'Domínio e Shared Kernel não podem depender de Tabler Icons.',
            },
            {
              group: ['zod/*'],
              message:
                'Domínio e Shared Kernel devem permanecer 100% puros e independentes de Zod.',
            },
          ],
        },
      ],
    },
  },

  // Camada 2: Bloqueio de Dexie e MSW na Apresentação, Layout, Router e Shared UI (ADR-0005 §5)
  {
    files: [
      'src/modules/*/presentation/**/*.{ts,tsx}',
      'src/app/layout/**/*.{ts,tsx}',
      'src/app/router/**/*.{ts,tsx}',
      'src/shared/ui/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'dexie',
              message:
                'Componentes e hooks de apresentação não podem acessar Dexie/IndexedDB diretamente.',
            },
            {
              name: 'msw',
              message: 'Camada de apresentação não pode importar MSW diretamente.',
            },
          ],
          patterns: [
            {
              group: ['dexie/*'],
              message:
                'Componentes e hooks de apresentação não podem acessar Dexie/IndexedDB diretamente.',
            },
            {
              group: ['msw/*'],
              message: 'Camada de apresentação não pode importar MSW diretamente.',
            },
          ],
        },
      ],
    },
  },

  // Arquivos de configuração Node e E2E Playwright
  {
    files: ['*.config.{js,mjs,cjs,ts,mts}', 'e2e/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // Testes unitários, de componentes e suporte de testes
  {
    files: ['src/**/*.{test,spec}.{ts,tsx}', 'src/test/**/*.{ts,tsx}', 'e2e/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },

  // Prettier sempre por último para desativar regras de estilo conflitantes
  eslintConfigPrettier,
);
