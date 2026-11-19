# Workflow dos agentes

1.  Orquestrador seleciona fase e tarefas.
2.  Verifica dependências e contratos.
3.  Cria tarefa a partir de `TASK-TEMPLATE.md`.
4.  Atribui agente e branch isolada.
5.  Agente lê contexto, inspeciona código e confirma entendimento.
6.  Implementa escopo restrito.
7.  Executa testes e atualiza documentação.
8.  Entrega relatório.
9.  Revisor verifica aceite e qualidade.
10. CI executa pipeline.
11. Orquestrador aprova e integra.
12. Atualiza estado da fase e relatório.

## Bloqueios

Se houver requisito ambíguo, conflito, contrato ausente ou dependência
não satisfeita, parar a parte afetada e reportar. Não inventar decisão.

## Branches

`feature/<id>-<slug>`, `fix/<id>-<slug>`, `test/<id>-<slug>`,
`docs/<id>-<slug>`, `refactor/<id>-<slug>`.
