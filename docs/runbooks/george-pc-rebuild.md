# Runbook — reconstrução do PC

## Quando usar
PC roubado, disco perdido, formatação ou instalação nova sem banco local utilizável.

## Procedimento
1. Instalar uma versão aprovada do **Sistema Locadora George** em Windows limpo.
2. Confirmar que o `userData` pertence exclusivamente ao George e que não existe SQLite antigo copiado manualmente.
3. No painel administrativo cloud, registrar o novo PC e gerar uma credencial de dispositivo específica para `GEORGE-PC`. A credencial é exibida uma vez e deve ser inserida no desktop; ela fica cifrada pelo `safeStorage` do Electron.
4. Configurar a URL oficial e a credencial no desktop. O agente detectará estado não inicializado e executará bootstrap completo.
5. Aguardar o diagnóstico mostrar cursor cloud atual e `lastSuccessAt` sem erro. O agente deve baixar todas as tabelas do D1.
6. Confirmar que fotos/documentos foram materializados no diretório local de attachments e que o SHA-256 confere antes de cada promoção.
7. Executar **Backup físico do PC agora** e confirmar `backupValid=true`.
8. Reiniciar o app e executar nova sincronização; não deve ocorrer rebuild desnecessário nem regressão de cursor.

## Evidências mínimas
Versão do app, schema, cursor final, `restoreGeneration`, contagens de clientes/veículos/locações, quantidade de anexos e resultado do backup verificado.

## Critério de aceite
Um diretório local inicialmente vazio termina com SQLite funcional, anexos físicos, cursor atual e backup verificado, sem depender do PC anterior.
