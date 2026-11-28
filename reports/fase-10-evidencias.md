# Relatório de Evidências e Homologação — Fase 10

- **Projeto:** Project Management System (PMS) — Protótipo Frontend Local
- **Fase:** `10 — Analytics, dashboards e relatórios`
- **Orquestrador responsável:** PMS Orchestrator
- **Branch base e de entrega:** `main` (integrações via `--no-ff` a partir de `4e12fc6`)
- **HEAD técnico homologado pelos 3 gates:** `dc5d48d` (`merge: integrate F10-T05 Phase 10 Analytics and Reports test and E2E suites`)
- **Data de homologação:** 2026-11-28
- **Status final da Fase 10:** **APROVADA** (`APROVADO` unânime nos 3 gates independentes sobre `dc5d48d`, com `0` achados `BLOQUEANTE`, `0` `ALTO`, `0` `MÉDIO` e `7` observações `BAIXO` não bloqueantes registradas em backlog)

---

## 1. Resumo Executivo

A Fase 10 operacionalizou os módulos **`analytics`** e **`reports`** sobre o Schema Dexie `v2` (`51` tabelas preservadas, `src/modules/authorization/**` mantido como módulo-folha absoluto e `recharts` `2.15.4` instalado mediante aprovação explícita da `DN-01`), entregando: métricas oficiais de trabalho e fluxo (`Lead Time`, `Cycle Time EFFECTIVE` descontando pausas válidas vs `TOTAL` separados, `Throughput`, `countUniqueCompletedTasks` vs `countPeriodCompletions`, taxa de conclusão por coorte, presets de período + comparação equivalente anterior e estado explícito `UNAVAILABLE` via `MetricValue<T>`), analytics histórico de feedbacks preservando versões históricas de categorias/motivos (`FeedbackCategoryVersion`, `FeedbackContestReasonVersion`) e origens de ciclo, consolidação histórica de carga ponderada (`0–100`, `representsHours: false`), impedimentos e gargalos, personalização de `DashboardPreference` (`PERSONAL`, `PROJECT`, `ORGANIZATION`) isolada por `(organizationId, userId, scope, projectId?)` + `isDemoIsolated` com edição em rascunho (`Salvar`/`Descartar`/restaurar padrão), governança `ADMIN` para calibração de `calibratableWeights` (`ANALYTICS_RULES_MANAGE`), catálogo fechado de 4 relatórios canônicos com paridade estrita pré-visualização ↔ exportação e exportadores zero-dep (`JSON`, `CSV`, `PDF 1.4` e `XLSX` OOXML `t="inlineStr"` sem tags `<f>`), alinhamento compartilhado contra Formula Injection em `reports` e `feedback-service.ts` (`DN-08`), dupla guarda de privacidade mitigando `reportAccessRule` e interfaces WCAG 2.2 AA em `/analytics`, `/projects/:projectId/analytics` e `/reports`.

Sobre o consolidado `dc5d48d`, os 3 gates independentes (**Segurança**, **Arquitetura** e **Revisor Independente**) emitiram parecer **`APROVADO`** com **0 bloqueantes, 0 altos e 0 médios**, e todos os **8 checks obrigatórios** concluíram com `exit code 0`.

---

## 2. Rastreabilidade de Subtarefas, Branches e Commits Integrados (`--no-ff`)

| Tarefa | Papel Responsável | Branch Isolada | Commit da Entrega | Commit Merge (`main`) | Escopo Principal |
| --- | --- | --- | --- | --- | --- |
| `F10-T00` | Arquiteto de Software | *(leitura em `4e12fc6`)* | — | — | Estudo de viabilidade (`APROVADO COM RESSALVAS`), correção de índice Dexie `v2`, detecção de lacuna em `reportAccessRule` e 8 decisões normativas (`DN-01`..`DN-08`) |
| `F10-T01` | Arquiteto de Software | `docs/F10-T01-adr0014-eslint-dag-and-analytics-contracts` | `060b0cd` | `680ae53` | `ADR-0014`, `INDEX.md` (`42` docs), instalação aprovada de `recharts@^2` (`2.15.4`), regras DAG ESLint (`reports -> analytics -> authorization`) + `architecture-boundaries.test.ts`, `sanitizeSpreadsheetCell`/`escapeCsvCell` em `@/shared/kernel`, `AnalyticsWorkContextPort`/`ReportsContextPort`, `REPORT_CATALOG` e complementos em `*RepositoryPort`/Dexie |
| `F10-T02` | Engenheiro Persistência | `feature/F10-T02-analytics-reports-services-and-msw` | `b8d9bf7` | `b96d9dd` | `DexieAnalyticsPortsAdapter`, `AnalyticsService`, `ReportService` com dupla guarda de terceiros e exportadores zero-dep (`JSON`/`CSV`/`PDF`/`XLSX`), alinhamento `DN-08` em `feedback-service.ts`, `container.ts`, handlers MSW v2 e contrato `api-endpoints.md` §13 |
| `F10-T03` | Engenheiro Frontend | `feature/F10-T03-analytics-i18n-and-nav` | `50cfbd9` | `5998e3a` | Contratos `src/modules/reports/application/contracts.ts` e expansão de `analytics/application/contracts.ts`, dicionário `pt-BR.ts` (`nav.analytics`, `nav.reports`, `analytics.*`, `reports.*`), navegação `AppShell` e atalhos contextuais em Projetos e Kanban |
| `F10-T04` | Engenheiro Frontend | `feature/F10-T04-analytics-dashboards-and-reports-ui` | `37ad29b` | `6ab211b` | Painéis modulares WCAG 2.2 AA (`analytics/presentation/`, `reports/presentation/`) com `recharts` + tabela HTML equivalente, customizador em rascunho, calibração `ADMIN`, exportação segura `Blob` e rotas lazy `/analytics`, `/projects/:projectId/analytics` e `/reports` |
| `F10-T05` | Engenheiro de QA | `test/F10-T05-analytics-and-reports-tests` | `75c87d2` | `dc5d48d` | `analytics-service.integration.test.ts`, `report-service.integration.test.ts` (incluindo Formula Injection em `reports` e `feedback-service.ts`), expansão `analytics-reports-msw.integration.test.ts`, `analytics-and-reports.presentation.test.tsx` (`vitest-axe` `0` violações) e `e2e/analytics.spec.ts` |
| `F10-T06` | Segurança, Arquiteto, Revisor | *(auditoria read-only sobre `dc5d48d`)* | — | — | Gate final dos 3 revisores independentes e execução completa dos 8 checks obrigatórios |
| `F10-T07` | PMS Orchestrator | `docs/F10-T07-phase-10-evidence-report` | *(esta entrega)* | *(merge `--no-ff` em `main`)* | Relatório formal de evidências e homologação da Fase 10 em `reports/fase-10-evidencias.md` |

---

## 3. Rastreabilidade das Decisões Normativas (`DN-01`..`DN-08`)

| Decisão | Tema | Implementação Verificada na Fase 10 |
| --- | --- | --- |
| **`DN-01`** | `recharts@^2` + A11y + Lazy | `"recharts": "2"` (`2.15.4`) instalado com aprovação explícita em `package.json`; importado exclusivamente em `analytics-charts.tsx` dentro do chunk lazy `analytics-page`, sempre encapsulado por `AccessibleChartCard` com resumo textual e tabela HTML equivalente |
| **`DN-02`** | Exportação `PDF` e `XLSX` zero-dep | `pdf-exporter.ts` (`%PDF-1.4`, `/BaseFont /Helvetica`, WinAnsi/ASCII seguro, paginação tabular, `xref`, `%%EOF`) e `xlsx-exporter.ts` (`PKZIP` Store + CRC-32, OOXML `t="inlineStr"` sem tags `<f>`) sem libs externas |
| **`DN-03`** | Modularidade `reports` vs `analytics` | `src/modules/reports/` criado em fluxo unidirecional `reports -> analytics -> authorization`, isolado via `eslint.config.js` e `ReportsContextPort` |
| **`DN-04`** | `DashboardPreference` | Escopos `PERSONAL`, `PROJECT`, `ORGANIZATION` isolados por `(organizationId, userId, scope, projectId?)` e `isDemoIsolated`, reutilizando `existing.id` no Dexie `v2`, com rascunho local (`Salvar`/`Descartar`/aviso inline/restaurar padrão) |
| **`DN-05`** | Catálogo fechado e paridade | 4 relatórios canônicos (`PROJECT_DELIVERY_FLOW`, `PRODUCTIVITY_WORKLOAD`, `FEEDBACK_SLA_CONTESTS`, `ORGANIZATION_EXECUTIVE_SUMMARY`) usando o mesmo `ReportSnapshot` para pré-visualização e exportação + `AuditEvent` `EXPORT` |
| **`DN-06`** | `ANALYTICS_RULES_MANAGE` | Leitura e calibração exclusiva de `ADMIN` para `calibratableWeights` (soma = `1.0`) e `defaultProjectInactivityThresholdDays` com `AuditEvent` |
| **`DN-07`** | Rotas protegidas e `AppShell` | `/analytics`, `/projects/:projectId/analytics` e `/reports` sob `<RequireAuth />`, `nav.analytics` e `nav.reports` condicionados a permissões no `AppShell`, e atalhos em Projetos/Kanban |
| **`DN-08`** | Formula Injection compartilhado | `sanitizeSpreadsheetCell` / `toCsvCell` / `toCsvRow` em `src/shared/kernel/spreadsheet-sanitization.ts`, aplicados em `csv-exporter.ts`, `xlsx-exporter.ts` e `feedback-service.ts` (removendo função local anterior) |

---

## 4. Evidências Objetivas dos 8 Checks Obrigatórios (Revisor Independente em `dc5d48d`)

Executados integralmente pelo subagente Revisor Independente (`c6696998`) em modo somente leitura sobre o `HEAD` consolidado da branch `main` (`dc5d48d`):

| # | Verificação / Comando | Exit Code | Resultado Observado |
| ---: | --- | :---: | --- |
| 1 | `pnpm.cmd typecheck` | `0` | `tsc -b --noEmit` — `0` erros |
| 2 | `pnpm.cmd lint` | `0` | `eslint .` — `0` erros, `0` warnings |
| 3 | `pnpm.cmd format:check` | `0` | `prettier --check .` — `All matched files use Prettier code style!` |
| 4 | `pnpm.cmd test` | `0` | Vitest (`v3.2.7`): **`Test Files 46 passed (46)` \| `Tests 295 passed (295)`** (`Duration 94.43s`, `0` falhas, `0` skipped) |
| 5 | `pnpm.cmd test:coverage` | `0` | **`Test Files 46 passed (46)` \| `Tests 295 passed (295)`** (`Duration 117.17s`); cobertura global: **`83.75%` Statements \| `75.9%` Branches \| `81.09%` Functions \| `83.75%` Lines** |
| 6 | `pnpm.cmd build` | `0` | `tsc -b && vite build` (`7564 modules transformed`, `built in 17.54s`): chunks `index-BKLJQZO0.js` (`1,235.06 kB`, gzip `314.01 kB`), `analytics-page-B4cMVq6D.js` (`461.94 kB`, gzip `122.72 kB`), `project-board-page-BSlDtzBA.js` (`93.36 kB`), `task-detail-panel-9yd70e5g.js` (`92.31 kB`), `feedback-detail-page-DXacUfIN.js` (`59.69 kB`), `reports-page-dfs_0pQ7.js` (`22.60 kB`, gzip `6.33 kB`) |
| 7 | `pnpm.cmd test:e2e` | `0` | Playwright Chromium (`6 workers`): **`10 passed (15.5s)`** (inclui `e2e\analytics.spec.ts` `ADMIN` + `MEMBER` e demais E2E das Fases 01–09) |
| 8 | `git status --short --branch` | `0` | `dc5d48d` \| `## main...origin/main [ahead 10]` (working tree limpa antes e após todos os checks) |

---

## 5. Pareceres dos 3 Gates Independentes (`F10-T06` em `dc5d48d`)

| Gate | Subagente | Parecer | `BLOQUEANTE` | `ALTO` | `MÉDIO` | `BAIXO` | Principais Evidências Auditadas |
| --- | --- | --- | :---: | :---: | :---: | :---: | --- |
| Segurança | `62a8edae` | **`APROVADO`** | `0` | `0` | `0` | `3` | Mitigação de `reportAccessRule` em dupla guarda (`ANALYTICS_PROJECT_VIEW` + `allowManagerViewIndividualProductivity`), filtragem item-a-item `TASK_VIEW`/`FEEDBACK_VIEW` antes de agregar, segregação total de `FeedbackInternalNote`/`internalNoteId`, sanitização contra Formula Injection (`=`, `+`, `-`, `@`, `\t`, `\r`, inclusive após whitespace/NBSP) em `CSV`/`XLSX` e `feedback-service.ts`, isolamento cross-org e `isDemoIsolated`, `AuditEvent` `EXPORT`, downloads seguros via `Blob` + `URL.revokeObjectURL`, zero XSS/`window.confirm`/alteração em `authorization` ou `pms-database.ts` |
| Arquitetura | `49c032f6` | **`APROVADO`** | `0` | `0` | `0` | `2` | Invariantes intactas (`pms-database.ts` `v2`/`51` stores, `authorization/**` módulo-folha, `vite.config.ts` sem `manualChunks`), apenas `"recharts": "2"` em `package.json`, `INDEX.md` (`42` docs) + `ADR-0014`, DAG `reports -> analytics -> authorization` validado no `eslint.config.js` e `architecture-boundaries.test.ts`, unicidade `DashboardPreference` via `existing.id`, separação `Cycle Time EFFECTIVE` vs `TOTAL` e `MetricValue<T>`, zero escopo antecipado de Fases 11–13 |
| Revisor Independente | `c6696998` | **`APROVADO`** | `0` | `0` | `0` | `2` | `0 any`, `0 @ts-ignore`/`eslint-disable`/`console.log`/`window.confirm`/`.skip`, WCAG 2.2 AA (`AccessibleChartCard` com resumo textual + `<table>`/`<caption>`/`<th scope="col">`, `h1 -> h2 -> h3`, navegação por teclado em abas, `min-h-[44px]`, aviso inline de alterações não salvas, `vitest-axe` 0 violações), rigor da suíte `F10-T05` e todos os 8 checks com `exit 0` |

---

## 6. Invariantes e Registros Não-Bloqueantes para Fases Futuras (Backlog)

- **Invariantes preservados durante toda a Fase 10:** zero alteração em `src/shared/persistence/pms-database.ts` (Schema Dexie `v2`, `51` stores), zero alteração em `src/modules/authorization/**`, zero alteração em `vite.config.ts`, e zero implementação antecipada de Fases 11–13 (`notifications` UI/despacho, busca/auditoria global UI, `backups`/`trash`/`SettingsService`, `onboarding`/`help`, `PWA`, `monitoring` ou `manualChunks`). Única adição em `package.json`: `"recharts": "2"` (`2.15.4`, aprovada em `DN-01`).
- **Observações `[BAIXO]` registradas para melhoria futura (não bloqueantes):**
  1. **Snapshot pós-gravação de `calibratableWeights` (`analytics-ports-adapter.ts#L596-L605`):** substituir `isDemoOrganization: false` literal pela leitura real de `org?.isDemo ?? false` (atualmente não consumido por `updateCalibrationSettings`).
  2. **Catálogo estático vs `ExplicitDenyRule` (`report-service.ts:288-295`) e guarda defensiva de alerta `TASK` (`analytics-service.ts:1066-1105`):** avaliar `explicitDenies` organizacionais já em `listReportCatalog` e reforçar `visibleTaskIds.has(alert.targetEntityId)` caso alertas de nível `TASK` venham a ser emitidos no futuro.
  3. **Representação parcial em gráfico misto (`analytics-charts.tsx#L95-L100`):** quando apenas parte das métricas de tempo está `UNAVAILABLE`, considerar omissão visual da barra ausente mantendo o estado `UNAVAILABLE` já exibido no cartão e na tabela equivalente.
  4. **Internacionalização de booleanos em `reports-ui-helpers.ts:149-151`:** mover literais `'Sim'` / `'Não'` de `formatReportCellValue` para chaves tipadas em `pt-BR.ts` caso haja expansão multi-idioma.
  5. **Otimização de bundle Vite (`manualChunks` — Fase 13):** particionar o chunk principal (`dist/assets/index-BKLJQZO0.js`, `1,235.06 kB`, aviso informativo Rollup > 500 kB), mantendo os chunks lazy de `/analytics` (`461.94 kB`) e `/reports` (`22.60 kB`) isolados.

---

## 7. Limites Explícitos do Protótipo Local

Conforme `PMS_Documentacao/SECURITY.md` e `PMS_Documentacao/PERMISSIONS.md`, o PMS opera como **protótipo frontend local** apoiado em `IndexedDB` (Dexie) e simulação HTTP via **MSW v2** no navegador. Todos os controles RBAC + ABAC (`ANALYTICS_*`, `REPORT_*`, dupla guarda de produtividade individual de terceiros, filtragem item-a-item e segregação de notas internas), sanitização de planilhas (`CSV`/`XLSX`), geração `PDF 1.4`/`XLSX` e trilha de `AuditEvent` previnem regressões lógicas e exposição na camada de cliente, porém **não substituem** autenticação em servidor, cookies `HttpOnly/Secure/SameSite`, isolamento multi-tenant nem geração/exportação autorizada em backend de produção.
