# George 03 — Desktop Replica, Backup, Hardening and DR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar o Electron em réplica automática independente de D1/R2, criar backups locais/cloud restauráveis, endurecer segurança e provar recuperação em cenários reais de perda, corrupção e reinstalação.

**Architecture:** O Electron usa a mesma API incremental da PWA, mantém cursor próprio e aplica deltas em transações SQLite; anexos são reconciliados por checksum. Backups locais usam SQLite consistente + arquivos/manifests com retenção, enquanto um job cloud cria export lógico versionado em R2. Restore cria nova geração de dados para impedir dispositivos antigos de reintroduzirem estado anterior.

**Tech Stack:** Electron 39, Node.js, `node:sqlite`, filesystem/crypto, Cloudflare Worker/D1/R2, Web Crypto, `node:test`, E2E/QA existentes.

**Spec:** `docs/superpowers/specs/2026-09-27-cloudflare-pwa-d1-r2-local-replica-design.md`

## Global Constraints

- Réplica do PC nunca bloqueia operação normal da PWA.
- PC pode ficar dias desligado e retomar sem reinstalação manual.
- Bootstrap de PC vazio deve reconstruir dados estruturados e anexos a partir da nuvem.
- Anexo local só é considerado íntegro quando checksum confere.
- Backup só é considerado válido quando verificável e restaurável em ambiente descartável.
- Retenção local inicial: 7 diários, 4 semanais, 12 mensais.
- Restore gera nova `restore_generation`/identificador e dispositivos stale não podem reintroduzir estado antigo.
- Hardening não pode depender de recurso pago obrigatório; controles pagos futuros são opcionais e explícitos.
- Logs evitam senha, token de sessão, conteúdo documental e dados pessoais desnecessários.

## Review Focus

1. Cursor avançado antes de commit local pode causar perda silenciosa; cursor só avança após transação SQLite concluída.
2. R2 retorna objeto cujo checksum não bate; arquivo local anterior íntegro deve ser preservado e erro registrado.
3. Backup local durante writes deve usar snapshot SQLite consistente/checkpoint adequado, não simples cópia corruptível.
4. Restore seguido de conexão de dispositivo stale deve forçar rebase/bootstrap e não merge do estado antigo.
5. Revogar um dispositivo deve invalidar todas as sessões daquele device imediatamente no backend.

---

### Task 1: Criar bootstrap e protocolo de réplica desktop

**Files:**
- Create: `electron/replica/cloud-client.cjs`
- Create: `electron/replica/bootstrap.cjs`
- Create: `electron/replica/state.cjs`
- Create: `tests/desktop-replica-bootstrap.test.mjs`

**Interfaces:**
- Consumes: API `/api/v1/sync/*`, `/api/v1/attachments/*`, `RelationalStore` do plano 01.
- Produces: `createReplicaClient({ baseUrl, sessionProvider, fetchImpl })`; `bootstrapReplica({ client, store, installationId, deviceId }) -> { cursor, counts }`; estado persistido por device.

- [ ] **Step 1: Escrever teste de PC vazio**

Backend fake contém clientes/veículos/locações/financeiro e cursor final. DB temporário começa vazio; bootstrap preenche e só grava cursor depois do commit final.

- [ ] **Step 2: Rodar RED**

Run: `node --test tests/desktop-replica-bootstrap.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implementar cloud client CJS**

Cliente suporta sessão/device credential específica do Electron, timeout e paginação. Não embutir segredo no código.

- [ ] **Step 4: Implementar bootstrap paginado**

Usar endpoint de bootstrap/deltas definido no plano 02; aplicar batches em transação e validar `installation_id`.

- [ ] **Step 5: Implementar state**

Persistir `cursor`, `restoreGeneration`, `lastSuccessAt`, `lastError` em tabelas relacionais/sync metadata, não sidecar JSON.

- [ ] **Step 6: Testar falha antes do cursor**

Injetar erro no meio do batch; cursor permanece anterior e reexecução completa sem duplicação.

- [ ] **Step 7: Commit**

```bash
git add electron/replica tests/desktop-replica-bootstrap.test.mjs
git commit -m "feat: bootstrap desktop replica from cloud"
```

---

### Task 2: Implementar agente incremental no Electron

**Files:**
- Create: `electron/replica/agent.cjs`
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs`
- Create: `tests/desktop-replica-agent.test.mjs`
- Modify: `src/ui/p2.mjs`

**Interfaces:**
- Produces: `ReplicaAgent.start()/stop()/syncNow()`; status `{ running, cursor, pending, lastSuccessAt, lastError, cloudReachable }`; IPC `locadora:replica-status` e `locadora:replica-sync-now`.

- [ ] **Step 1: Escrever teste vários dias offline**

Cursor local 100; servidor possui mudanças 101–500 em páginas; agente aplica todas em ordem e termina em 500.

- [ ] **Step 2: Rodar RED**

Run: `node --test tests/desktop-replica-agent.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implementar loop com backoff limitado**

Start após Electron ready; sync imediato + intervalo razoável; erro de rede não derruba app e não apaga última réplica.

- [ ] **Step 4: Aplicar deltas por transação**

Cada batch aplica mutations/tombstones e somente depois persiste novo cursor.

- [ ] **Step 5: Integrar status administrativo**

Tela mostra última réplica, cursor e erro; não exibir token/session secret.

- [ ] **Step 6: Testar stop/quit**

`before-quit` encerra timer/request e fecha DB sem write pendente.

- [ ] **Step 7: Commit**

```bash
git add electron/replica/agent.cjs electron/main.cjs electron/preload.cjs src/ui/p2.mjs tests/desktop-replica-agent.test.mjs
git commit -m "feat: sync cloud deltas into desktop replica"
```

---

### Task 3: Replicar e reconciliar attachments R2 → PC

**Files:**
- Create: `electron/replica/attachment-replicator.cjs`
- Create: `tests/desktop-attachment-replica.test.mjs`
- Modify: `electron/replica/agent.cjs`
- Modify: `electron/attachment-store.cjs`

**Interfaces:**
- Produces: `syncAttachments({ client, attachmentStore, sinceCursor }) -> { downloaded, skipped, corrupted, missing }`; `repairAttachment(id)`.

- [ ] **Step 1: Escrever teste download/skip**

Primeiro sync baixa 2 objetos; segundo sync com checksums iguais não baixa novamente.

- [ ] **Step 2: Escrever teste checksum inválido**

Se download novo não confere, manter arquivo local antigo íntegro quando existir, marcar erro e não promover metadata falsa.

- [ ] **Step 3: Rodar RED**

Run: `node --test tests/desktop-attachment-replica.test.mjs`

Expected: FAIL.

- [ ] **Step 4: Implementar download atômico**

Baixar para temporário, calcular SHA-256, comparar, rename somente após sucesso.

- [ ] **Step 5: Implementar repair**

Objeto local ausente/corrompido pode ser baixado novamente do R2 usando metadata autorizada da API.

- [ ] **Step 6: Commit**

```bash
git add electron/replica/attachment-replicator.cjs electron/replica/agent.cjs electron/attachment-store.cjs tests/desktop-attachment-replica.test.mjs
git commit -m "feat: replicate cloud attachments to desktop"
```

---

### Task 4: Criar backup local consistente com retenção

**Files:**
- Create: `electron/backup/local-backup.cjs`
- Create: `electron/backup/retention.cjs`
- Create: `electron/backup/manifest.cjs`
- Create: `tests/local-backup.test.mjs`
- Modify: `electron/main.cjs`
- Modify: `src/ui/system.mjs`

**Interfaces:**
- Produces: `createLocalBackup({ store, attachmentRoot, backupRoot, appVersion })`; `verifyLocalBackup(path)`; `applyRetention(root, policy)` onde policy default é `{ daily:7, weekly:4, monthly:12 }`.

- [ ] **Step 1: Escrever teste snapshot consistente**

Criar DB com WAL/updates, executar backup via API SQLite segura, verificar que cópia abre e possui todos os commits confirmados.

- [ ] **Step 2: Rodar RED**

Run: `node --test tests/local-backup.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implementar backup DB + attachments**

Gerar diretório temporário, DB consistente, cópia/hardlink seguro dos anexos conforme plataforma, manifest com schema/app/installation/cursor/restoreGeneration/checksums; publicar diretório final por rename.

- [ ] **Step 4: Implementar verificação**

Abrir DB backup read-only, validar manifest/checksums e contagem de anexos.

- [ ] **Step 5: Implementar retenção 7/4/12**

Classificar backups por data e manter slots diários/semanais/mensais sem apagar o único backup válido.

- [ ] **Step 6: Integrar UI**

Tela mostra último backup, verificação e ação manual `Criar backup agora` para admin.

- [ ] **Step 7: Commit**

```bash
git add electron/backup electron/main.cjs src/ui/system.mjs tests/local-backup.test.mjs
git commit -m "feat: add verified rotating local backups"
```

---

### Task 5: Criar backup lógico cloud em R2

**Files:**
- Create: `cloudflare/jobs/backup.mjs`
- Create: `cloudflare/backup/export-d1.mjs`
- Create: `cloudflare/backup/manifest.mjs`
- Create: `tests/cloud-backup.test.mjs`
- Modify: `wrangler.jsonc`

**Interfaces:**
- Produces: `exportInstallation(db, installationId) -> AsyncIterable<BackupChunk>`; `writeCloudBackup(env, installationId, now) -> BackupManifest`; chave `backups/<installationId>/<date>/...`.

- [ ] **Step 1: Escrever teste export lógico**

Base sintética é exportada por tabela em formato versionado e reimportável; manifesto inclui schema, installation, createdAt, object list, SHA-256 e status.

- [ ] **Step 2: Rodar RED**

Run: `node --test tests/cloud-backup.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implementar export por páginas**

Não carregar banco inteiro em memória; produzir chunks determinísticos por tabela/PK. Excluir secrets/session tokens transitórios do backup quando não necessários à recuperação.

- [ ] **Step 4: Implementar upload R2 e manifest last**

Objetos de dados primeiro; manifest `status: complete` somente depois de todos os hashes confirmados.

- [ ] **Step 5: Agendar sem dependência paga obrigatória**

Configurar mecanismo compatível com o nível gratuito escolhido (Cron Trigger quando disponível no plano usado) e manter endpoint/admin manual autenticado como fallback explícito.

- [ ] **Step 6: Testar backup incompleto**

Falha no terceiro chunk não cria manifesto `complete`; cleanup/retomada é determinístico.

- [ ] **Step 7: Commit**

```bash
git add cloudflare/jobs cloudflare/backup tests/cloud-backup.test.mjs wrangler.jsonc
git commit -m "feat: archive logical cloud backups to r2"
```

---

### Task 6: Device management e hardening de produção

**Files:**
- Create: `cloudflare/auth/devices.mjs`
- Create: `cloudflare/auth/login-throttle.mjs`
- Create: `cloudflare/api/device-routes.mjs`
- Create: `cloudflare/security/headers.mjs`
- Create: `tests/cloud-security.test.mjs`
- Modify: `cloudflare/worker.mjs`
- Modify: `src/ui/system.mjs`

**Interfaces:**
- Produces: `listDevices`, `revokeDevice`, `revokeDeviceSessions`; login throttle D1-based; `secureHeaders(response)`; rotas admin de devices.

- [ ] **Step 1: Escrever testes de revogação**

Revogar device encerra todas as sessões associadas; request seguinte retorna 401.

- [ ] **Step 2: Escrever testes negativos RBAC/origin**

Origem não permitida em request mutável, cookie ausente/CSRF strategy inválida conforme desenho final, usuário sem permissão e payload acima do limite devem ser negados sem mutação.

- [ ] **Step 3: Rodar RED**

Run: `node --test tests/cloud-security.test.mjs`

Expected: FAIL.

- [ ] **Step 4: Implementar device management**

Registrar nome, created/lastSeen, revokedAt; UI admin pode revogar sem expor tokens.

- [ ] **Step 5: Implementar throttle gratuito no app**

Controlar tentativas de login por chave não sensível/installation com janela/lock progressivo no D1; não depender de produto pago de rate limiting.

- [ ] **Step 6: Implementar security headers/origin**

CSP compatível com app, `X-Content-Type-Options`, frame policy, referrer policy e CORS somente nas origens previstas. Cookies continuam Secure/HttpOnly.

- [ ] **Step 7: Commit**

```bash
git add cloudflare/auth cloudflare/api/device-routes.mjs cloudflare/security cloudflare/worker.mjs src/ui/system.mjs tests/cloud-security.test.mjs
git commit -m "feat: harden sessions devices and worker security"
```

---

### Task 7: Implementar restore com geração e proteção contra stale devices

**Files:**
- Create: `cloudflare/backup/restore.mjs`
- Create: `electron/backup/restore.cjs`
- Create: `tests/restore-generation.test.mjs`
- Modify: `cloudflare/api/sync-routes.mjs`
- Modify: `src/sync/cloud-sync.mjs`
- Modify: `electron/replica/agent.cjs`

**Interfaces:**
- Produces: `restoreCloudBackup(...) -> { restoreGeneration, restoreId, cursor }`; `restoreLocalBackup(...)`; sync handshake inclui `restoreGeneration` e rejeita/manda bootstrap para geração antiga.

- [ ] **Step 1: Escrever teste stale device**

Device A fica offline na geração 3; restore cria geração 4 removendo registro X; A retorna tentando enviar estado antigo com X. Servidor não aceita merge/reintrodução e exige rebase/bootstrap.

- [ ] **Step 2: Rodar RED**

Run: `node --test tests/restore-generation.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implementar restore cloud transacional/controlado**

Validar manifest/checksums/schema; criar restore record; aplicar dados; incrementar geração; registrar auditoria administrativa.

- [ ] **Step 4: Implementar restore local**

Restaurar DB/anexos somente com app fechado/locks controlados; preservar estado atual em `pre-restore` antes da troca.

- [ ] **Step 5: Alterar sync handshake**

Toda operação inclui geração conhecida; mismatch antigo retorna erro estruturado `restore_generation_mismatch` e caminho de bootstrap.

- [ ] **Step 6: Commit**

```bash
git add cloudflare/backup/restore.mjs electron/backup/restore.cjs tests/restore-generation.test.mjs cloudflare/api/sync-routes.mjs src/sync/cloud-sync.mjs electron/replica/agent.cjs
git commit -m "feat: protect restores with data generations"
```

---

### Task 8: Criar suíte automatizada de disaster recovery

**Files:**
- Create: `qa/dr/new-device.test.cjs`
- Create: `qa/dr/offline-reconnect.test.cjs`
- Create: `qa/dr/idempotent-payment.test.cjs`
- Create: `qa/dr/desktop-catchup.test.cjs`
- Create: `qa/dr/desktop-rebuild.test.cjs`
- Create: `qa/dr/attachment-recovery.test.cjs`
- Create: `qa/dr/restore-stale-device.test.cjs`
- Create: `qa/dr/concurrent-conflicts.test.cjs`
- Create: `scripts/run-dr-tests.cjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `npm run dr:test` cobrindo cenários automatizáveis do spec.

- [ ] **Step 1: Adicionar `dr:test`**

Script roda testes serialmente quando compartilham fixture/backend local e cria diretórios temporários isolados por cenário.

- [ ] **Step 2: Automatizar novo celular/perda de dispositivo**

Criar sessão em device A, dados confirmados, revogar/perder A, login B recupera dados cloud sem depender do cache de A.

- [ ] **Step 3: Automatizar offline/reconexão e pagamento idempotente**

Cobrir cenários 2 e 3 do spec.

- [ ] **Step 4: Automatizar PC vários dias offline e PC vazio rebuild**

Cobrir cenários 4 e 5 usando cursor grande e bootstrap.

- [ ] **Step 5: Automatizar recuperação de attachment**

Apagar arquivo local e reconstruir do R2 fake/local; checksum final igual.

- [ ] **Step 6: Automatizar conflitos**

Reserva concorrente e cadastro editado por dois devices retornam resolução explícita; nenhuma alteração some silenciosamente.

- [ ] **Step 7: Automatizar restore/stale device**

Cobrir cenário 10.

- [ ] **Step 8: Rodar**

Run: `npm run dr:test`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add qa/dr scripts/run-dr-tests.cjs package.json
git commit -m "test: automate disaster recovery scenarios"
```

---

### Task 9: Criar runbooks dos cenários que exigem instalação real

**Files:**
- Create: `docs/runbooks/george-device-loss.md`
- Create: `docs/runbooks/george-pc-rebuild.md`
- Create: `docs/runbooks/george-cloud-restore.md`
- Create: `docs/runbooks/george-electron-update-reinstall.md`
- Create: `docs/runbooks/george-backup-verification.md`

**Interfaces:**
- Produces: procedimentos reproduzíveis para cenários 1, 5, 7, 11 e 12 do spec onde parte da evidência depende de SO/instalador real.

- [ ] **Step 1: Documentar perda/roubo de celular**

Revogar device, login novo, verificar dados/anexos e sessões.

- [ ] **Step 2: Documentar rebuild do PC**

Instalar em máquina/diretório limpo, registrar device, bootstrap, baixar anexos, comparar manifest/contagens.

- [ ] **Step 3: Documentar restore cloud**

Selecionar backup/ponto, validar antes, restaurar, confirmar nova geração, obrigar devices antigos a rebase.

- [ ] **Step 4: Documentar update/reinstall Electron**

Provar que `userData` desta instalação permanece isolado; desinstalação/reinstalação segue política explícita de retenção e recovery.

- [ ] **Step 5: Documentar verificação de backup**

Rotina mensal de restore em ambiente descartável e evidências mínimas a registrar.

- [ ] **Step 6: Commit**

```bash
git add docs/runbooks
git commit -m "docs: add recovery and reinstall runbooks"
```

---

### Task 10: Gate final de release e diagnóstico operacional

**Files:**
- Modify: `src/ui/system.mjs`
- Modify: `src/ui/p2.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/windows-build.yml`
- Create: `tests/health-diagnostics.test.mjs`

**Interfaces:**
- Produces: painel com status API, cursor, outbox, última réplica PC, último backup local/cloud, schema/app version e erros sem segredo.

- [ ] **Step 1: Escrever teste de diagnóstico sem segredo**

Objeto de diagnóstico contém campos previstos e não contém cookie, senha, hash de senha ou token de sessão.

- [ ] **Step 2: Implementar painel**

Admin visualiza saúde; demais roles só o que já possuem permissão para ver.

- [ ] **Step 3: Atualizar CI**

Adicionar cloud local migrations/tests e DR automatizado sem exigir credenciais de produção. Windows workflow continua gerando instalador.

- [ ] **Step 4: Rodar gate final**

```bash
npm run check
npm test
npm run verify
npm run coverage
npm run e2e
npm run qa:release
npm run cloud:test
npm run cloud:migrations:local
npm run dr:test
npm run release:check
npm run dist
```

Expected: todos PASS.

- [ ] **Step 5: Executar runbooks obrigatórios**

Registrar evidência de rebuild do PC, update/reinstall e restore de backup em ambiente descartável.

- [ ] **Step 6: Commit**

```bash
git add src/ui package.json .github/workflows tests/health-diagnostics.test.mjs
git commit -m "chore: gate production cloud and recovery release"
```

---

## Gate de saída do Plano 03

A branch `feat/george-desktop-replica-dr` só está pronta para PR/release quando:

- [ ] PC vazio reconstrói D1 + attachments R2;
- [ ] PC offline por muitos deltas alcança o cursor atual sem perda/duplicação;
- [ ] checksum inválido nunca substitui arquivo local íntegro;
- [ ] backup local 7/4/12 é criado, verificado e restaurado;
- [ ] backup cloud possui manifest completo e restore testado;
- [ ] device revogado perde sessão imediatamente;
- [ ] stale device após restore não reintroduz dados antigos;
- [ ] `npm run dr:test` está verde;
- [ ] runbooks de SO/instalador foram executados;
- [ ] instalador final preserva isolamento de `userData`/appId;
- [ ] não existe dependência silenciosa de plano pago.