# Runbook — reconstrução do PC

## Quando usar
PC roubado, disco perdido, formatação ou instalação nova sem banco local utilizável.

## Procedimento
1. Instalar uma versão aprovada do **Sistema Locadora George** em Windows limpo.
2. Confirmar que o `userData` pertence exclusivamente ao George e que não existe SQLite antigo copiado manualmente.
3. Na PWA cloud, entrar como administrador e abrir `/security.html`. Em **Preparar novo PC**, gerar uma credencial específica para `GEORGE-PC`. A credencial aparece uma vez.
4. No desktop, abrir **Backup e configurações → Réplica e recuperação**, informar a URL oficial e a credencial. O Electron cifra a credencial com `safeStorage` e inicia o bootstrap.
5. Aguardar o diagnóstico mostrar cursor cloud atual, `restoreGeneration` atual e `lastSuccessAt` sem erro. O agente deve baixar todas as tabelas do D1.
6. Confirmar que fotos/documentos foram materializados no diretório local de attachments e que o SHA-256 confere antes de cada promoção.
7. Executar **Backup físico do PC agora** e confirmar backup válido.
8. Reiniciar o app e executar nova sincronização; não deve ocorrer rebuild desnecessário nem regressão de cursor.

## Evidências mínimas
Versão do app, schema, cursor final, `restoreGeneration`, contagens de clientes/veículos/locações, quantidade de anexos e resultado do backup verificado.

## Critério de aceite
Um diretório local inicialmente vazio termina com SQLite funcional, anexos físicos, cursor atual e backup verificado, sem depender do PC anterior.
