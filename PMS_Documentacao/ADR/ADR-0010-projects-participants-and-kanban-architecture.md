# ADR-0010 --- Arquitetura de Projetos, Participantes e Quadro Kanban

- **Status:** Aceita
- **Data:** 2026-11-21
- **Fase:** 06 — Projetos, Participantes e Quadro Kanban
- **Responsáveis:** Arquiteto de Software (redação) / PMS Orchestrator (aprovação)
- **Referências normativas:** `PRD.md` (§8, §9, §10, §12.1, §22, §23, §24), `PERMISSIONS.md`, `SECURITY.md`, `ARCHITECTURE.md`, `DOMAIN.md`, `MODULES.md`, `DATA-PERSISTENCE.md`, `API-SIMULATION.md`, `ACCESSIBILITY.md`, `CODING-STANDARDS.md`, `ADR-0001..0009`, `docs/contracts/permission-matrix.md` (§4.2, §5.3, §5.4, §7, §11), `docs/contracts/api-endpoints.md` (§6, §9), `docs/contracts/event-envelope.md`.

## Contexto

Com a fundação técnica, o motor RBAC + ABAC em módulo-folha, o banco local Dexie v4 (Schema v2 / 51 tabelas), os simuladores MSW v2 e os fluxos completos de Autenticação, Usuários, Organizações, Convites, Equipes e Gestão de Permissões concluídos nas Fases 01–05 (`ADR-0004..0009`), a Fase 06 entrega os fluxos completos de **Gestão de Projetos, Participantes e Quadro Kanban com controle de WIP e movimentação acessível de cartões**.

Para preservar integralmente a pureza do domínio, as fronteiras mecânicas do `eslint.config.js`, a aciclicidade do grafo de módulos (`import-x/no-cycle`) inclusive frente à Fase 07 (`tasks`), a estabilidade do Schema Dexie `v2`, a autoridade única dos casos de uso sobre o transporte MSW e os requisitos de acessibilidade WCAG 2.2 AA, seis decisões arquiteturais precisam ser formalizadas:

1. Seleção, isolamento em `presentation/` e requisitos de acessibilidade das dependências de Drag and Drop (`@dnd-kit/*`).
2. Preservação do Schema Dexie `v2` (`51` tabelas), complementos pontuais de repositório e regra de reativação de `ProjectMember`.
3. Manutenção do DAG acíclico entre módulos (eliminando potenciais ciclos `teams <-> projects` e `projects <-> kanban`) e regra prospectiva obrigatória para a Fase 07 (`tasks`).
4. Invariantes transacionais, de escopo e de auditoria de `ProjectService`.
5. Invariantes de `KanbanService` (WIP, colunas, ciclo de vida de movimentação, contexto ABAC completo) e criação mínima `createQuickCard`.
6. Saneamento dos handlers MSW legados, atualização de `docs/contracts/api-endpoints.md` §9 e encerramento dos débitos herdados da Fase 05.

## Decisão

### 1. Dependências Drag and Drop e Pureza de Camadas

1. **Pacotes oficiais instalados na Fase 06 (`ADR-0004` §3):**
   - `@dnd-kit/core@^6.3.1`
   - `@dnd-kit/sortable@^10.0.0`
   - `@dnd-kit/utilities@^3.2.2`
2. **Compatibilidade estrita sem `pnpm.overrides`:** os três pacotes resolvem com `0` warnings de `peerDependencies` sobre `react@^18.3.1` e `react-dom@^18.3.1` (`pnpm install --frozen-lockfile` limpo). É proibido adicionar `pnpm.overrides` para contornar incompatibilidades de dependência.
3. **Isolamento estrito na camada `presentation/`:** conforme `eslint.config.js` e `ADR-0005`, imports de `@dnd-kit/*` são permitidos exclusivamente na camada `presentation/` (`src/modules/*/presentation/**`), permanecendo bloqueados em `domain/`, `shared/kernel/`, `shared/errors/`, `application/` e `infrastructure/`.
4. **Acessibilidade obrigatória WCAG 2.2 AA (`ACCESSIBILITY.md`, `PRD.md` §9):**
   - Configurar `PointerSensor` com restrição de ativação `{ activationConstraint: { distance: 6 } }` (evitando arrastos acidentais ao clicar em botões/cartões) e `KeyboardSensor` para navegação por teclado.
   - Fornecer controles alternativos explícitos por teclado e botão (reordenação/movimentação entre colunas sem depender exclusivamente de gesto de ponteiro), com alvos de toque/interação de no mínimo `44x44px` (WCAG 2.2 SC 2.5.8).
   - Anunciar movimentações, reordenações e bloqueios/erros em região viva `aria-live="polite"`.

### 2. Preservação do Schema Dexie `v2` (`51` Tabelas) e Complementos de Repositório

1. **Zero migração `v2 -> v3`:** todas as tabelas exigidas pela Fase 06 (`projects`, `projectMembers`, `projectBoards`, `boardColumns`, `tasks`, `subtasks`, `taskDependencies`, `impediments`, `taskPauses`, `taskExecutionCycles`, `organizationSettings`, `auditEvents`, `teams`, `permissionGrants`, `explicitDenyRules`) já compõem as 51 stores do `PmsDatabase` Schema v2 (`src/shared/persistence/pms-database.ts`).
2. **Complementos no módulo `tasks` (`TaskRepositoryPort` / `DexieTaskRepository`):**
   - Adicionar `saveMany(organizationId: OrganizationId, tasks: readonly Task[]): Promise<void>` delegando a `saveManyOrganizationScopedEntities` para persistência atômica em lote (ex.: migração de tarefas na exclusão de coluna e reordenação em lote).
   - Estender `listByColumn(organizationId: OrganizationId, columnId: BoardColumnId, options?: { readonly includeDeleted?: boolean }): Promise<readonly Task[]>` utilizando `filterSoftDeleted(records, options?.includeDeleted)` para que operações estruturais (como `deleteColumn`) possam migrar tanto tarefas ativas quanto logicamente excluídas sem perder integridade referencial da Lixeira.
3. **Complemento no módulo `projects` (`ProjectMemberRepositoryPort` / `DexieProjectMemberRepository`):**
   - Adicionar `saveMany(organizationId: OrganizationId, members: readonly ProjectMember[]): Promise<void>` delegando a `saveManyOrganizationScopedEntities` (ex.: encerramento em lote de membros ativos em `deleteProject`).
4. **Reativação obrigatória por `existingMember.id` em `ProjectMember`:**
   - A store `projectMembers` em `PMS_SCHEMA_V2_STORES` declara o índice composto único `'id, &[organizationId+projectId+userId], [organizationId+projectId], [organizationId+userId]'`.
   - Ao readicionar um ex-participante que já possua registro com `removedAt !== undefined`, `ProjectService` **deve reutilizar `existingMember.id`** (atualizando `projectRole`, `joinedAt` e limpando `removedAt`), prevenindo `ConstraintError` / `ConflictError` decorrente de colisão na chave única `&[organizationId+projectId+userId]`.

### 3. DAG Acíclico entre Módulos e Regra Prospectiva da Fase 07

1. **Preservação do módulo-folha `src/modules/authorization/**`:** permanece 100% proibido de importar qualquer outro módulo de `src/modules/*` (`ADR-0006`, `ADR-0009`, `eslint.config.js`).
2. **Portas locais mínimas em `src/modules/projects/application/ports/`:**
   - Como `teams` já importa `@/modules/projects` (`ProjectRepositoryPort` em `TeamService`) e `kanban` depende de `@/modules/projects` (`ProjectRepositoryPort`, `ProjectMemberRepositoryPort`, `assertProjectOperational`), o módulo `projects` **não pode** importar `@/modules/teams` nem `@/modules/kanban`, evitando ciclos `teams <-> projects` e `projects <-> kanban` bloqueados por `import-x/no-cycle`.
   - `src/modules/projects/application/ports/` declara duas portas locais mínimas:
     - **`ProjectTeamLookupPort`**: consulta existência, status (`archivedAt`, `deletedAt`) e vínculo organizacional de uma equipe na criação e transferência de projeto.
     - **`ProjectBoardInitializerPort`**: cria atomicamente o `ProjectBoard` primário (`Quadro Principal`, `isPrimary: true`) e as 4 colunas padrão dentro da transação de `createProject`.
   - Os adaptadores finos conectando `ProjectTeamLookupPort` (via `TeamRepositoryPort`) e `ProjectBoardInitializerPort` (via `ProjectBoardRepositoryPort` / `BoardColumnRepositoryPort`) residem exclusivamente em `src/app/composition/`.
3. **Direção única e dependências permitidas na Fase 06:**
   - Direção obrigatória **`kanban -> projects`** (nunca `projects -> kanban`) e **`teams -> projects`** (nunca `projects -> teams`).
   - `projects` → `authorization`, `organizations`, `users`, `tasks`, `audit`.
   - `kanban` → `authorization`, `projects`, `tasks`, `dependencies`, `impediments`, `settings`, `audit`.
4. **Regra normativa prospectiva para a Fase 07 (`src/modules/tasks`):**
   - Como `projects` e `kanban` importam contratos públicos de `@/modules/tasks`, **fica expressamente proibido a `src/modules/tasks/**` (Fase 07+) importar diretamente `@/modules/projects` ou `@/modules/kanban`**.
   - Qualquer consulta ou validação de projeto/quadro/coluna necessária aos futuros casos de uso de `TaskService` deverá ser modelada por portas locais mínimas em `src/modules/tasks/application/ports/` e adaptada exclusivamente em `src/app/composition/`.

### 4. Invariantes de `ProjectService`

1. **`createProject` (`PERMISSION_CODES.PROJECT_CREATE`):**
   - Aceita `id?: ProjectId` e `ownerUserId?: UserId` opcionais (viabilizando criação determinística em integrações/MSW e atribuição inicial explícita de responsável).
   - Quando `teamId` é informado, valida via `ProjectTeamLookupPort` que a equipe pertence à mesma organização, existe, **não está arquivada (`archivedAt === undefined`) e não está logicamente excluída (`deletedAt === undefined`)**; além disso, valida que o ator `MANAGER` possui autoridade de escopo sobre a equipe/criação.
   - Executa em transação atômica única (`TransactionPort.run([PROJECTS, PROJECT_MEMBERS, PROJECT_BOARDS, BOARD_COLUMNS, AUDIT_EVENTS], ...)`):
     - persiste `Project` (`status: 'ACTIVE'`, `inactivityThresholdDays >= 1`);
     - cria `ProjectMember` inicial com `projectRole: PROJECT_MEMBER_ROLES.MANAGER` para o `ownerUserId` resolvido (padrão `actorUserId`; quando explícito, exige membro `ACTIVE` na mesma organização e dentro da autoridade do ator);
     - inicializa via `ProjectBoardInitializerPort` o `ProjectBoard` primário (`name: 'Quadro Principal'`, `isPrimary: true`) e as 4 colunas padrão:
       1. `A Fazer` (`columnRole: 'INITIAL'`, `wipLimit: null`, `order: 1`)
       2. `Em Execução` (`columnRole: 'OPERATIONAL'`, `wipLimit: 3`, `order: 2`)
       3. `Em Revisão` (`columnRole: 'OPERATIONAL'`, `wipLimit: 2`, `order: 3`)
       4. `Concluído` (`columnRole: 'FINAL'`, `wipLimit: null`, `order: 4`)
     - registra **exatamente 1** `AuditEvent` (`category: 'PROJECT'`, `eventType: 'project.created'`, `result: 'SUCCESS'`) e publica o evento pós-commit `project.created`.
2. **`updateProject` (`PERMISSION_CODES.PROJECT_UPDATE`) vs `transferProjectTeam` (`PERMISSION_CODES.PROJECT_TRANSFER`):**
   - `updateProject` atualiza apenas metadados permitidos (`name`, `description`, `inactivityThresholdDays`, `ownerUserId` quando autorizado) em projeto não arquivado/não excluído e **é expressamente proibido de alterar `teamId`**.
   - Alteração de equipe é exclusiva de **`transferProjectTeam`**, avaliada com `PERMISSION_CODES.PROJECT_TRANSFER`: valida equipe destino ativa na mesma organização (não arquivada/excluída) e exige que `MANAGER` administre **tanto o escopo/equipe de origem quanto o `targetTeamId` de destino** (`managedTeamIds`), conforme `permission-matrix.md` §5.3.
3. **Proteção ao `ownerUserId` e último `MANAGER` ativo do projeto:**
   - Nenhuma operação de gestão de participantes pode remover ou rebaixar o `ownerUserId` atual sem transferência prévia de propriedade, nem deixar um projeto ativo sem ao menos um `ProjectMember` ativo com `projectRole === 'MANAGER'` (lançando `ConflictError`).
4. **`removeProjectParticipant` (`PERMISSION_CODES.PROJECT_MEMBERS_MANAGE`):**
   - Verifica tarefas pendentes sob responsabilidade do participante no projeto via `TaskRepositoryPort` + `assertParticipantRemovalHandled(pendingTaskCount)` (`ConflictError` se `> 0`, exigindo reatribuição/tratamento prévio — `PRD.md` §8).
   - Marca `removedAt` no `ProjectMember` e invoca `PermissionGrantRepositoryPort.revokeByScope(organizationId, targetUserId, 'PROJECT', projectId, actorUserId, now)` na mesma transação (`permission-matrix.md` §6 regra 6 e §11).
   - **Nunca** altera `OrganizationMember` nem apaga autoria histórica.
5. **`deleteProject` (`PERMISSION_CODES.PROJECT_DELETE` — exclusivo `ADMIN`):**
   - Executa soft-delete (`deletedAt`, `deletedBy`, `deletionReason`), encerra em lote os `ProjectMember` ativos (`removedAt` via `saveMany`) e revoga todas as concessões vinculadas ao projeto via `PermissionGrantRepositoryPort.revokeAllByScope(organizationId, 'PROJECT', projectId, actorUserId, now)` na mesma transação com `AuditEvent`.
6. **`exportProjectData` (`PERMISSION_CODES.PROJECT_VIEW` + `BOARD_VIEW` + `TASK_VIEW`):**
   - Exige `PROJECT_VIEW` e `BOARD_VIEW` sobre o projeto e filtra as tarefas exportadas item a item com `PERMISSION_CODES.TASK_VIEW`, garantindo que `MEMBER` jamais receba dados de tarefas fora de sua visibilidade autorizada (`permission-matrix.md` §5.3) e registrando auditoria da exportação.

### 5. Invariantes de `KanbanService` e `createQuickCard`

1. **Preenchimento obrigatório de `projectArchivedAt` e `deletedAt` no contexto ABAC:**
   - Em **todas** as avaliações de autorização para `BOARD_*` e `TASK_*` submetidas a `assertAuthorized` / `evaluateAuthorization`, o serviço deve preencher explicitamente `projectArchivedAt: project.archivedAt` e `deletedAt: project.deletedAt` (além de `teamId: project.teamId`, `ownerUserId: project.ownerUserId`, `organizationId`, `projectId`), assegurando que o Passo 5 do motor (`policy-engine.ts`) bloqueie imediatamente mutações operacionais em projetos arquivados (`DENIED_PROJECT_ARCHIVED`) ou excluídos (`DENIED_RESOURCE_DELETED`).
2. **Contagem real de WIP (`occupyingTaskCount`) vs filtragem de leitura:**
   - O cálculo de ocupação de WIP por coluna (`occupyingTaskCount`) é computado sobre **todas** as tarefas ativas (não soft-deleted) presentes na coluna cujo status ocupe WIP segundo `doesTaskStatusOccupyWip(task.status)` — **incluindo tarefas `BLOCKED` e `PAUSED`, e excluindo apenas `DONE` e `CANCELLED`** (`PRD.md` §9) —, independentemente de o ator atual poder visualizar cada tarefa individual.
   - A projeção retornada ao usuário na leitura do quadro (`getProjectBoard` / listagem de cartões) filtra os cartões individualmente por `PERMISSION_CODES.TASK_VIEW`, preservando apenas o total agregado (`occupyingTaskCount`) para avaliação fiel de WIP.
3. **`updateColumn` (`BOARD_COLUMNS_MANAGE` / `BOARD_WIP_MANAGE`):**
   - Qualquer alteração em `wipLimit` exige autorização explícita para `PERMISSION_CODES.BOARD_WIP_MANAGE`, além de `PERMISSION_CODES.BOARD_COLUMNS_MANAGE` quando alterar metadados da coluna (`name`, `columnRole`). Valida invariantes estruturais via `assertValidBoardColumns`.
4. **`archiveColumn` (`BOARD_COLUMNS_MANAGE`):**
   - Bloqueia o arquivamento com `ConflictError` se houver qualquer tarefa ativa na coluna e valida via `assertValidBoardColumns` que o quadro mantém ao menos uma coluna operacional ativa (`INITIAL` ou `OPERATIONAL`) e uma coluna `FINAL` ativa.
5. **`reorderColumns` (`BOARD_COLUMNS_MANAGE`):**
   - Exige uma **permutação exata** dos IDs das colunas ativas do quadro (mesma cardinalidade, sem IDs duplicados, ausentes ou pertencentes a outro quadro), gravando as novas ordens via `BoardColumnRepositoryPort.saveMany`.
6. **`deleteColumn` (`BOARD_COLUMNS_MANAGE`):**
   - Valida integridade via `assertColumnCanBeDeleted(column, allBoardColumns, activeTaskCount, migrationTargetColumn)` (`PRD.md` §9).
   - Quando existirem tarefas associadas à coluna — **tanto ativas quanto logicamente excluídas**, consultadas via `TaskRepositoryPort.listByColumn(organizationId, columnId, { includeDeleted: true })` —, migra todas atomicamente para `migrationTargetColumn` via `TaskRepositoryPort.saveMany` dentro da mesma transação antes de chamar `BoardColumnRepositoryPort.delete`.
7. **`moveCard` (`BOARD_CARD_MOVE` + `TASK_MOVE`):**
   - Avalia autorização para `PERMISSION_CODES.BOARD_CARD_MOVE` e `PERMISSION_CODES.TASK_MOVE` sobre o cartão e projeto.
   - Rejeita movimentação de tarefas em estado `CANCELLED` (`ConflictError`).
   - Invoca `assertCardMoveAllowed` verificando projeto arquivado, coluna de destino arquivada, tarefa pausada (com `TaskPauseRepositoryPort` — exigindo retomada ou exceção autorizada com justificativa e auditoria) e limite WIP (`assertWipAllowsCardMove`). Qualquer exceção de WIP exige autorização explícita para `PERMISSION_CODES.BOARD_WIP_MANAGE`, justificativa não vazia e gravação de `AuditEvent`.
   - **Sincronização bidirecional com coluna `FINAL`:**
     - **Entrada em coluna `FINAL`:** exige autorização `PERMISSION_CODES.TASK_COMPLETE` e validação via `assertTaskCanBeCompleted` (verificando subtarefas obrigatórias abertas, impedimentos bloqueantes via `ImpedimentRepositoryPort`/`isImpedimentBlocking` e dependências obrigatórias pendentes via `TaskDependencyRepositoryPort`/`getPendingRequiredDependencies`, com eventual exceção justificada e auditada); transita a tarefa para `status: 'DONE'`, preenche `completedAt` e fecha o ciclo de execução aberto (`TaskExecutionCycleRepositoryPort`).
     - **Saída de coluna `FINAL` (reabertura por movimentação):** exige autorização `PERMISSION_CODES.TASK_REOPEN`, cria novo `TaskExecutionCycle` imutável preservando ciclos anteriores via `assertTaskReopenCreatesNewCycle`, limpa `completedAt` e transita o status operacional para `IN_PROGRESS`/`TODO` conforme a coluna destino, registrando auditoria.
   - **Separação estrita `lastMovedAt` vs `lastActivityAt` (`PRD.md` §12.1):** movimentar cartão entre colunas (`sourceColumnId !== targetColumnId`) atualiza `lastMovedAt`, `lastActivityAt` e `updatedAt`; reordenar na mesma coluna (`sourceColumnId === targetColumnId`) preserva o `lastMovedAt` original (impedindo reset indevido de inatividade) e atualiza apenas `order`, `lastActivityAt` e `updatedAt`.
8. **`createQuickCard` (`PERMISSION_CODES.TASK_CREATE` + `OrganizationSettings`):**
   - Criação mínima de tarefa diretamente no quadro Kanban (`title`, `columnId`, `priority?`), protegida por `PERMISSION_CODES.TASK_CREATE` e parametrizada com `OrganizationSettings` (`OrganizationSettingsRepositoryPort`, passando `allowMemberCreateTaskInProject: settings.pendingPermissionDefaults.allowMemberCreateTaskWithoutGrant` ao contexto de política).
   - Valida projeto operacional, coluna não arquivada do quadro primário, inicializa ordem na coluna destino, ciclo inicial (`TaskExecutionCycle`) quando aplicável, registra `AuditEvent` e publica evento pós-commit.

### 6. Saneamento MSW e Débitos da Fase 05

1. **Migração dos handlers MSW legados (`/projects` e `/projects/:projectId/tasks`):**
   - Remover os handlers legados de `GET/POST */api/v1/organizations/:organizationId/projects` e `GET */api/v1/organizations/:organizationId/projects/:projectId/tasks` que ainda acessam repositórios diretamente em `src/app/composition/msw-handlers.ts`, passando todos os endpoints de Projetos, Participantes e Quadro Kanban a delegar estritamente a `deps.services.projects` e `deps.services.kanban`.
   - Remover os helpers legados `resolveAuthorizationActor` e `authorizeOrThrow` de `src/app/composition/msw-handlers.ts` após a migração integral (eliminando qualquer duplicação residual de lógica de autorização na camada MSW — `ARCHITECTURE.md`, `API-SIMULATION.md`).
2. **Catálogo contratual em `docs/contracts/api-endpoints.md` §9:**
   - Documentar na §9 os endpoints completos da Fase 06 (projetos, transferência de equipe, arquivamento/restauração/exclusão, exportação, participantes, quadro Kanban, colunas, movimentação/reordenação de cartões e criação rápida de card), mantendo paridade com os contratos de resposta e códigos de erro da §4.
3. **Encerramento de débitos herdados da Fase 05:**
   - Exibir **`activeProjectCount`** nos itens de equipe em `TeamsPanel` / `TeamsPage` (`src/modules/teams/presentation/`), reforçando visibilidade antes de tentativas de exclusão.
   - Habilitar seleção assistida de **`projectScopes`** (`PermissionScopeOption[]`) nos formulários de concessão e negação em `PermissionsPage` / `PermissionsPanel` (`src/modules/authorization/presentation/`).
   - Corrigir a hierarquia semântica de cabeçalhos em `AcceptInvitationPage` (eliminando `<h1>` aninhado dentro de `<CardTitle>`/`<h2>`) e extrair **`AcceptInvitationPanel`** de `src/app/router/pages/accept-invitation-page.tsx` para `src/modules/invitations/presentation/`.

## Alternativas Consideradas

1. **Instalar bibliotecas alternativas de Drag and Drop ou utilizar `pnpm.overrides` / atualizar para React 19:** descartada porque `@dnd-kit/core@^6.3.1`, `@dnd-kit/sortable@^10.0.0` e `@dnd-kit/utilities@^3.2.2` oferecem suporte nativo a `React 18.3.1` sem `overrides`, atendem aos requisitos do `PRD.md` §9 e permitem isolamento completo em `presentation/`.
2. **Executar migração Dexie `v2 -> v3` para relaxar o índice único `&[organizationId+projectId+userId]` em `projectMembers`:** descartada porque a unicidade composta previne duplicatas estruturais por usuário/projeto e o reuso de `existingMember.id` em reativações mantém compatibilidade total com o Schema `v2` (`51` tabelas) sem migração desnecessária.
3. **Permitir importação direta `projects -> teams`, `projects -> kanban` ou `tasks -> projects`/`kanban` relaxando `import-x/no-cycle`:** descartada porque comprometeria o DAG acíclico garantido mecanicamente pelo ESLint e aumentaria o acoplamento entre módulos de domínio/aplicação.
4. **Permitir mudança de `teamId` dentro de `updateProject` ou dispensar `projectArchivedAt`/`deletedAt` em chamadas `BOARD_*`/`TASK_*`:** descartada porque permitiria contornar a permissão específica `PROJECT_TRANSFER` (e validação de escopo origem/destino) ou burlar o Passo 5 do motor RBAC + ABAC (`DENIED_PROJECT_ARCHIVED` / `DENIED_RESOURCE_DELETED`).
5. **Manter os handlers MSW legados `/projects` e `/projects/:projectId/tasks` manipulando repositórios diretamente:** descartada por violar `API-SIMULATION.md` (*"MSW simula transporte, não implementa regras de negócio"*) e perpetuar divergência entre fluxos via UI direta e fluxos via HTTP simulado.

## Consequências

- **Positivas:** resolução limpa de dependências `@dnd-kit/*` com `0` warnings de `peerDependencies` e `0` `overrides`; Schema Dexie `v2` (`51` tabelas) preservado sem migração; DAG acíclico entre `authorization`, `teams`, `projects`, `kanban` e preparação limpa para a Fase 07 (`tasks`); invariantes rigorosos de WIP, arquivamento, transição `FINAL` e auditoria concentrados na camada `application/`; paridade completa entre UI, casos de uso e handlers MSW.
- **Trade-offs:** exige manter o adaptador de `ProjectTeamLookupPort` e `ProjectBoardInitializerPort` em `src/app/composition/`; obriga todos os fluxos de `KanbanService` a propagar `projectArchivedAt` e `deletedAt` no contexto de autorização e a consultar tarefas soft-deleted na exclusão de colunas; impõe à Fase 07 (`tasks`) o uso exclusivo de portas locais para qualquer interação com projetos ou colunas.
