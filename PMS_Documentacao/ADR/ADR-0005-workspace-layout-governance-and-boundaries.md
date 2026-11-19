# ADR-0005 --- Topologia Documental, Governança de Workspace e Fronteiras Arquiteturais

- **Status:** Aceita
- **Data:** 2026-11-19
- **Fase:** 01 — Fundação, Configuração e Arquitetura
- **Responsáveis:** Arquiteto de Software (redação) / PMS Orchestrator (aprovação)
- **Referências normativas:** `AGENTS.md`, `AI-AGENTS.md`, `AGENT-WORKFLOW.md`, `ARCHITECTURE.md`, `MODULES.md`, `SECURITY.md`, `CODING-STANDARDS.md`, `CONTEXT-BOOTSTRAP.md`, `ADR-0001`, `docs/contracts/permission-matrix.md` (§10).

## Contexto

No início da Fase 01, o pacote normativo do PMS (30 arquivos Markdown originais, incluindo `ADR-0001..0003` e `docs/contracts/*`) reside em `PMS_Documentacao/` com links relativos internos entre si, enquanto a raiz do repositório hospeda a aplicação Vite/React, configurações de tooling, CI e evidências operacionais.

Além disso, `ADR-0001` e `ARCHITECTURE.md` estabelecem regras estritas de dependência entre camadas (`Presentation -> Application -> Domain`, `Infrastructure` conectada por composição, `Domain` livre de React/Dexie/MSW, `UI` sem acesso a Dexie e ausência de dependências circulares), que exigem estrutura clara de diretórios e enforcement automatizado desde a Fase 01.

## Decisão

### 1. Topologia Documental (Fonte Única de Verdade)

1. **`PMS_Documentacao/` permanece como fonte normativa canônica e intacta.** Documentos normativos **não** devem ser duplicados nem movidos para a raiz, preservando integralmente os links relativos internos (`PRD.md`, `PERMISSIONS.md`, `INDEX.md`) e referências em `.agents/agents/`.
2. **Novos ADRs (`ADR-0004`, `ADR-0005`, ...)** são registrados em **`PMS_Documentacao/ADR/`**, mantendo numeração contígua com `ADR-0001..0003` e evitando divisão de fonte de verdade.
3. **Novos contratos e decisões normativas futuras** (a partir da Fase 02) são mantidos em `PMS_Documentacao/docs/contracts/` e `PMS_Documentacao/docs/decisions/`, atualizando `PMS_Documentacao/INDEX.md` sempre que novos documentos normativos forem adicionados.
4. **Relatórios operacionais e evidências de fase (`reports/`)** residem na **raiz do repositório** (ex.: `reports/fase-01-evidencias.md`), separando artefatos vivos de execução/CI da especificação normativa.
5. **Ponteiros mínimos na raiz:** `AGENTS.md` e `README.md` na raiz atuam exclusivamente como ponteiros técnicos e operacionais para `PMS_Documentacao/`, sem duplicar requisitos normativos.

### 2. Alinhamento da Equipe Multiagente (`AI-AGENTS.md`)

A operação segue o modelo híbrido de `AI-AGENTS.md` com o **PMS Orchestrator** e 6 agentes especializados definidos em `.agents/agents/` (`arquiteto`, `frontend`, `persistencia`, `seguranca`, `qa`, `revisor`). Conforme explicitamente autorizado por `AI-AGENTS.md` (*"Papéis podem ser combinados quando não houver conflito de responsabilidade"*):

- **Serviços simulados (MSW)** é combinado sob o agente **Persistência** (sem conflito de interesse, mantendo handlers MSW desacoplados de regras de negócio conforme `ADR-0003`).
- **Documentação** é responsabilidade distribuída por tarefa + consolidação do Orquestrador + verificação independente do agente **Revisor**.
- Nenhuma tarefa edita arquivos compartilhados em paralelo sem propriedade exclusiva previamente definida pelo Orquestrador.

### 3. Estrutura de Diretórios e Subcamadas de Pureza em `src/shared/`

Adotar a estrutura aderente a `ARCHITECTURE.md`:

- `src/app/` — bootstrap (`main.tsx`, `App.tsx`), raiz de composição (`composition/`), layout (`layout/`), providers (`providers/`), roteamento (`router/`) e estilos globais (`styles/`).
- `src/modules/` — módulos de negócio (vazio com `.gitkeep` na Fase 01; cada módulo criado a partir da Fase 02 contém apenas as camadas necessárias, sem pastas vazias artificiais, expondo contratos públicos via `src/modules/<module>/index.ts`).
- `src/shared/` — **obrigatoriamente segmentado em 3 subcamadas de pureza** para impedir vazamento de frameworks para o domínio:
  1. **`shared-kernel` (100% puro — importável por `domain`):** `src/shared/errors/**` (e futuramente `src/shared/kernel/**` na Fase 02). Proibido de importar React, `react-intl`, Zod, Dexie, MSW, `import.meta.env` ou `src/shared/ui`. Na Fase 01 contém apenas `AppError`, os 5 códigos de `permission-matrix.md` §10 (`AUTHENTICATION_ERROR`, `AUTHORIZATION_ERROR`, `NOT_FOUND`, `CONFLICT`, `VALIDATION_ERROR`), códigos técnicos transversais (`INFRASTRUCTURE_ERROR`, `UNEXPECTED_ERROR`) e normalização segura sem textos traduzidos.
  2. **`shared-infra` (runtime/infraestrutura — proibido em `domain`):** `src/shared/config/**` (`env.ts` com validação Zod proibindo segredos em `VITE_*`) e `src/shared/logging/**` (logger estruturado com redação de campos sensíveis em memória/console na Fase 01; persistência com retenção de 30 dias pertence às Fases 03 e 13).
  3. **`shared-ui` (apresentação — permitido apenas em `presentation` e `app`):** `src/shared/ui/**` (`cn.ts`, `ErrorBoundary`, primitivos mínimos `shadcn/ui`) e `src/shared/i18n/**` (mensagens `pt-BR`, provider `react-intl` e mapeamento `AppErrorCode -> chave i18n`).
- `src/test/setup.ts` — setup compartilhado de Vitest/RTL; testes unitários e de componentes são co-localizados (`*.test.ts`, `*.test.tsx`); testes E2E Playwright residem em `e2e/`.

### 4. Convenção de Path Alias

Adotar um único alias canônico em `tsconfig.app.json`, `vite.config.ts`, `vitest.config.ts`, `components.json` e `eslint.config.js`:

- **`@/* -> ./src/*`**

### 5. Enforcement Automatizado de Fronteiras Arquiteturais (3 Camadas ESLint)

O `eslint.config.js` (ESLint 9 Flat Config) aplicará 3 camadas complementares de proteção:

1. **Fronteiras estruturais (`eslint-plugin-boundaries` v5+, com fallback documentado para `import-x/no-restricted-paths`):**
   - Elementos: `app-composition` (`src/app/composition/**`), `app-shell` (`src/app/**` exceto `composition/`), `module-domain` (`src/modules/*/domain/**`), `module-application` (`src/modules/*/application/**`), `module-infrastructure` (`src/modules/*/infrastructure/**`), `module-presentation` (`src/modules/*/presentation/**`), `module-public-api` (`src/modules/*/index.ts`), `shared-kernel` (`src/shared/errors/**`, `src/shared/kernel/**`), `shared-infra` (`src/shared/config/**`, `src/shared/logging/**`), `shared-ui` (`src/shared/ui/**`, `src/shared/i18n/**`).
   - Regras de dependência:
     - `shared-kernel` -> somente `shared-kernel`.
     - `shared-infra` -> `shared-kernel`, `shared-infra`.
     - `shared-ui` -> `shared-kernel`, `shared-infra`, `shared-ui`.
     - `module-domain` -> `module-domain` (mesmo módulo) e `shared-kernel`.
     - `module-application` -> `module-domain` (mesmo módulo), `module-application` (mesmo módulo), `module-public-api` (outros módulos), `shared-kernel`, `shared-infra`.
     - `module-infrastructure` -> `module-domain` (mesmo módulo), `module-application` (mesmo módulo), `module-infrastructure` (mesmo módulo), `shared-kernel`, `shared-infra`.
     - `module-presentation` -> `module-application` (mesmo módulo), `module-presentation` (mesmo módulo), `module-public-api` (outros módulos), `shared-kernel`, `shared-ui`. **Proibido importar `module-infrastructure` e internos de outros módulos.**
     - `app-shell` -> `app-shell`, `app-composition`, `module-presentation`, `module-public-api`, `shared-kernel`, `shared-infra`, `shared-ui`. **Proibido importar `module-infrastructure` diretamente.**
     - `app-composition` -> único ponto autorizado a conectar `module-infrastructure` às portas de `module-application` e `shared-infra`.
2. **Bloqueio de bibliotecas externas por camada (`no-restricted-imports` por `files`):**
   - Em `src/modules/*/domain/**` e `src/shared/errors/**` (`src/shared/kernel/**`): proibido importar `react`, `react-dom`, `react-router`, `react-intl`, `dexie`, `msw`, `msw/*`, `@dnd-kit/*`, `recharts`, `@tabler/icons-react`.
   - Em `src/modules/*/presentation/**`, `src/app/layout/**`, `src/app/router/**`, `src/shared/ui/**`: proibido importar `dexie`, `msw`, `msw/*`.
3. **Detecção de ciclos e higiene de tipos (`eslint-plugin-import-x` + `typescript-eslint` + `eslint-plugin-jsx-a11y`):**
   - `import-x/no-cycle: ["error", { "maxDepth": "Infinity" }]`
   - `@typescript-eslint/no-explicit-any: "error"`
   - `@typescript-eslint/consistent-type-imports: "error"`
   - Regras de acessibilidade `jsx-a11y` habilitadas para componentes React.

Além da configuração, a Fase 01 exige **teste automatizado negativo** (via API `ESLint` em memória no Vitest) comprovando que violações arquiteturais disparam erro real de lint.

### 6. Estratégia Base de CSP e Headers de Segurança (`SECURITY.md`)

- A política CSP e os headers de segurança (`Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options: DENY`) são aplicados primariamente nos **HTTP Response Headers de `vercel.json`**, onde diretivas como `frame-ancestors 'none'` são suportadas.
- A CSP de produção já prevê `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`, `worker-src 'self'` (compatível com MSW na Fase 03 e PWA na Fase 13) e `img-src 'self' data: blob:`.
- **Não** inserir `<meta http-equiv="Content-Security-Policy">` estática restritiva em `index.html` que quebre o Vite Dev Server (HMR/preamble React). Tanto `pnpm dev` quanto `pnpm build` + `pnpm preview` devem permanecer funcionais.
- Reafirma-se `SECURITY.md`: CSP e validações locais reduzem riscos de XSS/clickjacking no protótipo, mas não substituem controles de segurança de backend real.

## Alternativas Consideradas

1. **Mover `PMS_Documentacao/*` para a raiz do repositório:** descartada por quebrar links relativos internos já consolidados e referências dos agentes, além de misturar documentação congelada com arquivos de configuração do projeto.
2. **Criar uma pasta `ADR/` separada na raiz mantendo `ADR-0001..0003` em `PMS_Documentacao/ADR/`:** descartada por fragmentar o histórico de decisões arquiteturais em dois diretórios.
3. **Permitir que `domain` importe qualquer arquivo de `src/shared/`:** descartada por abrir brecha para acoplamento indireto do domínio a React (`shared/ui`, `shared/i18n`) ou Vite (`shared/config`).
4. **Aplicar CSP estática restritiva via `<meta>` em `index.html`:** descartada por incompatibilidade com Vite HMR em desenvolvimento e falta de suporte da tag `<meta>` a `frame-ancestors`.

## Consequências

- **Positivas:** fonte única de verdade preservada; fronteiras de `ADR-0001` garantidas mecanicamente no CI com validação negativa; paralelismo seguro entre agentes por propriedade exclusiva de arquivos; zero atrito entre CSP e fluxo de desenvolvimento local.
- **Trade-offs:** exige disciplina ao adicionar novas pastas em `src/shared/` (toda nova pasta precisa ser classificada explicitamente como `shared-kernel`, `shared-infra` ou `shared-ui` no `eslint.config.js`).
