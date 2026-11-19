# Módulo de feedback e contestações

## Ciclo

Feedback -\> FeedbackCycle -\> resolução -\> janela de
manifestação/contestação -\> contestação opcional -\> decisão
administrativa -\> encerramento ou novo ciclo.

## Origem do ciclo

INITIAL, CONTESTATION_REOPEN, EXCEPTIONAL_REOPEN.

## Contestação

Obrigatórios: ciclo, resolução de origem, motivo versionado,
justificativa, autor e timestamp. Sem limite fixo de contestações, mas
nova contestação exige nova resolução e anterior encerrada.

## Análise

Admin pode delegar a admin/gestor autorizado. Parecer imutável e
estruturado. Decisão final somente admin. Divergir do parecer exige
justificativa.

## Resultado

Aceita: retorna feedback a Em atendimento e cria novo ciclo quando
aplicável. Rejeitada: mantém Resolvido. Contestação encerra
automaticamente após decisão.

## Reabertura excepcional

Após encerramento por expiração, autor solicita com justificativa; admin
aprova/rejeita. Aprovação cria novo ciclo, novos SLAs, preserva
responsável e prioridade como valores iniciais. Fluxo convencional
integral.

## Histórico

Cronológico, completo e segmentado por permissão. Exportação
PDF/CSV/XLSX/JSON respeitando visibilidade.
