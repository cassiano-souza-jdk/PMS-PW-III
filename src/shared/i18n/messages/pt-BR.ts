export const ptBRMessages = {
  'app.name': 'PMS — Project Management System',
  'app.shortName': 'PMS',
  'app.skipToMain': 'Pular para o conteúdo principal',
  'app.loading': 'Carregando conteúdo...',

  'nav.primaryLabel': 'Navegação principal',
  'nav.foundation': 'Fundação',

  'theme.switcherLabel': 'Selecionar tema da interface',
  'theme.light': 'Claro',
  'theme.dark': 'Escuro',
  'theme.system': 'Sistema',
  'theme.currentLabel': 'Tema atual: {theme}',

  'footer.version': 'Versão {version}',
  'footer.environment': 'Ambiente: {env}',
  'footer.prototypeNotice':
    'Protótipo frontend local em execução no navegador, sem backend remoto nem sincronização entre dispositivos.',

  'foundation.title': 'Fundação técnica — Fase 01',
  'foundation.subtitle':
    'Base arquitetural do Project Management System configurada e pronta para a implementação incremental dos módulos de negócio.',
  'foundation.statusBadge': 'Fundação ativa',
  'foundation.card.architecture.title': 'Arquitetura em camadas',
  'foundation.card.architecture.description':
    'Separação explícita entre Apresentação, Aplicação, Domínio e Infraestrutura com fronteiras verificadas automaticamente.',
  'foundation.card.accessibility.title': 'Acessibilidade WCAG 2.2 AA',
  'foundation.card.accessibility.description':
    'Navegação por teclado, foco visível de alto contraste, landmarks semânticos e suporte a tema claro e escuro.',
  'foundation.card.i18n.title': 'Internacionalização pt-BR',
  'foundation.card.i18n.description':
    'Mensagens centralizadas em português do Brasil, preservando códigos de domínio desacoplados da apresentação.',
  'foundation.card.runtime.title': 'Runtime e diagnóstico',
  'foundation.card.runtime.description':
    'Ambiente {env}, versão {version}, nível de log {logLevel}.',

  'notFound.code': '404',
  'notFound.title': 'Página não encontrada',
  'notFound.description': 'O endereço solicitado não corresponde a nenhuma rota disponível no PMS.',
  'notFound.backHome': 'Voltar para o início',

  'errorBoundary.title': 'Algo deu errado',
  'errorBoundary.description':
    'Ocorreu uma falha inesperada durante a renderização desta interface. Nenhuma informação sensível foi exposta.',
  'errorBoundary.codeLabel': 'Código de referência: {code}',
  'errorBoundary.retry': 'Tentar novamente',
  'errorBoundary.backHome': 'Voltar para o início',

  'errors.AUTHENTICATION_ERROR': 'É necessário autenticar-se novamente para continuar.',
  'errors.AUTHORIZATION_ERROR': 'Você não tem permissão para realizar esta operação.',
  'errors.NOT_FOUND': 'O recurso solicitado não foi encontrado.',
  'errors.CONFLICT': 'Não foi possível concluir a operação devido a um conflito de estado atual.',
  'errors.VALIDATION_ERROR':
    'Os dados informados são inválidos. Revise os campos e tente novamente.',
  'errors.INFRASTRUCTURE_ERROR':
    'Ocorreu uma falha temporária ao acessar os recursos locais da aplicação.',
  'errors.UNEXPECTED_ERROR': 'Ocorreu um erro inesperado. Tente novamente em instantes.',
} as const;

export type MessageId = keyof typeof ptBRMessages;
export type AppMessages = Record<MessageId, string>;
