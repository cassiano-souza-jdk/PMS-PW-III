# AI-AGENTS.md --- Governança dos agentes

## Modelo de coordenação

Modelo híbrido: um orquestrador principal planeja, decompõe, distribui,
acompanha, integra e aprova; agentes especializados executam tarefas
independentes em paralelo.

## Papéis

-   Orquestrador: plano, dependências, contratos, conflitos, integração
    e aprovação.
-   Arquiteto: domínio, arquitetura, fronteiras, contratos e ADRs.
-   Frontend: React, rotas, componentes, acessibilidade e experiência.
-   Persistência: Dexie, IndexedDB, migrações, índices e repositórios.
-   Serviços simulados: MSW, cliente HTTP e cenários de falha.
-   Segurança: RBAC/ABAC, isolamento, validação e revisão de riscos.
-   QA: testes unitários, integração, E2E e evidências.
-   Documentação: PRD, documentação técnica, rastreabilidade e
    relatórios.

Papéis podem ser combinados quando não houver conflito de
responsabilidade. O agente não decide fora de sua autoridade.

## Ciclo de trabalho

1.  Orquestrador define objetivo, escopo, restrições e aceite.
2.  Dependências e contratos são identificados.
3.  Tarefas independentes são distribuídas.
4.  Agentes trabalham em branches isoladas.
5.  Cada agente executa testes e prepara relatório.
6.  Revisão técnica e funcional.
7.  Integração controlada.
8.  CI completo.
9.  Aprovação explícita da tarefa/fase.

## Paralelismo

Paralelizar somente tarefas independentes. Mudanças em entidades,
contratos, permissões, esquema Dexie ou componentes compartilhados
exigem coordenação prévia. Um agente não deve editar arquivos
compartilhados sem autorização.

## Autoridade

-   Requisitos aprovados só mudam mediante decisão registrada.
-   Alterações arquiteturais exigem ADR.
-   O orquestrador aprova escopo e integração.
-   QA reporta evidências, não substitui aprovação funcional.
-   Nenhum agente pode afirmar que testes passaram sem executá-los.

## Recuperação de contexto

Ao retomar trabalho, consultar Git, fase atual, tarefas abertas,
relatórios, ADRs, PRD e contratos. A memória da conversa não é fonte
normativa; os arquivos versionados são a fonte de verdade.

## Relatório obrigatório

Use `TASK-TEMPLATE.md`. Informar status real, arquivos, testes,
resultados, pendências, riscos, divergências e recomendação.
