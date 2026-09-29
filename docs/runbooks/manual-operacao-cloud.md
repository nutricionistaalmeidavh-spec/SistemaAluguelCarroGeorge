# Manual de operação cloud — Sistema Locadora George

## Acesso

O sistema usa a **mesma conta** no aplicativo Windows e no PWA do celular. Cada dispositivo mantém sua própria sessão protegida, portanto o PC e o celular podem permanecer conectados ao mesmo tempo.

## Onde os dados ficam

- **D1** mantém os dados estruturados: clientes, veículos, locações, cobranças, pagamentos, vistorias e configurações operacionais.
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

## Dispositivos e sessões

Em **Backup e configurações → Dispositivos e sessões**, o administrador pode visualizar os dispositivos ativos, revogar um dispositivo antigo e encerrar as outras sessões da conta. Revogar um dispositivo não encerra automaticamente os demais.

## Backup

O aplicativo Windows gera backup local verificável do SQLite e da pasta de anexos. A nuvem também gera backups lógicos de D1 em objetos privados no R2. Restaurações cloud avançam a geração de restauração para impedir que uma réplica antiga envie dados sobre uma base restaurada.

## Recuperação em outro computador

Em um Windows novo, instale o aplicativo e entre com a mesma conta. Com a base local vazia, o aplicativo baixa o estado estruturado do D1 e os arquivos do R2, reconstruindo a réplica SQLite local.
