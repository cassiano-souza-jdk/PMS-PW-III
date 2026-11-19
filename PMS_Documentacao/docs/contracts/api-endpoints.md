# Contrato de Endpoints Simulados (HTTP Client + MSW v2)

- **Fase:** 03 — Dexie, IndexedDB, Repositórios e MSW
- **Referências normativas:** `API-SIMULATION.md`, `DATA-PERSISTENCE.md`, `ARCHITECTURE.md`, `PERMISSIONS.md`, `SECURITY.md`, `ADR-0002`, `ADR-0003`, `ADR-0007`, `docs/contracts/event-envelope.md`, `docs/contracts/permission-matrix.md`.

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
- **Propósito:** diagnóstico local do banco Dexie (`pms_local_db`), versão do schema (`1`), versão da seed demo (`1.0.0`) e indicador `demoOrganizationSeeded`.
- **Autorização:** público (diagnóstico local).
- **Response (`200 OK`):** `ApiSuccessEnvelope<HealthEndpointResponse>`.

### 6.2 `POST /api/v1/demo/seed`
- **Propósito:** dispara `ensureDemoOrganizationSeeded` dentro de transação Dexie de 16 stores.
- **Comportamento idempotente:** retorna `201 Created` (`{ seeded: true, organizationId, seedVersion }`) na primeira execução e `200 OK` (`{ seeded: false, organizationId, seedVersion }`) nas chamadas subsequentes sem sobrescrever dados existentes.
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
