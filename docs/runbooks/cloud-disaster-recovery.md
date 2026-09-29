# Disaster recovery — Locadora George cloud-first

## Fontes de recuperação

- **D1:** fonte canônica dos dados estruturados.
- **R2:** fotos, documentos e backups lógicos cloud.
- **SQLite local:** réplica de trabalho do Windows e fonte de recuperação imediata enquanto ainda não sincronizada.
- **Backup local verificável:** cópia do SQLite e dos anexos antes de restaurações ou migrações destrutivas.

## Novo PC ou reinstalação limpa

1. Instale o aplicativo em um **novo PC**.
2. Entre com a mesma conta cloud.
3. O preflight confirma que a base local de negócio está vazia.
4. O cliente obtém o manifesto da réplica, geração de restauração e cursor.
5. As tabelas do D1 reconstruem o SQLite local.
6. Metadados de anexos são lidos do D1 e os bytes são baixados do R2.
7. Cada anexo é validado por SHA-256 antes de ser aceito localmente.
8. O cursor local passa a acompanhar somente deltas posteriores.

## Perda apenas do PC

Não restaure um SQLite antigo sobre uma réplica já sincronizada. Instale novamente e reconstrua pelo D1/R2. Um backup local antigo deve ser usado somente para investigação ou para recuperar alterações que comprovadamente nunca chegaram à nuvem.

## Restore de backup cloud

Uma restauração administrativa valida o manifesto e o SHA-256 dos objetos no R2 antes de substituir as tabelas do D1. Sessões e credenciais antigas são invalidadas e a `restore_generation` é incrementada. Réplicas com geração antiga não podem gravar sobre a base restaurada.

## Falha de rede durante operação

No Windows, alterações permanecem no SQLite/outbox. No PWA, alterações estruturadas permanecem na fila local e arquivos permanecem no armazenamento offline. Quando a rede retorna, a fila é enviada e depois o estado canônico é puxado.

## Falha durante migração inicial

Se a instalação antiga possui dados, nenhum bootstrap cloud pode substituir o SQLite antes de um backup local verificado. Quando D1 e PC já possuem dados, a migração fica bloqueada até decisão explícita do administrador.

## Verificações após recuperação

Confirme clientes, veículos, locações, pagamentos, cobranças, vistorias e fotos; confira cursor e geração da réplica; execute uma sincronização manual e valide que não existem pendências ou conflitos antes de considerar a recuperação encerrada.
