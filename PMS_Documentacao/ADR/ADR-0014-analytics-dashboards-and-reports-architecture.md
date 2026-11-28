# ADR-0014 --- Arquitetura de Analytics, Dashboards Personalizáveis e Relatórios

- **Status:** Aceita
- **Data:** 2026-11-28
- **Fase:** 10 — Analytics, Dashboards e Relatórios
- **Responsáveis:** Arquiteto de Software (redação) / PMS Orchestrator (aprovação)
- **Referências normativas:** `PRD.md` (§14, §15.9, §18, §19, §22, §23, §24), `PERMISSIONS.md`, `SECURITY.md`, `ARCHITECTURE.md`, `DOMAIN.md`, `MODULES.md`, `DATA-PERSISTENCE.md`, `API-SIMULATION.md`, `ACCESSIBILITY.md`, `CODING-STANDARDS.md`, `ADR-0001..0013`, `docs/modules/analytics.md`, `docs/contracts/metric-definitions.md`, `docs/contracts/permission-matrix.md` (§5.6, §5.8, §6–§12), `docs/contracts/api-endpoints.md` (§13), `docs/contracts/event-envelope.md`.

## Contexto

Com a conclusão do núcleo operacional, do Modo Foco/Gargalos e do fluxo completo de Feedbacks, SLA e Contestações nas Fases 06–09 (`ADR-0010`..`ADR-0013`), a Fase 10 (`F10-T00`..`F10-T07`) consolida os módulos **`analytics`** e **`reports`**, entregando indicadores oficiais de fluxo e produtividade, analytics histórico de feedbacks/SLA/contestações com preservação de versões, consolidação histórica de carga e impedimentos, dashboards individuais personalizáveis (`DashboardPreference`), calibração organizacional de pesos (`ANALYTICS_RULES_MANAGE`) e catálogo de relatórios com pré-visualização e exportação em `JSON`, `CSV`, `PDF` e `XLSX`.

Esta arquitetura deve respeitar três invariantes estruturais do projeto:

1. **Preservação integral do Schema Dexie `v2` (`51` tabelas)** em `src/shared/persistence/pms-database.ts` (zero migração `v2 -> v3`, mantendo intactas `dashboardPreferences` e todas as stores operacionais e de feedback).
2. **Preservação integral de `src/modules/authorization/**`** como módulo-folha (`ADR-0006`), mitigando na camada de aplicação a ausência de checagem de produtividade individual de terceiros em `reportAccessRule` sem alterar o motor ABAC canônico.
3. **Blindagem mecânica do DAG acíclico** (`reports -> analytics -> authorization`) no `eslint.config.js` e em `src/test/architecture-boundaries.test.ts`, autorizando exclusivamente a instalação de `recharts` v2 (`"recharts": "2"`, compatível com React 18) para visualização gráfica na apresentação e mantendo exportação `PDF`/`XLSX` zero-dep.

---

## Decisão

### 1. Decisões Normativas Aprovadas (`DN-01`..`DN-08` — Plano `F10-T00`)

1. **`DN-01` — Biblioteca de Gráficos (`recharts` v2) com Alternativa Acessível:**
   - Instala-se explicitamente **`recharts`** v2 (`"recharts": "2"`, versão resolvida `2.15.4`, compatível com `react@^18.3.1` e `react-dom@^18.3.1` conforme `ADR-0004` §3 e `PRD.md` §23).
   - O uso de `recharts` é restrito à camada de apresentação (`analytics/presentation/` e `reports/presentation/`), permanecendo bloqueado em `src/modules/*/domain/**`, `src/shared/errors/**` e `src/shared/kernel/**` pela regra `no-restricted-imports` do `eslint.config.js`.
   - Todo gráfico renderizado com `recharts` é obrigatoriamente acompanhado de **alternativa tabular/resumo textual acessível (WCAG 2.2 AA)** e carregado sob demanda via `React.lazy` por rota (sem `manualChunks` no `vite.config.ts`, reservado à Fase 13).

2. **`DN-02` — Exportação `PDF` e `XLSX` Zero-Dep em TypeScript Puro:**
   - As exportações **`PDF`** e **`XLSX`** são implementadas integralmente em TypeScript puro sem dependências externas (sem `jspdf`, `pdfkit`, `xlsx` ou equivalentes, evitando bloat de bundle e riscos de segurança/CSP):
     - **`PDF`:** gerador determinístico **PDF 1.4** tabular com fonte padrão Helvetica, escapando strings PDF e preservando exatamente as colunas, linhas e metadados da pré-visualização.
     - **`XLSX`:** gerador OOXML/ZIP mínimo utilizando células de texto inline (**`t="inlineStr"`**) **sem elementos de fórmula `<f>`**, combinado à sanitização contra Formula Injection (`DN-08`).

3. **`DN-03` — Modularidade Unidirecional (`reports -> analytics -> authorization`):**
   - Cria-se o módulo próprio **`src/modules/reports/`**, separado de `src/modules/analytics/`, consumindo unidirecionalmente apenas `@/modules/analytics`, `@/modules/authorization` e `@/shared/*` (conforme `ADR-0006` §3.1 e `MODULES.md`).
   - A camada `reports/presentation/` permanece isolada de infraestrutura via `application/contracts.ts`, e dados externos de rótulos/auditoria chegam via `ReportsContextPort`.

4. **`DN-04` — Escopos e Ciclo de Vida de `DashboardPreference`:**
   - Suportam-se os escopos **`PERSONAL`** (`ANALYTICS_PERSONAL_VIEW`), **`PROJECT`** (`ANALYTICS_PROJECT_VIEW`) e **`ORGANIZATION`** (`ANALYTICS_ORGANIZATION_VIEW`), sempre individuais por `(organizationId, userId, scope, projectId?)`, nunca compartilhados e isolados por ambiente (`isDemoIsolated`, separando dashboards da organização demonstrativa dos reais conforme `PRD.md` §14 e §18).
   - A edição de widgets opera sobre rascunho local com ações explícitas **`Salvar`** e **`Descartar`**, alerta de saída/alterações não salvas e restauração para o layout padrão preservando `existing.id`, com revalidação de autorização tanto na consulta quanto na renderização.

5. **`DN-05` — Catálogo Fechado de Relatórios Pré-Construídos e Paridade Prévia ↔ Exportação:**
   - O módulo `reports` expõe catálogo fechado (`REPORT_CATALOG` em `src/modules/reports/domain/report-catalog.ts`) com os 4 relatórios canônicos (`REPORT_KINDS`):
     - `PROJECT_DELIVERY_FLOW` (`PROJECT` — Entrega & Fluxo por Projeto);
     - `PRODUCTIVITY_WORKLOAD` (`PROJECT | ORGANIZATION` — Produtividade e Carga, sujeito à guarda de produtividade individual de terceiros);
     - `FEEDBACK_SLA_CONTESTS` (`PROJECT | ORGANIZATION` — Feedbacks, SLA & Contestações, sujeito à filtragem item-a-item e segregação de notas internas);
     - `ORGANIZATION_EXECUTIVE_SUMMARY` (`ORGANIZATION` — Resumo Executivo Organizacional).
   - Todos os formatos reutilizam `EXPORT_FORMATS` (`JSON`, `CSV`, `PDF`, `XLSX`) com filtros parametrizáveis (`ReportFilters`) validados por `assertValidReportFilters` e **paridade estrita pré-visualização ↔ arquivo exportado**: o arquivo exportado é materializado a partir exatamente do mesmo snapshot, filtros e decisões de autorização exibidos na pré-visualização, gravando `AuditEvent` (`AUDIT_CATEGORIES.EXPORT`).

6. **`DN-06` — Escopo de `ANALYTICS_RULES_MANAGE` (`calibratableWeights`):**
   - A leitura e calibração de `OrganizationSettings.calibratableWeights` (pesos de Workload: `workloadPriorityWeight`, `workloadDelayWeight`, `workloadImpedimentsWeight`, `workloadOperationalStateWeight` somando `1.0` / `100%`, `workloadPausedFactor`; pesos de Modo Foco: `focusPriorityWeight`, `focusDeadlineWeight`, `focusDependenciesWeight`, `focusInactivityWeight`, `focusWorkloadCompatibilityWeight` somando `1.0` / `100%`; e `defaultProjectInactivityThresholdDays`) é exposta exclusivamente a **`ADMIN`** (`PERMISSION_CODES.ANALYTICS_RULES_MANAGE` / `PERMISSION_CODES.ORGANIZATION_SETTINGS_MANAGE`) na governança de Analytics, mantendo *Default Deny* e registrando `AuditEvent` pós-commit.

7. **`DN-07` — Rotas Protegidas e Navegação no `AppShell`:**
   - O roteador expõe sob `<RequireAuth />` as rotas **`/analytics`**, **`/projects/:projectId/analytics`** e **`/reports`**, carregadas via `React.lazy`.
   - O `AppShell` exibe entradas `nav.analytics` e `nav.reports` condicionadas às respectivas permissões (`ANALYTICS_*`, `REPORT_VIEW`), acompanhadas de atalhos contextuais em Projetos e no Quadro Kanban para `/projects/:projectId/analytics`.

8. **`DN-08` — Sanitização Compartilhada contra Formula Injection (`@shared/kernel`):**
   - Define-se o utilitário puro compartilhado em `src/shared/kernel/spreadsheet-sanitization.ts` (reexportado em `src/shared/kernel/index.ts`):
     - `SPREADSHEET_FORMULA_TRIGGER_CHARACTERS = ['=', '+', '-', '@', '\t', '\r']`;
     - `isSpreadsheetFormulaLike`, `sanitizeSpreadsheetCell`, `escapeCsvCell`, `toCsvCell`, `toCsvRow`.
   - Todo valor textual cujo primeiro caractere significativo (inclusive após espaços regulares `' '` ou NBSP `'\u00A0'`) pertença ao conjunto de gatilhos é neutralizado com prefixo `'` antes da serialização RFC 4180 (`CSV`) ou `inlineStr` (`XLSX`).
   - Esse mesmo utilitário deve ser adotado tanto pelos exportadores de `reports` quanto por `feedback-service.ts` (`reports/fase-09-evidencias.md` §5.1), eliminando duplicação e divergência de proteção.

---

### 2. Métricas Oficiais, Períodos, Coortes e Analytics Histórico

1. **Métricas Oficiais de Trabalho e Fluxo (`src/modules/analytics/domain/analytics.ts`, `docs/contracts/metric-definitions.md`):**
   - **`Lead Time` (`calculateLeadTimeMs`):** média de `createdAt -> completedAt` para tarefas concluídas dentro do período.
   - **`Cycle Time` (`calculateCycleTimeMs`):** `effectiveStartedAt ?? startedAt -> completedAt` dos ciclos concluídos no período, distinguindo explicitamente **`EFFECTIVE`** (descontando pausas válidas registradas em `TaskPause`, clamped ao intervalo do ciclo) de **`TOTAL`** (tempo decorrido bruto sem desconto).
   - **`Throughput` (`calculateThroughput`) vs `countUniqueCompletedTasks` vs `countPeriodCompletions`:** `Throughput` e `countPeriodCompletions` contabilizam ciclos concluídos no período (independentemente da data de criação da tarefa); `countUniqueCompletedTasks` contabiliza IDs distintos de tarefas concluídas (uma tarefa reaberta e concluída múltiplas vezes conta uma única vez).
   - **`Taxa de Conclusão por Coorte` (`calculateCohortCompletionRate`):** proporção de tarefas criadas no período-coorte que foram concluídas até a data de referência (`/ total` da coorte), nunca confundida com conclusões no período.
   - **Períodos e Comparação Equivalente:** `resolveAnalyticsPeriodRange` suporta `LAST_7_DAYS`, `LAST_30_DAYS`, `LAST_90_DAYS`, `CURRENT_YEAR` e `CUSTOM`; `resolveEquivalentPreviousPeriod` resolve o intervalo imediatamente anterior de duração idêntica para comparações.
   - **Representação de Ausência (`MetricValue<T>`):** dados insuficientes, ausência de ciclos concluídos, denominador zero ou falta de autorização retornam `UNAVAILABLE` (`unavailableMetric('INSUFFICIENT_DATA' | 'NO_COMPLETED_CYCLES' | 'ZERO_DENOMINATOR' | 'UNAUTHORIZED')`), **nunca `0` implícito**.

2. **Analytics Histórico de Feedback (`PRD.md` §15.9):**
   - Consolida volumes, taxas de resolução, cumprimento de SLA (`ON_TRACK` / `WARNING` / `BREACHED`), contestações, decisões e reaberturas, tempos de primeira resposta e resolução, e desempenho por responsável.
   - Preserva **versões históricas** de categorias (`FeedbackCategoryVersion`) e motivos de contestação (`FeedbackContestReasonVersion`) referenciadas por `categoryVersionId` / `reasonVersionId`, bem como a **origem de cada ciclo** (`INITIAL`, `CONTESTATION_REOPEN`, `EXCEPTIONAL_REOPEN`).

3. **Consolidação Histórica de Carga, Impedimentos e Gargalos:**
   - Consolida séries e distribuições de impedimentos por categoria/severidade, carga de trabalho ponderada (`0–100`, `representsHours: false`) e alertas de gargalo, preservando `DN-02` da Fase 08 (`ADR-0012`: alertas e métricas individuais `OVERLOAD` de terceiros ocultos quando `!allowManagerViewIndividualProductivity`).

---

### 3. Segurança RBAC + ABAC, Mitigação de `reportAccessRule` e Segregação

1. **Códigos Canônicos (`src/modules/authorization/domain/permission-codes.ts`, sem `DASHBOARD_*`):**
   - Dashboards pessoais: `ANALYTICS_PERSONAL_VIEW` (`ownResourceRule`, `ownerUserId === actorUserId`);
   - Dashboards e métricas de projeto: `ANALYTICS_PROJECT_VIEW`;
   - Visão organizacional global: `ANALYTICS_ORGANIZATION_VIEW` (exclusivo `ADMIN`);
   - Calibração de pesos/limiares: `ANALYTICS_RULES_MANAGE` (exclusivo `ADMIN`);
   - Exportação de analytics: `ANALYTICS_EXPORT`;
   - Consulta e exportação de relatórios: `REPORT_VIEW` e `REPORT_EXPORT`.

2. **Mitigação Obrigatória de `reportAccessRule` (`policy-engine.ts` L671–711) na Camada de Aplicação:**
   - Enquanto `analyticsProjectRule` (`policy-engine.ts` L627–669) verifica explicitamente `ctx.resource.includesThirdPartyIndividualMetrics === true` e `ctx.policyConfig.allowManagerViewIndividualProductivity` (negando `MEMBER` e negando `MANAGER` quando a política estiver em *Default Deny*), **`reportAccessRule` (`policy-engine.ts` L671–711) não avalia esses atributos**.
   - Como `src/modules/authorization/**` é preservado intacto como módulo-folha, **a camada de aplicação (`ReportService` e `AnalyticsService`) impõe obrigatoriamente dupla guarda antes de incluir métricas nominais/individuais de terceiros** em qualquer prévia, dashboard ou arquivo exportado:
     1. Avaliar **`PERMISSION_CODES.ANALYTICS_PROJECT_VIEW`** com `includesThirdPartyIndividualMetrics: true` e `toAuthorizationPolicyConfig(settings)`;
     2. Verificar diretamente `actor.role === 'ADMIN'` ou (`actor.role === 'MANAGER'` em projeto gerido com `settings.pendingPermissionDefaults.allowManagerViewIndividualProductivity === true`).
   - Para `MEMBER`, métricas nominais/individuais de terceiros são **sempre proibidas**; para `MANAGER`, são negadas por padrão quando `allowManagerViewIndividualProductivity === false` ou fora de seu escopo gerido.

3. **Filtragem Item-a-Item Antes de Agregar e Segregação de Notas Internas:**
   - Toda tarefa candidata é filtrada individualmente por **`PERMISSION_CODES.TASK_VIEW`** e todo feedback por **`PERMISSION_CODES.FEEDBACK_VIEW`** antes de calcular somatórios, médias, taxas, distribuições ou linhas de relatório.
   - Notas internas (`FeedbackInternalNote`) e anexos vinculados a **`internalNoteId`** são **estritamente excluídos** de qualquer agregação, pré-visualização ou exportação sempre que `!FEEDBACK_INTERNAL_NOTE_VIEW` ou **`isFeedbackAuthor && role !== 'ADMIN'`** (`ADR-0013` `DN-04`).

---

### 4. Blindagem Mecânica do DAG Acíclico (`eslint.config.js` e `architecture-boundaries.test.ts`)

1. **Regras DAG no `eslint.config.js` (`createModuleDagDisallowPolicy`, antes da exceção `categories: 'test'`):**
   - `authorization` permanece 100% isolado como módulo-folha (`ADR-0006`).
   - Fluxo unidirecional estrito: **`reports -> analytics -> authorization`**.
   - **`analytics`** é **PROIBIDO** de importar `['projects', 'kanban', 'tasks', 'dependencies', 'impediments', 'focus', 'bottlenecks', 'feedback', 'teams', 'users', 'organizations', 'invitations', 'authentication', 'notifications', 'audit', 'backups', 'settings', 'onboarding', 'demo', 'reports']`.
   - **`reports`** é **PROIBIDO** de importar os mesmos 19 módulos operacionais/transversais (`projects`, `kanban`, `tasks`, `dependencies`, `impediments`, `focus`, `bottlenecks`, `feedback`, `teams`, `users`, `organizations`, `invitations`, `authentication`, `notifications`, `audit`, `backups`, `settings`, `onboarding`, `demo`), sendo permitido importar apenas `analytics`, `authorization` e `@/shared/*`.
   - Os módulos **`tasks`**, **`projects`**, **`dependencies`**, **`impediments`**, **`bottlenecks`**, **`focus`** e **`feedback`** passam a proibir também **`'reports'`**.
   - A restrição existente bloqueando `recharts` em `src/modules/*/domain/**`, `src/shared/errors/**` e `src/shared/kernel/**` é mantida integralmente.
2. **Testes negativos em `src/test/architecture-boundaries.test.ts`:**
   - Asserções negativas comprovam o bloqueio de violações DAG em `analytics` (incluindo `analytics -> tasks` e `analytics -> reports`), `reports` (ex.: `reports -> feedback`) e módulos de trabalho/transversais tentando importar `reports`, além de asserções positivas para `reports -> analytics`, `reports -> authorization`, `analytics -> authorization` e `*.test.ts`.

---

### 5. Schema Dexie `v2` Preservado, Repositórios e Portas Anti-Ciclo

1. **Schema Dexie `v2` (`51` tabelas) 100% preservado:**
   - `src/shared/persistence/pms-database.ts` permanece inalterado.
   - Na store `dashboardPreferences` (`'id, organizationId, [organizationId+userId], [organizationId+userId+scope]'`), `DexieDashboardPreferenceRepository.save` impõe unicidade lógica por **`(organizationId, userId, scope, projectId)`**, reutilizando `existing.id` quando já existir registro para a mesma chave.
2. **Extensões de Portas e Repositórios sobre Índices `v2` Existentes:**
   - `DashboardPreferenceRepositoryPort` / `DexieDashboardPreferenceRepository`: adiciona `findById(organizationId, preferenceId)` e `delete(organizationId, preferenceId)`, com `save(preference)` retornando `Promise<DashboardPreference>`.
   - `TaskPauseRepositoryPort` e `TaskExecutionCycleRepositoryPort`: adicionam `listByOrganization(organizationId)` sobre o índice `organizationId`, evitando consultas N+1 por tarefa.
   - `FeedbackContestRepositoryPort`: adiciona `listDecisionsByOrganization(organizationId)` sobre o índice `organizationId`.
   - `FeedbackCategoryRepositoryPort` e `FeedbackContestReasonRepositoryPort`: adicionam `listAllVersionsByOrganization(organizationId)` usando range scan `[organizationId, Dexie.minKey]..[organizationId, Dexie.maxKey]` sobre `[organizationId+categoryId]` e `[organizationId+reasonId]`.
3. **Portas Anti-Ciclo (`AnalyticsWorkContextPort` e `ReportsContextPort`):**
   - **`AnalyticsWorkContextPort`** (`src/modules/analytics/application/ports/analytics-context.port.ts`, reexportada em `src/modules/analytics/index.ts`): fornece snapshots read-only de ator, projetos, tarefas, ciclos de execução, pausas, impedimentos, feedbacks, ciclos de feedback, contestações, decisões e versões históricas de categorias/motivos.
   - **`ReportsContextPort`** (`src/modules/reports/application/ports/reports-context.port.ts`, reexportada em `src/modules/reports/index.ts`): fornece rótulos de cabeçalho (`ReportSubjectLabelsSnapshot`) e registro de auditoria (`recordExportAuditEvent` com `AUDIT_CATEGORIES.EXPORT`).
   - Ambas as portas serão implementadas exclusivamente em `src/app/composition/analytics-ports-adapter.ts` e conectadas no `AppContainer` (`F10-T02`).

---

### 6. Contratos de Serviços, MSW v2 e Escopo Estritamente Postergado

1. **Superfície prevista para `F10-T02` (`api-endpoints.md` §13):**
   - Endpoints MSW v2 sob `/api/v1/organizations/:organizationId/analytics*`, `.../dashboard-preferences*`, `.../reports*` e calibração `.../settings/analytics-rules`, delegando integralmente a `AnalyticsService` e `ReportService`, validando autorização real e aguardando `TransactionPort.run` + `PostCommitDomainEventBus` antes de responder.
2. **Escopo estritamente postergado (Fases 11–13):**
   - **Fase 11:** `notifications` (UI, preferências, polling), `search` (busca global cross-entity), `audit` (UI/exportação global de trilha de auditoria — Fase 10 apenas grava `AuditEvent`).
   - **Fase 12:** `backups`, `trash`, `SettingsService` unificado, `onboarding` e `help`.
   - **Fase 13:** `PWA` (`vite-plugin-pwa`), `monitoring` e `manualChunks` no `vite.config.ts`.

---

## Alternativas Consideradas

1. **Gráficos SVG puros zero-dep em vez de `recharts`:** evitaria alterar `package.json` / `pnpm-lock.yaml`, mas reduziria interatividade responsiva/tooltips e contrariaria a stack já prevista em `PRD.md` §23 e `ADR-0004` §3; a decisão aprovada (`DN-01`) instala `recharts` v2 isolado na apresentação com alternativa tabular WCAG 2.2 AA obrigatória.
2. **Instalar `jspdf` / `xlsx` para exportações:** descartada (`DN-02`) pelo impacto de bundle (~300 kB–1 MB+) e superfície de segurança/CSP; geradores puros `PDF 1.4` e `XLSX` `inlineStr` sem `<f>` suprem integralmente os relatórios tabulares com determinismo total.
3. **Alterar `reportAccessRule` dentro de `src/modules/authorization/**`:** descartada para preservar a invariante de intocabilidade do módulo-folha `authorization`; o reforço na camada de aplicação (`AnalyticsService`/`ReportService`) aplica `ANALYTICS_PROJECT_VIEW` (`includesThirdPartyIndividualMetrics: true`) + guarda explícita de `allowManagerViewIndividualProductivity` sem risco de regressão nas fases anteriores.
4. **Unificar `reports` dentro de `analytics`:** descartada (`DN-03`) para manter fronteiras limpas entre agregação analítica/dashboards e catálogo/exportação de relatórios.

## Consequências

- **Positivas:** Schema Dexie `v2` (`51` tabelas) e `src/modules/authorization/**` 100% preservados; DAG `reports -> analytics -> authorization` garantido mecanicamente via ESLint e testes negativos; proteção uniforme contra CSV/XLSX Formula Injection compartilhada entre `reports` e `feedback`; paridade estrita pré-visualização ↔ exportação; zero `0` implícito em dados insuficientes (`MetricValue<T>`).
- **Trade-offs:** adiciona `recharts` (`2.15.4`) às dependências de produção (exigindo lazy loading por rota na apresentação); exige adaptador de composição dedicado em `src/app/composition/analytics-ports-adapter.ts` (`F10-T02`) para alimentar `AnalyticsWorkContextPort` e `ReportsContextPort` sem acoplamento cruzado entre módulos.
