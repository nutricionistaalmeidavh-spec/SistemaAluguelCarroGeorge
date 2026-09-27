# Runbook — restore cloud D1/R2

## Regra principal
Nunca restaurar um backup cujo registro não esteja `valid`. O manifest deve existir, estar `complete` e todos os objetos devem passar SHA-256 antes de qualquer mutação do D1.

## Procedimento
1. Suspender mudanças operacionais durante a janela de restore.
2. Listar backups cloud e escolher o ponto com status `valid`; registrar ID, data e `restoreGeneration` atual.
3. Acionar o restore administrativo. O Worker verifica manifest e todos os chunks antes de iniciar a troca.
4. Confirmar retorno com `restoreId` e **nova** `restoreGeneration`.
5. Confirmar clientes, frota, locações, recebimentos e anexos do ponto restaurado.
6. Em cada celular/PWA antigo, sincronizar. Operações pendentes da geração anterior devem receber `restore_generation_mismatch`/409 e não podem ser aplicadas automaticamente.
7. O desktop deve detectar mudança de geração, executar bootstrap e substituir a réplica local pela geração restaurada.
8. Criar um novo backup local e um novo backup cloud após validação do restore.

## Critério de aceite
Dados correspondem ao ponto escolhido; geração aumentou; dispositivo offline antigo não consegue ressuscitar registros removidos pelo restore; cópias locais convergem para a nova geração.

## Rollback
Não tentar “desfazer” editando tabelas. Se o ponto escolhido estiver errado, usar outro backup `valid` como um novo restore, gerando outra geração.
