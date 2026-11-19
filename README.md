# Project Management System (PMS)

Protótipo funcional frontend multi-organização para gestão de projetos, equipes e tarefas orientado a Kanban, com Modo Foco, identificação de gargalos, Analytics, feedbacks com SLA/contestações, auditoria, notificações, lixeira e backups locais.

- **Repositório:** [https://github.com/cassiano-souza-jdk/PMS-PW-III](https://github.com/cassiano-souza-jdk/PMS-PW-III)
- **Idioma inicial:** Português brasileiro (`pt-BR`)
- **Licença:** MIT (`LICENSE`)
- **Documentação normativa completa:** [`PMS_Documentacao/INDEX.md`](PMS_Documentacao/INDEX.md) e [`PMS_Documentacao/README.md`](PMS_Documentacao/README.md)

---

## Limitações Explícitas do Protótipo

O PMS é um **protótipo funcional frontend local** que executa persistência em IndexedDB (Dexie) e simulação de transporte HTTP com MSW no navegador:

- **Não** possui backend real, banco de dados remoto ou autenticação/autorização de servidor.
- **Não** oferece sincronização entre dispositivos, entrega real de e-mails ou armazenamento remoto de arquivos.
- **Não** protege dados contra manipulação direta do navegador ou do IndexedDB pelo próprio usuário local.
- **Não** armazena segredos em código cliente nem em variáveis `VITE_*`.

Detalhes completos em [`PMS_Documentacao/SECURITY.md`](PMS_Documentacao/SECURITY.md) e [`PMS_Documentacao/PRD.md`](PMS_Documentacao/PRD.md).

---

## Stack e Arquitetura

- **Arquitetura:** Modular híbrida em camadas (`Presentation -> Application -> Domain`; `Infrastructure` implementa portas via composição) — ver [`ADR-0001`](PMS_Documentacao/ADR/ADR-0001-modular-layered-architecture.md) e [`ADR-0005`](PMS_Documentacao/ADR/ADR-0005-workspace-layout-governance-and-boundaries.md).
- **Stack baseline:** React `18.3.x`, TypeScript strict, Vite `6.x`, Tailwind CSS `3.4.x`, `shadcn/ui`, Tabler Icons, React Router `7.x` (modo SPA), `react-intl`, Zod `3.x`, ESLint `9.x` (flat config com enforcement de fronteiras), Prettier, Vitest `3.x`, React Testing Library e Playwright — ver [`ADR-0004`](PMS_Documentacao/ADR/ADR-0004-frontend-stack-versions-and-tooling.md).
- **Persistência e API simulada (a partir da Fase 03):** Dexie/IndexedDB ([`ADR-0002`](PMS_Documentacao/ADR/ADR-0002-indexeddb-dexie.md)) e MSW ([`ADR-0003`](PMS_Documentacao/ADR/ADR-0003-msw-api-simulation.md)).

---

## Requisitos de Ambiente e Comandos

- **Node.js:** `>=20.19.0` (desenvolvido e validado em Node `24.x`)
- **Gerenciador único:** `pnpm` `>=9.0.0` (`pnpm@9.15.4`)

> **Nota para Windows PowerShell:** caso a `ExecutionPolicy` bloqueie o script `pnpm.ps1`, utilize `pnpm.cmd` no lugar de `pnpm` sem alterar políticas de segurança do sistema operacional.

### Scripts padronizados da Fase 01 (`package.json`)

| Comando (`pnpm` / `pnpm.cmd`) | Finalidade |
|---|---|
| `pnpm install` | Instala dependências conforme `pnpm-lock.yaml` |
| `pnpm dev` | Inicia servidor de desenvolvimento Vite |
| `pnpm typecheck` | Verificação TypeScript estrita (sem emitir artefatos) |
| `pnpm lint` | ESLint (qualidade, `jsx-a11y`, fronteiras arquiteturais e detecção de ciclos) |
| `pnpm format` | Formata o repositório com Prettier |
| `pnpm format:check` | Valida formatação Prettier (modo CI) |
| `pnpm test` | Executa testes unitários, componentes, acessibilidade e fronteiras (Vitest) |
| `pnpm test:watch` | Executa Vitest em modo interativo |
| `pnpm test:e2e` | Executa testes E2E com Playwright |
| `pnpm build` | Gera build de produção Vite em `dist/` |
| `pnpm preview` | Serve o build de produção localmente para validação |

---

## Estrutura do Repositório

- `PMS_Documentacao/` — fonte normativa canônica (PRD, Arquitetura, Domínio, Permissões, Contratos, Fases e ADRs em `PMS_Documentacao/ADR/`).
- `reports/` — relatórios operacionais de fase, evidências de testes e homologação.
- `src/app/` — bootstrap, raiz de composição, layout, providers, rotas e estilos globais.
- `src/modules/` — módulos de negócio (criados incrementalmente a partir da Fase 02, sem pastas vazias artificiais).
- `src/shared/` — abstrações transversais segmentadas por pureza (`errors/`, `config/`, `logging/`, `i18n/`, `ui/`).
- `e2e/` — testes ponta a ponta Playwright.
- `.agents/agents/` — definições da equipe multiagente.
