# ADR-0006 --- Modelo de Domínio, Motor de Autorização e Contratos entre Módulos

- **Status:** Aceita
- **Data:** 2026-11-19
- **Fase:** 02 — Domínio, Entidades e Contratos
- **Responsáveis:** Arquiteto de Software (redação) / PMS Orchestrator (aprovação)
- **Referências normativas:** `PRD.md` (§4–§21), `DOMAIN.md`, `MODULES.md`, `PERMISSIONS.md`, `ARCHITECTURE.md`, `DATA-PERSISTENCE.md`, `CODING-STANDARDS.md`, `ADR-0001`, `ADR-0002`, `ADR-0005`, `docs/contracts/permission-matrix.md` (§1–§12), `docs/contracts/event-envelope.md`, `docs/contracts/metric-definitions.md`, `docs/modules/analytics.md`, `docs/modules/feedback-contestation.md`.

## Contexto

Com a fundação de tooling, arquitetura e enforcement ESLint concluída na Fase 01 (`ADR-0004`, `ADR-0005`), a Fase 02 estabelece o núcleo de domínio puro, o motor determinístico de autorização RBAC + ABAC, o envelope de eventos, as fórmulas oficiais de métricas/produtividade e as portas de repositório preparadas para a Fase 03 (Dexie/IndexedDB e MSW).

A consolidação normativa identificou seis pontos estruturais que exigem decisão explícita antes da implementação para evitar decisões silenciosas, acoplamento entre módulos ou retrabalho na Fase 03:

1. Consolidação das 34 entidades de `DOMAIN.md` com entidades explicitamente exigidas pelo `PRD.md` e `permission-matrix.md`.
2. Posicionamento arquitetural do motor RBAC + ABAC sem gerar dependências circulares.
3. Granularidade dos módulos em `src/modules/` na Fase 02 e padrão anti-ciclo entre módulos que consomem dados transversais (`analytics`, `focus`, `bottlenecks`, `tasks`, `kanban`, `dependencies`, `impediments`).
4. Reconciliação semântica do encerramento de Feedback entre `PRD.md` §15.3 (`CLOSED`) e §15.6 / §15.8 (encerramento automático mantendo `RESOLVED` e reabertura excepcional).
5. Contratos transversais para `BoardColumn`/`TaskStatus`, `TransactionPort` compatível com Dexie, política de anexos (`15 MB` / `50 MB`) e pendências parametrizáveis sob *Default Deny*.
6. Endurecimento das regras ESLint herdado do encerramento da Fase 01 (`zod` em `shared-kernel`/`domain`, `module-public-api` livre de UI e isolamento de módulo-folha para `authorization`).

## Decisão

### 1. Catálogo Consolidado de Entidades

Preservar integralmente as **34 entidades centrais de `DOMAIN.md`** (`User`, `Organization`, `OrganizationMember`, `Invitation`, `Team`, `TeamMember`, `Project`, `ProjectMember`, `ProjectBoard`, `BoardColumn`, `Task`, `TaskParticipant`, `Subtask`, `TaskDependency`, `Impediment`, `TaskPause`, `TaskExecutionCycle`, `Notification`, `AuditEvent`, `Feedback`, `FeedbackCycle`, `FeedbackMessage`, `FeedbackInternalNote`, `FeedbackAttachment`, `FeedbackContest`, `FeedbackContestReason`, `FeedbackContestReasonVersion`, `FeedbackContestAnalysis`, `FeedbackContestDecision`, `FeedbackSlaSnapshot`, `FeedbackReopenRequest`, `DashboardPreference`, `Backup`, `MaintenanceEvent`) e formalizar as **14 entidades normativas complementares** exigidas pelo `PRD.md`, `PERMISSIONS.md` e `permission-matrix.md`:

- `PermissionGrant` e `ExplicitDenyRule` (`permission-matrix.md` §1, §3, §6)
- `UserSession` (sessões por dispositivo e revogação individual/global — `PRD.md` §6)
- `FeedbackCategory` e `FeedbackCategoryVersion` (catálogo versionado de categorias — `PRD.md` §15.1, `DOMAIN.md`)
- `TaskComment`, `TaskAttachment`, `Tag` e `TaskDeadlineHistoryEntry` (`PRD.md` §10, `DATA-PERSISTENCE.md`, `permission-matrix.md` §5.5)
- `BottleneckAlert` (`PRD.md` §12.2, `MODULES.md`)
- `FocusPreference` (`PRD.md` §13, `MODULES.md`)
- `NotificationPreference` (`PRD.md` §16, `MODULES.md`)
- `OnboardingProgress` (`PRD.md` §21, `MODULES.md`)
- `OrganizationSettings` (calendário organizacional, parâmetros de SLA, pesos/limiares calibráveis e flags das 8 pendências parametrizáveis de `permission-matrix.md` §12 sob *Default Deny*)

Todas as entidades organizacionais carregam `organizationId: OrganizationId` obrigatório (`OrganizationScoped`) e todas as entidades com exclusão lógica implementam o contrato `SoftDeletable` (`deletedAt?`, `deletedBy?`, `deletionReason?`).

### 2. Motor RBAC + ABAC em `src/modules/authorization/` (Módulo-Folha Transversal)

- Posicionar o motor de autorização em **`src/modules/authorization/`** (complementando `MODULES.md` para o escopo *"permissões"* da Fase 05 em `PHASES.md`), contendo na Fase 02 `domain/`, `application/ports/` e `index.ts`.
- O módulo modela os **89 códigos estáveis de permissão** definidos em `permission-matrix.md` §9 (formato `resource.action`), `PermissionGrant`, `ExplicitDenyRule`, o motor determinístico de **10 passos** (`permission-matrix.md` §7), *Default Deny*, *Deny Overrides*, falha fechada diante de atributos ausentes, isolamento estrito por `organizationId` e separação de `demo.maintenance.view` / `demo.maintenance.restore`.
- **Regra de módulo-folha (invariante anti-ciclo):** `src/modules/authorization/**` pode depender **exclusivamente** de `src/shared/kernel` e `src/shared/errors` — é **proibido** (com enforcement no ESLint) de importar qualquer outro módulo em `src/modules/*`. Todos os demais módulos consomem `@/modules/authorization` a partir de `application/` (casos de uso) ou `presentation/` (reflexo de UI, nunca como fonte de autorização).
- Essa escolha acomoda naturalmente `infrastructure/` (repositórios Dexie de concessões e negações na Fase 03) e `application/` + `presentation/` (gestão de permissões na Fase 05) em um único módulo coeso sem fragmentar autorização entre `shared/kernel` e `modules/`.

### 3. Granularidade de Módulos na Fase 02 e Padrão Anti-Ciclo (*Published Language* + *Input Snapshots*)

#### 3.1 Módulos Criados na Fase 02 (21 módulos) vs Módulos Adiados (5 módulos)

Criar em `src/modules/` apenas os **21 módulos** com entidades, invariantes puras ou portas de repositório concretas para a Fase 02 (contendo apenas `domain/`, `application/ports/` e `index.ts`; zero `infrastructure/` e zero `presentation/`):

1. `authorization` *(módulo-folha transversal)*
2. `authentication`, `users`, `organizations`, `invitations`, `teams`, `projects`, `kanban`, `tasks`, `dependencies`, `impediments` *(10 módulos core de organização e trabalho)*
3. `focus`, `bottlenecks`, `analytics`, `feedback`, `notifications`, `audit`, `backups`, `settings`, `onboarding`, `demo` *(10 módulos de produtividade, Analytics, Feedback e governança)*

Adiar **5 módulos de `MODULES.md`** que não possuem entidade persistida própria em `DOMAIN.md`, evitando estrutura vazia artificial (`ARCHITECTURE.md`):

- `reports` -> **Fase 10** (opera sobre snapshots read-only/exportações de Analytics e Feedback)
- `search` -> **Fase 11** (busca agregada cross-entity filtrada por autorização)
- `trash` -> **Fase 12** (contrato transversal `SoftDeletable` já disponibilizado em `src/shared/kernel/` na Fase 02)
- `help` -> **Fase 12** (catálogo de ajuda, artigos e FAQs)
- `monitoring` -> **Fase 13** (`Logger` e `LogSink` já disponíveis em `src/shared/logging/`; retenção local de 30 dias entra nas Fases 03/13)

#### 3.2 Padrão Anti-Ciclo e Aderência Estrita a `boundaries/dependencies`

Como `module-domain` só pode importar `module-domain` do mesmo módulo e `shared-kernel` (`ADR-0005`), **nenhum módulo importa entidades de outro módulo dentro de `domain/`**:

1. **`src/shared/kernel/` atua como *Published Language* mínima** (sem entidades ricas de módulo):
   - Branded IDs (`UserId`, `OrganizationId`, `TeamId`, `ProjectId`, `BoardId`, `BoardColumnId`, `TaskId`, `SubtaskId`, `ImpedimentId`, `FeedbackId`, `FeedbackCycleId`, `FeedbackContestId`, `NotificationId`, `AuditEventId`, `BackupId`, `CorrelationId`, `EventId`, `Uuid`).
   - Tipos temporais/estruturais (`IsoDateTime`, `IsoDate`, `DateRange`, `OrganizationScoped`, `AuditableTimestamps`, `SoftDeletable`).
   - Enums verdadeiramente transversais (`OrganizationRole`, `Priority`, `Severity`, `TaskStatus`).
   - `MetricValue<T>` (`AVAILABLE` vs `UNAVAILABLE` com motivo — `metric-definitions.md`).
   - Portas transversais puras (`ClockPort`, `IdGeneratorPort`, `TransactionPort`, `PaginationParams`, `PaginatedResult<T>`, `DomainEventEnvelope`, `DomainEventPublisherPort`, `AttachmentDescriptor`, `AttachmentBlobStorePort`).
2. **Cada módulo consumidor define seus próprios *Input Snapshots / Read Models* puros em `domain/`** usando apenas primitivos e `shared/kernel`:
   - `analytics/domain`: `AnalyticsTaskSnapshot`, `AnalyticsTaskCycleSnapshot`, `AnalyticsPauseSnapshot`, `AnalyticsFeedbackSnapshot`.
   - `focus/domain`: `FocusTaskCandidate`, `FocusBlockingReason`.
   - `bottlenecks/domain`: `BottleneckColumnSnapshot`, `BottleneckTaskSnapshot`, `BottleneckWorkloadSnapshot`.
   - `tasks/domain`: políticas de conclusão recebem `pendingRequiredDependencyIds: readonly TaskId[]` e `openBlockingImpedimentIds: readonly ImpedimentId[]` sem importar `dependencies` ou `impediments`.
   - `kanban/domain`: políticas de movimentação/WIP recebem snapshot mínimo de coluna, projeto arquivado e estado da tarefa sem importar `projects` ou `tasks`.
   - `dependencies/domain`: detecção pura de ciclos opera sobre `DependencyEdge` (`{ fromTaskId: TaskId; toTaskId: TaskId }`) sem importar `tasks`.
3. Nos casos de uso (`application/` a partir da Fase 04), a orquestração carrega dados via portas de repositório e projeta as entidades nos *Input Snapshots* puros, garantindo grafo DAG estritamente acíclico.

### 4. Reconciliação Ortogonal de Encerramento de Feedback (`PRD.md` §15.3 vs §15.6 / §15.8)

Sem alterar nenhuma regra aprovada no PRD, a modelagem reconcilia integralmente `PRD.md` §15.3, §15.6, §15.7 e §15.8 separando **estado operacional (`status`)** de **estado de encerramento do ciclo (`closure`)**:

1. Preservar os **7 códigos oficiais** de `FeedbackStatus`: `RECEIVED`, `IN_ANALYSIS`, `ASSIGNED`, `IN_PROGRESS`, `WAITING_INFO`, `RESOLVED`, `CLOSED`.
2. Modelar no `Feedback` e em `FeedbackCycle`:
   - `closedAt?: IsoDateTime` (o ciclo/feedback está encerrado quando `closedAt !== undefined`);
   - `closureReason?: 'CONFIRMED_BY_AUTHOR' | 'EXPIRED_WITHOUT_CONTEST' | 'CONTEST_REJECTED_EXPIRED' | 'ADMIN_CLOSED'`;
   - `authorConfirmedResolution: boolean` (assegura §15.6: *"Ausência de resposta não equivale a confirmação"*).
3. Regras determinísticas de transição:
   - **Encerramento automático por expiração (§15.6):** permitido somente quando `status === 'RESOLVED'`, `hasPendingContest === false` e os prazos de manifestação e contestação do snapshot da resolução expiraram. **Mantém `status = 'RESOLVED'`**, registra `closedAt = now`, `closureReason = 'EXPIRED_WITHOUT_CONTEST'` e `authorConfirmedResolution = false`.
   - **Confirmação explícita pelo autor (§15.3 / §15.6):** transita `status = 'CLOSED'`, registra `closedAt = now`, `closureReason = 'CONFIRMED_BY_AUTHOR'` e `authorConfirmedResolution = true`.
   - **Rejeição administrativa de contestação (§15.7):** encerra a contestação automaticamente e mantém `status = 'RESOLVED'`; expirados os prazos sem contestação pendente, encerra com `status = 'RESOLVED'` e `closureReason = 'CONTEST_REJECTED_EXPIRED'`.
   - **Reabertura excepcional (§15.8):** elegível quando encerrado por expiração (`closedAt !== undefined` e `closureReason` em `'EXPIRED_WITHOUT_CONTEST' | 'CONTEST_REJECTED_EXPIRED'`). Enquanto o `FeedbackReopenRequest` está `PENDING`, o feedback permanece encerrado. Aprovação por `ADMIN` cria novo `FeedbackCycle` (`origin: 'EXCEPTIONAL_REOPEN'`), novos snapshots de SLA, preserva responsável e prioridade anteriores como valores iniciais e retorna `status` para `IN_PROGRESS` no novo ciclo ativo.

### 5. Contratos de Quadro Kanban, Transações Dexie, Anexos e Pendências sob *Default Deny*

1. **Kanban (`BoardColumn` + `TaskStatus`):** `BoardColumn` possui `id: BoardColumnId` independente do nome, `columnRole: 'INITIAL' | 'OPERATIONAL' | 'FINAL'`, `wipLimit?: number` e `order: number`; `Task` referencia `columnId: BoardColumnId` e `status: TaskStatus` (`TODO`, `IN_PROGRESS`, `PAUSED`, `BLOCKED`, `DONE`, `CANCELLED`). Todas as tarefas presentes na coluna contam para WIP (inclusive bloqueadas); concluídas/removidas deixam de ocupar WIP; exceção exige autorização e justificativa (`PRD.md` §9).
2. **`TransactionPort` com escopo declarativo (`src/shared/kernel/`):** projetado como `run<T>(resources: readonly TransactionResource[], work: () => Promise<T>): Promise<T>` (onde `TransactionResource` são identificadores lógicos de agregados/stores, sem nenhum tipo Dexie), garantindo compatibilidade direta com `db.transaction('rw', tables, fn)` na Fase 03 (`ADR-0002`). Todas as portas em `application/ports/` são assíncronas (`Promise<...>`) e exigem `organizationId` explícito em operações organizacionais.
3. **Política de anexos (`DATA-PERSISTENCE.md`):** constantes puras de `15 MB` (`15 * 1024 * 1024` bytes) por arquivo e `50 MB` (`50 * 1024 * 1024` bytes) por tarefa/contexto aplicável; domínio opera apenas sobre `AttachmentDescriptor` puro (livre de `File`/`Blob` do navegador), delegando persistência binária à porta `AttachmentBlobStorePort` (implementada em IndexedDB na Fase 03).
4. **Pendências parametrizáveis e divergências normativas sob *Default Deny*:** as 8 pendências parametrizáveis de `permission-matrix.md` §12 e a divergência sobre Lixeira para `MEMBER` (`PRD.md` §20 vs `permission-matrix.md` §5.9) permanecem estritamente sob **Default Deny** (defaults restritivos em `OrganizationSettings`, sem alterar o PRD).

### 6. Endurecimento das Regras ESLint (`eslint.config.js`)

Estender `ADR-0005` §5 em `eslint.config.js`:

1. **Camada 2 (`no-restricted-imports`):** adicionar bloqueio explícito de `zod` e `zod/*` para `src/modules/*/domain/**`, `src/shared/errors/**` e `src/shared/kernel/**`. `zod` permanece permitido em `src/shared/config/**`, `application/`, `infrastructure/` e `presentation/`.
2. **Camada 1 (`boundaries/dependencies` — `module-public-api`):** restringir `src/modules/*/index.ts` para importar apenas `module-domain` e `module-application` (mesmo módulo) e `shared-kernel`, removendo `module-presentation` e `shared-ui` e impedindo vazamento transitivo de React para camadas `application` consumidoras.
3. **Camada 1 (`boundaries/dependencies` — módulo-folha `authorization`):** adicionar política `disallow` impedindo que qualquer arquivo em `src/modules/authorization/**` importe de qualquer outro módulo em `src/modules/*` (inclusive `module-public-api`).

## Alternativas Consideradas

1. **Colocar o motor RBAC + ABAC em `src/shared/kernel/authorization/`:** descartada por não comportar `infrastructure/` (Dexie na Fase 03) nem `application/`/`presentation/` (gestão de concessões na Fase 05), o que forçaria fragmentação da autorização entre `shared/kernel` e `modules/`.
2. **Permitir que `analytics/domain`, `focus/domain` e `bottlenecks/domain` importem entidades diretamente de `tasks`/`kanban`/`feedback`:** descartada por violar `ADR-0001` e `ADR-0005` (`boundaries/dependencies`) e induzir acoplamento rígido e risco de ciclos entre domínios.
3. **Remover `CLOSED` de `FeedbackStatus` ou sobrescrever `RESOLVED` para `CLOSED` no encerramento automático:** descartada por contrariar literalmente `PRD.md` §15.3 ou §15.6.
4. **Definir `TransactionPort` sem lista declarativa de recursos (`run(work)` apenas):** descartada porque `db.transaction` no Dexie exige declarar antecipadamente as tabelas envolvidas na transação; omitir escopo obrigaria o adapter da Fase 03 a abrir transação global sobre todas as tabelas ou quebrar o contrato.
5. **Permitir `zod` dentro de `domain/` e `shared-kernel`:** descartada por acoplar regras de domínio puras a biblioteca externa específica (`CODING-STANDARDS.md`: *"Domínio sem dependência de framework"*).

## Consequências

- **Positivas:** pureza total de `shared-kernel` e `domain/` garantida mecanicamente no CI; grafo de módulos 100% acíclico; reconciliação fiel de todas as cláusulas do PRD sobre Feedback e permissões; contratos de repositório e transações prontos para implementação direta em Dexie na Fase 03 sem refatoração.
- **Trade-offs:** casos de uso em `application/` (Fases 04–10) exigem pequenos mapeadores de entidades para *Input Snapshots* em `analytics`, `focus` e `bottlenecks`, custo amplamente compensado pelo isolamento e testabilidade determinística das fórmulas de domínio.
