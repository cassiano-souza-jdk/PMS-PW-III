# ADR-0011 --- Arquitetura de Tarefas, Subtarefas, Dependências e Impedimentos

- **Status:** Aceita
- **Data:** 2026-11-22
- **Fase:** 07 — Tarefas, Subtarefas, Dependências e Impedimentos
- **Responsáveis:** Arquiteto de Software (redação) / PMS Orchestrator (aprovação)
- **Referências normativas:** `PRD.md` (§9, §10, §11, §12.1, §14, §22, §23, §24), `PERMISSIONS.md`, `SECURITY.md`, `ARCHITECTURE.md`, `DOMAIN.md`, `MODULES.md`, `DATA-PERSISTENCE.md`, `API-SIMULATION.md`, `ACCESSIBILITY.md`, `CODING-STANDARDS.md`, `ADR-0001..0010`, `docs/contracts/permission-matrix.md` (§3, §4.4, §5.4, §5.5, §6–§12), `docs/contracts/api-endpoints.md` (§4, §6, §9), `docs/contracts/event-envelope.md`, `docs/contracts/metric-definitions.md`, `reports/fase-06-evidencias.md` (§4.1).

## Contexto

Com a entrega completa da gestão de Projetos, Participantes e Quadro Kanban na Fase 06 (`ADR-0010`), a Fase 07 implementa os fluxos operacionais completos de **Tarefas (`Task`), Participantes de Tarefa (`TaskParticipant`), Subtarefas de 1 nível (`Subtask`), Pausas (`TaskPause`), Ciclos de Execução (`TaskExecutionCycle`), Comentários (`TaskComment`), Anexos Binários (`TaskAttachment` + `AttachmentBlobPayload`), Etiquetas (`Tag`), Histórico de Prazos (`TaskDeadlineHistoryEntry`), Dependências Acíclicas (`TaskDependency`) e Impedimentos (`Impediment`)**, além de incorporar os quatro endurecimentos menores registrados no encerramento da Fase 06 (`reports/fase-06-evidencias.md` §4.1).

Para preservar o Schema Dexie `v2`, evitar qualquer `PrematureCommitError` no armazenamento binário de anexos, blindar mecanicamente o grafo DAG acíclico no `eslint.config.js`, resolver de forma explícita as decisões normativas pendentes sobre `deleteTask` e `Tag`, eliminar assimetrias residuais entre `PendingPermissionDefaults` e `AuthorizationPolicyConfig` e manter fidelidade estrita aos contratos RBAC + ABAC e ao `PRD.md`, dez grupos de decisões arquiteturais precisam ser formalizados antes da implementação:

1. Manutenção de zero novas dependências NPM, preservação do Schema Dexie `v2` (`51` tabelas) e complementos pontuais nos repositórios.
2. Segurança de anexos binários, prevenção de `PrematureCommitError`, limites cumulativos e tratamento não-destrutivo de `QuotaExceededError`.
3. Blindagem mecânica do DAG acíclico no `eslint.config.js` e criação de portas locais mínimas em `tasks`, `dependencies` e `impediments`, preservando `authorization` como módulo-folha absoluto.
4. Decisão normativa A: proteção, contexto ABAC e revogação de grants para `deleteTask`.
5. Decisão normativa B: separação estrita de permissões entre catálogo organizacional de `Tag` e associação/remoção em tarefa.
6. Sincronização `PendingPermissionDefaults` ↔ `AuthorizationPolicyConfig` e simetria operacional para `MANAGER` participante em `SUBTASK_MANAGE` e `IMPEDIMENT_RESOLVE` (preservando o Cenário 6).
7. Preenchimento completo de atributos ABAC nas avaliações de autorização da Fase 07.
8. Política de autoria, imutabilidade de sistema (`isSystem`) e janela configurável de edição/exclusão de `TaskComment`.
9. Invariantes temporais (`lastMovedAt` vs `lastActivityAt`), histórico de prazos, ciclos, sincronização bidirecional com o quadro Kanban, dependências, impedimentos e transição de encerramento/reabertura.
10. Incorporação dos quatro endurecimentos herdados da Fase 06 e fronteira estrita em relação às Fases 08+.

## Decisão

### 1. Zero Novas Dependências, Schema Dexie `v2` (`51` Tabelas) e Complementos de Repositório

1. **Zero novas dependências NPM e zero migração `v2 -> v3`:** nenhuma alteração é permitida em `package.json` ou `pnpm-lock.yaml`, e o schema `PMS_SCHEMA_V2_STORES` (`51` tabelas em `src/shared/persistence/pms-database.ts`) permanece integralmente preservado. Todas as stores exigidas pela Fase 07 (`tasks`, `taskParticipants`, `subtasks`, `taskDependencies`, `impediments`, `taskPauses`, `taskExecutionCycles`, `taskComments`, `taskAttachments`, `taskDeadlineHistory`, `tags`, `attachmentBlobs`, além de `projects`, `projectMembers`, `projectBoards`, `boardColumns`, `organizationSettings`, `permissionGrants`, `explicitDenyRules` e `auditEvents`) já existem no Schema `v2`.
2. **Complementos obrigatórios nas portas e repositórios Dexie:**
   - **`TaskParticipantRepositoryPort` (`DexieTaskParticipantRepository`):** adicionar `findByTaskAndUser(organizationId: OrganizationId, taskId: TaskId, userId: UserId): Promise<TaskParticipant | null>` consultando o índice composto único `&[organizationId+taskId+userId]`. Ao readicionar um ex-participante que possua registro com `removedAt !== undefined`, `TaskService` **deve reutilizar `existing.id`** (atualizando `addedByUserId`, `joinedAt` e limpando `removedAt`), prevenindo colisão `ConstraintError` / `ConflictError` análoga à regra adotada em `ProjectMember` (`ADR-0010` §2.4).
   - **`SubtaskRepositoryPort` (`DexieSubtaskRepository`):** adicionar `saveMany(organizationId: OrganizationId, subtasks: readonly Subtask[]): Promise<void>` delegando a `saveManyOrganizationScopedEntities` para persistência atômica em lote (ex.: reordenação de subtarefas).
   - **`TaskDependencyRepositoryPort` (`DexieTaskDependencyRepository`):** adicionar `findByPair(organizationId: OrganizationId, taskId: TaskId, dependsOnTaskId: TaskId): Promise<TaskDependency | null>` consultando o índice composto único `&[organizationId+taskId+dependsOnTaskId]` para verificação explícita de duplicidade antes de persistir nova dependência.
   - **Unicidade normalizada de `Tag` por organização:** como a store `tags` declara índice não-único `[organizationId+name]` e o IndexedDB realiza comparações sensíveis a maiúsculas/minúsculas e espaços, `TagRepositoryPort` (e `TaskService`) deve aplicar verificação de unicidade pelo nome normalizado (`name.trim().toLowerCase()`) no escopo de `organizationId`, lançando `ConflictError` em caso de colisão semântica na criação ou renomeação.

### 2. Segurança de Anexos Binários e Prevenção de `PrematureCommitError`

1. **Cálculo de hash e leitura binária estritamente fora da transação Dexie (`ADR-0007` §3.3):**
   - A leitura dos bytes em `Uint8Array`, a validação de nome/MIME/tamanho e o cálculo criptográfico de `checksumSha256` (via Web Crypto `crypto.subtle.digest('SHA-256', ...)` ou utilitário assíncrono equivalente) **devem ocorrer integralmente antes** de invocar `TransactionPort.run(...)`.
   - É expressamente proibido aguardar APIs não-Dexie (`FileReader`, `Blob.arrayBuffer()`, `crypto.subtle`, `fetch`) dentro do callback de `TransactionPort.run(...)`, prevenindo `PrematureCommitError` por fechamento prematuro da transação IndexedDB.
2. **Persistência atômica de metadados e blob binário:**
   - Dentro de `TransactionPort.run([TRANSACTION_RESOURCES.TASKS, TRANSACTION_RESOURCES.TASK_ATTACHMENTS, TRANSACTION_RESOURCES.ATTACHMENT_BLOBS, TRANSACTION_RESOURCES.AUDIT_EVENTS], ...)`, o caso de uso grava atomicamente o descritor `TaskAttachment` em `taskAttachments`, grava os bytes em `attachmentBlobs` via `AttachmentBlobStorePort.putBlob` (que impõe clonagem defensiva de `Uint8Array`, MIME não vazio e `assertSameOrganization`) e atualiza `lastActivityAt` / `updatedAt` da tarefa (preservando `lastMovedAt`).
   - Na exclusão de anexo, o caso de uso remove metadados (`TaskAttachmentRepositoryPort.delete`) e blob binário (`AttachmentBlobStorePort.deleteBlob`) dentro da mesma transação com auditoria.
3. **Limites normativos, denylist MIME e política organizacional (`DATA-PERSISTENCE.md`, `permission-matrix.md` §12):**
   - Validar via `validateTaskAttachmentSize` / `validateAttachmentQuota`: máximo **`15 MB`** (`MAX_ATTACHMENT_SIZE_BYTES`) por arquivo, máximo **`50 MB`** (`MAX_CONTEXT_ATTACHMENTS_SIZE_BYTES`) cumulativos por tarefa (ou limites configurados em `OrganizationSettings.pendingPermissionDefaults.maxAttachmentSizeBytes` e `maxContextAttachmentsSizeBytes`) e limite máximo de quantidade por contexto (`OrganizationSettings.pendingPermissionDefaults.maxAttachmentsPerContext`, padrão `10`).
   - Aplicar a denylist canônica **`DISALLOWED_ATTACHMENT_MIME_TYPES`** (e `isDisallowedAttachmentMimeType`) exportada em `@/shared/kernel` (`src/shared/kernel/attachments.ts`), normalizando o MIME base (removendo parâmetros como `; charset=utf-8`) para rejeitar executáveis e tipos web ativos (`image/svg+xml`, `text/html`, `application/x-msdownload`, `application/x-sh`, etc.) com `ValidationError` (`details.field: 'mimeType'`, `reason: 'DISALLOWED_MIME_TYPE'`, HTTP `422`), além de rejeitar arquivos vazios (`sizeBytes <= 0`), nomes vazios/inválidos e MIME types vazios ou fora da allowlist configurada (com validação equivalente na UI do `TaskAttachmentsPanel`).
4. **Revalidação estrita no download e paridade `TRASH_VIEW` em leituras (`permission-matrix.md` §8):**
   - A obtenção do conteúdo binário de anexo (`getTaskAttachmentContent` / endpoint de download) e as demais leituras da tarefa (`getTaskDetail`, `listTaskComments`, `listTaskAttachments`, `listTaskDeadlineHistory`) **devem revalidar integralmente** `PERMISSION_CODES.TASK_VIEW` (ou `PERMISSION_CODES.TASK_HISTORY_VIEW` para `deadlineHistory` / `listTaskDeadlineHistory`) em tarefas ativas e **`PERMISSION_CODES.TRASH_VIEW`** quando a tarefa estiver excluída logicamente (`deletedAt`) em projeto ativo — falhando fechado com `409 Conflict` (`ConflictError`) caso o projeto também esteja excluído logicamente — considerando associação organizacional ativa, isolamento por `organizationId`, vínculo de autoria/participação/escopo e `ExplicitDenyRule` antes de invocar `AttachmentBlobStorePort.getBlob`.
5. **Tratamento não-destrutivo de `QuotaExceededError` e borda MSW:**
   - Qualquer `QuotaExceededError` do navegador/IndexedDB é traduzido por `withPersistenceErrorHandling` / `translateDexieError` em `InfrastructureError` diagnóstico (`reason: 'STORAGE_QUOTA_EXCEEDED'`), **jamais** apagando anexos ou dados de negócio automaticamente. Em eventuais falhas após operações preparatórias, aplicar somente limpeza compensatória segura do novo blob órfão se alguma etapa fora do escopo transacional tiver sido criada, sem nunca remover anexos válidos preexistentes.
   - Conversões de transporte **`contentBase64` ↔ `Uint8Array`** (ou equivalentes serializados em JSON para `HttpClient` / MSW) permanecem **restritas exclusivamente à borda MSW / cliente HTTP**; `TaskService`, `domain/` e `AttachmentBlobStorePort` operam somente com `Uint8Array`.

### 3. DAG Acíclico, Portas Locais Mínimas e Blindagem Mecânica no ESLint

1. **Preservação absoluta do módulo-folha `src/modules/authorization/**`:** permanece 100% proibido de importar qualquer outro módulo em `src/modules/*` (`ADR-0006`, `ADR-0009`, `eslint.config.js`).
2. **Portas locais mínimas anti-ciclo (`ADR-0010` §3.4):**
   - Como `projects` e `kanban` importam contratos públicos de `@/modules/tasks`, e `kanban` importa contratos de `@/modules/dependencies` e `@/modules/impediments`, é **proibido** aos módulos `tasks`, `dependencies` e `impediments` importar `@/modules/projects` ou `@/modules/kanban`, bem como é **proibido** a `dependencies` e `impediments` importar `@/modules/tasks`.
   - Declaram-se três portas locais mínimas em `application/ports/` de cada módulo, com adaptadores finos residindo exclusivamente em **`src/app/composition/task-ports-adapter.ts`**:
     - **`TaskProjectContextPort`** (`src/modules/tasks/application/ports/`): consulta projeto (estado `status`, `archivedAt`, `deletedAt`, `teamId`, `ownerUserId`), membros ativos do projeto (`ProjectMember` / papéis e escopos geridos/participados), quadro primário e colunas (`ProjectBoard` / `BoardColumn` para validação de coluna inicial/operacional/final e contagem de ocupação WIP) sem importar `@/modules/projects` ou `@/modules/kanban`.
     - **`DependencyWorkContextPort`** (`src/modules/dependencies/application/ports/`): consulta dados de projeto/escopos de equipe/projeto e projeções mínimas de tarefa (`id`, `projectId`, `status`, `deletedAt`, `createdByUserId`, `assigneeId`, `participantIds`) para avaliar `DEPENDENCY_MANAGE`, `DEPENDENCY_VIEW` (incluindo `relatedTasksAccessible`) e integridade intra-projeto sem importar `@/modules/tasks`, `@/modules/projects` ou `@/modules/kanban`.
     - **`ImpedimentWorkContextPort`** (`src/modules/impediments/application/ports/`): consulta contexto mínimo de projeto/tarefa e aplica atualização sincronizada de status operacional da tarefa (`BLOCKED` na abertura de impedimento bloqueante e restauração do status operacional apropriado ao desbloquear o último impedimento bloqueante, atualizando `lastActivityAt` sem alterar `lastMovedAt`) dentro da mesma transação sem importar `@/modules/tasks`, `@/modules/projects` ou `@/modules/kanban`.
3. **Blindagem mecânica em `eslint.config.js` (`BOUNDARIES_POLICIES`):**
   - Adicionam-se regras `disallow` explícitas para código de produção (`module-domain`, `module-application`, `module-infrastructure`, `module-presentation`, `module-public-api`), posicionadas antes da regra de exceção para `categories: 'test'` (`BOUNDARIES_FILES`) para que suítes de testes legítimas (como `core-work-invariants.test.ts` e `project-service.integration.test.ts`) continuem válidas:
     - `tasks` **PROIBIDO** de importar `projects` e `kanban`;
     - `projects` **PROIBIDO** de importar `teams` e `kanban`;
     - `dependencies` **PROIBIDO** de importar `tasks`, `projects` e `kanban`;
     - `impediments` **PROIBIDO** de importar `tasks`, `projects` e `kanban`;
     - `authorization` **PROIBIDO** de importar qualquer outro módulo em `src/modules/*`.
   - Todas as proibições negativas do DAG são verificadas automaticamente por testes automatizados em `src/test/architecture-boundaries.test.ts`.

### 4. Decisão Normativa A — Exclusão Lógica de Tarefa (`deleteTask`)

1. **Permissão canônica (`PERMISSION_CODES.TASK_CANCEL`):** conforme o catálogo fechado de 89 códigos de `permission-matrix.md` §9 e `policy-engine.ts`, a exclusão lógica de uma tarefa (`deleteTask`) é protegida por **`PERMISSION_CODES.TASK_CANCEL`** (regra `adminOrManagedProjectRule`: autorizada para `ADMIN` e `MANAGER` administrando o projeto, e negada por padrão a `MEMBER`, salvo concessão explícita delegável em `MANAGER_DELEGABLE_PERMISSIONS`).
2. **Contexto ABAC e pré-condições:** a avaliação propaga obrigatoriamente `organizationId`, `projectId`, `teamId`, `ownerUserId`, `projectArchivedAt: project.archivedAt`, `deletedAt: task.deletedAt ?? project.deletedAt`, `taskId`, `createdBy`, `assigneeId` e `participantIds`, bloqueando execução em projetos arquivados (`DENIED_PROJECT_ARCHIVED`) ou tarefas/projetos já excluídos (`DENIED_RESOURCE_DELETED`).
3. **Revogação imediata de grants `RESOURCE` e trilha atômica:** dentro de `TransactionPort.run([TRANSACTION_RESOURCES.TASKS, TRANSACTION_RESOURCES.PERMISSION_GRANTS, TRANSACTION_RESOURCES.AUDIT_EVENTS], ...)`:
   - marca `deletedAt`, `deletedBy` e `deletionReason?` na entidade `Task` (`SoftDeletable`);
   - revoga imediatamente todas as concessões vinculadas ao escopo `PERMISSION_SCOPE_TYPES.RESOURCE` da tarefa (`PermissionGrantRepositoryPort.revokeAllByScope(organizationId, PERMISSION_SCOPE_TYPES.RESOURCE, asEntityId(taskId), actorUserId, now)`);
   - grava `AuditEvent` (`category: 'TASK'`, `eventType: 'task.deleted'`) e publica evento pós-commit `task.deleted`.

### 5. Decisão Normativa B — Permissões de Etiquetas (`Tag`)

1. **Catálogo organizacional de `Tag` (CRUD global da organização):**
   - Criar, editar e excluir etiquetas do catálogo organizacional (`createTag`, `updateTag`, `deleteTag`) são ações de configuração organizacional protegidas exclusivamente por **`PERMISSION_CODES.ORGANIZATION_SETTINGS_MANAGE`** (**exclusivo `ADMIN`** via `adminExclusiveRule`).
   - Exclusão de etiqueta do catálogo remove atomicamente seu `TagId` de `task.tagIds` nas tarefas da mesma organização que a referenciarem, com registro de `AuditEvent`.
   - Listagem/leitura do catálogo (`listTags`) é permitida a qualquer membro `ACTIVE` da organização ativa (somente metadados mínimos `id`, `name`, `colorToken?`).
2. **Associação e remoção de etiquetas em tarefa (`tagIds`):**
   - Atribuir ou remover etiquetas em uma tarefa específica é avaliado com **`PERMISSION_CODES.TASK_UPDATE`** preenchendo **`requestedFields: ['tags']`** no `AuthorizationResource`.
   - Desse modo, conforme `permission-matrix.md` §5.5 (*"Editar etiquetas: Member pode editar etiquetas da tarefa se possuir permissão operacional; catálogo/definições globais permanecem restritos"*), `ADMIN`, `MANAGER` do projeto e `MEMBER` responsável ou participante ativo da tarefa podem associar/remover etiquetas existentes da organização sem elevar acesso ao catálogo organizacional.

### 6. Sincronização `PendingPermissionDefaults` ↔ `AuthorizationPolicyConfig` e Simetria `MANAGER`

1. **Sincronização completa em `OrganizationSettings` (`src/modules/settings/domain/organization-settings.ts`):**
   - `PendingPermissionDefaults` passa a incluir explicitamente:
     - `readonly allowMemberManageSubtasksInAccessibleTask?: boolean;`
     - `readonly allowMemberResolveOthersImpediment?: boolean;`
   - Ambas iniciam como **`false`** (*Default Deny*) dentro de `createDefaultOrganizationSettings`.
   - Toda avaliação de autorização nos serviços da Fase 07 (`TaskService`, `ImpedimentService`) e em `KanbanService` lê `OrganizationSettings` da organização (com fallback seguro em `createDefaultOrganizationSettings`) e injeta o bloco `policyConfig` completo em `AuthorizationContext`: `commentEditWindowMinutes`, `allowMemberCreateTaskInProject`, `allowMemberUpdateTaskPriority`, `allowMemberUpdateTaskDueDate`, `allowFieldLevelTemporaryGrants`, `allowMemberManageSubtasksInAccessibleTask` e `allowMemberResolveOthersImpediment`.
2. **Simetria para `MANAGER` participante de projeto no `policy-engine.ts`:**
   - Em **`PERMISSION_CODES.SUBTASK_MANAGE`:** quando `ctx.role === ORGANIZATION_ROLES.MANAGER` e `!ctx.managesProject`, após verificar `ctx.matchedGrant !== undefined`, se `ctx.participatesInProject && ctx.isTaskActor && ctx.policyConfig.allowMemberManageSubtasksInAccessibleTask`, retorna `allowByRole(ctx)`.
   - Em **`PERMISSION_CODES.IMPEDIMENT_RESOLVE`:** quando `ctx.role === ORGANIZATION_ROLES.MANAGER` e `!ctx.managesProject`, após verificar `ctx.matchedGrant !== undefined` e `ctx.managesProject`, se `ctx.participatesInProject && ctx.isTaskActor && (ctx.isResourceCreator || ctx.policyConfig.allowMemberResolveOthersImpediment)`, retorna `allowByRole(ctx)`.
   - **Preservação inviolável do Cenário 6 (`permission-matrix.md` §11):** ser responsável ou participante apenas de uma subtarefa (`isSubtaskActor: true`, `isTaskActor: false`) habilita exclusivamente `SUBTASK_COMPLETE` (quando aplicável), **nunca** concedendo `TASK_UPDATE`, `TASK_MOVE`, `TASK_COMPLETE` nem `SUBTASK_MANAGE` sobre a tarefa-pai.

### 7. Preenchimento ABAC Completo

Todas as avaliações submetidas a `assertAuthorized` / `evaluateAuthorization` nos serviços da Fase 07 devem preencher de forma completa e não-omissiva os atributos do `AuthorizationResource`:

- **Contexto organizacional e de projeto:** `exists`, `organizationId`, `projectId`, `teamId: project?.teamId`, `ownerUserId: project?.ownerUserId`, `projectArchivedAt: project?.archivedAt`, `deletedAt: entityDeletedAt ?? project?.deletedAt`.
- **Contexto de tarefa:** `taskId`, `createdBy: task?.createdByUserId` (ou autor do comentário/impedimento na respectiva ação), `assigneeId: task?.assigneeId`, `participantIds` (IDs dos `TaskParticipant` com `removedAt === undefined`).
- **Contexto de subtarefa e campos:** `subtaskId`, `subtaskAssigneeId` (em `SUBTASK_COMPLETE` / `SUBTASK_ASSIGN` / `SUBTASK_MANAGE`), `requestedFields` (em `TASK_UPDATE`, discriminando exatamente os campos alterados dentre `'title' | 'description' | 'priority' | 'dueDate' | 'tags'`).
- **Contexto de dependências:** `relatedTasksAccessible` (em `DEPENDENCY_VIEW`, exigindo permissão `TASK_VIEW` em ambas as tarefas da aresta; caso contrário define `false`, fazendo o motor negar por `DENIED_OUT_OF_SCOPE` sem vazar título ou estado da tarefa não autorizada).

### 8. Regras de Comentários (`TaskComment`)

1. **Criação e consulta:** criação protegida por `PERMISSION_CODES.TASK_COMMENT` (exige projeto operacional e vínculo autorizado com a tarefa); consulta protegida por `PERMISSION_CODES.TASK_VIEW` (comentar jamais concede acesso permanente à tarefa). Comentários do usuário possuem `isSystem: false`; registros automáticos de sistema usam `isSystem: true`.
2. **Edição (`updateTaskComment`):**
   - Exige `PERMISSION_CODES.TASK_COMMENT`, **autoria estrita** (`comment.authorUserId === actorUserId`, negando edição por terceiros mesmo com papel superior) e validação de `assertTaskCommentEditable(comment)` (bloqueando com `ConflictError` comentários com `isSystem: true` ou `deletedAt !== undefined`).
   - Aplica a janela configurável `effectiveSettings.pendingPermissionDefaults.commentEditWindowMinutes`: se `<= 0` (*Default Deny*), edição é negada com `AuthorizationError`; se `> 0`, exige `(parseIsoDateTimeMs(now) - parseIsoDateTimeMs(comment.createdAt)) <= commentEditWindowMinutes * 60_000`.
   - Atualiza `body`, `editedAt = now`, `updatedAt = now`, `task.lastActivityAt = now` (preservando `task.lastMovedAt`) e grava `AuditEvent`.
3. **Exclusão (`deleteTaskComment`):**
   - Protegida por `PERMISSION_CODES.TASK_COMMENT` + autoria estrita **ou** autoridade administrativa de `ADMIN` / `MANAGER` administrando o projeto (`managesProject`).
   - Protege comentários com `isSystem: true` e já excluídos via `assertTaskCommentEditable(comment)` (`ConflictError`), aplica soft-delete (`deletedAt`, `deletedBy`, `deletionReason?`), registra `AuditEvent` (`task.comment.deleted`) e preserva histórico lógico.

### 9. Invariantes Temporais, Ciclos, Quadro Kanban, Dependências e Impedimentos

1. **Separação estrita `lastMovedAt` vs `lastActivityAt` (`PRD.md` §12.1):**
   - `lastMovedAt` é atualizado **somente** quando ocorre alteração de coluna Kanban (`columnId` alterado entre colunas distintas).
   - Edição de campos, alteração de responsável/participantes/tags, criação/atualização/conclusão de subtarefas, pausas/retomadas, comentários, anexos, dependências, impedimentos e reordenação dentro da mesma coluna atualizam exclusivamente `lastActivityAt` e `updatedAt`, **preservando `lastMovedAt` intacto**.
2. **Histórico imutável de prazos (`TaskDeadlineHistoryEntry` — `PRD.md` §10):**
   - Toda alteração de `dueDate` na tarefa (inclusive atribuição inicial após criação ou remoção/adiamento) grava registro append-only via `TaskDeadlineHistoryRepositoryPort.append` (`table.add`) com `previousDueDate`, `newDueDate`, `changedByUserId`, `changedAt` e `justification?`.
3. **Ciclos `TaskExecutionCycle`, Pausas `TaskPause` e Sincronização Bidirecional com Quadro Kanban:**
   - **`createTask` (`TASK_CREATE`):** valida `OrganizationSettings.pendingPermissionDefaults.allowMemberCreateTaskWithoutGrant`, exige projeto operacional, valida coluna destino ativa e não-`FINAL`, valida WIP (`assertWipAllowsCardMove`), exige `PERMISSION_CODES.TASK_ASSIGN` quando `assigneeId !== undefined && assigneeId !== actorUserId`, cria `Task` e `TaskExecutionCycle` inicial (`cycleNumber: 1`, `effectiveStartedAt` quando iniciar em coluna `OPERATIONAL`/`IN_PROGRESS`) e `TaskDeadlineHistoryEntry` inicial se `dueDate` for informado.
   - **`startTask` (`TASK_START`):** transita tarefa `TODO` para `IN_PROGRESS`, preenche `startedAt` na tarefa e `effectiveStartedAt` no ciclo ativo; se estiver em coluna `INITIAL`, move para a primeira coluna `OPERATIONAL` ativa elegível (respeitando WIP e atualizando `lastMovedAt`).
   - **`pauseTask` / `resumeTask` (`TASK_PAUSE`):** `pauseTask` exige justificativa não vazia (`assertTaskPauseJustification`), bloqueia tarefas terminais (`DONE`/`CANCELLED`) ou já pausadas, cria `TaskPause` aberto vinculado ao ciclo aberto e define `status: 'PAUSED'`. `resumeTask` encerra o `TaskPause` aberto (`endedAt`, `endedByUserId`) e restaura o status operacional adequado (`BLOCKED` se houver impedimento bloqueante aberto, caso contrário `IN_PROGRESS` ou `TODO` conforme coluna/início).
   - **`completeTask` (`TASK_COMPLETE`):** valida `assertTaskCanBeCompleted` (todas as subtarefas `required` em `DONE` ou `CANCELLED`, zero impedimentos bloqueantes via `isImpedimentBlocking`, e zero dependências obrigatórias pendentes salvo exceção autorizada por `DEPENDENCY_MANAGE` com justificativa não vazia e auditada), move para coluna `FINAL` ativa (se não estiver nela, atualizando `lastMovedAt`), define `status: 'DONE'`, preenche `completedAt` e fecha o `TaskExecutionCycle` aberto (e eventuais pausas abertas de ciclo quando aplicável).
   - **`cancelTask` (`TASK_CANCEL`) vs `requestTaskCancellation` (`PRD.md` §10):**
     - `cancelTask` é restrito a `ADMIN`, `MANAGER` administrando o projeto ou portador de grant `TASK_CANCEL`, exige justificativa não vazia (`assertTaskCanBeCancelled`), define `status: 'CANCELLED'`, `cancelledAt`, `cancellationReason` (liberando ocupação de WIP), encerra ciclo/pausas abertas e grava `AuditEvent`.
     - `requestTaskCancellation` permite ao `MEMBER` responsável/participante da tarefa registrar solicitação auditável de cancelamento (com justificativa obrigatória via comentário/registro estruturado e `AuditEvent` `task.cancellation_requested`) sem cancelar a tarefa diretamente.
   - **`reopenTask` (`TASK_REOPEN`):** cria obrigatoriamente novo `TaskExecutionCycle` via `assertTaskReopenCreatesNewCycle` preservando integralmente ciclos anteriores, limpa `completedAt` (ou estado cancelado quando aplicável), move para coluna `OPERATIONAL`/`INITIAL` ativa respeitando WIP e registra `AuditEvent`.
   - **`restoreTask` (`TRASH_RESTORE`):** revalida existência e estado operacional do projeto, coluna de destino ativa no quadro (realocando para coluna inicial/operacional ativa se a coluna original tiver sido arquivada/excluída), limites de WIP e integridade de dependências, limpando `deletedAt`/`deletedBy`/`deletionReason` atomicamente com auditoria.
4. **Dependências (`TaskDependency`):**
   - `addDependency` (`DEPENDENCY_MANAGE`): impede auto-dependência e ciclos diretos ou indiretos no projeto via `assertNoDependencyCycle`, impede duplicidade via `TaskDependencyRepositoryPort.findByPair`, impede relações entre projetos diferentes ou organizações diferentes (`assertSameOrganization`) e audita a operação.
   - `listTaskDependencies` (`DEPENDENCY_VIEW`): verifica visibilidade `TASK_VIEW` de cada tarefa relacionada para preencher `relatedTasksAccessible`, garantindo não divulgação de tarefas fora do escopo do ator.
5. **Impedimentos (`Impediment`):**
   - Modela exatamente as 7 categorias de `IMPEDIMENT_CATEGORIES`, severidades `IMPEDIMENT_SEVERITIES` e transições de `assertImpedimentTransitionAllowed` (`OPEN`, `IN_RESOLUTION`, `RESOLVED`, `CANCELLED`).
   - Impedimento bloqueante aberto mantém ou transita a tarefa associada para `status: 'BLOCKED'` (que continua contando no cálculo de WIP — `doesTaskStatusOccupyWip('BLOCKED') === true`).
   - Resolver ou cancelar o último impedimento bloqueante **jamais conclui automaticamente a tarefa (`autoCompletesTask: false`)**: apenas restabelece o estado operacional elegível (`PAUSED` se houver pausa aberta, senão `IN_PROGRESS` se já iniciada ou `TODO`), mantendo `lastMovedAt` preservado.

### 10. Endurecimentos Herdados da Fase 06 e Fronteira Estreita com a Fase 08+

1. **Incorporação integral dos 4 endurecimentos da Fase 06 (`reports/fase-06-evidencias.md` §4.1):**
   - **Endurecimento 1 (`TASK_ASSIGN` em `createQuickCard`):** em `KanbanService.createQuickCard` (e em `TaskService.createTask`), exigir `PERMISSION_CODES.TASK_ASSIGN` sempre que `assigneeId` for informado para terceiro (`validatedAssigneeId !== validatedActorId`).
   - **Endurecimento 2 (guarda de coluna arquivada em `deleteColumn`):** em `assertColumnCanBeDeleted` / `KanbanService.deleteColumn`, rejeitar `migrationTargetColumn` arquivada (`archivedAt !== undefined`) mesmo quando `activeTaskCount === 0` e existirem apenas tarefas soft-deleted na coluna.
   - **Endurecimento 3 (cópia do diálogo de exceção no Kanban):** em `kanban-board-panel.tsx`, diferenciar título e rótulo do diálogo inline quando `pendingException.kind` for `'PAUSED_OVERRIDE'` ou `'DEPENDENCY_OVERRIDE'`, eliminando reutilização do título de WIP.
   - **Endurecimento 4 (simetria do botão `"Abrir quadro Kanban"`):** em `projects-panel.tsx`, condicionar a exibição do botão `"Abrir quadro Kanban"` nos itens da lista lateral à mesma regra de autorização (`canOpenSelectedProjectBoard` / `BOARD_VIEW`).
2. **Fronteira estrita vs Fase 08+:**
   - Os serviços da Fase 07 (`TaskService`, `DependencyService`, `ImpedimentService`) **não** calculam pontuação ou ordenação do Modo Foco (`focus`), não geram/resolvem `BottleneckAlert` (`bottlenecks`), não despacham notificações (`notifications`) e não expõem Lixeira unificada global (`trash`, Fase 12). Toda integração futura consome os eventos pós-commit publicados por `PostCommitDomainEventBus`.

## Alternativas Consideradas

1. **Executar migração Dexie `v2 -> v3` para adicionar índice único case-insensitive em `tags` ou relaxar `&[organizationId+taskId+userId]`:** descartada porque o Schema `v2` (`51` tabelas) já contempla todas as stores da Fase 07; a unicidade normalizada em `Tag` e o reuso de `existing.id` em `TaskParticipant` resolvem os casos sem migração disruptiva.
2. **Calcular `checksumSha256` ou ler `File`/`Blob` dentro de `TransactionPort.run(...)`:** descartada porque Promises não-Dexie (como `crypto.subtle.digest` e `Blob.arrayBuffer`) fecham prematuramente a transação IndexedDB gerando `PrematureCommitError` (`ADR-0007` §3.3).
3. **Permitir importação direta entre `tasks`, `projects`, `kanban`, `dependencies` e `impediments` no ESLint:** descartada porque criaria ciclos bidirecionais proibidos por `import-x/no-cycle` e acoplamento forte entre domínios/aplicação; portas locais mínimas com adaptadores em `src/app/composition/task-ports-adapter.ts` garantem um DAG estritamente acíclico.
4. **Criar um novo código de permissão para `deleteTask` ou exigir `ORGANIZATION_SETTINGS_MANAGE` para atribuir tags em tarefas:** descartada porque o catálogo normativo possui exatamente 89 códigos fechados (`permission-matrix.md` §9) e `permission-matrix.md` §5.5 determina expressamente que membros podem editar etiquetas na tarefa acessível enquanto o catálogo global permanece restrito a administração organizacional.
5. **Manter `MANAGER` participante de projeto bloqueado em `SUBTASK_MANAGE` / `IMPEDIMENT_RESOLVE` quando `OrganizationSettings` habilita membros:** descartada por criar inversão assimétrica onde `MEMBER` tinha mais autoridade operacional que `MANAGER` participante na mesma tarefa.

## Consequências

- **Positivas:** Schema Dexie `v2` (`51` tabelas) 100% preservado; zero novas dependências NPM; anexos binários seguros contra `PrematureCommitError`, vazamento cross-tenant e `QuotaExceededError`; DAG acíclico protegido mecanicamente no CI pelo ESLint (`tasks`, `projects`, `dependencies`, `impediments`, `authorization`); decisões normativas claras para `deleteTask` (`TASK_CANCEL` + `revokeAllByScope`) e `Tag` (`ORGANIZATION_SETTINGS_MANAGE` no catálogo vs `TASK_UPDATE` `['tags']` na tarefa); paridade entre `OrganizationSettings` e `policy-engine.ts`; preservação estrita de `lastMovedAt` vs `lastActivityAt` e de todos os ciclos históricos `TaskExecutionCycle`.
- **Trade-offs:** exige manter `src/app/composition/task-ports-adapter.ts` adaptando `TaskProjectContextPort`, `DependencyWorkContextPort` e `ImpedimentWorkContextPort`; obriga a borda MSW a encapsular a codificação/decodificação `contentBase64` ↔ `Uint8Array` para anexos; requer propagação explícita de `PendingPermissionDefaults` e de todos os atributos ABAC (`projectArchivedAt`, `deletedAt`, `requestedFields`, `relatedTasksAccessible`) em todos os fluxos de serviço.
