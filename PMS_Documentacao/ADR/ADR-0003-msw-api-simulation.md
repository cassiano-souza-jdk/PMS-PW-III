# ADR-0003 --- Simulação HTTP com MSW

-   Status: Aceita
-   Contexto: demonstrar fluxo cliente/API sem servidor real.
-   Decisão: MSW intercepta HTTP; serviços e repositórios locais
    executam operações.
-   Consequências: contratos testáveis e futura substituição; MSW não é
    backend nem camada de segurança.
