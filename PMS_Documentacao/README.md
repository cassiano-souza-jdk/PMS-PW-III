# Project Management System (PMS)

## Visão geral

O PMS é um protótipo funcional de gerenciamento de projetos, tarefas e
equipes, orientado a Kanban, com recursos de produtividade, feedback,
contestações, Analytics, auditoria e governança multi-organização.

**Escopo tecnológico:** aplicação frontend React + TypeScript, Vite,
Tailwind CSS, shadcn/ui, Tabler Icons, React Router, React Hook Form,
Zod, Context API, Dexie/IndexedDB, MSW, Vitest, React Testing Library e
Playwright.

O protótipo simula serviços e operações de backend no navegador. Não
oferece autenticação segura de servidor, sincronização entre
dispositivos, entrega real de e-mails, armazenamento remoto ou segurança
contra um usuário que controle o navegador.

## Início rápido

1.  Instale Node.js em versão LTS compatível com as dependências.
2.  Instale pnpm.
3.  Execute `pnpm install`.
4.  Execute `pnpm dev`.
5.  Execute `pnpm typecheck`, `pnpm lint`, `pnpm test` e `pnpm build`.

Os scripts exatos deverão ser definidos na fase 01 e documentados no
`package.json`.

## Documentos normativos

Leia nesta ordem: 1. `AGENTS.md` 2. `AI-AGENTS.md` 3. `PRD.md` 4.
`ARCHITECTURE.md` 5. `DOMAIN.md` 6. `PERMISSIONS.md` 7. `MODULES.md` 8.
`DATA-PERSISTENCE.md` 9. `API-SIMULATION.md` 10. `CODING-STANDARDS.md`
11. `TESTING.md` 12. `SECURITY.md` 13. `ACCESSIBILITY.md` 14.
`PHASES.md` 15. `DEFINITION-OF-DONE.md`

## Estrutura

-   `docs/contracts/`: contratos e interfaces entre módulos.
-   `docs/decisions/`: decisões funcionais e arquiteturais.
-   `docs/modules/`: especificações de módulos.
-   `docs/testing/`: matrizes de teste.
-   `reports/`: relatórios de fase, validação e homologação.
-   `ADR/`: registros de decisões arquiteturais.

## Estado documental

Este pacote representa a especificação consolidada para iniciar o
planejamento técnico e a implementação incremental. Parâmetros
quantitativos identificados como iniciais deverão ser calibrados com
cenários sintéticos, sem alterar fórmulas oficiais silenciosamente.
