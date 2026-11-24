# Relatório de Evidências e Homologação — Fase 07

- **Projeto:** Project Management System (PMS) — Protótipo Frontend Local
- **Fase:** `07 — Tarefas, Subtarefas, Dependências e Impedimentos`
- **Orquestrador responsável:** PMS Orchestrator
- **Branch base e de entrega:** `main` (integrações via `--no-ff` a partir de `4524c03`)
- **HEAD técnico homologado pelos 3 gates:** `89e45c7` (`merge: integrate F07-T09 TASK_HISTORY_VIEW restoration, MIME UI test and contract sync`)
- **Data de homologação:** 2026-11-23 / 2026-11-24
- **Status final da Fase 07:** **APROVADA** (`0` achados `BLOQUEANTE`, `ALTO`, `MÉDIO`, `BAIXO` ou `OBSERVAÇÃO` nos 3 gates finais sobre `89e45c7`)

---

## 1. Resumo Executivo

A Fase 07 entregou a arquitetura, os serviços de aplicação, a persistência em Dexie (`Schema v2` com `51` tabelas preservadas), os endpoints simulados MSW (§10 de `api-endpoints.md`), o dicionário `pt-BR`, as páginas lazy e subpainéis acessíveis (WCAG 2.2 AA) de **Tarefas (`Task`), Participantes (`TaskParticipant`), Subtarefas de 1 nível (`Subtask`), Pausas (`TaskPause`), Ciclos de Execução (`TaskExecutionCycle`), Histórico de Prazos (`TaskDeadlineHistoryEntry`), Comentários (`TaskComment`), Anexos Binários (`TaskAttachment` + `AttachmentBlobPayload`), Etiquetas (`Tag`), Dependências Acíclicas (`TaskDependency`) e Impedimentos (`Impediment`)**, além da resolução integral dos 4 endurecimentos herdados da Fase 06 (`reports/fase-06-evidencias.md` §4.1).

Seguindo estritamente o protocolo de governança em `main`, o primeiro ciclo de revisão (`F07-T06` sobre `677bda7`) e sua primeira revalidação (`e08f334`) identificaram pontos de segurança e contrato tratados de forma cirúrgica nas ondas de endurecimento `F07-T08` (`ce7a9be`) e `F07-T09` (`b329118`). Na revalidação final sobre o commit `89e45c7`, os 3 gates independentes (**Segurança**, **Arquitetura** e **Revisor Independente**) emitiram parecer unânime **`APROVADO`** com **zero achados em todas as severidades**, e todos os **8 checks obrigatórios** passaram com `exit code 0`.

---

## 2. Rastreabilidade de Subtarefas, Branches e Commits Integrados (`--no-ff`)

| Tarefa | Papel Responsável | Branch Isolada | Commit da Entrega | Commit Merge (`main`) | Escopo Principal |
| --- | --- | --- | --- | --- | --- |
| `F07-T00` | Arquiteto de Software | *(leitura em `4524c03`)* | — | — | Plano arquitetural (`18` diretivas e `2` decisões normativas: `deleteTask` e `Tag`) |
| `F07-T01` | Arquiteto de Software | `docs/F07-T01-adr0011-eslint-dag-and-policy-sync` | `4a6d6fc` | `26c4a02` | `ADR-0011`, `INDEX.md` (`39` docs), regras `disallow` DAG no `eslint.config.js`, `PendingPermissionDefaults` + simetria `MANAGER` no `policy-engine.ts` |
| `F07-T02` | Engenheiro Persistência | `feature/F07-T02-tasks-dependencies-impediments-services-msw` | `02f46d7` | `8133500` | `TaskService`, `DependencyService`, `ImpedimentService`, `task-ports-adapter.ts`, repositórios, endurecimentos Kanban 1 e 2, handlers MSW e `api-endpoints.md` §10 |
| `F07-T03` | Engenheiro Frontend | `feature/F07-T03-tasks-i18n-and-phase06-ui-fixes` | `afb6361` | `a286981` | Expansão tipada de `pt-BR.ts`, endurecimentos UI 3 e 4 (`kanban-board-panel.tsx`, `projects-panel.tsx`) e links de detalhes fora da alça DnD |
| `F07-T04` | Engenheiro Frontend | `feature/F07-T04-tasks-dependencies-impediments-pages` | `5dfe80d` | `ea3a8d4` | Painéis modulares (`tasks`, `dependencies`, `impediments`), `ModalDialog`, páginas lazy `/projects/:projectId/tasks` e `:taskId`, propagação ABAC completa e suíte UI/E2E inicial |
| `F07-T05` | Engenheiro de QA | `test/F07-T05-tasks-subtasks-deps-impediments-tests` | `425c998` | `677bda7` | Auditoria e expansão de cobertura Dexie, MSW, RTL/`vitest-axe` (`0` violações) e Playwright Chromium E2E |
| `F07-T08` | Engenheiro Persistência | `fix/F07-T08-attachment-mime-and-trash-view-parity` | `ce7a9be` | `e08f334` | Endurecimento pós-gate: `DISALLOWED_ATTACHMENT_MIME_TYPES` em `@/shared/kernel` (`M-01`) e paridade inicial `TRASH_VIEW` (`B-01`) |
| `F07-T09` | Engenheiro Persistência | `fix/F07-T09-task-history-view-and-mime-ui-test` | `b329118` | `89e45c7` | Restauração `TASK_HISTORY_VIEW` vs `TRASH_VIEW` em `listTaskDeadlineHistory`/`getTaskDetail`/`task-page-helpers.ts` (`F07-T08-R1`/`ALTO-01`), teste UI MIME (`BAIXO-01`) e sincronia `api-endpoints.md`/`ADR-0011` (`OBSERVAÇÃO-01`) |
| `F07-T06` | Segurança, Arquiteto, Revisor | *(auditoria read-only sobre `89e45c7`)* | — | — | Revalidação final dos 3 gates e execução independente dos 8 checks obrigatórios |
| `F07-T07` | PMS Orchestrator | `docs/F07-T07-phase-07-evidence-report` | *(esta entrega)* | *(merge `--no-ff` em `main`)* | Registro formal de evidências e homologação da Fase 07 em `reports/fase-07-evidencias.md` |

---

## 3. Evidências Objetivas dos 8 Checks Obrigatórios (Revisor Independente em `89e45c7`)

Executados integralmente pelo subagente Revisor Independente (`314407d1`) em modo somente leitura sobre o `HEAD` consolidado da branch `main` (`89e45c7`):

| # | Verificação / Comando | Exit Code | Resultado Observado |
| ---: | --- | :---: | --- |
| 1 | `git status --short` | `0` | Saída vazia (`0` alterações — working tree 100% limpa antes e após os checks) |
| 2 | `git log --oneline -n 16` | `0` | Topo em `89e45c7` (`F07-T09`) com histórico completo de merges `--no-ff` até `c55f69f` (`F06-T07`) |
| 3 | `pnpm.cmd typecheck` | `0` | `tsc -b --noEmit` — `0` erros |
| 4 | `pnpm.cmd lint` | `0` | `eslint .` — `0` erros, `0` warnings (inclui regras mecânicas DAG em `eslint.config.js`) |
| 5 | `pnpm.cmd format:check` | `0` | `prettier --check .` — `All matched files use Prettier code style!` |
| 6 | `pnpm.cmd test` | `0` | Vitest `v3.2.7`: **`Test Files 30 passed (30)` \| `Tests 216 passed (216)`** (`0` falhas, `0` skipped, `Duration 54.94s`; inclui `vitest-axe` com `0` violações e `architecture-boundaries.test.ts` `16/16`) |
| 7 | `pnpm.cmd build` | `0` | `tsc -b && vite build` (`vite v6.4.6`): **`7082 modules transformed`**, **`40` artefatos emitidos em `dist/`** (`built in 14.03s`, chunks lazy `project-tasks-page` e `task-detail-page-t489euGH.js` `34.74 kB`) |
| 8 | `pnpm.cmd test:e2e` | `0` | Playwright Chromium (`5 workers`): **`5 passed (9.2s)`** (`foundation-smoke.spec.ts` `1.9s`, `auth-and-organizations.spec.ts` `2.7s`, `invitations-teams-permissions.spec.ts` `3.4s`, `projects-and-kanban.spec.ts` `4.0s`, `tasks-dependencies-impediments.spec.ts` `5.7s`) |

---

## 4. Pareceres dos 3 Gates Independentes (`F07-T06` pós-`F07-T09` em `89e45c7`)

| Gate | Subagente | Parecer | `BLOQUEANTE` | `ALTO` | `MÉDIO` | `BAIXO` | `OBSERVAÇÃO` | Principais Evidências Auditadas |
| --- | --- | --- | :---: | :---: | :---: | :---: | :---: | --- |
| Segurança | `70fbaf8a` | **`APROVADO`** | `0` | `0` | `0` | `0` | `0` | `resolveTaskReadAction` (`TASK_VIEW` / `TASK_HISTORY_VIEW` vs `TRASH_VIEW`, fail-closed `409` em projeto excluído), denylist canônica `DISALLOWED_ATTACHMENT_MIME_TYPES` no kernel/serviço/MSW/UI + `vitest-axe` (`OBS-04` encerrada), `deleteTask` `TASK_CANCEL` + `revokeAllByScope`, `Tag` `ADMIN`-only vs `TASK_UPDATE`, `DEPENDENCY_VIEW` `relatedTasksAccessible`, Cenário 6 e simetria `MANAGER` participante, reafirmando limites do protótipo local (`SECURITY.md`) |
| Arquitetura | `d6504f25` | **`APROVADO`** | `0` | `0` | `0` | `0` | `0` | Zero novas deps NPM (`package.json` / `pnpm-lock.yaml` intactos), Schema Dexie `v2` (`51` stores intactas), módulo-folha `authorization`, DAG acíclico protegido no `eslint.config.js` + adaptadores locais `task-ports-adapter.ts`, prevenção de `PrematureCommitError` (SHA-256 fora de `TransactionPort.run`), separação `lastMovedAt` vs `lastActivityAt`, ciclos e prazos append-only, e sincronia documental integral entre `api-endpoints.md` §10 e `ADR-0011` |
| Revisor Independente | `314407d1` | **`APROVADO`** | `0` | `0` | `0` | `0` | `0` | Encerramento de `ALTO-01`, `BAIXO-01` e `OBSERVAÇÃO-01`, `0` usos de `any`/`@ts-ignore`/`eslint-disable`/`console.log`/`.skip`/`window.confirm`, WCAG 2.2 AA + `pt-BR.ts`, todos os 8 checks com `exit code 0` |

---

## 5. Encerramento dos 4 Endurecimentos Herdados da Fase 06 (`ADR-0011` §10.1)

1. **`TASK_ASSIGN` em `KanbanService.createQuickCard` (`kanban-service.ts`):** exige `PERMISSION_CODES.TASK_ASSIGN` com contexto ABAC completo sempre que `validatedAssigneeId !== validatedActorId`.
2. **Guarda de coluna destino arquivada em `assertColumnCanBeDeleted` / `KanbanService.deleteColumn` (`board.ts`, `kanban-service.ts`):** rejeita `migrationTargetColumn` arquivada (`archivedAt !== undefined`) inclusive quando `activeTaskCount === 0` (apenas tarefas soft-deleted).
3. **Cópia distinta no diálogo inline de exceção Kanban (`kanban-board-panel.tsx`, `pt-BR.ts`):** títulos, descrições e rótulos próprios para `PAUSED_OVERRIDE`, `DEPENDENCY_OVERRIDE`, `REOPEN_REASON` e `WIP_OVERRIDE`, com foco inicial e `Escape`.
4. **Simetria de `"Abrir quadro Kanban"` na lista de Projetos (`projects-panel.tsx`, `projects-page.tsx`):** exibição nos itens da lista lateral condicionada à mesma regra `BOARD_VIEW` (`canOpenBoardByProjectId`) aplicada ao painel de detalhe.

---

## 6. Invariantes e Registros para Fases Futuras (Backlog Não-Bloqueante)

- **Invariantes preservados durante toda a Fase 07:** zero dependências NPM adicionadas (`package.json` e `pnpm-lock.yaml` inalterados), zero alteração em `src/shared/persistence/pms-database.ts` (Schema Dexie `v2`, `51` stores) e zero acoplamento com domínios de Fase 08+ (`focus`, `bottlenecks`, `notifications`, lixeira unificada global).
- **Notas técnicas registradas para melhoria contínua em fases posteriores (sem impacto na homologação da Fase 07):**
  1. Quando `SettingsService` e configurações de allowlist MIME forem introduzidos (Fase 12), migrar as leituras de `repositories.settings.organizationSettings` nas páginas/provider (`permission-provider.tsx`, `project-tasks-page.tsx`, `task-detail-page.tsx`) para serviço dedicado e avaliar `allowedMimeTypes` configurável.
  2. Avaliar particionamento de bundle Vite (`manualChunks`) em fase de otimização final (Fase 13) para reduzir o aviso informativo do chunk principal (`dist/assets/index-d1Pr_6rR.js`, `939.09 kB`), já que os chunks lazy da Fase 07 já são emitidos separadamente.
  3. Avaliar oportunamente injeção uniforme de `policyConfig` em operações de coluna do `KanbanService` e defesa em profundidade de MIME diretamente nos adaptadores de `AttachmentBlobStorePort`.

---

## 7. Limites Explícitos do Protótipo Local

Conforme `PMS_Documentacao/SECURITY.md`, este projeto opera como **protótipo frontend local** com `IndexedDB` (Dexie) e simulação HTTP via **MSW** no navegador. Os controles RBAC+ABAC, denylist de MIME, CSP (`vercel.json`) e auditoria previnem regressões lógicas e XSS no cliente, mas **não substituem** validação/varredura binária server-side, gestão de sessão em cookies `HttpOnly/Secure/SameSite`, isolamento multiusuário real em servidor nem armazenamento remoto de anexos em ambiente de produção.
