# Contrato de Endpoints Simulados (HTTP Client + MSW v2)

- **Fase:** 03–04 — Dexie, IndexedDB, Repositórios, MSW, Autenticação, Usuários e Organizações
- **Referências normativas:** `API-SIMULATION.md`, `DATA-PERSISTENCE.md`, `ARCHITECTURE.md`, `PERMISSIONS.md`, `SECURITY.md`, `ADR-0002`, `ADR-0003`, `ADR-0007`, `ADR-0008`, `docs/contracts/event-envelope.md`, `docs/contracts/permission-matrix.md`.

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
- **Autorização:** filtra os projetos da organização avaliando `PERMISSION_CODES.PROJECT_VIEW` para cada projeto no escopo do ator (`ADMIN`, gerente do projeto, participante do projeto ou portador de `PermissionGrant` ativo).
- **Response (`200 OK`):** `ApiSuccessEnvelope<readonly Project[]>`.

### 6.5 `POST /api/v1/organizations/:organizationId/projects`
- **Cabeçalhos:** `x-actor-user-id`, `x-correlation-id`.
- **Autorização:** `PERMISSION_CODES.PROJECT_CREATE` (exige `ADMIN`, `MANAGER` no escopo de equipe administrada ou `PermissionGrant` válido).
- **Request Body:** `{ id?: string, name: string, description?: string, teamId?: string, ownerUserId?: string, inactivityThresholdDays?: number }`.
- **Persistência Transacional:** grava atomicamente `Project`, `ProjectMember` (`MANAGER`) e `AuditEvent` (`category: 'PROJECT'`, `eventType: 'project.created'`, `result: 'SUCCESS'`) e publica o evento pós-commit `project.created`.
- **Response (`201 Created`):** `ApiSuccessEnvelope<Project>`.
- **Erros:** `401`, `403`, `422` (`name` vazio ou `inactivityThresholdDays < 1`), `500` (erro simulado ou quota excedida).

### 6.6 `GET /api/v1/organizations/:organizationId/projects/:projectId/tasks`
- **Cabeçalhos:** `x-actor-user-id`, `x-correlation-id`.
- **Autorização:** `PERMISSION_CODES.PROJECT_VIEW` sobre o projeto alvo.
- **Response (`200 OK`):** `ApiSuccessEnvelope<readonly Task[]>` (tarefas ativas não excluídas logicamente, ordenadas por `order ASC`).

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
