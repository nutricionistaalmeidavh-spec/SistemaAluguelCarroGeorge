# Manual de operação cloud — Sistema Locadora George

## Acesso

O sistema usa a **mesma conta** no aplicativo Windows e no PWA do celular. Cada dispositivo mantém sua própria sessão protegida, portanto o PC e o celular podem permanecer conectados ao mesmo tempo.

O PWA pode ser usado como cliente principal da locadora. Usuários com perfil **Administrador** também recebem a área **Administração** no PWA; os demais perfis não veem esse módulo.

## Onde os dados ficam

- **D1** mantém os dados estruturados: clientes, veículos, locações, cobranças, pagamentos, vistorias, auditoria e configurações operacionais.
- **R2** mantém fotos, documentos e objetos de backup cloud.
- O aplicativo Windows mantém uma réplica SQLite e cópias locais de arquivos para continuar funcionando offline.
- O PWA mantém cache e fila local para operações feitas offline.

## Sincronização

Com internet disponível, as alterações são enviadas automaticamente. O PC grava primeiro no SQLite e depois envia a fila ao Worker; o PWA também mantém uma fila durável antes do envio. Depois do envio, ambos recebem o estado canônico da nuvem.

Os estados exibidos são:

- **Sincronizado:** não há alterações pendentes.
- **Pendente:** existem alterações locais aguardando envio.
- **Offline:** o trabalho continua localmente e será enviado quando a conexão voltar.
- **Conflito:** outra versão mais recente existe na nuvem; o sistema não a substitui silenciosamente.

As configurações da empresa (nome, CPF/CNPJ, telefone e endereço) também são versionadas e sincronizadas entre PWA, D1 e réplica Windows. Alterações concorrentes não usam `last-write-wins` silencioso.

## Administração no PWA

A tela **Administração** reúne as funções administrativas cloud:

- **Empresa e configurações:** editar nome, CPF/CNPJ, telefone e endereço da empresa.
- **Backups cloud:** gerar backup lógico do D1 no R2, consultar histórico e iniciar restauração de um backup `valid`.
- **Dispositivos e sessões:** visualizar dispositivos, revogar um dispositivo, encerrar outras sessões ou encerrar todas as sessões.
- **Auditoria:** consultar histórico com filtros por ação, entidade e período e abrir os detalhes de cada evento.

Essas ações administrativas exigem perfil `admin` e o Worker repete a autorização no servidor; esconder a tela no navegador não é usado como controle de segurança.

## Dispositivos e sessões

No PWA, abra **Administração → Dispositivos e sessões**. No desktop, as funções equivalentes permanecem em **Backup e configurações**.

O administrador pode visualizar dispositivos ativos, revogar um dispositivo antigo e encerrar as outras sessões da conta. Revogar um dispositivo invalida as sessões e credenciais persistentes ligadas àquele dispositivo, sem encerrar automaticamente os demais.

## Backup

A nuvem gera backups lógicos do D1 em objetos privados no R2. O histórico e a restauração ficam disponíveis em **Administração → Backups cloud** no PWA.

Para restaurar pelo PWA são exigidas três confirmações: escolher um backup com status `valid`, digitar exatamente `RESTAURAR` e informar novamente a senha do administrador. O Worker valida a senha antes de tocar no backup. Depois do restore, a geração da base aumenta e sessões/credenciais antigas são invalidadas, obrigando os dispositivos a autenticar novamente antes de continuar.

O aplicativo Windows continua oferecendo uma proteção adicional que o navegador não pode reproduzir: **backup físico local do SQLite e da pasta de anexos**. Essa cópia física é complementar; ela não é necessária para o PWA funcionar sozinho.

## Auditoria

Em **Administração → Auditoria**, o administrador pode filtrar por ação, entidade e período. A consulta é paginada e os detalhes estruturados do evento podem ser abertos na própria tela. As alterações das configurações da empresa geram evento `settings.update`.

## Recuperação em outro computador

Em um Windows novo, instale o aplicativo e entre com a mesma conta. Com a base local vazia, o aplicativo baixa o estado estruturado do D1 e os arquivos do R2, reconstruindo a réplica SQLite local.
