# Contrato de Endpoints Simulados (HTTP Client + MSW v2)

- **Fase:** 03–08 — Dexie, IndexedDB, Repositórios, MSW, Autenticação, Usuários, Organizações, Convites, Equipes, Permissões, Projetos, Quadro Kanban, Tarefas, Subtarefas, Dependências, Impedimentos, Modo Foco, Carga de Trabalho e Gargalos
- **Referências normativas:** `API-SIMULATION.md`, `DATA-PERSISTENCE.md`, `ARCHITECTURE.md`, `PERMISSIONS.md`, `SECURITY.md`, `ADR-0002`, `ADR-0003`, `ADR-0007`, `ADR-0008`, `ADR-0009`, `ADR-0010`, `ADR-0011`, `ADR-0012`, `docs/contracts/event-envelope.md`, `docs/contracts/permission-matrix.md`.

## 1. Visão Geral e Princípios Invioláveis

1. **Propósito:** simular transporte HTTP realista (`/api/v1/*`), cabeçalhos de correlação, latência e falhas controladas por cenário sem deslocar regras de negócio para os handlers MSW.
2. **Persistência Confirmada antes da Resposta (`API-SIMULATION.md`):** nenhum handler de mutação (`POST`, `PUT`, `PATCH`, `DELETE`) pode emitir resposta HTTP de sucesso antes que a transação Dexie (`TransactionPort.run`) seja confirmada (`await`) e os eventos pós-commit (`PostCommitDomainEventBus`) sejam despachados.
3. **Autorização Real:** handlers autenticados resolvem o ator (`x-actor-user-id`) e a organização (`x-organization-id` / `:organizationId`) diretamente nos repositórios Dexie e invocam `assertAuthorized` / `evaluateAuthorization` (`@/modules/authorization`).
4. **Sem Segredos Reais:** nenhum token criptográfico de backend real ou senha em texto puro transita nos payloads ou cabeçalhos.

---

## 2. Cabeçalhos HTTP Canônicos (`HTTP_HEADERS`)

| Cabeçalho | Obrigatório | Descrição |
|---|---|---|
| `x-correlation-id` | Sim (gerado automaticamente pelo `HttpClient` se omitido) | UUID v4 propagado na resposta HTTP, em `meta.correlationId`, em `error.correlationId`, em `AuditEvent.correlationId` e em `DomainEventEnvelope.correlationId`. |
| `x-organization-id` | Em rotas organizacionais | UUID v4 da organização ativa no contexto da requisição. |
| `x-actor-user-id` | Em rotas autenticadas | UUID v4 do usuário autenticado na sessão simulada. |

---

## 3. Envelopes Canônicos de Resposta

### 3.1 Sucesso (`ApiSuccessEnvelope<TData>`)

```json
{
  "data": {},
  "meta": {
    "correlationId": "11111111-1111-4111-8111-111111111999",
    "timestamp": "2026-01-15T12:00:00.000Z"
  }
}
```

### 3.2 Erro (`ApiErrorEnvelope`)

```json
{
  "error": {
    "code": "AUTHORIZATION_ERROR",
    "message": "Actor is not authorized for action \"project.create\" (DENIED_INSUFFICIENT_ROLE).",
    "correlationId": "11111111-1111-4111-8111-111111111999",
    "details": {
      "action": "project.create",
      "reasonCode": "DENIED_INSUFFICIENT_ROLE",
      "requiresAudit": true
    }
  }
}
```

---

## 4. Mapeamento Bidirecional `AppErrorCode <-> HTTP Status`

| `AppErrorCode` | Subclasse `AppError` | HTTP Status |
|---|---|---|
| `AUTHENTICATION_ERROR` | `AuthenticationError` | `401 Unauthorized` |
| `AUTHORIZATION_ERROR` | `AuthorizationError` | `403 Forbidden` |
| `NOT_FOUND` | `NotFoundError` | `404 Not Found` |
| `CONFLICT` | `ConflictError` | `409 Conflict` |
| `VALIDATION_ERROR` | `ValidationError` | `422 Unprocessable Entity` |
| `INFRASTRUCTURE_ERROR` | `InfrastructureError` | `500 Internal Server Error` / `503 Service Unavailable` |
| `UNEXPECTED_ERROR` | `AppError` | `500 Internal Server Error` |

---

## 5. Controle de Latência e Injeção Determinística de Falhas (`SimulationScenarioController`)

Todo handler registrado em `createMswHandlers` passa pelo `SimulationScenarioController` antes de executar a operação:

- **Latência global ou por rota:** `setDefaultLatencyMs(ms)` ou `setRule({ method, pathPattern, latencyMs })`.
- **Erro HTTP/Domínio forçado:** `setRule({ method, pathPattern, forceStatus, forceErrorCode, forceErrorMessage, remainingApplications })`.
- **Falha de rede (`HttpResponse.error()`):** `setRule({ method, pathPattern, networkError: true, remainingApplications })` — traduzida pelo `HttpClient` em `InfrastructureError` (`details.reason = 'NETWORK_ERROR'`).

---

## 6. Catálogo de Endpoints Base (Fase 03)

### 6.1 `GET /api/v1/health`
- **Propósito:** diagnóstico local do banco Dexie (`pms_local_db`), versão do schema (`2`), versão da seed demo (`1.0.0`) e indicador `demoOrganizationSeeded`.
- **Autorização:** público (diagnóstico local).
- **Response (`200 OK`):** `ApiSuccessEnvelope<HealthEndpointResponse>`.

### 6.2 `POST /api/v1/demo/seed`
- **Propósito:** dispara `ensureDemoOrganizationSeeded` dentro de transação Dexie de 17 stores (incluindo `localCredentials`, com verificadores calculados previamente fora da transação).
- **Comportamento idempotente:** retorna `201 Created` (`{ seeded: true, organizationId, seedVersion }`) na primeira execução e `200 OK` (`{ seeded: false, organizationId, seedVersion }`) nas chamadas subsequentes sem sobrescrever dados existentes (aplicando backfill idempotente de credenciais demo em upgrades `v1 -> v2`).
- **Eventos pós-commit:** emite `demo.organization.seeded` apenas quando `seeded === true` e somente após o commit da transação Dexie.

### 6.3 `GET /api/v1/organizations/:organizationId`
- **Cabeçalhos:** `x-actor-user-id`, `x-correlation-id`.
- **Autorização:** `PERMISSION_CODES.ORGANIZATION_VIEW` via `assertAuthorized`.
- **Erros:** `401` (sem `x-actor-user-id`), `403` (sem vínculo ativo ou cross-organization), `404` (organização inexistente).
- **Response (`200 OK`):** `ApiSuccessEnvelope<Organization>`.

### 6.4 `GET /api/v1/organizations/:organizationId/projects`
- **Cabeçalhos:** `x-actor-user-id`, `x-correlation-id`.
- **Query Params:** `includeArchived=true` (opcional; padrão `false`).
- **Autorização:** delega integralmente a `ProjectService.listProjects`, validando associação ativa e filtrando os projetos individuais via `PERMISSION_CODES.PROJECT_VIEW` (`ADMIN`, gestor/participante do projeto ou portador de `PermissionGrant` ativo).
- **Response (`200 OK`):** `ApiSuccessEnvelope<readonly ProjectListItem[]>` (estende `Project` com `teamName?`, `ownerName`, `participantCount` e `myProjectRole?`). Ver catálogo completo da Fase 06 em §9.

### 6.5 `POST /api/v1/organizations/:organizationId/projects`
- **Cabeçalhos:** `x-actor-user-id`, `x-correlation-id`.
- **Autorização:** delega integralmente a `ProjectService.createProject` (`PERMISSION_CODES.PROJECT_CREATE`, validando equipe ativa/gerida quando `teamId` é informado e autoridade de atribuição de `ownerUserId`).
- **Request Body:** `{ id?: string, name: string, description?: string, teamId?: string, ownerUserId?: string, inactivityThresholdDays?: number }`.
- **Persistência Transacional:** grava atomicamente `Project`, `ProjectMember` (`MANAGER`), `ProjectBoard` primário (`Quadro Principal`), as 4 `BoardColumn`s padrão e `AuditEvent` (`category: 'PROJECT'`, `eventType: 'project.created'`, `result: 'SUCCESS'`), publicando `project.created` pós-commit.
- **Response (`201 Created`):** `ApiSuccessEnvelope<Project>`.
- **Erros:** `401`, `403`, `404` (`teamId` ou `ownerUserId` inexistente), `409` (equipe arquivada ou ID duplicado), `422` (`name` inválido ou `inactivityThresholdDays < 1`), `500` (erro simulado ou quota excedida).

### 6.6 `GET /api/v1/organizations/:organizationId/projects/:projectId/tasks`
- **Cabeçalhos:** `x-actor-user-id`, `x-correlation-id`.
- **Autorização:** delega a `KanbanService.getProjectBoard` (`PERMISSION_CODES.BOARD_VIEW` + filtragem individual de cada tarefa via `PERMISSION_CODES.TASK_VIEW`).
- **Response (`200 OK`):** `ApiSuccessEnvelope<readonly Task[]>` (tarefas visíveis e não excluídas logicamente, ordenadas por `order ASC`).

### 6.7 `GET /api/v1/organizations/:organizationId/audit-events`
- **Cabeçalhos:** `x-actor-user-id`, `x-correlation-id`.
- **Query Params:** `page` (default `1`), `pageSize` (default `20`).
- **Autorização:** `PERMISSION_CODES.AUDIT_ORGANIZATION_VIEW`.
- **Response (`200 OK`):** `ApiSuccessEnvelope<PaginatedResult<AuditEvent>>`.

---

## 7. Catálogo de Endpoints da Fase 04 (Autenticação, Usuários e Organizações)

Todos os endpoints abaixo delegam estritamente aos casos de uso em `container.services` (`AuthService`, `UserService`, `OrganizationService`), sem duplicar regras de negócio nos handlers MSW (`ADR-0008`).

### 7.1 `POST /api/v1/auth/register`
- **Propósito:** cria conta local (`User`, `LocalCredential` com verificador SHA-256 + salt calculado fora da transação e `UserSession` inicial) e emite `accessToken` simulado (`pms_sim_<uuid>`) apenas em memória.
- **Autorização:** público.
- **Request Body:** `{ email: string, password: string, displayName: string, acceptTerms: true, persistent?: boolean, deviceLabel?: string }`.
- **Response (`201 Created`):** `ApiSuccessEnvelope<AuthSessionResult>`.
- **Erros:** `409 Conflict` (e-mail já cadastrado), `422 Unprocessable Entity` (payload inválido ou termos não aceitos).

### 7.2 `POST /api/v1/auth/login`
- **Propósito:** autentica usuário local via `LocalCredential` (verificação fora da transação Dexie) e persiste nova `UserSession`.
- **Autorização:** público.
- **Request Body:** `{ email: string, password: string, persistent?: boolean, deviceLabel?: string }`.
- **Response (`200 OK`):** `ApiSuccessEnvelope<AuthSessionResult>`.
- **Erros:** `401 Unauthorized` (credenciais inválidas ou usuário excluído), `422 Unprocessable Entity`.

### 7.3 `POST /api/v1/auth/demo`
- **Propósito:** garante seed idempotente da organização demonstrativa (`DEMO_ORG_ID`) e inicia sessão simulada no perfil `ADMIN`, `MANAGER` ou `MEMBER`, registrando `AuditEvent` na organização demo.
- **Autorização:** público.
- **Request Body:** `{ role: 'ADMIN' | 'MANAGER' | 'MEMBER', persistent?: boolean, deviceLabel?: string }`.
- **Response (`200 OK`):** `ApiSuccessEnvelope<EnterDemoProfileResult>`.

### 7.4 `POST /api/v1/auth/logout`
- **Cabeçalhos:** `x-actor-user-id`, `x-correlation-id`, `x-organization-id` (opcional).
- **Request Body:** `{ sessionId: string }`.
- **Comportamento:** revoga a sessão própria (`revokedAt`) no IndexedDB, registra `AuditEvent` se `x-organization-id` for informado e limpa ponteiro efêmero quando aplicável.
- **Response (`200 OK`):** `ApiSuccessEnvelope<{ loggedOut: true }>`.

### 7.5 `GET /api/v1/auth/sessions`
- **Cabeçalhos:** `x-actor-user-id`, `x-correlation-id`.
- **Propósito:** lista as sessões locais do próprio usuário autenticado ordenadas por `createdAt DESC`.
- **Response (`200 OK`):** `ApiSuccessEnvelope<readonly UserSession[]>`.

### 7.6 `POST /api/v1/auth/sessions/:sessionId/revoke`
- **Cabeçalhos:** `x-actor-user-id`, `x-correlation-id`, `x-organization-id` (opcional).
- **Request Body (opcional):** `{ reason?: string }`.
- **Autorização:** apenas o próprio titular da sessão (`403 Forbidden` se tentar revogar sessão de terceiros).
- **Response (`200 OK`):** `ApiSuccessEnvelope<{ revoked: true, sessionId: SessionId }>`.

### 7.7 `GET /api/v1/users/me` e `PATCH /api/v1/users/me`
- **Cabeçalhos:** `x-actor-user-id`, `x-correlation-id`, `x-organization-id` (opcional no `PATCH`).
- **Propósito:** consulta e atualiza o perfil do próprio usuário (`displayName` e `avatarUrl?`), sem alterar papéis ou associações organizacionais e sem jamais expor credenciais.
- **Response (`200 OK`):** `ApiSuccessEnvelope<User>`.

### 7.8 `GET /api/v1/organizations` e `POST /api/v1/organizations`
- **Cabeçalhos:** `x-actor-user-id`, `x-correlation-id`.
- **`GET`:** retorna projeção mínima (`MyOrganizationSummary[]`: `{ id, name, slug, isDemo, role, status }`) das organizações com associação `ACTIVE` do ator (`PRD.md` §5, `ADR-0008` §4.4).
- **`POST`:** cria atomicamente `Organization`, `OrganizationMember` (`ADMIN`), `OrganizationSettings` padrão e `AuditEvent`, retornando `201 Created` (`CreateOrganizationResult`). Erro `409 Conflict` se `slug` já existir.

### 7.9 `PATCH /api/v1/organizations/:organizationId`
- **Cabeçalhos:** `x-actor-user-id`, `x-correlation-id`.
- **Autorização:** `PERMISSION_CODES.ORGANIZATION_UPDATE`.
- **Request Body:** `{ name?: string, description?: string | null }`.
- **Response (`200 OK`):** `ApiSuccessEnvelope<Organization>`.

### 7.10 `GET /api/v1/organizations/:organizationId/members` e `PATCH /api/v1/organizations/:organizationId/members/:userId`
- **Cabeçalhos:** `x-actor-user-id`, `x-correlation-id`.
- **`GET`:** exige `PERMISSION_CODES.ORGANIZATION_MEMBERS_VIEW`; retorna membros enriquecidos com `displayName`, `email` e `avatarUrl?`.
- **`PATCH`:** exige `ORGANIZATION_ROLES_MANAGE` (quando altera `role`) e/ou `ORGANIZATION_MEMBERS_MANAGE` (quando altera `status` entre `ACTIVE` e `SUSPENDED`), protegido por `assertCanChangeOrRemoveAdmin` (`409 Conflict` ao tentar rebaixar ou suspender o último `ADMIN` ativo) com gravação de `AuditEvent`.

### 7.11 `POST /api/v1/organizations/:organizationId/leave`
- **Cabeçalhos:** `x-actor-user-id`, `x-correlation-id`.
- **Comportamento:** permite que o próprio ator saia da organização (`status: 'REMOVED'`), revoga grants ativos do usuário naquela organização, registra `AuditEvent`, bloqueia saída do último `ADMIN` ativo (`409 Conflict`) e **nunca** revoga a sessão global `UserSession`.
- **Response (`200 OK`):** `ApiSuccessEnvelope<OrganizationMember>`.

---

## 8. Catálogo de Endpoints da Fase 05 (Convites, Equipes e Permissões RBAC + ABAC)

Todos os endpoints abaixo delegam estritamente aos casos de uso em `container.services` (`InvitationService`, `TeamService`, `AuthorizationManagementService`), sem duplicar regras de negócio nos handlers MSW (`ADR-0009`).

### 8.1 `GET /api/v1/organizations/:organizationId/invitations` e `POST /api/v1/organizations/:organizationId/invitations`
- **Cabeçalhos:** `x-actor-user-id`, `x-correlation-id`.
- **Autorização:** `PERMISSION_CODES.INVITATION_CREATE` (exclusivo `ADMIN`).
- **`GET`:** lista convites da organização com `derivedStatus` (`PENDING` | `ACCEPTED` | `EXPIRED` | `REVOKED`) e `inviteLink`.
- **`POST`:** cria convite nominal (`{ email, expiresInDays?: 1..90, initialRole?: 'MEMBER' | 'MANAGER' | 'ADMIN' }`), grava `AuditEvent` (`invitation.created`) em transação `[INVITATIONS, AUDIT_EVENTS]` e retorna `201 Created` (`CreateInvitationResult`).

### 8.2 `POST /api/v1/organizations/:organizationId/invitations/:invitationId/revoke`
- **Cabeçalhos:** `x-actor-user-id`, `x-correlation-id`.
- **Autorização:** `PERMISSION_CODES.INVITATION_REVOKE` (exclusivo `ADMIN`).
- **Comportamento:** revoga convite `PENDING` (`409 Conflict` para convites já aceitos, expirados ou revogados), gravando `AuditEvent` (`invitation.revoked`).

### 8.3 `GET /api/v1/invitations/preview?code=...` e `POST /api/v1/invitations/accept`
- **Cabeçalhos:** `x-actor-user-id`, `x-correlation-id`.
- **`GET /preview`:** projeção mínima segura (`organizationName`, `organizationSlug`, `status`, `initialRole`, `expiresAt`, `emailMatchesActor`), sem expor membros da organização.
- **`POST /accept`:** body `{ code }`; exige correspondência estrita `normalizeEmail(actor.email) === normalizeEmail(invitation.email)` (`403 Forbidden` se divergir — `ADR-0009` §2), bloqueia membro já `ACTIVE` (`409 Conflict`) e membro `SUSPENDED` (`403 Forbidden`); em transação `[INVITATIONS, ORGANIZATION_MEMBERS, AUDIT_EVENTS]` marca convite `ACCEPTED` e cria associação `OrganizationMember` `ACTIVE`.

### 8.4 `GET /api/v1/organizations/:organizationId/teams` e `POST /api/v1/organizations/:organizationId/teams`
- **Cabeçalhos:** `x-actor-user-id`, `x-correlation-id`.
- **`GET`:** query param opcional `includeArchived=true`; filtra equipes visíveis conforme papel/escopo (`ADMIN`: todas não excluídas; `MANAGER`: equipes administradas; `MEMBER`: equipes das quais participa).
- **`POST`:** exige `PERMISSION_CODES.TEAM_CREATE`; cria equipe, membros gestores iniciais e `AuditEvent` (`team.created`) em transação atômica (`201 Created`).

### 8.5 `GET/PATCH/DELETE /api/v1/organizations/:organizationId/teams/:teamId`
- **Cabeçalhos:** `x-actor-user-id`, `x-correlation-id`.
- **`GET`:** exige `PERMISSION_CODES.TEAM_VIEW`; retorna equipe e membros ativos enriquecidos com `displayName`, `email` e `isManager`.
- **`PATCH`:** exige `PERMISSION_CODES.TEAM_UPDATE`; atualiza `name`, `description` e/ou `managerUserIds` (bloqueado se arquivada/excluída com `409 Conflict`).
- **`DELETE`:** exige `PERMISSION_CODES.TEAM_DELETE` (exclusivo `ADMIN`); bloqueia com `409 Conflict` se houver projeto não-excluído vinculado; executa soft-delete + `revokeAllByScope` de todos os grants da equipe + `AuditEvent` (`team.deleted`) atomicamente (`ADR-0009` §3.1).

### 8.6 `POST /api/v1/organizations/:organizationId/teams/:teamId/archive` e `/restore`
- **Cabeçalhos:** `x-actor-user-id`, `x-correlation-id`.
- **Autorização:** `PERMISSION_CODES.TEAM_ARCHIVE`.
- **Comportamento:** arquiva ou restaura a equipe sem excluir projetos vinculados; equipes arquivadas rejeitam novas associações de membros (`409 Conflict`).

### 8.7 `POST /api/v1/organizations/:organizationId/teams/:teamId/members` e `DELETE .../members/:userId`
- **Cabeçalhos:** `x-actor-user-id`, `x-correlation-id`.
- **Autorização:** `PERMISSION_CODES.TEAM_MEMBERS_MANAGE`.
- **`POST`:** associa membro `ACTIVE` da mesma organização à equipe (`201 Created`, bloqueando cross-org e equipes arquivadas/excluídas).
- **`DELETE`:** marca `removedAt`, remove de `managerUserIds` se presente e revoga imediatamente todos os `PermissionGrant` do usuário no escopo da equipe via `revokeByScope` na mesma transação, sem alterar `OrganizationMember` nem autoria histórica (`ADR-0009` §3.2).

### 8.8 `GET /api/v1/organizations/:organizationId/permissions/me`
- **Cabeçalhos:** `x-actor-user-id`, `x-correlation-id`.
- **Propósito:** retorna `{ grants, explicitDenies, managedTeamIds, memberTeamIds, managedProjectIds, participatedProjectIds }` ativos do próprio ator na organização para sincronização do `PermissionProvider` (`ADR-0009` §4.1).

### 8.9 `GET/POST /api/v1/organizations/:organizationId/permissions/grants` e `POST .../grants/:grantId/revoke`
- **Cabeçalhos:** `x-actor-user-id`, `x-correlation-id`.
- **`GET`:** `ADMIN` lista todos os grants da organização com `derivedStatus`; `MANAGER` lista apenas grants de equipes/projetos sob sua administração; `MEMBER` recebe `403 Forbidden`.
- **`POST`:** cria `PermissionGrant` validando `canGrantorDelegatePermission`, exigindo `reason` obrigatória, membro ativo e escopo existente na organização, com `AuditEvent` atômico (`201 Created`).
- **`POST .../revoke`:** revoga grant imediatamente dentro da autoridade de escopo do revogador com `AuditEvent`.

### 8.10 `GET/POST /api/v1/organizations/:organizationId/permissions/denies` e `POST .../denies/:denyRuleId/revoke`
- **Cabeçalhos:** `x-actor-user-id`, `x-correlation-id`.
- **`GET`:** `ADMIN` vê todas as regras de negação explícita da organização; `MANAGER` vê apenas regras em seus escopos administrados; `MEMBER` recebe `403 Forbidden`.
- **`POST` e `POST .../revoke`:** exclusivos de `ADMIN` ativo; exigem `reason` obrigatória na criação; aplicam *Deny Overrides* imediato com `AuditEvent` atômico.

---

## 9. Catálogo de Endpoints da Fase 06 (Projetos, Participantes e Quadro Kanban)

Todos os endpoints abaixo delegam estritamente aos casos de uso em `container.services` (`ProjectService` e `KanbanService`), sem regras de negócio nos handlers MSW e sem acesso direto a repositórios Dexie (`ADR-0010` §6). Toda avaliação ABAC sobre quadros e tarefas propaga obrigatoriamente `projectArchivedAt` e `deletedAt` para que projetos arquivados (`DENIED_PROJECT_ARCHIVED`) e recursos excluídos (`DENIED_RESOURCE_DELETED`) retornem `409 Conflict`.

### 9.1 `GET /api/v1/organizations/:organizationId/projects` e `POST .../projects`
- **Cabeçalhos:** `x-actor-user-id`, `x-correlation-id`.
- **`GET`:** query param opcional `includeArchived=true`; delega a `ProjectService.listProjects`, exigindo associação ativa na organização (`403 Forbidden` se cross-org ou suspenso) e filtrando projetos individualmente com `PERMISSION_CODES.PROJECT_VIEW`. Retorna `200 OK` com `ApiSuccessEnvelope<readonly ProjectListItem[]>`.
- **`POST`:** delega a `ProjectService.createProject` (`PERMISSION_CODES.PROJECT_CREATE`). Quando `teamId` é informado, valida equipe ativa (não excluída e não arquivada) na mesma organização e dentro do escopo de `MANAGER`; valida `ownerUserId` (padrão ator) como membro `ACTIVE`; cria atomicamente `Project`, `ProjectMember` (`MANAGER`), `ProjectBoard` (`Quadro Principal`, `isPrimary: true`), 4 `BoardColumn`s padrão (`A Fazer`, `Em Execução` [WIP 3], `Em Revisão` [WIP 2], `Concluído`) e `AuditEvent` (`project.created`), retornando `201 Created`.

### 9.2 `GET/PATCH/DELETE /api/v1/organizations/:organizationId/projects/:projectId`
- **Cabeçalhos:** `x-actor-user-id`, `x-correlation-id`.
- **`GET`:** exige `PERMISSION_CODES.PROJECT_VIEW`; retorna `ProjectDetails` (`project`, `teamName?`, `owner`, `members`, `activeParticipantCount`). Erros: `401`, `403`, `404`, `409` (se excluído logicamente).
- **`PATCH`:** exige `PERMISSION_CODES.PROJECT_UPDATE` em projeto operacional (não arquivado/excluído). Aceita apenas `{ name?, description?, inactivityThresholdDays?, ownerUserId? }` e rejeita qualquer tentativa de enviar `teamId` com `422 Unprocessable Entity` (transferência é exclusiva de `POST .../transfer`). Se `ownerUserId` mudar, valida membro `ACTIVE`, bloqueia `MANAGER` transferir propriedade para `ADMIN` (`403`) e promove/reativa o novo responsável como `ProjectMember` `MANAGER` reutilizando eventual registro removido anterior.
- **`DELETE`:** exclusivo `ADMIN` (`PERMISSION_CODES.PROJECT_DELETE`); body ou query opcional `{ reason? }`. Marca `deletedAt`/`deletedBy`/`deletionReason`, encerra todos os `ProjectMember` ativos em lote, revoga todas as concessões vinculadas ao projeto via `revokeAllByScope`, grava `AuditEvent` (`project.deleted`) e publica evento pós-commit.

### 9.3 `POST /api/v1/organizations/:organizationId/projects/:projectId/transfer`
- **Cabeçalhos:** `x-actor-user-id`, `x-correlation-id`.
- **Autorização:** `PERMISSION_CODES.PROJECT_TRANSFER`.
- **Request Body:** `{ targetTeamId: string | null, reason?: string }`.
- **Comportamento:** `MANAGER` só pode transferir entre equipes sob sua administração (`managedTeamIds`) e é impedido de desvincular (`targetTeamId: null`). Valida equipe destino ativa (não excluída com `404`, não arquivada com `409`) e projeto operacional (`409` se arquivado). Grava `AuditEvent` (`project.team_transferred`).
- **Response (`200 OK`):** `ApiSuccessEnvelope<Project>`.

### 9.4 `POST /api/v1/organizations/:organizationId/projects/:projectId/archive` e `/restore`
- **Cabeçalhos:** `x-actor-user-id`, `x-correlation-id`.
- **Autorização:** `PERMISSION_CODES.PROJECT_ARCHIVE` (`/archive`) e `PERMISSION_CODES.PROJECT_RESTORE` (`/restore`).
- **Comportamento:** transicionam `status` entre `'ACTIVE'` e `'ARCHIVED'` (`409 Conflict` se já estiver no estado alvo), preservam quadro, colunas e histórico e gravam `AuditEvent` (`project.archived` / `project.restored`).
- **Response (`200 OK`):** `ApiSuccessEnvelope<Project>`.

### 9.5 `POST/PATCH/DELETE /api/v1/organizations/:organizationId/projects/:projectId/participants`
- **Cabeçalhos:** `x-actor-user-id`, `x-correlation-id`.
- **Autorização:** `PERMISSION_CODES.PROJECT_MEMBERS_MANAGE` (bloqueada com `409 Conflict` em projeto arquivado ou excluído).
- **`POST .../participants`:** body `{ userId: string, role?: 'MANAGER' | 'PARTICIPANT' }` (padrão `'PARTICIPANT'`). Exige membro `ACTIVE` da mesma organização (`404` se inexistente/inativo), bloqueia duplicidade ativa (`409`), reutiliza `existing.id` ao reativar ex-participante (`removedAt !== undefined`) e retorna `201 Created` (`ProjectMember`).
- **`PATCH .../participants/:userId`:** body `{ role: 'MANAGER' | 'PARTICIPANT' }`. Protege o `ownerUserId` contra rebaixamento e impede deixar o projeto sem nenhum `ProjectMember` `MANAGER` ativo (`409 Conflict`), além de impedir `MANAGER` de alterar o papel de um `ADMIN` da organização ou rebaixar a si próprio (`403 Forbidden`).
- **`DELETE .../participants/:userId`:** protege `ownerUserId` e último `MANAGER` ativo (`409 Conflict`); verifica tarefas pendentes (`status !== 'DONE' && status !== 'CANCELLED'`) onde o usuário seja responsável principal (`assigneeId`) ou `TaskParticipant` ativo via `assertParticipantRemovalHandled` (`409 Conflict` se `> 0`); na mesma transação preenche `removedAt`, invoca `revokeByScope` para o escopo `PROJECT` e grava `AuditEvent` (`project.member.removed`), preservando `OrganizationMember`.

### 9.6 `GET /api/v1/organizations/:organizationId/projects/:projectId/export`
- **Cabeçalhos:** `x-actor-user-id`, `x-correlation-id`.
- **Autorização:** `PERMISSION_CODES.PROJECT_VIEW` (e verificação de `BOARD_VIEW` para incluir metadados do quadro/colunas), filtrando tarefas individualmente com `PERMISSION_CODES.TASK_VIEW` (nunca exige `DATA_EXPORT`).
- **Response (`200 OK`):** `ApiSuccessEnvelope<ProjectExportData>` contendo `{ exportedAt, organizationId, project, teamName?, participants, board?, columns, tasks }` sanitizados (zero hashes, credenciais ou tokens) e registrando `AuditEvent` (`category: 'EXPORT'`, `eventType: 'project.exported'`).

### 9.7 `GET /api/v1/organizations/:organizationId/projects/:projectId/board`
- **Cabeçalhos:** `x-actor-user-id`, `x-correlation-id`.
- **Autorização:** `PERMISSION_CODES.BOARD_VIEW`.
- **Comportamento:** calcula `occupyingTaskCount` por coluna com `doesTaskStatusOccupyWip(task.status)` sobre todas as tarefas ativas (incluindo `BLOCKED` e `PAUSED`, mesmo quando o ator não visualiza todas as tarefas), filtra os cartões retornados individualmente por `PERMISSION_CODES.TASK_VIEW` e retorna flags de capacidade (`canConfigureBoard`, `canManageColumns`, `canManageWip`, `canCreateQuickCard`, `canMoveWithWipOverride`, `canMove`, `canComplete`, `canReopen`) considerando `projectArchivedAt`.
- **Response (`200 OK`):** `ApiSuccessEnvelope<ProjectBoardView>`.

### 9.8 Colunas do Quadro Kanban (`.../projects/:projectId/board/columns*`)
- **Cabeçalhos:** `x-actor-user-id`, `x-correlation-id`.
- **`POST .../board/columns`:** exige `BOARD_COLUMNS_MANAGE` (e `BOARD_WIP_MANAGE` quando `wipLimit !== null`); body `{ name, columnRole, wipLimit, order? }`; valida `assertValidBoardColumns` e retorna `201 Created` (`BoardColumn`).
- **`PATCH .../board/columns/:columnId`:** exige `BOARD_COLUMNS_MANAGE` e, quando `wipLimit !== undefined`, exige também `BOARD_WIP_MANAGE`; valida `assertValidBoardColumns` e retorna `200 OK` (`BoardColumn`).
- **`POST .../board/columns/reorder`:** exige `BOARD_COLUMNS_MANAGE`; body `{ orderedColumnIds: string[] }` exigindo permutação exata (`422` se faltar, sobrar ou duplicar ID); persiste via `saveMany` e retorna `200 OK` (`readonly BoardColumn[]`).
- **`POST .../board/columns/:columnId/archive` e `/restore`:** exigem `BOARD_COLUMNS_MANAGE`; `archive` bloqueia com `409 Conflict` se houver tarefas ativas na coluna e valida `assertValidBoardColumns`; retornam `200 OK` (`BoardColumn`).
- **`DELETE .../board/columns/:columnId`:** exige `BOARD_COLUMNS_MANAGE`; query ou body opcional `migrationTargetColumnId`. Consulta todas as tarefas da coluna com `includeDeleted: true`, valida `assertColumnCanBeDeleted`, migra atomicamente tarefas ativas e soft-deleted para a coluna destino antes de excluir a coluna e retorna `200 OK` (`{ deletedColumnId, migratedTaskCount }`).
- **Invariante comum:** todas as mutações de coluna rejeitam projetos arquivados ou excluídos com `409 Conflict` e gravam `AuditEvent` (`category: 'KANBAN'`).

### 9.9 Cartões Rápidos e Movimentação (`.../projects/:projectId/cards*`)
- **Cabeçalhos:** `x-actor-user-id`, `x-correlation-id`.
- **`POST .../cards`:** delega a `KanbanService.createQuickCard` (`PERMISSION_CODES.TASK_CREATE` parametrizado com `OrganizationSettings.pendingPermissionDefaults.allowMemberCreateTaskWithoutGrant`). Body `{ title, description?, columnId?, assigneeId?, priority? }`. Valida projeto operacional, coluna ativa não-`FINAL`, participante ativo para `assigneeId` (se informado) e WIP (`assertWipAllowsCardMove`); cria `Task`, `TaskExecutionCycle` inicial e `AuditEvent` (`task.created`), retornando `201 Created`.
- **`POST .../cards/:taskId/move`:** delega a `KanbanService.moveCard` (`PERMISSION_CODES.BOARD_CARD_MOVE` + `PERMISSION_CODES.TASK_MOVE`). Body `{ targetColumnId, targetOrder?, wipOverrideJustification?, dependencyOverrideJustification?, pausedOverrideJustification?, reopenReason? }`.
  - Bloqueia tarefas `CANCELLED` (`409 Conflict`), projetos/colunas arquivadas (`409`), tarefas pausadas sem retomada/exceção autorizada (`409`/`403`/`422`) e excesso de WIP sem `BOARD_WIP_MANAGE` + justificativa não vazia (`409`/`403`/`422`).
  - Ao entrar em coluna `FINAL`: exige `TASK_COMPLETE` + `assertTaskCanBeCompleted` (subtarefas obrigatórias, impedimentos bloqueantes, dependências obrigatórias pendentes), transita para `DONE`, preenche `completedAt` e encerra o ciclo de execução.
  - Ao sair de coluna `FINAL`: exige `TASK_REOPEN` + `assertTaskReopenCreatesNewCycle`, transita para `IN_PROGRESS` (ou `TODO` em coluna `INITIAL`), limpa `completedAt` e cria novo ciclo imutável.
  - Preserva `lastMovedAt` original na reordenação dentro da mesma coluna e atualiza `lastMovedAt` + `lastActivityAt` na troca de coluna (`PRD.md` §12.1), gravando `AuditEvent` (`kanban.card.moved`) e retornando `200 OK` (`Task`).

---

## 10. Catálogo de Endpoints da Fase 07 (Tarefas, Subtarefas, Comentários, Anexos, Etiquetas, Dependências e Impedimentos)

Todos os endpoints abaixo delegam estritamente aos casos de uso em `container.services` (`TaskService`, `DependencyService` e `ImpedimentService`), preservando o DAG acíclico (`ADR-0011` §3), propagando atributos ABAC completos (`organizationId`, `projectId`, `teamId`, `ownerUserId`, `projectArchivedAt`, `deletedAt`, `taskId`, `createdBy`, `assigneeId`, `participantIds`, `subtaskId`, `subtaskAssigneeId`, `requestedFields`, `relatedTasksAccessible`) e `policyConfig` integral de `OrganizationSettings` (`ADR-0011` §6–§7). Nenhuma regra de domínio reside nos handlers MSW; toda conversão `contentBase64` ↔ `Uint8Array` permanece restrita exclusivamente à borda HTTP/MSW (`ADR-0011` §2.5).

### 10.1 Tarefas e Ciclo de Vida (`TaskService`)
- **Cabeçalhos comuns:** `x-actor-user-id`, `x-correlation-id`.
- **`GET /api/v1/organizations/:organizationId/projects/:projectId/tasks`:** suporta query opcional `?includeDeleted=true` (quando `true`, delega a `TaskService.listProjectTasks` filtrando tarefas excluídas com `TRASH_VIEW` e ativas com `TASK_VIEW`; por padrão delega a `KanbanService.getProjectBoard` filtrando por `TASK_VIEW`). Retorna `200 OK` (`readonly Task[]`).
- **`POST /api/v1/organizations/:organizationId/projects/:projectId/tasks`:** delega a `TaskService.createTask` (`PERMISSION_CODES.TASK_CREATE` com `allowMemberCreateTaskInProject` e `PERMISSION_CODES.TASK_ASSIGN` obrigatório quando `assigneeId !== actorUserId`). Body `{ id?, title, description?, columnId?, priority?, assigneeId?, dueDate?, tagIds?, deadlineJustification? }`. Valida projeto operacional, coluna ativa não-`FINAL`, WIP (`assertWipAllowsCardMove`), tags organizacionais, cria `Task`, `TaskExecutionCycle` #1, `TaskDeadlineHistoryEntry` inicial (se `dueDate` informado) e `AuditEvent` (`task.created`), retornando `201 Created` (`Task`).
- **`GET /api/v1/organizations/:organizationId/tasks/:taskId`:** delega a `TaskService.getTaskDetail`, avaliando `PERMISSION_CODES.TASK_VIEW` (e `PERMISSION_CODES.TASK_HISTORY_VIEW` para `deadlineHistory`) em tarefas ativas, ou `PERMISSION_CODES.TRASH_VIEW` para ambos quando a tarefa está excluída logicamente (`deletedAt`) em projeto ativo (falhando fechado com `409 Conflict` se o projeto também estiver excluído). Retorna `200 OK` (`TaskDetail` com `task`, `project`, `column?`, `participants`, `subtasks`, `comments`, `attachments`, `pauses`, `executionCycles`, `deadlineHistory`, `tags`).
- **`PATCH /api/v1/organizations/:organizationId/tasks/:taskId`:** delega a `TaskService.updateTask` (`PERMISSION_CODES.TASK_UPDATE` propagando `requestedFields` estritos dentre `'title' | 'description' | 'priority' | 'dueDate' | 'tags'`). Body `{ title?, description?, priority?, dueDate?, tagIds?, deadlineJustification? }`. Atualiza `lastActivityAt` preservando `lastMovedAt` intacto e grava `TaskDeadlineHistoryEntry` append-only em qualquer mudança de `dueDate`. Retorna `200 OK` (`Task`).
- **`DELETE /api/v1/organizations/:organizationId/tasks/:taskId`:** delega a `TaskService.deleteTask` (`PERMISSION_CODES.TASK_CANCEL`, Decisão Normativa A — `ADR-0011` §4). Aceita `{ reason? }` ou query `?reason=`. Marca `deletedAt`/`deletedBy`/`deletionReason?`, revoga imediatamente todos os `PermissionGrant`s de escopo `RESOURCE` vinculados à tarefa via `revokeAllByScope` na mesma transação e grava `AuditEvent` (`task.deleted`). Retorna `200 OK` (`Task`).
- **`POST /api/v1/organizations/:organizationId/tasks/:taskId/restore`:** delega a `TaskService.restoreTask` (`PERMISSION_CODES.TRASH_RESTORE`). Revalida projeto operacional, coluna ativa elegível (realocando para coluna ativa se a original foi arquivada/excluída), WIP e integridade, limpando campos de soft-delete atomicamente com `AuditEvent` (`task.restored`). Retorna `200 OK` (`Task`).
- **`POST /api/v1/organizations/:organizationId/tasks/:taskId/assign`:** delega a `TaskService.assignTask` (`PERMISSION_CODES.TASK_ASSIGN`). Body `{ assigneeId: string | null }`. Valida membro `ACTIVE` participante do projeto; preserva `lastMovedAt`. Retorna `200 OK` (`Task`).
- **`POST /api/v1/organizations/:organizationId/tasks/:taskId/participants` e `DELETE .../participants/:userId`:** delegam a `TaskService.addTaskParticipant` (`201 Created`) e `removeTaskParticipant` (`200 OK`), protegidos por `PERMISSION_CODES.TASK_PARTICIPANTS_MANAGE`. Na readmissão de ex-participante com `removedAt`, reutiliza `existing.id` (`ADR-0011` §1.2). Preservam `lastMovedAt`.
- **`POST /api/v1/organizations/:organizationId/tasks/:taskId/start`:** delega a `TaskService.startTask` (`PERMISSION_CODES.TASK_START`). Transita `TODO -> IN_PROGRESS`, preenche `startedAt` e `effectiveStartedAt` no ciclo ativo; se estiver em coluna `INITIAL`, move para primeira coluna `OPERATIONAL` ativa elegível respeitando WIP e atualizando `lastMovedAt`. Retorna `200 OK` (`Task`).
- **`POST /api/v1/organizations/:organizationId/tasks/:taskId/pause` e `/resume`:** delegam a `TaskService.pauseTask` (body `{ reason }`, exige justificativa não vazia, cria `TaskPause` aberto, retorna `200 OK` `{ task, pause }`) e `resumeTask` (encerra `TaskPause` aberto, restaura `BLOCKED` se houver impedimento bloqueante ou `IN_PROGRESS`/`TODO`, retorna `200 OK` `Task`), protegidos por `PERMISSION_CODES.TASK_PAUSE` e preservando `lastMovedAt`.
- **`POST /api/v1/organizations/:organizationId/tasks/:taskId/complete`:** delega a `TaskService.completeTask` (`PERMISSION_CODES.TASK_COMPLETE`). Body opcional `{ dependencyOverrideJustification? }`. Valida `assertTaskCanBeCompleted` (exceção de dependência exige `DEPENDENCY_MANAGE` + justificativa não vazia auditada), move para coluna `FINAL` ativa atualizando `lastMovedAt` se necessário, fecha ciclo e pausas abertas. Retorna `200 OK` (`Task`).
- **`POST /api/v1/organizations/:organizationId/tasks/:taskId/cancel`:** delega a `TaskService.cancelTask` (`PERMISSION_CODES.TASK_CANCEL`). Body `{ justification }` obrigatório. Define `CANCELLED` liberando WIP, fecha ciclo/pausas abertas, preserva `lastMovedAt` e grava `AuditEvent` (`task.cancelled`). Retorna `200 OK` (`Task`).
- **`POST /api/v1/organizations/:organizationId/tasks/:taskId/cancellation-requests`:** delega a `TaskService.requestTaskCancellation` (`PERMISSION_CODES.TASK_COMMENT`). Body `{ justification }` obrigatório. Permite a `MEMBER` responsável/participante registrar solicitação auditável (`isSystem: true` + `AuditEvent` `task.cancellation_requested`) sem cancelar a tarefa diretamente. Retorna `201 Created` (`TaskComment`).
- **`POST /api/v1/organizations/:organizationId/tasks/:taskId/reopen`:** delega a `TaskService.reopenTask` (`PERMISSION_CODES.TASK_REOPEN`). Body opcional `{ reason?, targetColumnId? }`. Cria obrigatoriamente novo `TaskExecutionCycle` (`assertTaskReopenCreatesNewCycle`) preservando ciclos anteriores, move para coluna `OPERATIONAL`/`INITIAL` ativa respeitando WIP e grava `AuditEvent` (`task.reopened`). Retorna `200 OK` (`Task`).
- **`GET /api/v1/organizations/:organizationId/tasks/:taskId/deadline-history`:** delega a `TaskService.listTaskDeadlineHistory`, avaliando `PERMISSION_CODES.TASK_HISTORY_VIEW` em tarefas ativas e `PERMISSION_CODES.TRASH_VIEW` quando a tarefa está excluída logicamente em projeto ativo (falhando fechado com `409 Conflict` se o projeto também estiver excluído). Retorna `200 OK` (`readonly TaskDeadlineHistoryEntry[]`).

### 10.2 Subtarefas de 1 Nível (`.../tasks/:taskId/subtasks*`)
- **Cabeçalhos comuns:** `x-actor-user-id`, `x-correlation-id`.
- **`POST .../subtasks`:** delega a `TaskService.createSubtask` (`SUBTASK_MANAGE`, mais `SUBTASK_ASSIGN` se `assigneeId` informado); body `{ title, required?, assigneeId? }`; retorna `201 Created` (`Subtask`).
- **`PATCH .../subtasks/:subtaskId`:** delega a `TaskService.updateSubtask` (`SUBTASK_MANAGE`); body `{ title?, required?, status? }`; retorna `200 OK` (`Subtask`).
- **`POST .../subtasks/:subtaskId/assign`:** delega a `TaskService.assignSubtask` (`SUBTASK_ASSIGN`); body `{ assigneeId: string | null }`; retorna `200 OK` (`Subtask`).
- **`POST .../subtasks/:subtaskId/complete`:** delega a `TaskService.completeSubtask` (`SUBTASK_COMPLETE`, preservando integralmente o Cenário 6 — responsável apenas por subtarefa não adquire autoridade sobre a tarefa-pai); retorna `200 OK` (`Subtask`).
- **`POST .../subtasks/reorder`:** delega a `TaskService.reorderSubtasks` (`SUBTASK_MANAGE`); body `{ orderedSubtaskIds: string[] }` exigindo permutação exata (`422` se inválida) e persistência em lote via `saveMany`; retorna `200 OK` (`readonly Subtask[]`).
- **`DELETE .../subtasks/:subtaskId`:** delega a `TaskService.deleteSubtask` (`SUBTASK_MANAGE`); retorna `200 OK` (`{ deletedSubtaskId }`).
- **Invariante comum:** nenhuma ação de subtarefa altera `task.lastMovedAt`.

### 10.3 Comentários (`.../tasks/:taskId/comments*`)
- **Cabeçalhos comuns:** `x-actor-user-id`, `x-correlation-id`.
- **`GET .../comments`:** delega a `TaskService.listTaskComments`, avaliando `PERMISSION_CODES.TASK_VIEW` em tarefas ativas e `PERMISSION_CODES.TRASH_VIEW` quando a tarefa está excluída logicamente em projeto ativo (falhando fechado com `409 Conflict` se o projeto também estiver excluído). Retorna `200 OK` (`readonly TaskComment[]`).
- **`POST .../comments`:** delega a `TaskService.addTaskComment` (`PERMISSION_CODES.TASK_COMMENT`). Body `{ body }`. Cria comentário com `isSystem: false` e retorna `201 Created` (`TaskComment`).
- **`PATCH .../comments/:commentId`:** delega a `TaskService.updateTaskComment` (`PERMISSION_CODES.TASK_COMMENT`). Body `{ body }`. Impõe autoria estrita (`authorUserId === actorUserId`), imutabilidade de `isSystem: true` (`409 Conflict`) e janela configurável `commentEditWindowMinutes` (`<= 0` ou expirada retorna `403 Forbidden`). Retorna `200 OK` (`TaskComment`).
- **`DELETE .../comments/:commentId`:** delega a `TaskService.deleteTaskComment` (`PERMISSION_CODES.TASK_COMMENT`). Aceita `{ reason? }` ou query `?reason=`. Permite autoria estrita ou moderação por `ADMIN`/`MANAGER` administrando o projeto; protege `isSystem: true` (`409 Conflict`); executa soft-delete com `AuditEvent` (`task.comment.deleted`). Retorna `200 OK` (`TaskComment`).

### 10.4 Anexos Binários (`.../tasks/:taskId/attachments*`)
- **Cabeçalhos comuns:** `x-actor-user-id`, `x-correlation-id`.
- **`GET .../attachments`:** delega a `TaskService.listTaskAttachments`, avaliando `PERMISSION_CODES.TASK_VIEW` em tarefas ativas e `PERMISSION_CODES.TRASH_VIEW` quando a tarefa está excluída logicamente em projeto ativo (falhando fechado com `409 Conflict` se o projeto também estiver excluído). Retorna `200 OK` (`readonly TaskAttachment[]`).
- **`POST .../attachments`:** body JSON `{ fileName, mimeType, contentBase64 }`. A borda MSW decodifica `contentBase64` → `Uint8Array` (`422` se Base64 inválido) e delega a `TaskService.uploadTaskAttachment` (`PERMISSION_CODES.TASK_ATTACHMENT_MANAGE`), que valida a denylist canônica de MIME (`DISALLOWED_ATTACHMENT_MIME_TYPES`, normalizando parâmetros como `; charset=utf-8` e rejeitando executáveis/ativos web com `422 ValidationError`, `details.field: 'mimeType'`, `reason: 'DISALLOWED_MIME_TYPE'`), valida limites (`maxAttachmentSizeBytes`, `maxContextAttachmentsSizeBytes`, `maxAttachmentsPerContext`), calcula `checksumSha256` **antes** de `TransactionPort.run` (prevenindo `PrematureCommitError`) e persiste metadados + blob atomicamente; `QuotaExceededError` retorna `500` (`InfrastructureError` `STORAGE_QUOTA_EXCEEDED`) sem jamais apagar dados existentes. Retorna `201 Created` (`TaskAttachment`).
- **`GET .../attachments/:attachmentId/content`:** delega a `TaskService.getTaskAttachmentContent`, que **revalida estritamente a permissão de leitura na tarefa proprietária** (`PERMISSION_CODES.TASK_VIEW` em tarefas ativas e `PERMISSION_CODES.TRASH_VIEW` quando a tarefa está excluída logicamente em projeto ativo, falhando fechado com `409 Conflict` se o projeto também estiver excluído) antes de ler `AttachmentBlobStorePort.getBlob`. A borda MSW codifica `Uint8Array` → `contentBase64` e retorna `200 OK` (`{ attachment, mimeType, contentBase64 }`).
- **`DELETE .../attachments/:attachmentId`:** delega a `TaskService.deleteTaskAttachment` (`PERMISSION_CODES.TASK_ATTACHMENT_MANAGE`), removendo metadados e blob binário na mesma transação com `AuditEvent` (`task.attachment.deleted`). Retorna `200 OK` (`{ deletedAttachmentId }`).

### 10.5 Etiquetas Organizacionais (`.../organizations/:organizationId/tags*`)
- **Cabeçalhos comuns:** `x-actor-user-id`, `x-correlation-id`.
- **`GET /api/v1/organizations/:organizationId/tags`:** delega a `TaskService.listTags` (qualquer membro `ACTIVE` da organização). Retorna `200 OK` (`readonly Tag[]`).
- **`POST /api/v1/organizations/:organizationId/tags`:** delega a `TaskService.createTag` (`PERMISSION_CODES.ORGANIZATION_SETTINGS_MANAGE`, exclusivo `ADMIN` — Decisão Normativa B). Body `{ name, colorToken? }`. Impõe unicidade case-insensitive normalizada (`409 Conflict` em colisão). Retorna `201 Created` (`Tag`).
- **`PATCH /api/v1/organizations/:organizationId/tags/:tagId`:** delega a `TaskService.updateTag` (`ORGANIZATION_SETTINGS_MANAGE`). Body `{ name?, colorToken? }`. Impõe unicidade normalizada (`409 Conflict`). Retorna `200 OK` (`Tag`).
- **`DELETE /api/v1/organizations/:organizationId/tags/:tagId`:** delega a `TaskService.deleteTag` (`ORGANIZATION_SETTINGS_MANAGE`). Remove atomicamente o `tagId` de todas as tarefas afetadas na organização com `AuditEvent` (`tag.deleted`). Retorna `200 OK` (`{ deletedTagId, updatedTaskCount }`).
- *Nota:* Associação/remoção de etiquetas em tarefa específica ocorre via `PATCH .../tasks/:taskId` com `tagIds` (`PERMISSION_CODES.TASK_UPDATE`, `requestedFields: ['tags']`).

### 10.6 Dependências Acíclicas (`.../tasks/:taskId/dependencies*`)
- **Cabeçalhos comuns:** `x-actor-user-id`, `x-correlation-id`.
- **`GET .../dependencies`:** delega a `DependencyService.listTaskDependencies` (`PERMISSION_CODES.DEPENDENCY_VIEW`). Avalia `TASK_VIEW` de cada tarefa relacionada para preencher `relatedTasksAccessible`; arestas envolvendo tarefas fora do escopo do ator são negadas por `DENIED_OUT_OF_SCOPE` e omitidas sem vazar título ou estado. Retorna `200 OK` (`readonly TaskDependencyListItem[]`).
- **`POST .../dependencies`:** delega a `DependencyService.addDependency` (`PERMISSION_CODES.DEPENDENCY_MANAGE`). Body `{ dependsOnTaskId, required? }`. Bloqueia auto-dependência, ciclos diretos/indiretos (`assertNoDependencyCycle`), duplicidade (`findByPair`), tarefas canceladas e relações entre projetos/organizações distintas (`409`/`404`/`403`); atualiza `lastActivityAt` preservando `lastMovedAt`. Retorna `201 Created` (`TaskDependency`).
- **`DELETE .../dependencies/:dependencyId`:** delega a `DependencyService.removeDependency` (`PERMISSION_CODES.DEPENDENCY_MANAGE`). Remove dependência, atualiza `lastActivityAt` preservando `lastMovedAt` e registra `AuditEvent`. Retorna `200 OK` (`{ deletedDependencyId }`).

### 10.7 Impedimentos (`.../tasks/:taskId/impediments*`)
- **Cabeçalhos comuns:** `x-actor-user-id`, `x-correlation-id`.
- **`GET .../impediments`:** delega a `ImpedimentService.listTaskImpediments` (`PERMISSION_CODES.IMPEDIMENT_VIEW`). Retorna `200 OK` (`readonly Impediment[]`).
- **`POST .../impediments`:** delega a `ImpedimentService.createImpediment` (`PERMISSION_CODES.IMPEDIMENT_CREATE`). Body `{ category, severity, description, ownerUserId? }` (7 categorias de `IMPEDIMENT_CATEGORIES`, severidades `LOW | MEDIUM | HIGH | CRITICAL`). Cria impedimento `OPEN`, transita tarefa para `BLOCKED` (preservando `lastMovedAt`) e registra `AuditEvent`. Retorna `201 Created` (`Impediment`).
- **`PATCH .../impediments/:impedimentId`:** delega a `ImpedimentService.updateImpediment` (`PERMISSION_CODES.IMPEDIMENT_CREATE`). Body `{ category?, severity?, description?, ownerUserId? }`. Atualiza metadados de impedimento ativo mantendo `lastMovedAt` intacto. Retorna `200 OK` (`Impediment`).
- **`POST .../impediments/:impedimentId/transition`:** delega a `ImpedimentService.transitionImpediment` (`IMPEDIMENT_RESOLVE` para `RESOLVED`/`CANCELLED`, respeitando simetria de `MANAGER` participante e `allowMemberResolveOthersImpediment`; `IMPEDIMENT_CREATE` para `OPEN`/`IN_RESOLUTION`). Body `{ targetStatus, resolutionNote? }`. Valida `assertImpedimentTransitionAllowed` (`autoCompletesTask: false`); ao encerrar o último impedimento bloqueante, restaura o status operacional elegível (`PAUSED` se pausa aberta, senão `IN_PROGRESS` se iniciada ou `TODO`), nunca concluindo automaticamente a tarefa e preservando `lastMovedAt`. Retorna `200 OK` (`Impediment`).

---

## 11. Catálogo de Endpoints da Fase 08 (Modo Foco, Carga de Trabalho 0–100 e Gargalos)

Todos os endpoints abaixo delegam estritamente aos casos de uso em `container.services` (`FocusService` e `BottleneckService`), preservando o Schema Dexie `v2` (`51` tabelas), o DAG acíclico (`ADR-0012` §3), a regra de disparo explícito sem escrita implícita em mutações de Kanban/Tarefas (`DN-04`), a privacidade *Default Deny* para alertas `OVERLOAD` de terceiros (`DN-02`), o bloqueio `409 Conflict` em projetos arquivados/excluídos (`DN-05`) e a propagação ABAC integral com `toAuthorizationPolicyConfig(settings)`. Nenhuma métrica histórica reservada à Fase 10 (`Lead Time`, `Cycle Time`, `Throughput`, séries temporais) é exposta nesta seção (`DN-01`).

### 11.1 Modo Foco Individual (`FocusService`)
- **Cabeçalhos comuns:** `x-actor-user-id`, `x-correlation-id`.
- **`GET /api/v1/organizations/:organizationId/focus`:** query params opcionais `projectId` e `onlyMyTasks=true`. Delega a `FocusService.getMyFocusView`, avaliando `PERMISSION_CODES.FOCUS_PREFERENCES_MANAGE` e `PERMISSION_CODES.ANALYTICS_PERSONAL_VIEW` (`ownerUserId === actorUserId`), filtrando todas as tarefas candidatas item-a-item por `PERMISSION_CODES.TASK_VIEW`, calculando `workload` próprio (`calculateWorkloadScore`, `representsHours: false`), ranqueando tarefas ativas acionáveis via `rankFocusTasks` com `calibratableWeights`, separando `blockedTasks` com motivo explicável (`OPEN_IMPEDIMENT`, `PENDING_DEPENDENCY`, `PAUSED`, `OTHER`) e condição de desbloqueio (sem vazar títulos de predecessoras fora do escopo) e retornando contadores pessoais instantâneos (`counters`) + `hiddenTasks`. Retorna `200 OK` (`MyFocusView`).
- **`PUT /api/v1/organizations/:organizationId/focus/preferences`:** delega a `FocusService.updateFocusPreferences` (`PERMISSION_CODES.FOCUS_PREFERENCES_MANAGE` com `ownerUserId === actorUserId`). Body `{ mode?: 'AUTO' | 'MANUAL', pinnedTaskIds?: string[], hiddenTaskIds?: string[], manualOrderTaskIds?: string[] }`. Revalida `TASK_VIEW` para cada tarefa referenciada, reutiliza `existing.id` no índice único `&[organizationId+userId]`, nunca altera Kanban nem `Task.priority` e publica `focus.preferences.updated` pós-commit. Retorna `200 OK` (`FocusPreference`).
- **`POST /api/v1/organizations/:organizationId/focus/preferences/reset`:** delega a `FocusService.resetFocusPreferences` (`PERMISSION_CODES.FOCUS_PREFERENCES_MANAGE` com `ownerUserId === actorUserId`). Restaura preferências individuais para `{ mode: 'AUTO', pinnedTaskIds: [], hiddenTaskIds: [], manualOrderTaskIds: [] }` reutilizando `existing.id` e publica `focus.preferences.updated` pós-commit. Retorna `200 OK` (`FocusPreference`).

### 11.2 Carga de Trabalho Pessoal e Gargalos (`BottleneckService`)
- **Cabeçalhos comuns:** `x-actor-user-id`, `x-correlation-id`.
- **`GET /api/v1/organizations/:organizationId/workload/me`:** delega a `BottleneckService.getMyWorkloadSummary` (`PERMISSION_CODES.ANALYTICS_PERSONAL_VIEW` com `ownerUserId === actorUserId`). Retorna score ponderado próprio `0–100` (`calculateWorkloadScore`, `representsHours: false`), faixa (`LOW` | `MODERATE` | `HIGH` | `CRITICAL`) e breakdown operacional instantâneo (`todoCount`, `inProgressCount`, `pausedCount`, `blockedCount`, `overdueCount`, `sharedTaskCount`, `openSubtaskCount`). Retorna `200 OK` (`MyWorkloadSummary`).
- **`GET /api/v1/organizations/:organizationId/bottlenecks`:** query params opcionais `projectId`, `indicator` (`WIP` | `INACTIVITY` | `OVERDUE` | `IMPEDIMENTS` | `OVERLOAD`), `status` (`OPEN` | `ACKNOWLEDGED` | `RESOLVED`) e `includeResolved=true`. Delega a `BottleneckService.listOrganizationAlerts`. Avalia `PERMISSION_CODES.BOTTLENECK_VIEW` projeto a projeto (ocultando projetos não autorizados e alertas sem `projectId` para não-`ADMIN` **antes** de contagens e agregações) e aplica `DN-02` ocultando alertas individuais `OVERLOAD` de terceiros (`targetEntityType === 'USER' && targetEntityId !== actorUserId`) para `MEMBER` e para `MANAGER` com `allowManagerViewIndividualProductivity === false`, expondo apenas `overloadedMemberCount` anonimizado. Retorna `200 OK` (`OrganizationBottleneckAlertsResult`).
- **`GET /api/v1/organizations/:organizationId/projects/:projectId/bottlenecks`:** delega a `BottleneckService.getProjectBottlenecksOverview` (`PERMISSION_CODES.BOTTLENECK_VIEW`). Calcula ao vivo os 5 indicadores (`WIP` via `doesTaskStatusOccupyWip`, `INACTIVITY` via `lastMovedAt`, `OVERDUE`, `IMPEDIMENTS` e `OVERLOAD`) sem gravar em `bottleneckAlerts` (`DN-04`), filtra detalhes de tarefas item-a-item por `PERMISSION_CODES.TASK_VIEW`, aplica `DN-02` sobre `activeAlerts` e `overloadedMemberCount`, e expõe `memberWorkloads` de terceiros **somente** quando `ANALYTICS_PROJECT_VIEW` com `includesThirdPartyIndividualMetrics: true` autorizar. Retorna `200 OK` (`ProjectBottlenecksOverview`).
- **`POST /api/v1/organizations/:organizationId/projects/:projectId/bottlenecks/evaluate`:** delega a `BottleneckService.evaluateProjectBottlenecks` (`PERMISSION_CODES.BOTTLENECK_RULES_MANAGE` — bloqueia projeto arquivado/excluído com `409 Conflict`). Avalia os 5 indicadores com `normalizeProjectBottleneckThresholds`, deduplica contra alertas ativos (`OPEN` / `ACKNOWLEDGED`) via `upsertBottleneckAlert`, persiste em lote via `saveMany` + `AuditEvent` (`category: 'PROJECT'`, `eventType: 'bottleneck.project.evaluated'`), publica `bottleneck.project.evaluated` pós-commit e aplica `DN-02` na projeção retornada. Retorna `200 OK` (`EvaluateProjectBottlenecksResult`).
- **`PATCH /api/v1/organizations/:organizationId/projects/:projectId/bottlenecks/thresholds`:** delega a `BottleneckService.updateProjectBottleneckRules` (`PERMISSION_CODES.BOTTLENECK_RULES_MANAGE` — bloqueia projeto arquivado/excluído com `409 Conflict`). Body `{ inactivityThresholdDays?: number, thresholds?: ProjectBottleneckThresholds }`. Valida via `assertValidProjectBottleneckThresholds` e `normalizeProjectBottleneckThresholds` (`422` em valores inválidos ou pares invertidos), persiste em `Project` + `AuditEvent` (`category: 'PROJECT'`, `eventType: 'bottleneck.rules.updated'`) e publica `bottleneck.rules.updated` pós-commit. Retorna `200 OK` (`ProjectBottleneckRulesResult`).
- **`POST /api/v1/organizations/:organizationId/bottlenecks/:alertId/acknowledge` e `.../resolve`:** delegam a `BottleneckService.acknowledgeAlert` e `resolveAlert` (`PERMISSION_CODES.BOTTLENECK_RULES_MANAGE` — bloqueia projeto arquivado/excluído com `409 Conflict` e protege sigilo `DN-02`). Impõem transição `OPEN -> ACKNOWLEDGED -> RESOLVED` (`ACKNOWLEDGED !== RESOLVED`, `409 Conflict` em transição inválida), gravam `AuditEvent` (`category: 'PROJECT' | 'ORGANIZATION'`) e publicam `bottleneck.alert.acknowledged` / `bottleneck.alert.resolved` pós-commit. Retornam `200 OK` (`BottleneckAlert`).
- **`GET /api/v1/organizations/:organizationId/settings/productivity-visibility` e `PATCH .../settings/productivity-visibility`:** delegam a `BottleneckService.getIndividualProductivityVisibility` e `updateIndividualProductivityVisibility` (`PERMISSION_CODES.ORGANIZATION_SETTINGS_MANAGE`, **exclusivo `ADMIN`** via `adminExclusiveRule` — `DN-06`). O `PATCH` recebe `{ allowManagerViewIndividualProductivity: boolean, justification?: string }`, atualiza `OrganizationSettings.pendingPermissionDefaults.allowManagerViewIndividualProductivity` com `AuditEvent` (`category: 'ORGANIZATION'`, `eventType: 'organization.productivity_visibility.updated'`) e publica evento pós-commit. Retornam `200 OK` (`IndividualProductivityVisibilityResult`).
