# AGENTS.md — Ponteiro de Governança (Raiz do Repositório)

Este arquivo é um ponteiro mínimo na raiz do repositório. **Não duplicar** regras normativas aqui; a fonte normativa canônica reside integralmente em `PMS_Documentacao/`.

## Fontes Normativas Obrigatórias

Antes de qualquer planejamento, alteração ou revisão, consulte na ordem abaixo:

1. [`PMS_Documentacao/AGENTS.md`](PMS_Documentacao/AGENTS.md) — instruções globais, hierarquia de decisão e proibições.
2. [`PMS_Documentacao/AI-AGENTS.md`](PMS_Documentacao/AI-AGENTS.md) — governança multiagente, paralelismo e autoridade.
3. [`PMS_Documentacao/AGENT-WORKFLOW.md`](PMS_Documentacao/AGENT-WORKFLOW.md) e [`PMS_Documentacao/TASK-TEMPLATE.md`](PMS_Documentacao/TASK-TEMPLATE.md) — fluxo de execução e formato de entrega.
4. [`PMS_Documentacao/INDEX.md`](PMS_Documentacao/INDEX.md) — índice completo do pacote normativo (PRD, Arquitetura, Domínio, Permissões, Contratos e ADRs).
5. [`PMS_Documentacao/ADR/ADR-0005-workspace-layout-governance-and-boundaries.md`](PMS_Documentacao/ADR/ADR-0005-workspace-layout-governance-and-boundaries.md) — topologia documental, estrutura de código e fronteiras arquiteturais.

## Definições dos Agentes Especializados

As especificações dos 6 agentes especializados subordinados ao PMS Orchestrator estão em `.agents/agents/`:

- `.agents/agents/arquiteto.md`
- `.agents/agents/frontend.md`
- `.agents/agents/persistencia.md`
- `.agents/agents/seguranca.md`
- `.agents/agents/qa.md`
- `.agents/agents/revisor.md`

## Regras Operacionais Rápidas

- **Branches isoladas obrigatórias:** `feature/<id>-<slug>`, `fix/<id>-<slug>`, `test/<id>-<slug>`, `docs/<id>-<slug>`, `refactor/<id>-<slug>`. Proibido merge direto na branch `main`.
- **Gerenciador de pacotes único:** `pnpm` (`pnpm-lock.yaml` versionado). Em ambientes Windows onde a ExecutionPolicy do PowerShell bloqueia `pnpm.ps1`, executar sempre `pnpm.cmd` (sem alterar políticas de segurança do sistema).
- **ADRs e relatórios:** novos ADRs são registrados em `PMS_Documentacao/ADR/`; relatórios de evidências e homologação são gravados em `reports/`.
- **Conflitos normativos:** nunca decidir silenciosamente; registrar conflito, impacto e escalar ao PMS Orchestrator.
