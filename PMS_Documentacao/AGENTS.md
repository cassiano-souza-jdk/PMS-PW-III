# AGENTS.md --- Instruções globais

## Missão

Implementar o PMS conforme o PRD e os documentos normativos, preservando
arquitetura, integridade de dados, permissões e rastreabilidade.

## Hierarquia

1.  Requisitos e decisões aprovados no `PRD.md`.
2.  Regras globais deste arquivo e `AI-AGENTS.md`.
3.  `ARCHITECTURE.md`, `DOMAIN.md`, `PERMISSIONS.md` e demais documentos
    técnicos.
4.  Especificação do módulo.
5.  Tarefa atribuída.

Se houver contradição, não escolha silenciosamente. Registre o conflito,
explique impacto e encaminhe ao orquestrador.

## Antes de trabalhar

-   Leia este arquivo e `AI-AGENTS.md`.
-   Identifique fase, papel, tarefa, dependências e critérios de aceite.
-   Consulte os documentos do módulo e contratos vigentes.
-   Inspecione o código existente antes de criar ou alterar arquivos.
-   Verifique branch, estado do Git e alterações de outros agentes.
-   Não assuma que uma tarefa antiga continua pendente.

## Regras obrigatórias

-   TypeScript estrito; evitar `any`.
-   Domínio independente de React, Dexie e MSW.
-   Componentes React não acessam IndexedDB diretamente.
-   Casos de uso verificam autorização; esconder botão não é
    autorização.
-   Toda consulta e mutação organizacional respeita `organizationId`.
-   Operações multi-entidade usam transações quando suportadas.
-   Eventos são emitidos somente após persistência confirmada.
-   Operações repetíveis e críticas devem ser idempotentes.
-   Não registrar senhas, tokens, segredos ou dados pessoais
    desnecessários.
-   Não apagar dados de negócio automaticamente para liberar
    armazenamento.
-   Não alterar decisões aprovadas sem processo formal.
-   Atualizar documentação, testes e ADRs quando aplicável.

## Proibições

-   Não implementar backend real, banco remoto ou sincronização entre
    dispositivos como se fizessem parte do protótipo.
-   Não inserir segredos em variáveis `VITE_`.
-   Não usar `any` para contornar contratos.
-   Não acessar Dexie diretamente a partir de componentes.
-   Não criar dependências circulares entre módulos.
-   Não fazer merge diretamente na branch principal.
-   Não declarar concluído sem evidências de teste.

## Entrega de tarefa

Informar: objetivo concluído, arquivos alterados, decisões aplicadas,
testes executados e resultados, limitações, riscos, pendências e
documentação atualizada.
