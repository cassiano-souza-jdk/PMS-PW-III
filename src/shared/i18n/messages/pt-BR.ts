export const ptBRMessages = {
  'app.name': 'PMS — Project Management System',
  'app.shortName': 'PMS',
  'app.skipToMain': 'Pular para o conteúdo principal',
  'app.loading': 'Carregando conteúdo...',

  'nav.primaryLabel': 'Navegação principal',
  'nav.foundation': 'Fundação',
  'nav.home': 'Início',
  'nav.organizations': 'Organizações',
  'nav.profile': 'Perfil',
  'nav.settings': 'Configurações',
  'nav.login': 'Entrar',
  'nav.register': 'Criar conta',
  'nav.demo': 'Modo Demo',
  'nav.logout': 'Sair',
  'nav.accountRegionLabel': 'Controles da conta e organização ativa',
  'nav.signedInAs': 'Conectado como {name}',

  'orgSwitcher.label': 'Organização ativa',
  'orgSwitcher.loading': 'Carregando organizações...',
  'orgSwitcher.empty': 'Sem organização ativa',
  'orgSwitcher.demoSuffix': '(Demo)',

  'demoBanner.regionLabel': 'Aviso permanente do Ambiente Demonstrativo',
  'demoBanner.badge': 'MODO DEMONSTRATIVO',
  'demoBanner.activeProfile': 'Perfil ativo: {role} ({roleCode})',
  'demoBanner.description':
    'Você está navegando em uma organização demonstrativa local e isolada. Alterações permanecem apenas neste navegador.',
  'demoBanner.switchProfile': 'Trocar perfil',
  'demoBanner.manageOrganizations': 'Organizações',

  'roles.ADMIN': 'Administrador',
  'roles.MANAGER': 'Gestor',
  'roles.MEMBER': 'Membro',

  'membershipStatus.ACTIVE': 'Ativo',
  'membershipStatus.SUSPENDED': 'Suspenso',
  'membershipStatus.REMOVED': 'Removido',

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

  'auth.common.emailLabel': 'E-mail',
  'auth.common.emailPlaceholder': 'voce@empresa.com.br',
  'auth.common.passwordLabel': 'Senha',
  'auth.common.passwordPlaceholder': 'Digite sua senha',
  'auth.common.confirmPasswordLabel': 'Confirmar senha',
  'auth.common.confirmPasswordPlaceholder': 'Repita sua senha',
  'auth.common.displayNameLabel': 'Nome completo',
  'auth.common.displayNamePlaceholder': 'Ex.: Ana Clara Souza',
  'auth.common.deviceLabel': 'Identificação do dispositivo (opcional)',
  'auth.common.devicePlaceholder': 'Ex.: Notebook Trabalho — Chrome',
  'auth.common.persistentLabel': 'Manter sessão conectada neste navegador',
  'auth.common.persistentHint':
    'Quando desmarcado, a sessão será encerrada ao fechar esta aba do navegador.',
  'auth.common.submitting': 'Processando...',
  'auth.common.localAuthNotice':
    'Autenticação simulada localmente neste navegador (IndexedDB). Nenhuma credencial é enviada a servidores externos.',

  'auth.login.title': 'Entrar no PMS',
  'auth.login.subtitle':
    'Acesse sua conta local para gerenciar organizações, perfil e sessões ativas.',
  'auth.login.submit': 'Entrar',
  'auth.login.forgotPassword': 'Esqueci minha senha',
  'auth.login.noAccount': 'Ainda não possui conta?',
  'auth.login.createAccount': 'Criar conta',
  'auth.login.demoShortcut': 'Acessar Modo Demonstrativo',
  'auth.login.invalidCredentials':
    'E-mail ou senha inválidos. Verifique os dados e tente novamente.',
  'auth.login.success': 'Autenticação realizada com sucesso.',

  'auth.register.title': 'Criar conta local',
  'auth.register.subtitle':
    'Crie um perfil local para começar a criar organizações e gerenciar projetos no PMS.',
  'auth.register.acceptTerms':
    'Li e aceito os termos de uso do protótipo local do Project Management System.',
  'auth.register.submit': 'Criar conta',
  'auth.register.hasAccount': 'Já possui uma conta?',
  'auth.register.signIn': 'Entrar',
  'auth.register.emailConflict': 'Já existe uma conta cadastrada com este endereço de e-mail.',
  'auth.register.success': 'Conta criada com sucesso. Sessão iniciada.',

  'auth.recovery.title': 'Recuperação de senha (simulada)',
  'auth.recovery.subtitle':
    'Informe seu e-mail para registrar uma solicitação simulada de recuperação de acesso local.',
  'auth.recovery.submit': 'Enviar instruções simuladas',
  'auth.recovery.backToLogin': 'Voltar para o login',
  'auth.recovery.successTitle': 'Solicitação registrada',
  'auth.recovery.simulatedNotice':
    'Se existir uma conta correspondente a este e-mail, as instruções simuladas de recuperação local foram registradas.',

  'auth.demo.title': 'Acesso rápido — Ambiente Demonstrativo',
  'auth.demo.subtitle':
    'Explore o PMS com dados realistas em uma organização isolada escolhendo um dos três papéis de acesso.',
  'auth.demo.isolationNotice':
    'A organização demonstrativa é totalmente isolada das suas organizações reais e exibe um banner permanente no topo da interface.',
  'auth.demo.enterButton': 'Entrar como {role}',
  'auth.demo.entering': 'Preparando ambiente demonstrativo...',
  'auth.demo.backToLogin': 'Voltar para login padrão',
  'auth.demo.credentialsHint': 'E-mail de demonstração: {email}',
  'auth.demo.admin.title': 'Administrador (ADMIN)',
  'auth.demo.admin.description':
    'Acesso completo às configurações da organização, gestão de membros, papéis e governança.',
  'auth.demo.manager.title': 'Gestor (MANAGER)',
  'auth.demo.manager.description':
    'Coordenação operacional de projetos e equipes, sem permissões administrativas globais da organização.',
  'auth.demo.member.title': 'Membro (MEMBER)',
  'auth.demo.member.description':
    'Execução diária de tarefas e acompanhamento do próprio perfil, com escopo restrito por papel.',

  'profile.title': 'Meu perfil e sessões',
  'profile.subtitle':
    'Atualize suas informações pessoais e acompanhe ou revogue sessões ativas por dispositivo.',
  'profile.account.title': 'Dados da conta',
  'profile.account.description':
    'Seu nome de exibição e avatar são compartilhados entre todas as organizações em que você participa.',
  'profile.account.emailLabel': 'E-mail da conta',
  'profile.account.emailVerified': 'E-mail verificado (simulado)',
  'profile.account.emailUnverified': 'E-mail não verificado',
  'profile.account.verifyEmailAction': 'Confirmar e-mail (simulado)',
  'profile.account.verifyEmailSuccess': 'Verificação simulada de e-mail concluída com sucesso.',
  'profile.account.avatarUrlLabel': 'URL do avatar (opcional)',
  'profile.account.avatarUrlPlaceholder': 'https://exemplo.com/avatar.png',
  'profile.account.avatarUrlHint':
    'Informe uma URL HTTP(S) válida ou deixe em branco para remover.',
  'profile.account.saveAction': 'Salvar alterações',
  'profile.account.saveSuccess': 'Perfil atualizado com sucesso.',

  'profile.sessions.title': 'Sessões por dispositivo',
  'profile.sessions.description':
    'Revogue sessões específicas ou encerre todas as sessões registradas localmente neste navegador.',
  'profile.sessions.currentBadge': 'Sessão atual',
  'profile.sessions.activeBadge': 'Ativa',
  'profile.sessions.revokedBadge': 'Revogada',
  'profile.sessions.expiredBadge': 'Expirada',
  'profile.sessions.persistentBadge': 'Persistente',
  'profile.sessions.ephemeralBadge': 'Temporária',
  'profile.sessions.deviceLabel': 'Dispositivo: {device}',
  'profile.sessions.createdAt': 'Criada em: {date}',
  'profile.sessions.lastActivity': 'Última atividade: {date}',
  'profile.sessions.expiresAt': 'Expira em: {date}',
  'profile.sessions.revokeAction': 'Revogar sessão',
  'profile.sessions.revokeSuccess': 'Sessão revogada com sucesso.',
  'profile.sessions.revokeAllAction': 'Encerrar todas as sessões',
  'profile.sessions.revokeAllSuccess': 'Todas as sessões foram encerradas.',
  'profile.sessions.empty': 'Nenhuma sessão registrada para esta conta.',

  'organizations.title': 'Minhas organizações',
  'organizations.subtitle':
    'Alterne entre organizações ativas, crie novos espaços de trabalho ou gerencie membros e papéis.',
  'organizations.activeBadge': 'Ativa',
  'organizations.demoBadge': 'Demo',
  'organizations.selectAction': 'Selecionar organização',
  'organizations.selectedLabel': 'Organização selecionada',
  'organizations.emptyTitle': 'Você ainda não participa de nenhuma organização',
  'organizations.emptyDescription':
    'Crie sua primeira organização abaixo ou acesse o Ambiente Demonstrativo para explorar o sistema.',
  'organizations.create.title': 'Criar nova organização',
  'organizations.create.description':
    'Você será adicionado automaticamente como Administrador (ADMIN) da nova organização.',
  'organizations.create.nameLabel': 'Nome da organização',
  'organizations.create.namePlaceholder': 'Ex.: Acme Engenharia',
  'organizations.create.slugLabel': 'Identificador (slug)',
  'organizations.create.slugPlaceholder': 'ex.: acme-engenharia',
  'organizations.create.slugHint':
    'Use apenas letras minúsculas, números e hífens simples (ex.: acme-engenharia).',
  'organizations.create.descriptionLabel': 'Descrição (opcional)',
  'organizations.create.descriptionPlaceholder': 'Breve descrição do propósito desta organização.',
  'organizations.create.submit': 'Criar organização',
  'organizations.create.success': 'Organização "{name}" criada e ativada com sucesso.',
  'organizations.create.slugConflict':
    'Este identificador (slug) já está em uso por outra organização.',

  'organizations.details.title': 'Detalhes da organização ativa',
  'organizations.details.description': 'Atualize o nome e a descrição da organização selecionada.',
  'organizations.details.saveAction': 'Salvar organização',
  'organizations.details.saveSuccess': 'Dados da organização atualizados com sucesso.',
  'organizations.details.noPermission':
    'Seu papel atual ({role}) não possui permissão para visualizar ou editar as configurações detalhadas desta organização.',

  'organizations.leave.action': 'Sair da organização',
  'organizations.leave.hint':
    'Sair desta organização remove apenas seu vínculo local com ela, sem encerrar sua sessão global.',
  'organizations.leave.success': 'Você saiu da organização "{name}". Sua sessão permanece ativa.',
  'organizations.leave.lastAdminError':
    'Não é possível sair porque você é o último Administrador ativo desta organização. Promova outro membro antes de sair.',

  'organizations.members.title': 'Membros e papéis',
  'organizations.members.description':
    'Visualize os participantes da organização ativa e gerencie papéis ou suspensões conforme suas permissões.',
  'organizations.members.roleLabel': 'Papel de {name}',
  'organizations.members.changeRoleSuccess': 'Papel de {name} atualizado para {role}.',
  'organizations.members.suspendAction': 'Suspender membro',
  'organizations.members.reactivateAction': 'Reativar membro',
  'organizations.members.suspendSuccess': 'Membro {name} suspenso com sucesso.',
  'organizations.members.reactivateSuccess': 'Membro {name} reativado com sucesso.',
  'organizations.members.noPermission':
    'Seu papel atual ({role}) não possui permissão para listar os membros desta organização.',
  'organizations.members.empty': 'Nenhum membro encontrado nesta organização.',

  'validation.required': 'Este campo é obrigatório.',
  'validation.emailInvalid': 'Informe um endereço de e-mail válido.',
  'validation.passwordMin': 'A senha deve conter pelo menos 8 caracteres.',
  'validation.passwordMismatch': 'As senhas informadas não coincidem.',
  'validation.displayNameMin': 'O nome deve conter pelo menos 2 caracteres.',
  'validation.termsRequired': 'Você precisa aceitar os termos de uso para criar sua conta.',
  'validation.slugFormat': 'O slug deve conter apenas letras minúsculas, números e hífens simples.',
  'validation.urlInvalid': 'Informe uma URL válida iniciada por http:// ou https://.',

  'feedback.sessionRestoring': 'Verificando sessão local...',
  'feedback.unauthorizedTitle': 'Acesso restrito',
  'feedback.unauthorizedDescription':
    'Você não possui permissão suficiente na organização ativa para acessar este recurso.',

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
