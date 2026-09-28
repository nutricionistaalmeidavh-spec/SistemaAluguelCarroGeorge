# Runbook — restore cloud D1/R2

## Regra principal
Nunca restaurar um backup cujo registro não esteja `valid`. O manifest deve existir, estar `complete` e todos os objetos devem passar SHA-256 antes de qualquer mutação do D1.

## Procedimento
1. Suspender mudanças operacionais durante a janela de restore.
2. Abrir `/security.html`, listar backups cloud e escolher o ponto com status `valid`; registrar ID, data e `restoreGeneration` atual.
3. Acionar o restore administrativo. O Worker verifica manifest e todos os chunks antes de iniciar a troca.
4. Confirmar retorno com `restoreId` e **nova** `restoreGeneration`.
5. O restore invalida sessões e credenciais persistentes de dispositivos. Entrar novamente no celular/PWA e confirmar clientes, frota, locações, recebimentos e anexos do ponto restaurado.
6. Um aparelho antigo que ainda tenha estado offline não consegue reapresentar a sessão anterior. Uma operação pendente da geração antiga também não é aplicada automaticamente; ela fica em conflito/rebase.
7. Em `/security.html`, gerar uma **nova credencial do PC**. No desktop, abrir **Backup e configurações → Réplica e recuperação**, informar a URL cloud e a nova credencial. O PC executará bootstrap da geração restaurada.
8. Confirmar no desktop o novo `restoreGeneration`, cursor atual e `lastSuccessAt` sem erro.
9. Criar um novo backup local e um novo backup cloud após validar o restore.

## Critério de aceite
Dados correspondem ao ponto escolhido; geração aumentou; sessões/credenciais anteriores foram invalidadas; dispositivo offline antigo não consegue ressuscitar registros removidos; o PC foi reprovisionado e convergiu para a nova geração.

## Rollback
Não tentar “desfazer” editando tabelas. Se o ponto escolhido estiver errado, usar outro backup `valid` como um novo restore, gerando outra geração.
