# Runbook — restore cloud D1/R2

## Regra principal

Nunca restaurar um backup cujo registro não esteja `valid`. O manifest deve existir, estar `complete` e todos os objetos devem passar SHA-256 antes de qualquer mutação do D1.

A restauração pelo PWA é uma ação exclusiva de administrador. Além da sessão ativa, o Worker exige **reauth**: confirmação literal `RESTAURAR` e a senha atual do administrador. A validação ocorre no servidor antes da leitura/restauração do backup.

## Procedimento pelo PWA

1. Suspender mudanças operacionais durante a janela de restore.
2. Entrar no PWA com perfil **Administrador** e abrir **Administração → Backups cloud**.
3. Escolher um backup com status `valid`; registrar ID, data e `restoreGeneration` atual.
4. Clicar em **Restaurar**, digitar exatamente `RESTAURAR`, informar novamente a senha do administrador e confirmar o aviso final.
5. O Worker valida a senha, o manifest e todos os chunks/hashes antes de iniciar a troca.
6. Confirmar retorno com `restoreId` e **nova** `restoreGeneration`.
7. O restore invalida sessões e credenciais persistentes de dispositivos. O PWA limpa a sessão local e exige novo login.
8. Entrar novamente no celular/PWA e confirmar clientes, frota, locações, recebimentos, configurações da empresa e anexos do ponto restaurado.
9. Um aparelho antigo que ainda tenha estado offline não consegue reapresentar a sessão anterior. Uma operação pendente da geração antiga também não é aplicada silenciosamente sobre a base restaurada.
10. Se houver desktop Windows em uso, gerar uma **nova credencial do PC** na área de segurança/administração apropriada e reprovisionar a réplica. O PC executará bootstrap da geração restaurada.
11. Confirmar no desktop o novo `restoreGeneration`, cursor atual e `lastSuccessAt` sem erro.
12. Criar um novo backup local do PC, quando houver desktop, e um novo backup cloud após validar o restore.

## Procedimento alternativo em `/security.html`

A página administrativa legada `/security.html` permanece disponível para segurança/reprovisionamento. Ela segue a mesma proteção: confirmação `RESTAURAR` + senha de administrador. Não existe mais caminho de restore cloud nessa tela sem reautenticação.

## Critério de aceite

Dados correspondem ao ponto escolhido; geração aumentou; sessões/credenciais anteriores foram invalidadas; dispositivo offline antigo não consegue ressuscitar registros removidos; o PWA exige novo login; e, se houver PC, a réplica foi reprovisionada e convergiu para a nova geração.

## Rollback

Não tentar “desfazer” editando tabelas. Se o ponto escolhido estiver errado, usar outro backup `valid` como um novo restore, gerando outra geração.
