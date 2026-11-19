# ADR-0004 --- Baseline de Stack Frontend, Versões e Tooling

- **Status:** Aceita
- **Data:** 2026-11-19
- **Fase:** 01 — Fundação, Configuração e Arquitetura
- **Responsáveis:** Arquiteto de Software (redação) / PMS Orchestrator (aprovação)
- **Referências normativas:** `PRD.md` (§3, §22, §23, §25), `ARCHITECTURE.md`, `CODING-STANDARDS.md`, `TESTING.md`, `ACCESSIBILITY.md`, `DEFINITION-OF-DONE.md`, `ADR-0001`, `ADR-0002`, `ADR-0003`.

## Contexto

O `PRD.md` (§23) define a stack tecnológica obrigatória do Project Management System (PMS), mas não fixa versões major nem opções exatas de compilação, linting e testes. O projeto será implementado em 14 fases incrementais sobre Node.js `24.x` e `pnpm` `9.x` (que aplica resolução estrita de `peerDependencies`), incorporando bibliotecas especializadas em fases posteriores — como Dexie e MSW (Fase 03), React Hook Form (Fase 04), `@dnd-kit` (Fase 06), `recharts` (Fase 10) e `vite-plugin-pwa` (Fase 13).

Fixar uma baseline compatível desde a Fase 01 evita conflitos tardios de `peerDependencies`, quebras de tipagem e retrabalho estrutural ao longo das fases.

## Decisão

Adotar a seguinte baseline tecnológica e de tooling para o PMS:

### 1. Runtime, Gerenciador e Metadados de Pacote

- **Node.js:** `>=20.19.0` (desenvolvimento local validado em Node `24.19.0`; CI em Node `22`/`24`).
- **Gerenciador único:** `pnpm` `>=9.0.0`, fixado via `"packageManager": "pnpm@9.15.4"` e `"engines": { "node": ">=20.19.0", "pnpm": ">=9.0.0" }`, com `pnpm-lock.yaml` obrigatoriamente versionado.
- **Restrição operacional Windows:** em ambientes onde a `ExecutionPolicy` do PowerShell bloqueia `pnpm.ps1`, executar `pnpm.cmd` sem alterar políticas de segurança do sistema operacional.
- **Versionamento e licença (`PRD.md` §22):** SemVer iniciando em `"version": "0.1.0"`, licença `"MIT"` (`LICENSE` na raiz), respeitando as licenças de todas as dependências.

### 2. Bibliotecas da Fase 01 (Versões Major Fixadas)

| Área | Pacote / Versão | Notas de uso |
|---|---|---|
| UI Runtime | `react@^18.3.1`, `react-dom@^18.3.1` | Baseline estável para todas as 14 fases |
| Roteamento | `react-router@^7` | **Estritamente em modo Library/SPA** (`createBrowserRouter`, `RouterProvider`, `lazy`); proibido modo framework/SSR (`@react-router/dev`) |
| Estilização | `tailwindcss@^3.4`, `postcss`, `autoprefixer`, `clsx`, `tailwind-merge`, `class-variance-authority` | Tokens semânticos CSS compatíveis com WCAG 2.2 AA e `shadcn/ui` |
| Componentes e Ícones | `shadcn/ui` (componentes sob demanda + primitivas Radix mínimas), `@tabler/icons-react@^3` | Sem bibliotecas de UI redundantes |
| Internacionalização | `react-intl@^7` (ou `^6.6`) | Idioma inicial `pt-BR`; códigos de domínio nunca traduzidos |
| Validação | `zod@^3.24` | Fixado em v3 para compatibilidade plena com `@hookform/resolvers` na Fase 04+ |
| Build | `vite@^6`, `@vitejs/plugin-react@^4` | Build SPA com code splitting e lazy loading |
| Linguagem | `typescript@^5.7` | Strict mode com flags adicionais abaixo |
| Lint e Formatação | `eslint@^9` (Flat Config), `typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, `eslint-plugin-jsx-a11y`, `eslint-plugin-boundaries`, `eslint-plugin-import-x`, `eslint-import-resolver-typescript`, `eslint-config-prettier`, `prettier` | Enforcement automatizado de qualidade, acessibilidade e fronteiras arquiteturais (ver `ADR-0005`) |
| Testes | `vitest@^3`, `@vitest/coverage-v8`, `jsdom`, `@testing-library/react@^16`, `@testing-library/jest-dom`, `@testing-library/user-event`, `vitest-axe`/`axe-core`, `@playwright/test@^1` | Unitários, componentes, acessibilidade, testes negativos de fronteira e E2E smoke |

### 3. Política de Dependências Futuras (Fases 03–13)

Em conformidade com `CODING-STANDARDS.md` (*"Não adicionar dependências sem justificar no PR"*), bibliotecas de fases futuras **não** são instaladas prematuramente na Fase 01, mas tiveram compatibilidade previamente verificada com esta baseline:

- **Fase 03 (Persistência e API simulada):** `dexie@^4`, `fake-indexeddb@^6` (dev), `msw@^2` — todos compatíveis com Node 24, Vitest 3 e Vite 6.
- **Fase 04 (Formulários):** `react-hook-form@^7`, `@hookform/resolvers` — compatíveis com React 18.3 e Zod 3.
- **Fase 06 (Kanban):** `@dnd-kit/core@^6.3`, `@dnd-kit/sortable`, `@dnd-kit/utilities` — compatibilidade madura com React 18.3 sem `overrides`.
- **Fase 10 (Analytics):** `recharts@^2` — compatibilidade direta com React 18.3 sem conflitos de `react-is` ou `peerDependencies`.
- **Fase 13 (PWA):** `vite-plugin-pwa` — compatível com Vite 6.

### 4. Configuração TypeScript Strict

Adotar `tsconfig.json` com referências para `tsconfig.app.json` (código da aplicação) e `tsconfig.node.json` (arquivos de configuração Vite, Vitest e Playwright), aplicando:

- `strict: true`
- `noUncheckedIndexedAccess: true` (previne acessos inseguros em listas, colunas Kanban e séries de métricas)
- `noImplicitOverride: true`
- `noFallthroughCasesInSwitch: true`
- `noUnusedLocals: true`
- `noUnusedParameters: true`
- `verbatimModuleSyntax: true` (impõe `import type`, melhora tree-shaking e reduz acoplamento acidental entre camadas)
- **`exactOptionalPropertyTypes: false`** (decisão explícita): embora teoricamente mais rígido, gera atrito severo com definições de tipos de `react-hook-form`, `zod` (`.optional()`), Radix/`shadcn/ui` e `recharts`, criando pressão artificial para casts (`as`) ou `any` — prática proibida por `AGENTS.md`. O conjunto `strict` + `noUncheckedIndexedAccess` + `verbatimModuleSyntax` entrega alta segurança de tipos sem degradar ergonomia nem induzir bypass de tipagem.

### 5. Scripts Padronizados (`package.json`)

Padronizar os scripts: `dev`, `build`, `preview`, `typecheck`, `lint`, `format`, `format:check`, `test`, `test:watch` e `test:e2e`, executados tanto localmente quanto no workflow `.github/workflows/ci.yml` (jobs `quality` e `e2e`).

## Alternativas Consideradas

1. **React 19.x na Fase 01:** descartada para a baseline inicial devido ao risco tardio de atritos em `peerDependencies` e runtime com `recharts@2.x` (`react-is`) e `@dnd-kit/core@6.x` sob resolução estrita do pnpm. Como `Domain` e `Application` permanecem 100% independentes de React (`ADR-0001`), uma migração futura para React 19 ficará isolada na camada de apresentação.
2. **Tailwind CSS v4 (`@tailwindcss/vite`):** alternativa viável, porém descartada em favor de Tailwind CSS `3.4.x` pela maturidade comprovada com `shadcn/ui`, `jsdom` (Vitest) e compatibilidade ampla nos navegadores recentes exigidos pelo PRD §22.
3. **React Router v6 (`react-router-dom@^6.28`):** descartada em favor de `react-router@^7` em modo Library/SPA por unificar o pacote e oferecer ciclo de vida mais longo mantendo a mesma ergonomia SPA.
4. **Habilitar `exactOptionalPropertyTypes: true`:** descartada pelo alto custo de adaptação em formulários e componentes de terceiros, conforme justificado na seção 4.
5. **Instalar `fake-indexeddb`, `dexie` e `msw` já na Fase 01:** descartada para evitar dependências órfãs sem uso efetivo na Fase 01, preservando o princípio de incremento limpo por fase.

## Consequências

- **Positivas:** resolução limpa de dependências no pnpm 9 + Node 24 ao longo das 14 fases; zero código ou dependência prematura na Fase 01; forte segurança de tipos sem incentivar `any`; pipeline CI reprodutível.
- **Trade-offs:** eventual atualização major para React 19 ou Tailwind v4 no futuro exigirá novo ADR dedicado; `exactOptionalPropertyTypes` desabilitado demanda atenção em contratos opcionais explícitos (`T | undefined`) quando a semântica distinguir ausência de valor explícito.
