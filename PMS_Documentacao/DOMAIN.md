# Domínio e modelo conceitual

## Convenções

UUID; datas ISO 8601; códigos internos para estados e papéis;
`organizationId` obrigatório em entidades organizacionais; histórico
append-only lógico.

## Entidades centrais

-   User
-   Organization
-   OrganizationMember
-   Invitation
-   Team
-   TeamMember
-   Project
-   ProjectMember
-   ProjectBoard
-   BoardColumn
-   Task
-   TaskParticipant
-   Subtask
-   TaskDependency
-   Impediment
-   TaskPause
-   TaskExecutionCycle
-   Notification
-   AuditEvent
-   Feedback
-   FeedbackCycle
-   FeedbackMessage
-   FeedbackInternalNote
-   FeedbackAttachment
-   FeedbackContest
-   FeedbackContestReason
-   FeedbackContestReasonVersion
-   FeedbackContestAnalysis
-   FeedbackContestDecision
-   FeedbackSlaSnapshot
-   FeedbackReopenRequest
-   DashboardPreference
-   Backup
-   MaintenanceEvent

## Relacionamentos principais

-   User N:N Organization por OrganizationMember.
-   User N:N Team por TeamMember.
-   Project pertence a Organization; opcionalmente Team.
-   Project N:N User por ProjectMember.
-   Project 1:1 ProjectBoard principal.
-   Board 1:N BoardColumn.
-   Project 1:N Task.
-   Task 1:N Subtask (um nível).
-   Task N:N Task por TaskDependency, com validação de ciclos.
-   Task 1:N TaskExecutionCycle.
-   Feedback 1:N FeedbackCycle.
-   FeedbackCycle 1:N FeedbackContest.
-   FeedbackContest referencia FeedbackContestReasonVersion.
-   FeedbackContest 1:N análises e eventos/decisões.
-   Organization 1:N categorias e versões.
-   Organization 1:N AuditEvent.

## Estados

Enums devem ser centralizados e não traduzidos no domínio. Exemplos:
TaskStatus, FeedbackStatus, InvitationStatus, ImpedimentStatus,
ContestStatus, CycleOrigin, Priority, Severity.

## Ciclos de feedback

`CycleOrigin`: INITIAL, CONTESTATION_REOPEN, EXCEPTIONAL_REOPEN. Cada
ciclo possui prioridade snapshot, responsável inicial, calendário/SLA
snapshot, datas e estado. Cada contestação referencia ciclo e resolução
de origem específicos.

## Versionamento de motivo

FeedbackContestReason possui identidade estável;
FeedbackContestReasonVersion preserva nome, descrição, estado e número
de versão. Contestação referencia a versão usada. Reativação/edição cria
nova versão; categoria usada não é removida fisicamente.

## Integridade

-   Não permitir relação cross-organization.
-   Não permitir dependência cíclica.
-   Não permitir ciclo de feedback sem origem válida.
-   Não permitir contestação sem resolução de origem, categoria
    versionada e justificativa.
-   Não apagar histórico para corrigir dado; criar evento corretivo.
