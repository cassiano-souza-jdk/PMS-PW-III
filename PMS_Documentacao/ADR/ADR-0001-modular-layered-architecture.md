# ADR-0001 --- Arquitetura modular em camadas

-   Status: Aceita
-   Contexto: PMS frontend exige módulos independentes e futura
    substituição de infraestrutura.
-   Decisão: arquitetura modular por funcionalidade, com domínio,
    aplicação, infraestrutura e apresentação.
-   Alternativas: arquitetura em camadas global; monólito de
    componentes; microfrontends.
-   Consequências: maior clareza de fronteiras; exige contratos e
    disciplina para evitar acoplamento.
