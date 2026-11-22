# Relatório de Evidências e Encerramento — Fase 06: Projetos, Participantes e Kanban

- **Fase:** 06 — Projetos, participantes e Kanban (`PMS_Documentacao/PHASES.md`)
- **Data:** 2026-11-22
- **Orquestrador:** PMS Orchestrator
- **Branch principal integrada:** `main` (commit técnico `755052d`, precedido por 5 integrações `--no-ff` de branches isoladas a partir do fechamento da Fase 05 em `d8fb6a7`)
- **Status do Gate Técnico:** **APROVADO** (Arquiteto: `APROVADO` | Segurança: `APROVADO` | Revisor Independente: `APROVADO` — `0 BLOQUEANTE`, `0 ALTO`, `0 MÉDIO`)
- **Status de Homologação Humana:** **Aguardando aprovação explícita do usuário** (`git push` e avanço para a Fase 07 bloqueados até aprovação)

---

## 1. Resumo Executivo

A Fase 06 entregou os fluxos completos de **Projetos, Participantes de Projeto (`MANAGER` / `PARTICIPANT`), Transferência entre Equipes, Arquivamento/Restauração/Exclusão Lógica Segura, Exportação JSON Autorizada e Quadro Kanban Principal** (criação, edição, reordenação, arquivamento/restauração e exclusão com migração de colunas; cálculo real de WIP e exceção justificada/auditada via `BOARD_WIP_MANAGE`; movimentação de cartões via `@dnd-kit` restrito à camada `presentation/` com suporte a ponteiro, teclado e controles alternativos acessíveis; região viva `aria-live="polite"`; sincronização de entrada/saída da coluna `FINAL`; criação mínima `createQuickCard`), além de encerrar todos os débitos preventivos herdados da Fase 05.

Todas as regras de negócio foram centralizadas em `ProjectService` e `KanbanService` com persistência atômica no **Schema Dexie v2 (`51` tabelas, zero migração)**, DAG acíclico entre módulos (`ProjectTeamLookupPort`, `ProjectBoardInitializerPort` e direção única `kanban -> projects`, preservando o módulo-folha `authorization`), eliminação completa dos helpers legados do MSW (`resolveAuthorizationActor`/`authorizeOrThrow`) com catálogo `api-endpoints.md` §9, e instalação limpa de `@dnd-kit/core@6.3.1`, `@dnd-kit/sortable@10.0.0` e `@dnd-kit/utilities@3.2.2` sobre `react@18.3.1` sem `pnpm.overrides` e sem peer warnings.

---

## 2. Equipe Multiagente e Tarefas Executadas

| ID | Agente | Branch isolada | Merge `main` | Escopo entregue | Parecer / Status |
|---|---|---|---|---|---|
| **F06-T00** | Arquiteto | — *(somente leitura)* | — | Revisão arquitetural pré-implementação do desenho da Fase 06 (12 diretivas incorporadas em `fase-06-plano-tecnico.md`) | Aprovada com ressalvas *(incorporadas)* |
| **F06-T01** | Arquiteto | `feature/F06-T01-dndkit-deps-and-adr0010` (`033a99f`) | `2099855` | Instalação `@dnd-kit/core@^6.3.1`, `@dnd-kit/sortable@^10.0.0`, `@dnd-kit/utilities@^3.2.2` (0 warnings, sem `overrides`), `ADR-0010` e `PMS_Documentacao/INDEX.md` (`38` documentos indexados) | Integrada |
| **F06-T02** | Persistência | `feature/F06-T02-projects-kanban-services-and-msw` (`ed9a7ef`, `3285c5a`) | `19490ce` | `TaskRepositoryPort.saveMany`/`listByColumn({ includeDeleted })`, `ProjectMemberRepositoryPort.saveMany`, `ProjectTeamLookupPort` / `ProjectBoardInitializerPort` + `project-ports-adapter.ts`, `ProjectService`, `KanbanService`, `TeamDetails.activeProjectCount`, migração integral MSW + remoção de helpers legados, `api-endpoints.md` §9 e alinhamento `ADR-0010` §5.7 | Integrada |
| **F06-T03** | Frontend | `feature/F06-T03-projects-nav-shell-and-debt-fixes` (`34cf032`) | `7872feb` | Catálogo `pt-BR.ts` Fase 06, link `Projetos` em `AppShell`, exibição `activeProjectCount` em `TeamsPanel`, `projectScopes` em `PermissionsPage`/`PermissionsPanel`, extração de `AcceptInvitationPanel` eliminando `<h1>` dentro de `<h2>` e atualização do teste de apresentação Fase 05 | Integrada |
| **F06-T04** | Frontend | `feature/F06-T04-projects-and-kanban-pages` (`68317f2`) | `424ca28` | Painéis puros (`projects-panel.tsx`, `project-participants-panel.tsx`, `kanban-board-panel.tsx`, `kanban-sortable-column.tsx`, `kanban-sortable-card.tsx` com `@dnd-kit/*`), páginas lazy `/projects` e `/projects/:projectId/board`, WCAG 2.2 AA (`44x44px`, `aria-live="polite"`, `role="alert"`), `vitest-axe` e spec E2E inicial | Integrada |
| **F06-T05** | QA | `test/F06-T05-projects-and-kanban-test-suite` (`682a436`) | `755052d` | Auditoria e expansão completa da matriz RBAC+ABAC/integracional (`fake-indexeddb`), acessibilidade `vitest-axe` e fluxo E2E Playwright Chromium para Projetos, Participantes e Quadro Kanban | Integrada (**177/177 + 4/4 E2E verdes**) |
| **Gate Arquiteto** | Arquiteto | — *(somente leitura)* | — | Auditoria arquitetural final sobre `755052d` (`d8fb6a7..755052d`, 40 arquivos) | **`APROVADO`** (`0 BLOQUEANTE/ALTO/MÉDIO`, `1 BAIXO`, `3 OBSERVAÇÃO`) |
| **Gate Segurança** | Segurança | — *(somente leitura)* | — | Auditoria RBAC+ABAC, isolamento multi-org, MSW e apresentação sobre `755052d` | **`APROVADO`** (`0 BLOQUEANTE/ALTO/MÉDIO`, `1 BAIXO`, `2 OBSERVAÇÃO`) |
| **F06-T06** | Revisor | — *(somente leitura)* | — | Auditoria técnica consolidada (`d8fb6a7..755052d`, `+13673/-566`) e reexecução dos 8 checks obrigatórios | **`APROVADO`** (`0 BLOQUEANTE/ALTO/MÉDIO`, `2 BAIXO`, `4 OBSERVAÇÃO`) |

---

## 3. Evidências Reais de Execução (Revalidadas pelo Revisor Independente no Commit `755052d`)

| Verificação | Comando executado | Exit Code | Duração Observada | Resultado numérico / Evidência observada |
|---|---|---|---|---|
| Integridade lockfile | `pnpm.cmd install --frozen-lockfile` | `0` | `5.45s` | `Lockfile is up to date`, `Already up to date`; `0` warnings de `peerDependencies` (`@dnd-kit/core@6.3.1`, `@dnd-kit/sortable@10.0.0`, `@dnd-kit/utilities@3.2.2`) |
| TypeScript Strict | `pnpm.cmd typecheck` | `0` | `10.31s` | `tsc -b --noEmit` — **0 erros** |
| ESLint + Fronteiras + Ciclos | `pnpm.cmd lint` | `0` | `29.33s` | `eslint .` — **0 erros e 0 warnings** (DAG acíclico, módulo-folha `authorization` e `@dnd-kit/*` restrito à `presentation/` confirmados) |
| Formatação | `pnpm.cmd format:check` | `0` | `5.77s` | `prettier --check .` — `All matched files use Prettier code style!` |
| Suíte Unitária, Integração, A11y e Fronteiras | `pnpm.cmd test` | `0` | `37.67s` | Vitest — **25/25 arquivos aprovados \| 177/177 testes aprovados \| 0 falhas \| 0 skips** |
| Build de Produção | `pnpm.cmd build` | `0` | `33.71s` | `tsc -b && vite build` — **7058 módulos transformados**; chunks lazy: `projects-page-DbK68PZS.js` (`35.23 kB` \| gzip `7.36 kB`), `project-board-page-DxMYu7AH.js` (`91.15 kB` \| gzip `25.50 kB`), `index-D-7eIMAN.js` (`808.82 kB` \| gzip `223.91 kB`) |
| Testes E2E | `pnpm.cmd test:e2e` | `0` | `9.76s` | Playwright (Chromium) — **4/4 specs aprovados**: `foundation-smoke.spec.ts` (`1.8s`), `auth-and-organizations.spec.ts` (`2.8s`), `invitations-teams-permissions.spec.ts` (`3.7s`), `projects-and-kanban.spec.ts` (`4.2s`) |
| Higiene do repositório | `git status -u -s` | `0` | `0.15s` | Saída vazia (working tree 100% limpa em `755052d`) |

### Novas Suítes e Coberturas da Fase 06

1. `src/modules/projects/application/use-cases/project-service.integration.test.ts` (**7/7 passed** — criação atômica + `Quadro Principal` + 4 colunas + 1 `AuditEvent`, `TeamDetails.activeProjectCount`, escopo `MANAGER` e bloqueio de equipe arquivada/excluída, `updateProject` `.strict()` rejeitando `teamId`, `transferProjectTeam`, `archiveProject`/`restoreProject`/`deleteProject` com encerramento em lote e `revokeAllByScope`, proteção a `ownerUserId` e último `MANAGER`, reativação reutilizando `existing.id`, bloqueio de remoção por `assigneeId` ou `TaskParticipant` pendente + `revokeByScope`, `exportProjectData` filtrado por `TASK_VIEW` sem segredos, `DexieTaskRepository.saveMany`/`listByColumn({ includeDeleted })`, isolamento cross-org, expiração de grant e *Deny Overrides*).
2. `src/modules/kanban/application/use-cases/kanban-service.integration.test.ts` (**7/7 passed** — cálculo `occupyingTaskCount` incluindo `BLOCKED` e `PAUSED` e excluindo `DONE`/`CANCELLED`/soft-deleted, filtragem `TASK_VIEW` na leitura, bloqueio em projeto arquivado para mutações, `BOARD_WIP_MANAGE` em edição de coluna e exceção WIP com justificativa + `AuditEvent`, `ExplicitDenyRule` bloqueando movimentação, permutação exata em `reorderColumns`, `archiveColumn`/`deleteColumn` migrando ativas e soft-deleted e respeitando `assertValidBoardColumns`, `createQuickCard` com `OrganizationSettings`, entrada/saída de coluna `FINAL` (`assertTaskCanBeCompleted` com subtarefa/dependência/impedimento e `TASK_REOPEN` criando novo `TaskExecutionCycle`), bloqueio `CANCELLED`, distinção `lastMovedAt` vs `lastActivityAt` (`PRD.md` §12.1) e isolamento cross-org).
3. `src/app/composition/projects-kanban-msw.integration.test.ts` (**2/2 passed** — ciclo HTTP completo via `HttpClient -> MSW -> Dexie` para todos os novos endpoints §9 de `api-endpoints.md`, incluindo erro `422` ao enviar `teamId` no `PATCH`, `/transfer`, `/export`, `/participants`, `/archive`/`/restore`, `DELETE` restrito a `ADMIN`, `/board`, `/board/columns*`, `/cards` e `/cards/:taskId/move`).
4. `src/app/router/projects-and-kanban.presentation.test.tsx` (**2/2 passed** com `vitest-axe` 0 violações e 0 avisos `validateDOMNesting` — navegação `/projects` e `/projects/:projectId/board` como `ADMIN` e `MEMBER`, validação inline acessível, remoção bloqueada por tarefas pendentes, exportação JSON via `Blob`, criação de coluna e cartão rápido, WIP override inline + erro `noPermissionError`, anúncios em `aria-live="polite"` para cartão e reordenação de coluna, exclusão/migração inline de coluna, visão restrita `MEMBER` sem gestão estrutural, rota inválida e banner `kanban.archivedLockBanner` em projeto arquivado).
5. `e2e/projects-and-kanban.spec.ts` (**1/1 Chromium passed** — login demo `ADMIN`, `/projects`, criação de projeto e adição de participante, abertura de `/projects/:id/board`, criação de coluna WIP=1 e 2 cartões rápidos, movimentação 1/1 e WIP override 2/1 com justificativa, retorno e arquivamento de projeto, validação do bloqueio permanente `kanban.archivedLockBanner` ao reabrir o quadro arquivado em Chromium real e restauração final).
6. **Débitos da Fase 05 encerrados e validados (`F06-T03` + `F06-T06`):** `src/app/router/invitations-teams-permissions.presentation.test.tsx` (**6/6 passed** com link `Projetos`, `activeProjectCount` em `TeamsPanel`, `<select>` assistido `projectScopes` em `PermissionsPanel`, `AcceptInvitationPanel` extraído sem `<h1>` dentro de `<h2>` e `0` violações `vitest-axe`) e `src/test/architecture-boundaries.test.ts` (**14/14 passed**).

---

## 4. Achados Menores e Melhorias Preventivas Registradas para a Fase 07 (Não Bloqueantes)

1. **Endurecimentos menores identificados nos gates da Fase 06 (`BAIXO` — não bloqueantes):**
   - **Checagem de `TASK_ASSIGN` em `createQuickCard` (`F06-Gate-Seguranca` #1):** em `src/modules/kanban/application/use-cases/kanban-service.ts:1954-1967`, validar `PERMISSION_CODES.TASK_ASSIGN` quando `input.assigneeId` for atribuído a terceiro (`validatedAssigneeId !== validatedActorId`). Mitigado na Fase 06 por *Default Deny* (`allowMemberCreateTaskWithoutGrant: false`) e pelo formulário de cartão rápido da UI não enviar `assigneeId`; obrigatório no `TaskService.createTask` e `createQuickCard` na Fase 07.
   - **Guarda de coluna destino explícita arquivada em `deleteColumn` com `0` tarefas ativas (`F06-Gate-Arquiteto` #1):** em `src/modules/kanban/domain/board.ts:145-183` e `kanban-service.ts:1320-1364`, se `migrationTargetColumnId` for passado via API mesmo quando houver apenas tarefas `soft-deleted` (`activeTaskCount === 0`), validar `targetColumn.archivedAt === undefined` antes da migração.
   - **Clareza textual do diálogo de exceção pausada/dependência e simetria do botão de quadro (`F06-T06` #1 e #2):** diferenciar título/label do diálogo inline em `src/modules/kanban/presentation/kanban-board-panel.tsx:687-718` quando `pendingException.kind` for `'PAUSED_OVERRIDE'` ou `'DEPENDENCY_OVERRIDE'` (sem reutilizar cabeçalho de WIP), e alinhar visibilidade do botão `"Abrir quadro Kanban"` na lista lateral de `src/modules/projects/presentation/projects-panel.tsx:888-896` com `canOpenSelectedProjectBoard` (`BOARD_VIEW`).
2. **Preparação arquitetural explícita para a Fase 07 (*Tarefas, subtarefas, dependências e impedimentos*):**
   - **Blindagem mecânica no `eslint.config.js` (`F06-Gate-Arquiteto` OBS-02):** adicionar regras `disallow` explícitas proibindo `src/modules/tasks/**` de importar diretamente `@/modules/projects` ou `@/modules/kanban` (`ADR-0010` §3.4) e `src/modules/projects/**` de importar `@/modules/teams` ou `@/modules/kanban`.
   - **Portas locais para `TaskService`, `DependencyService` e `ImpedimentService` (`F06-Gate-Arquiteto` OBS-03):** definir `TaskProjectContextPort` (ou equivalente) em `src/modules/tasks/application/ports/` adaptada em `src/app/composition/` para consultar projeto, `ProjectMember`, quadro/colunas primárias e `OrganizationSettings`, propagando `projectArchivedAt` e `deletedAt` e mantendo a sincronização `columnId` <-> `status`/`completedAt`/`TaskExecutionCycle` e a distinção `lastMovedAt` vs `lastActivityAt` (`PRD.md` §12.1).
   - **Ajustes documentais e de evolução futura:** alinhar a nuance redacional da `ADR-0010` §4.6 (*least privilege* em `exportProjectData` avaliando `BOARD_VIEW` opcionalmente conforme `api-endpoints.md` §9.6), planejar mecanismo de auditoria para tentativas negadas sensíveis nas Fases 07–10 (`permission-matrix.md` §7 passo 10) e avaliar `manualChunks` no `vite.config.ts` para redução do chunk principal (`808.82 kB`).

---

## 5. Checklist de Critérios de Saída da Fase 06

- [x] `@dnd-kit/core@6.3.1`, `@dnd-kit/sortable@10.0.0` e `@dnd-kit/utilities@3.2.2` instalados compatíveis com React `18.3.1` (`0` warnings de `peerDependencies`, `0` `pnpm.overrides`), confinados exclusivamente a `src/modules/kanban/presentation/**`.
- [x] Schema Dexie `v2` (`51` tabelas) preservado sem migração e módulo-folha `src/modules/authorization/**` mantido intacto com DAG acíclico validado.
- [x] `ADR-0010` e `docs/contracts/api-endpoints.md` (§9) atualizados + `PMS_Documentacao/INDEX.md` sincronizado (`38` documentos indexados).
- [x] Fluxos completos de Projetos, Participantes, Quadro Kanban (colunas, WIP, exceções auditadas, movimentação `dnd-kit` + teclado + controles acessíveis, entrada/saída `FINAL`, `createQuickCard`), handlers MSW migrados sem helpers legados e débitos da Fase 05 resolvidos.
- [x] `pnpm.cmd install --frozen-lockfile`, `pnpm.cmd typecheck`, `pnpm.cmd lint`, `pnpm.cmd format:check`, `pnpm.cmd test` (`25/25` suítes, `177/177` testes), `pnpm.cmd build` e `pnpm.cmd test:e2e` (`4/4` Chromium) 100% aprovados em `755052d`.
- [x] Acessibilidade WCAG 2.2 AA verificada (`vitest-axe` zero violações, `0` avisos `validateDOMNesting`).
- [x] Revisões finais de **Arquiteto**, **Segurança** e **Revisor Independente** retornaram **`APROVADO`** (`0` achados `BLOQUEANTE`, `ALTO` ou `MÉDIO`).
- [x] Relatório de evidências gerado (`reports/fase-06-evidencias.md`).
- [ ] **Aprovação explícita do usuário para encerramento da Fase 06, `git push` e abertura da Fase 07.**
