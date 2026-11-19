# Padrões de desenvolvimento

-   TypeScript strict; evitar `any`.
-   Preferir funções pequenas e coesas.
-   Nomear tipos, funções e arquivos de forma explícita.
-   Domínio sem dependência de framework.
-   Zod para validação de entrada; regras de domínio também validadas na
    aplicação.
-   React Hook Form para formulários.
-   Componentes shadcn/ui customizados com Tailwind.
-   Tabler Icons.
-   React Router para navegação.
-   Contextos pequenos e especializados.
-   Tratamento centralizado de erros.
-   Não duplicar lógica de autorização.
-   Não usar strings traduzidas como códigos de domínio.
-   Não colocar fórmulas de Analytics em componentes.
-   Não adicionar dependências sem justificar no PR.
-   ESLint e Prettier obrigatórios.
-   pnpm como único gerenciador; lockfile versionado.
