# Envelope de eventos

Campos recomendados: - eventId: UUID idempotente. - eventType: código
estável. - occurredAt: timestamp ISO 8601. - organizationId: escopo
organizacional quando aplicável. - actorId: usuário/ator ou sistema. -
correlationId: rastreamento da operação. - aggregateType e aggregateId:
entidade afetada. - payload: dados mínimos necessários, sem segredos.

Eventos são emitidos após persistência confirmada. Não usar eventos como
substituto de transação.
