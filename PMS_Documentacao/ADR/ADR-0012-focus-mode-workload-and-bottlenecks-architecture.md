# ADR-0012 --- Arquitetura de Modo Foco, Carga de Trabalho e Gargalos

- **Status:** Aceita
- **Data:** 2026-11-24
- **Fase:** 08 — Modo Foco, Carga de Trabalho e Gargalos
- **Responsáveis:** Arquiteto de Software (redação) / PMS Orchestrator (aprovação)
- **Referências normativas:** `PRD.md` (§12, §13, §14, §22, §23, §24), `PERMISSIONS.md`, `SECURITY.md`, `ARCHITECTURE.md`, `DOMAIN.md`, `MODULES.md`, `DATA-PERSISTENCE.md`, `API-SIMULATION.md`, `ACCESSIBILITY.md`, `CODING-STANDARDS.md`, `ADR-0001..0011`, `docs/contracts/permission-matrix.md` (§5.6, §6–§12), `docs/contracts/api-endpoints.md` (§4, §6, §9, §10), `docs/contracts/event-envelope.md`, `docs/contracts/metric-definitions.md`.

## Contexto

Com a entrega completa dos fluxos operacionais de Tarefas, Subtarefas, Dependências Acíclicas e Impedimentos na Fase 07 (`ADR-0011`), a Fase 08 operacionaliza os módulos **`focus`** e **`bottlenecks`** (incluindo cálculo determinístico de **Carga de Trabalho `0–100`** e os **5 indicadores operacionais de gargalo**), conectando os núcleos de domínio já estabelecidos (`rankFocusTasks`, `calculateWorkloadScore`, `classifyWorkloadScore`, `detectInactiveTasks`, `upsertBottleneckAlert`, `FocusPreference`, `BottleneckAlert`) a serviços de aplicação, portas anti-ciclo, adaptadores de composição, endpoints simulados MSW v2 e rotas protegidas de interface.

Para preservar o Schema Dexie `v2` (`51` tabelas), manter o grafo de módulos estritamente acíclico sem acoplamento cruzado entre `projects`, `focus`, `bottlenecks`, `tasks`, `kanban`, `dependencies`, `impediments` e `analytics`, assegurar privacidade estrita sobre produtividade e sobrecarga individual de terceiros (*Default Deny*), delimitar claramente a fronteira com as Fases 09–13 e garantir auditabilidade e propagação ABAC completas, formalizam-se as sete decisões normativas aprovadas (`DN-01`..`DN-07`) e seus contratos arquiteturais derivados.

## Decisão

### 1. Decisões Normativas Aprovadas (`DN-01`..`DN-07`)

1. **`DN-01` — Fronteira estrita vs Fases 09–13:**
   - A Fase 08 entrega exclusivamente **Modo Foco** (`focus`: preferências individuais `AUTO`/`MANUAL`, fixação `pinnedTaskIds`, ocultação `hiddenTaskIds`, reordenação manual `manualOrderTaskIds`, ranqueamento determinístico `30/30/20/10/10` e seção separada de tarefas bloqueadas com motivo e condição de desbloqueio), **Carga de Trabalho ponderada `0–100`** (`calculateWorkloadScore` com pesos `30/30/25/15`, `representsHours: false`, redução `50%` para pausadas, divisão igualitária por participantes ativos e zero para `DONE`/`CANCELLED`), **contadores operacionais instantâneos** e os **5 indicadores determinísticos de gargalo** (`WIP`, `INACTIVITY`, `OVERDUE`, `IMPEDIMENTS`, `OVERLOAD`).
   - Métricas analíticas históricas (`Lead Time`, `Cycle Time`, `Throughput`, taxa de conclusão por coorte, séries temporais, gráficos `recharts`, dashboards personalizáveis e exportações `ANALYTICS_EXPORT` / `REPORT_EXPORT`) permanecem estritamente reservadas à **Fase 10** (`analytics` / `reports`). Disparo de notificações proativas (`notifications`, Fase 11) e Lixeira global unificada (`trash`, Fase 12) também permanecem fora do escopo da Fase 08.

2. **`DN-02` — Privacidade de alertas `OVERLOAD` (`targetEntityType === 'USER'`):**
   - Alertas individuais de sobrecarga (`indicator === 'OVERLOAD'` e `targetEntityType === 'USER'`) referentes a **terceiros** (`targetEntityId !== actorUserId`) são **estritamente ocultados** para `MEMBER` e também para `MANAGER` quando `OrganizationSettings.pendingPermissionDefaults.allowManagerViewIndividualProductivity === false` (*Default Deny*).
   - Nessas condições, a resposta e a interface de gargalos expõem exclusivamente o contador agregado anonimizado **`overloadedMemberCount`** (nunca `targetEntityId`, nome, e-mail ou pontuação individual de terceiros).
   - O alerta `OVERLOAD` próprio do ator (`targetEntityId === actorUserId`), bem como alertas individuais sob `ADMIN` ou `MANAGER` administrando o projeto quando `allowManagerViewIndividualProductivity === true`, permanecem visíveis dentro do escopo autorizado por `BOTTLENECK_VIEW`.

3. **`DN-03` — Preservação do Schema Dexie `v2` (`51` tabelas) e `Project.bottleneckThresholds?`:**
   - Nenhuma migração `v2 -> v3` é executada; o schema `PMS_SCHEMA_V2_STORES` (`51` tabelas em `src/shared/persistence/pms-database.ts`) permanece 100% intacto, assim como `package.json` e `pnpm-lock.yaml` (zero novas dependências NPM).
   - A entidade `Project` (`src/modules/projects/domain/project.ts`) recebe o campo opcional não-indexado **`bottleneckThresholds?: ProjectBottleneckThresholds`**, onde `ProjectBottleneckThresholds` é definido como value type puro em **`@/shared/kernel`** (`src/shared/kernel/bottlenecks.ts`) e reexportado por `projects` e `bottlenecks` sem qualquer importação cruzada entre ambos os módulos.
   - O domínio de `bottlenecks` (`src/modules/bottlenecks/domain/bottleneck.ts`) fornece os defaults determinísticos (**`DEFAULT_PROJECT_BOTTLENECK_THRESHOLDS`**) e helpers puros de validação e normalização (**`assertValidProjectBottleneckThresholds`**, **`normalizeProjectBottleneckThresholds`**), garantindo retrocompatibilidade total com registros de `Project` persistidos anteriormente nos quais `bottleneckThresholds` é `undefined`.

4. **`DN-04` — Disparo explícito sob demanda (`POST .../bottlenecks/evaluate`):**
   - A avaliação persistente e deduplicação de `BottleneckAlert` ocorre exclusivamente mediante disparo explícito sob demanda (`evaluateProjectBottlenecks` / `POST /api/v1/organizations/:organizationId/projects/:projectId/bottlenecks/evaluate`), nunca por subscribers automáticos acoplados a mutações legadas de `tasks` ou `kanban`.
   - Esse modelo preserva a previsibilidade transacional, evita escritas implícitas em tabelas de gargalo durante operações do Kanban/Tarefas e garante controle explícito de auditoria sobre avaliações persistidas.

5. **`DN-05` — Governança de mutações (`BOTTLENECK_RULES_MANAGE`), `409 Conflict` e `AuditEvent`:**
   - `acknowledgeAlert`, `resolveAlert`, atualização de limiares/regras (`Project.bottleneckThresholds` e `inactivityThresholdDays` no contexto de regras de gargalo) e disparo persistente (`evaluateProjectBottlenecks`) são protegidos por **`PERMISSION_CODES.BOTTLENECK_RULES_MANAGE`** (e pertencem a `OPERATIONAL_MUTATION_PERMISSIONS`, retornando **`409 Conflict`** com `DENIED_PROJECT_ARCHIVED` em projeto arquivado ou `DENIED_RESOURCE_DELETED` em projeto excluído logicamente).
   - Reconhecimento (`ACKNOWLEDGED`) **nunca** equivale a resolução (`RESOLVED`); novas ocorrências equivalentes durante avaliação reutilizam o alerta ativo via `upsertBottleneckAlert` incrementando `occurrenceCount` sem duplicação.
   - Todas as mutações em `bottlenecks` gravam `AuditEvent` utilizando estritamente as categorias fechadas existentes em `AUDIT_CATEGORIES` (`AUDIT_CATEGORIES.PROJECT` para ações em escopo de projeto e `AUDIT_CATEGORIES.ORGANIZATION` para políticas organizacionais), sem introdução de novas categorias de auditoria fora do catálogo normativo.

6. **`DN-06` — Controle administrativo mínimo para produtividade individual (`ORGANIZATION_SETTINGS_MANAGE`):**
   - A interface de configurações organizacionais (`/settings`, `OrganizationSettingsPage`) disponibiliza controle administrativo mínimo protegido estritamente por **`PERMISSION_CODES.ORGANIZATION_SETTINGS_MANAGE`** (**exclusivo `ADMIN`** via `adminExclusiveRule`) para alternar `pendingPermissionDefaults.allowManagerViewIndividualProductivity` (mantendo *Default Deny* `false` na inicialização padrão de novas organizações).

7. **`DN-07` — Rotas protegidas e navegação contextual:**
   - O roteador da aplicação (`src/app/router/routes.tsx`) expõe sob `<RequireAuth />` as rotas protegidas **`/focus`**, **`/bottlenecks`** e **`/projects/:projectId/bottlenecks`**, com entradas contextuais no `AppShell` (navegação principal), na listagem/detalhes de Projetos (`projects-panel.tsx`) e no cabeçalho do Quadro Kanban (`kanban-board-panel.tsx`).

---

### 2. Schema Dexie `v2`, `ProjectBottleneckThresholds` e Complementos de Repositório

1. **Contrato estrutural compartilhado sem acoplamento cruzado (`@/shared/kernel/bottlenecks.ts`):**
   - `ProjectBottleneckThresholds` modela os limiares opcionais configuráveis por projeto de forma coerente com os 5 indicadores:
     - `wipUtilizationPercent` (ocupação WIP preventiva `1..100`, padrão `80`);
     - `inactivityWarningCount` / `inactivityCriticalCount` (padrões `2` e `5`, complementando `Project.inactivityThresholdDays`, padrão `7`, sempre avaliado sobre `lastMovedAt`, nunca `lastActivityAt`);
     - `overdueWarningCount` / `overdueCriticalCount` (padrões `1` e `3`);
     - `blockedWarningCount` / `blockedCriticalCount` (padrões `1` e `3`);
     - `overloadHighScore` / `overloadCriticalScore` (faixas `1..100`, padrões `50` e `75`, alinhados a `classifyWorkloadScore`).
   - `assertValidProjectBottleneckThresholds` valida integridade numérica (inteiros positivos / limites `[1, 100]`) e ordenação (`warning <= critical` e `overloadHighScore <= overloadCriticalScore`).
   - `normalizeProjectBottleneckThresholds` aplica fallback determinístico para `DEFAULT_PROJECT_BOTTLENECK_THRESHOLDS` sobre campos ausentes ou `undefined` e revalida a configuração resultante.

2. **Complementos obrigatórios de portas e repositórios compatíveis com Schema `v2` (`51` tabelas):**
   - **`SubtaskRepositoryPort` (`DexieSubtaskRepository`):** adicionar `listByOrganization(organizationId: OrganizationId): Promise<readonly Subtask[]>` consultando o índice `organizationId` já declarado em `PMS_SCHEMA_V2_STORES.subtasks`.
   - **`TaskParticipantRepositoryPort` (`DexieTaskParticipantRepository`):** adicionar `listByOrganization(organizationId: OrganizationId): Promise<readonly TaskParticipant[]>` utilizando varredura por faixa no índice composto `[organizationId+taskId]` (`Dexie.minKey`..`Dexie.maxKey`) já declarado em `PMS_SCHEMA_V2_STORES.taskParticipants`, preservando integralmente os índices do Schema `v2`.
   - **`BottleneckAlertRepositoryPort` (`DexieBottleneckAlertRepository`):** adicionar:
     - `saveMany(organizationId: OrganizationId, alerts: readonly BottleneckAlert[]): Promise<void>` delegando a `saveManyOrganizationScopedEntities` para persistência atômica em lote na avaliação;
     - `listActiveByOrganization(organizationId: OrganizationId, options?: { readonly projectId?: ProjectId }): Promise<readonly BottleneckAlert[]>` retornando exclusivamente alertas não resolvidos (`status !== 'RESOLVED'`, isto é, `OPEN` e `ACKNOWLEDGED`) ordenados deterministicamente.

---

### 3. DAG Acíclico, Portas Locais Anti-Ciclo e Blindagem Mecânica no ESLint

1. **Preservação do módulo-folha `src/modules/authorization/**`:** permanece 100% proibido de importar qualquer outro módulo de `src/modules/*` (`ADR-0006`, `ADR-0009`, `eslint.config.js`).
2. **Regras DAG obrigatórias em `eslint.config.js` (`createModuleDagDisallowPolicy`, antes da exceção `categories: 'test'`):**
   - **`bottlenecks`** é **PROIBIDO** de importar `['focus', 'tasks', 'projects', 'kanban', 'dependencies', 'impediments', 'analytics']`.
   - **`focus`** é **PROIBIDO** de importar `['tasks', 'projects', 'kanban', 'dependencies', 'impediments', 'analytics']`.
   - **`projects`** e **`bottlenecks`** **jamais** importam um ao outro (compartilham apenas `ProjectBottleneckThresholds` via `@/shared/kernel`).
   - Fluxo unidirecional permitido **`focus -> bottlenecks`** (para reutilização pura de `calculateWorkloadScore` e tipos de carga/severidade sem ciclo reverso), preservando também suítes `*.test.ts(x)`.
   - Todas as proibições negativas e permissões positivas são verificadas automaticamente em `src/test/architecture-boundaries.test.ts`.
3. **Portas locais anti-ciclo e adaptador único de composição:**
   - **`FocusWorkContextPort`** (`src/modules/focus/application/ports/`): expõe projeções anti-corrupção necessárias ao ranqueamento de Modo Foco e cálculo da carga própria do ator (`FocusTaskCandidate`, snapshots de tarefas/subtarefas para `calculateWorkloadScore`, estado de impedimentos bloqueantes, pausas e dependências pendentes), já pré-resolvidas com isolamento por `organizationId` e elegibilidade por `TASK_VIEW`, sem importar `tasks`, `projects`, `kanban`, `dependencies` ou `impediments`.
   - **`BottleneckWorkContextPort`** (`src/modules/bottlenecks/application/ports/`): expõe projeções mínimas de projetos (`id`, `name`, `teamId`, `ownerUserId`, `status`, `archivedAt`, `deletedAt`, `inactivityThresholdDays`, `bottleneckThresholds`), colunas Kanban com `wipLimit` e ocupação (`doesTaskStatusOccupyWip`), tarefas ativas, subtarefas, participantes ativos, impedimentos abertos, leitura/atualização transacional controlada de `Project.bottleneckThresholds` / `inactivityThresholdDays` (quando autorizado via `BOTTLENECK_RULES_MANAGE`) e leitura da política `allowManagerViewIndividualProductivity` de `OrganizationSettings`, sem importar `projects`, `kanban`, `tasks`, `dependencies`, `impediments` ou `settings`.
   - **Adaptador único:** **`src/app/composition/work-intelligence-ports-adapter.ts`** implementa `FocusWorkContextPort` e `BottleneckWorkContextPort` sobre `AppRepositoriesRegistry` e utilitários públicos de composição (`resolveActorProjectScopes` / políticas de domínio).

---

### 4. Filtragem Item-a-Item, Carga de Trabalho e Propagação ABAC Completa

1. **Filtragem item-a-item por `TASK_VIEW` e `BOTTLENECK_VIEW`:**
   - **Modo Foco (`focus`):** toda tarefa candidata exibida ao ator é validada individualmente contra **`PERMISSION_CODES.TASK_VIEW`** com contexto ABAC completo (`organizationId`, `projectId`, `teamId`, `ownerUserId`, `projectArchivedAt`, `deletedAt`, `taskId`, `createdBy`, `assigneeId`, `participantIds`) e `policyConfig` completo. Apenas preferências pessoais do próprio usuário (`FOCUS_PREFERENCES_MANAGE` com `ownerUserId === actorUserId`) são lidas/gravadas, e fixar/ocultar/reordenar no Modo Foco jamais altera o Kanban ou prioridade oficial.
   - **Gargalos (`bottlenecks`):** consultas de projeto ou organização avaliam **`PERMISSION_CODES.BOTTLENECK_VIEW`** por projeto (`projectReadRule`), e quaisquer detalhes ou identificadores de tarefas associados a alertas/contadores são filtrados item-a-item por **`PERMISSION_CODES.TASK_VIEW`**, nunca vazando títulos de tarefas fora do escopo do ator (como `MEMBER` em projetos parcialmente visíveis).
   - **Carga de Trabalho (`calculateWorkloadScore`):** `MEMBER` consulta apenas a própria carga (`0–100`, `representsHours: false`); carga individual de terceiros exige `ADMIN` ou `MANAGER` em escopo administrado **e** `allowManagerViewIndividualProductivity === true` (propagando `includesThirdPartyIndividualMetrics` e aplicando a regra de privacidade `DN-02`).

2. **Propagação ABAC completa e `AuditEvent`:**
   - Todas as chamadas a `assertAuthorized` / `evaluateAuthorization` nos serviços `FocusService` e `BottleneckService` preenchem integralmente `exists`, `organizationId`, `projectId`, `teamId`, `ownerUserId`, `projectArchivedAt`, `deletedAt`, `taskId`, `createdBy`, `assigneeId`, `participantIds`, `includesThirdPartyIndividualMetrics` (quando aplicável) e `policyConfig` derivado de `OrganizationSettings` via `toAuthorizationPolicyConfig`.
   - Mutações em `BottleneckService` executam dentro de `TransactionPort.run(...)`, gravam `AuditEvent` com `correlationId` nas categorias `AUDIT_CATEGORIES.PROJECT` / `AUDIT_CATEGORIES.ORGANIZATION` e despacham eventos pós-commit somente após confirmação da transação (`PostCommitDomainEventBus`).

---

### 5. Contratos de API Simulada (MSW) e Interface

1. **Endpoints MSW dedicados (sem lógica de negócio nos handlers):**
   - `GET /api/v1/organizations/:organizationId/focus` e `PUT /api/v1/organizations/:organizationId/focus/preferences` (delegam a `FocusService`, `FOCUS_PREFERENCES_MANAGE` + `TASK_VIEW` item-a-item).
   - `GET /api/v1/organizations/:organizationId/bottlenecks` e `GET /api/v1/organizations/:organizationId/projects/:projectId/bottlenecks` (delegam a `BottleneckService`, `BOTTLENECK_VIEW` + `DN-02` privacidade `OVERLOAD`).
   - `POST /api/v1/organizations/:organizationId/projects/:projectId/bottlenecks/evaluate` (`DN-04` + `DN-05`, `BOTTLENECK_RULES_MANAGE`).
   - `PATCH /api/v1/organizations/:organizationId/projects/:projectId/bottlenecks/thresholds` (`DN-03` + `DN-05`, `BOTTLENECK_RULES_MANAGE`).
   - `POST /api/v1/organizations/:organizationId/bottlenecks/:alertId/acknowledge` e `.../resolve` (`DN-05`, `BOTTLENECK_RULES_MANAGE`).
   - `PATCH /api/v1/organizations/:organizationId/settings/productivity-visibility` (ou atualização controlada de `OrganizationSettings.pendingPermissionDefaults.allowManagerViewIndividualProductivity` sob `ORGANIZATION_SETTINGS_MANAGE`, `DN-06`).
2. **Rotas e navegação acessível (`ACCESSIBILITY.md`, `DN-07`):**
   - `/focus`, `/bottlenecks`, `/projects/:projectId/bottlenecks` sob `<RequireAuth />`, com suporte completo a teclado, rótulos semânticos e regiões `aria-live="polite"`.

## Alternativas Consideradas

1. **Definir `ProjectBottleneckThresholds` dentro de `bottlenecks` e importá-lo em `projects` (ou vice-versa):** descartada porque criaria acoplamento direto entre módulos de negócio no DAG e violaria a proibição bilateral `projects <-> bottlenecks`. Definir o contrato puro em `@/shared/kernel` mantém o DAG acíclico sem duplicação divergente.
2. **Gerar `BottleneckAlert` automaticamente via subscribers pós-commit a cada mutação de tarefa/Kanban:** descartada (`DN-04`) porque introduziria escritas implícitas em transações secundárias e dificultaria determinismo operacional/auditoria; o disparo explícito sob demanda (`POST .../bottlenecks/evaluate`) garante atomicidade e previsibilidade.
3. **Executar migração Dexie `v2 -> v3` para adicionar store dedicada de regras por projeto ou índice standalone em `taskParticipants`:** descartada (`DN-03`) porque `PMS_SCHEMA_V2_STORES` (`51` tabelas) já possui `bottleneckAlerts`, `focusPreferences`, `projects`, `organizationSettings`, e `taskParticipants` já possui o índice composto `[organizationId+taskId]`, permitindo leitura por faixa sem migração.
4. **Expor alertas `OVERLOAD` individuais de terceiros para `MANAGER` por padrão:** descartada (`DN-02`, `permission-matrix.md` §12) por violar o princípio normativo *Default Deny* (`allowManagerViewIndividualProductivity: false`), expondo apenas `overloadedMemberCount` anonimizado até habilitação explícita pelo `ADMIN`.

## Consequências

- **Positivas:** Schema Dexie `v2` (`51` tabelas) 100% preservado; zero novas dependências NPM; DAG acíclico mecanicamente protegido pelo ESLint e testado em `src/test/architecture-boundaries.test.ts` (`bottlenecks`, `focus`, `projects`, `tasks`, `dependencies`, `impediments`, `authorization`); fronteira estrita vs Fase 10 (`analytics`/`reports`); privacidade de produtividade individual garantida por padrão com controle explícito do `ADMIN`; compatibilidade retroativa com projetos existentes sem `bottleneckThresholds`.
- **Trade-offs:** exige manter `src/app/composition/work-intelligence-ports-adapter.ts` adaptando `FocusWorkContextPort` e `BottleneckWorkContextPort`; requer atualização explícita de alertas persistidos via `POST .../bottlenecks/evaluate` (`DN-04`) em vez de recomputação implícita em mutações de Kanban/Tarefas; impõe filtragem cuidadosa de tarefas por `TASK_VIEW` e anonimização de `OVERLOAD` em todas as projeções retornadas pela aplicação e MSW.
