# Relatório de Evidências e Homologação — Fase 08

- **Projeto:** Project Management System (PMS) — Protótipo Frontend Local
- **Fase:** `08 — Modo Foco, produtividade e gargalos`
- **Orquestrador responsável:** PMS Orchestrator
- **Branch base e de entrega:** `main` (integrações via `--no-ff` a partir de `85a1ed9`)
- **HEAD técnico homologado pelos 3 gates:** `40f17b6` (`merge: integrate F08-T08 Phase 08 i18n key alignment`)
- **Data de homologação:** 2026-11-24 / 2026-11-25
- **Status final da Fase 08:** **APROVADA** (`APROVADO` unânime nos 3 gates independentes sobre `40f17b6`, com `0` achados `BLOQUEANTE`, `ALTO` ou `MÉDIO`)

---

## 1. Resumo Executivo

A Fase 08 entregou a arquitetura, os serviços de aplicação, os adaptadores anti-ciclo, os handlers MSW (§11 de `api-endpoints.md`), o dicionário `pt-BR`, a navegação contextual e as páginas lazy acessíveis (WCAG 2.2 AA) de **Modo Foco (`focus`)**, **Carga de Trabalho `0–100` (`representsHours: false`)** e **Gargalos Operacionais (`bottlenecks`)**, além do controle administrativo de privacidade `allowManagerViewIndividualProductivity` (`ORGANIZATION_SETTINGS_MANAGE`, *Default Deny* `false`) em `/settings`.

Durante a auditoria de QA (`F08-T05`), foi detectada a discrepância de duas chaves i18n ausentes (`tasks.lastMovedAtLabel` e `tasks.dueDateLabel`), corrigida imediatamente na onda cirúrgica pré-gate `F08-T08` (`c6e7dc2` → `40f17b6`) para reutilizar as chaves canônicas `'tasks.fields.lastMovedLabel'` e `'tasks.fields.dueDateDisplay'`. Em seguida, sobre o commit `40f17b6`, os 3 gates independentes (**Segurança**, **Arquitetura** e **Revisor Independente**) emitiram parecer **`APROVADO`** com zero achados bloqueantes, altos ou médios, e todos os **8 checks obrigatórios** passaram com `exit code 0`.

---

## 2. Rastreabilidade de Subtarefas, Branches e Commits Integrados (`--no-ff`)

| Tarefa | Papel Responsável | Branch Isolada | Commit da Entrega | Commit Merge (`main`) | Escopo Principal |
| --- | --- | --- | --- | --- | --- |
| `F08-T00` | Arquiteto de Software | *(leitura em `85a1ed9`)* | — | — | Estudo de viabilidade (`APROVADO COM RESSALVAS`), fronteira vs Fases 09–13 e 7 decisões normativas (`DN-01`..`DN-07`) |
| `F08-T01` | Arquiteto de Software | `docs/F08-T01-adr0012-eslint-dag-and-policy-sync` | `10ae1e2` | `c9c4101` | `ADR-0012`, `INDEX.md` (`40` docs), regras `disallow` DAG (`focus`, `bottlenecks`) em `eslint.config.js` + `architecture-boundaries.test.ts`, `ProjectBottleneckThresholds` em `@/shared/kernel` e `Project.bottleneckThresholds?` |
| `F08-T02` | Engenheiro Persistência | `feature/F08-T02-focus-bottlenecks-services-msw` | `85241c6` | `c1b85a8` | `FocusService`, `BottleneckService`, portas `FocusWorkContextPort` / `BottleneckWorkContextPort`, `work-intelligence-ports-adapter.ts`, complementos Dexie `v2`, `container.ts`, 12 handlers MSW e `api-endpoints.md` §11 |
| `F08-T03` | Engenheiro Frontend | `feature/F08-T03-focus-bottlenecks-i18n-and-nav` | `9133694` | `7c8a63b` | Expansão tipada de `pt-BR.ts`, links no `AppShell` (`/focus`, `/bottlenecks`) e atalhos contextuais em Projetos e Quadro Kanban sob `BOTTLENECK_VIEW` |
| `F08-T04` | Engenheiro Frontend | `feature/F08-T04-focus-bottlenecks-pages` | `9da0e74` | `3acb2c3` | Painéis modulares WCAG 2.2 AA (`focus/presentation`, `bottlenecks/presentation`, `ProductivityVisibilityCard` em `/settings`), páginas lazy `/focus`, `/bottlenecks`, `/projects/:projectId/bottlenecks` e propagação ABAC completa |
| `F08-T05` | Engenheiro de QA | `test/F08-T05-focus-bottlenecks-tests` | `042c68a` | `5cc27f4` | Suítes de integração Dexie (`focus-service.integration.test.ts`, `bottleneck-service.integration.test.ts`), expansão MSW e RTL/`vitest-axe` (`0` violações), e `e2e/focus-and-bottlenecks.spec.ts` |
| `F08-T08` | PMS Orchestrator | `fix/F08-T08-i18n-key-alignment` | `c6e7dc2` | `40f17b6` | Alinhamento das chaves i18n `tasks.fields.lastMovedLabel` e `tasks.fields.dueDateDisplay` na UI de Gargalos e Modo Foco |
| `F08-T06` | Segurança, Arquiteto, Revisor | *(auditoria read-only sobre `40f17b6`)* | — | — | Gate final dos 3 revisores independentes e execução completa dos 8 checks obrigatórios |
| `F08-T07` | PMS Orchestrator | `docs/F08-T07-phase-08-evidence-report` | *(esta entrega)* | *(merge `--no-ff` em `main`)* | Relatório formal de evidências e homologação da Fase 08 em `reports/fase-08-evidencias.md` |

---

## 3. Evidências Objetivas dos 8 Checks Obrigatórios (Revisor Independente em `40f17b6`)

Executados integralmente pelo subagente Revisor Independente (`c8df7f62`) em modo somente leitura sobre o `HEAD` consolidado da branch `main` (`40f17b6`):

| # | Verificação / Comando | Exit Code | Resultado Observado |
| ---: | --- | :---: | --- |
| 1 | `git status --short` | `0` | Saída vazia (`0` alterações — working tree 100% limpa antes e após os checks) |
| 2 | `git log --oneline -n 16` | `0` | Topo em `40f17b6` (`F08-T08`) com histórico completo de merges `--no-ff` até `85a1ed9` (`F07-T07`) |
| 3 | `pnpm.cmd typecheck` | `0` | `tsc -b --noEmit` — `0` erros |
| 4 | `pnpm.cmd lint` | `0` | `eslint .` — `0` erros, `0` warnings (inclui regras mecânicas DAG em `eslint.config.js`) |
| 5 | `pnpm.cmd format:check` | `0` | `prettier --check .` — `All matched files use Prettier code style!` |
| 6 | `pnpm.cmd test` | `0` | Vitest (`v3.2.7`): **`Test Files: 35 passed (35)` \| `Tests: 236 passed (236)`** (`Duration: 60.20s`, `0` falhas, `0` skipped; inclui `vitest-axe` com `0` violações) |
| 7 | `pnpm.cmd build` | `0` | `tsc -b && vite build`: **`7102 modules transformed`**, **`built in 13.26s`** (chunks lazy `focus-page-B3MAlocX.js` `27.29 kB` e `bottlenecks-page-CT-N-9dx.js` `37.57 kB`; chunk principal `dist/assets/index-D4bEv1N5.js` `1,011.52 kB`) |
| 8 | `pnpm.cmd test:e2e` | `0` | Playwright Chromium: **`7 passed (13.0s)`** (inclui 2 novos fluxos em `e2e/focus-and-bottlenecks.spec.ts` para `ADMIN` e `MANAGER` *Default Deny*, além dos 5 fluxos das Fases 01–07) |

---

## 4. Pareceres dos 3 Gates Independentes (`F08-T06` em `40f17b6`)

| Gate | Subagente | Parecer | `BLOQUEANTE` | `ALTO` | `MÉDIO` | `BAIXO` | `OBSERVAÇÃO` | Principais Evidências Auditadas |
| --- | --- | --- | :---: | :---: | :---: | :---: | :---: | --- |
| Segurança | `bc76ea68` | **`APROVADO`** | `0` | `0` | `0` | `0` | `4` | `FOCUS_PREFERENCES_MANAGE` e `ANALYTICS_PERSONAL_VIEW` (`ownerUserId`), filtragem item-a-item `TASK_VIEW` e sem vazamento de predecessoras, `DN-02` ocultando `OVERLOAD` de terceiros e `memberWorkloads` quando `allowManagerViewIndividualProductivity === false` (`overloadedMemberCount` anonimizado), `BOTTLENECK_VIEW` por projeto antes de contagens, `BOTTLENECK_RULES_MANAGE` com bloqueio `409` em projeto arquivado/excluído e `AuditEvent`, `DN-06` `ADMIN`-only (`ORGANIZATION_SETTINGS_MANAGE`), `<RequireAuth />` e zero XSS/`window.confirm`/segredos |
| Arquitetura | `a2f724e8` | **`APROVADO`** | `0` | `0` | `0` | `1` | `2` | Zero novas deps NPM (`package.json` / `pnpm-lock.yaml` intactos), Schema Dexie `v2` (`51` stores intactas), módulo-folha `authorization`, DAG protegido no `eslint.config.js` + `work-intelligence-ports-adapter.ts`, `DN-01`..`DN-07` preservados (sem subscribers implícitos, `INACTIVITY` por `lastMovedAt`, `representsHours: false`, `ACKNOWLEDGED !== RESOLVED`), fronteira estrita vs Fases 09–13, `INDEX.md` (`40` docs) e `api-endpoints.md` §11 |
| Revisor Independente | `c8df7f62` | **`APROVADO`** | `0` | `0` | `0` | `0` | `1` | `0 any`, `0 @ts-ignore`/`eslint-disable`/`console.log`/`window.confirm`/`.skip`, `100%` das chaves i18n presentes (`pt-BR.ts` e correção `F08-T08`), WCAG 2.2 AA (`<h1 tabIndex={-1}>`, `44x44px`, reordenação por teclado `Subir`/`Descer`, `ModalDialog` com `Escape`, `aria-live="polite"`, `vitest-axe` `0` violações), todos os 8 checks `exit 0` |

---

## 5. Invariantes e Registros Não-Bloqueantes para Fases Futuras (Backlog)

- **Invariantes preservados durante toda a Fase 08:** zero dependências NPM adicionadas (`package.json` e `pnpm-lock.yaml` inalterados), zero alteração em `src/shared/persistence/pms-database.ts` (Schema Dexie `v2`, `51` stores) e zero implementação antecipada de Fases 09–13 (`feedback`, `recharts`/`analytics` históricos/`ANALYTICS_EXPORT`, `notifications`, `SettingsService`, `manualChunks`).
- **Itens registrados nos gates para melhoria futura (não bloqueantes):**
  1. **Simetria ESLint `projects -> bottlenecks` (`[BAIXO]` do gate Arquitetura):** incluir `'bottlenecks'` na regra `createModuleDagDisallowPolicy('projects', ['teams', 'kanban', 'bottlenecks'], ...)` em `eslint.config.js` e teste negativo correspondente em `src/test/architecture-boundaries.test.ts` em manutenção futura (atualmente `src/modules/projects/**` já não possui qualquer import de `bottlenecks`).
  2. **Refinamento defensivo em evoluções futuras (`[OBSERVAÇÃO]`):**
     - Caso indicadores futuros passem a emitir alertas com `targetEntityType === 'TASK'`, aplicar filtro `TASK_VIEW` também em `listOrganizationAlerts` (hoje emite apenas `BOARD_COLUMN`, `PROJECT`, `USER`), e avaliar filtro `TASK_VIEW` prévio na pontuação agregada pessoal (`computeUserWorkload`) caso exista `ExplicitDeny` pontual em uma tarefa.
     - Em evolução de `BottleneckService.transitionAlertStatus`, evitar passar `targetEntityId` no fallback de recurso quando `project === null` (ramo hoje inalcançável por não-`ADMIN`).
     - Quando `SettingsService` dedicado for criado (Fase 12), encapsular as leituras de `repositories.settings.organizationSettings` nas páginas (`bottlenecks-page.tsx`, `organization-settings-page.tsx`, `permission-provider.tsx`) na camada de serviço.
     - Avaliar particionamento `manualChunks` no Vite (Fase 13) para o aviso informativo de tamanho do chunk principal (`dist/assets/index-D4bEv1N5.js`, `1,011.52 kB`).

---

## 6. Limites Explícitos do Protótipo Local

Conforme `PMS_Documentacao/SECURITY.md`, este sistema permanece um **protótipo frontend local** apoiado em `IndexedDB` (Dexie) e **MSW** no navegador. Os controles RBAC+ABAC, anonimização `DN-02`, auditoria e CSP mitigam regressões lógicas e exposição client-side, mas **não substituem** autenticação/autorização server-side, sessões em cookies `HttpOnly/Secure/SameSite`, isolamento multi-tenant real em backend nem trilhas de auditoria centralizadas em produção.
