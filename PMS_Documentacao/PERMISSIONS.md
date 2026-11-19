# Autorização — RBAC + ABAC

Este documento apresenta os princípios de autorização do PMS. A matriz normativa por recurso/ação, os códigos estáveis e os cenários de aceite estão em [`docs/contracts/permission-matrix.md`](docs/contracts/permission-matrix.md).

## Papéis organizacionais

- `ADMIN`: administração da organização à qual está associado.
- `MANAGER`: gestão dos projetos e equipes explicitamente atribuídos ou administrados; não possui autoridade organizacional global.
- `MEMBER`: acesso aos projetos dos quais participa e operação das tarefas em que é responsável/participante, conforme ação e estado.

Papéis são definidos por organização. Um mesmo usuário pode possuir papéis diferentes em organizações distintas.

## Princípios obrigatórios

- Default Deny: toda ação sem regra explícita é negada.
- Deny Overrides: negações explícitas prevalecem sobre permissões concedidas.
- Menor privilégio e escopo explícito.
- Associação ativa à organização proprietária é requisito.
- Papel não basta: avaliar projeto, equipe, autoria, responsabilidade, participação, estado e concessões.
- Validar autorização no serviço/caso de uso em consultas e mutações.
- A interface apenas reflete a autorização; não é mecanismo de segurança.
- Concessões adicionais devem ter escopo, concedente autorizado, justificativa e validade; expiração e revogação são efetivas na avaliação.
- Remoção de participação revoga concessões vinculadas ao escopo removido.
- Permissões de manutenção demo são independentes dos papéis ADMIN/MANAGER.

## Limite de segurança do protótipo

O PMS é um protótipo frontend local, com IndexedDB e serviços simulados. A autorização deve ser implementada e testada na camada de aplicação, mas não deve ser apresentada como segurança de servidor, isolamento resistente a adulteração do cliente ou proteção de dados em ambiente multiusuário real.

## Contratos relacionados

- [Matriz RBAC + ABAC, regras de escopo, concessões e aceite](docs/contracts/permission-matrix.md)
- [Modelo de domínio](DOMAIN.md)
- [Segurança](SECURITY.md)
- [Envelope de eventos](docs/contracts/event-envelope.md)
