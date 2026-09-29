# Migração da versão local para a versão cloud

## Objetivo

Migrar a instalação existente do George sem perder o SQLite ou os anexos locais. A nuvem usa **D1** para dados estruturados e **R2** para fotos, documentos e backups.

## Regra de segurança

Nenhuma troca de base local pode ocorrer antes de um **backup verificado**. O backup local inclui o banco SQLite e a pasta de anexos e é validado antes de a migração continuar.

## Cenários

### PC possui dados e a nuvem de negócio está vazia

1. O aplicativo detecta dados locais e confirma que a nuvem ainda não possui clientes, veículos, locações ou demais registros de negócio.
2. Cria um backup verificado do PC.
3. Envia o dataset relacional permitido ao endpoint administrativo de migração.
4. O Worker cria antes um backup lógico da nuvem no R2.
5. O Worker importa os registros no D1, preservando usuários, sessões e credenciais cloud já existentes.
6. Fotos e documentos locais entram na fila de upload para R2.
7. Somente depois de não restarem arquivos pendentes a réplica do PC é reconstruída a partir do estado canônico da nuvem.

### PC vazio e nuvem populada

O aplicativo trata o computador como nova instalação. Após o login, reconstrói SQLite a partir do D1 e baixa os objetos necessários do R2.

### PC e nuvem possuem dados

A migração é bloqueada. O sistema não escolhe uma das bases por conta própria. O administrador deve revisar o cenário e, se decidir usar a nuvem neste PC, confirmar explicitamente a operação. Antes da aplicação da base cloud, outro backup verificado do estado local é criado.

## Dados que não são importados do legado

O importador não aceita usuários locais, sessões, credenciais de dispositivo nem metadados locais de anexos. A identidade cloud já autenticada permanece sendo a autoridade. Referências de operador em locações e auditoria são vinculadas ao usuário cloud que executa a migração.

## Falha durante a migração

Se o envio estruturado ou de arquivos falhar, a migração não é marcada como concluída. O SQLite e o backup verificado permanecem no PC. A fila pode ser retomada quando a conexão voltar.
