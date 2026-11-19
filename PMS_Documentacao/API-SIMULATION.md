# API simulada --- MSW

## Objetivo

Simular transporte HTTP e cenários de rede sem deslocar regras de
negócio para handlers.

## Arquitetura

UI/Application -\> client HTTP tipado -\> MSW handlers -\>
serviços/repositórios Dexie. Casos de uso de domínio permanecem
reutilizáveis e independentes de MSW.

## Contratos por endpoint

Documentar método, caminho, parâmetros, request, response, erros,
autorização, latência e cenários de falha.

## Regras

-   Handlers por módulo.
-   Respostas e erros padronizados.
-   Latência e falhas controláveis por cenário.
-   IDs de correlação.
-   Sem segredos reais.
-   Não simular sucesso antes da persistência.
-   MSW não é backend real e não oferece segurança de servidor.

## Evolução

O cliente HTTP e DTOs devem permitir substituir MSW por API real sem
reescrever componentes ou domínio.
