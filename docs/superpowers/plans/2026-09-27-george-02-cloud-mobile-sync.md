# George 02 — Cloud, Mobile and Incremental Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar a PWA a interface operacional principal sobre Worker + D1/R2, com autenticação/RBAC backend, offline/outbox e sincronização incremental por operações/cursor.

**Architecture:** O Worker serve os assets da PWA e uma API `/api/v1`. D1 é autoridade online dos dados estruturados, R2 dos anexos; cada write gera uma mudança ordenada e idempotente. PWA usa um repository cloud-first com cache/outbox local e deixa de sincronizar snapshots completos.

**Tech Stack:** Cloudflare Workers, D1, R2, Wrangler, JavaScript ESM, Web Crypto, PWA/Service Worker, IndexedDB/OPFS, Node `node:test` e testes E2E existentes.

**Spec:** `docs/superpowers/specs/2026-09-27-cloudflare-pwa-d1-r2-local-replica-design.md`

## Global Constraints

- PC desligado não pode impedir a operação online da PWA.
- D1/R2 não podem ser acessados diretamente pelo browser; toda autorização passa pelo Worker.
- Nenhum endpoint autenticado usa CORS `*`.
- UI nunca é fronteira de segurança; RBAC é validado no backend.
- Pagamentos usam `operationId` idempotente e auditoria append-only/estorno explícito.
- Reservas concorrentes são validadas server-side antes de commit online.
- Offline pode aceitar ações definidas no spec, mas conflitos posteriores ficam explícitos; nunca descartar alteração silenciosamente.
- O protocolo de sync ordinário é delta/operação + cursor; snapshot completo só serve bootstrap/export/backup controlado.
- Testes locais principais não exigem plano pago nem credenciais reais.

## Review Focus

1. Cookie de sessão expirado/revogado deve falhar com 401 sem vazar existência de dados.
2. Usuário sem `finance.write` manipulando request deve receber 403 e nenhuma linha deve mudar.
3. Retry do mesmo `operationId` de pagamento deve retornar o resultado original sem nova contabilização.
4. Upload R2 confirmado mas transação de metadata falha deve ser reconciliável/limpável, não ficar órfão invisível.
5. Outbox sobrevivendo refresh/reabertura deve reenviar na ordem correta e não duplicar operações aceitas.

---

### Task 1: Scaffolding Cloudflare e migrations D1 locais

**Files:**
- Create: `wrangler.jsonc`
- Create: `cloudflare/worker.mjs`
- Create: `cloudflare/config.mjs`
- Create: `scripts/cloud-migrations-local.mjs`
- Create: `tests/cloud-config.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `db/migrations/` do plano 01.
- Produces: Worker default export `{ fetch(request, env, ctx) }`; scripts `cloud:test`, `cloud:migrations:local`, `cloud:dev`.

- [ ] **Step 1: Escrever teste de config**

Asserções: bindings exigidos `DB`, `ATTACHMENTS`, assets; `migrations_dir` aponta para `db/migrations`; nenhum segredo real em config.

- [ ] **Step 2: Rodar RED**

Run: `node --test tests/cloud-config.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Adicionar Wrangler como dev dependency e config**

Nome de desenvolvimento local explícito; `DB` e `ATTACHMENTS` com placeholders/documentação, nunca IDs/segredos privados copiados de produção.

- [ ] **Step 4: Criar worker mínimo `/api/v1/health`**

Resposta JSON inclui `ok`, `appVersion`, `schemaVersion` e não exige DB para servir asset shell.

- [ ] **Step 5: Criar script de migrations locais**

Executar migrations contra D1 local e falhar se uma migration não aplicar do zero.

- [ ] **Step 6: Rodar**

Run: `npm run cloud:migrations:local && node --test tests/cloud-config.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add wrangler.jsonc cloudflare scripts/cloud-migrations-local.mjs tests/cloud-config.test.mjs package.json package-lock.json
git commit -m "feat: scaffold cloudflare worker and local d1"
```

---

### Task 2: Criar router e adapter D1 por recurso

**Files:**
- Create: `cloudflare/api/router.mjs`
- Create: `cloudflare/api/http.mjs`
- Create: `cloudflare/db/d1-repository.mjs`
- Create: `cloudflare/db/resource-map.mjs`
- Create: `tests/cloud-api-resources.test.mjs`

**Interfaces:**
- Produces: `routeApi(request, env, ctx) -> Response`; `createD1Repository(env.DB, installationId)` com `list/get/insert/update/softDelete/transaction` orientados a tabelas permitidas.

- [ ] **Step 1: Escrever testes de rota e whitelist**

`/api/v1/customers`, `/vehicles`, `/rentals` aceitam métodos previstos; recurso arbitrário como `/api/v1/kv` ou tabela desconhecida retorna 404/405.

- [ ] **Step 2: Rodar RED**

Run: `node --test tests/cloud-api-resources.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implementar `http.mjs`**

Helpers estritos para JSON, status, request body limitado e erros sem stack em resposta.

- [ ] **Step 4: Implementar `resource-map.mjs`**

Mapear somente recursos públicos previstos para tabelas/colunas; nenhum SQL/tabela é escolhido diretamente por parâmetro do usuário.

- [ ] **Step 5: Implementar D1 repository parametrizado**

Toda query inclui `installation_id`; updates exigem versão esperada para entidades mutáveis.

- [ ] **Step 6: Testar isolamento**

Duas `installation_id` sintéticas no mesmo adapter; uma nunca lista/edita dados da outra.

- [ ] **Step 7: Commit**

```bash
git add cloudflare/api cloudflare/db tests/cloud-api-resources.test.mjs
git commit -m "feat: add versioned d1 resource api"
```

---

### Task 3: Implementar autenticação e sessões backend

**Files:**
- Create: `cloudflare/auth/password.mjs`
- Create: `cloudflare/auth/session.mjs`
- Create: `cloudflare/auth/cookies.mjs`
- Create: `cloudflare/api/auth-routes.mjs`
- Create: `tests/cloud-auth.test.mjs`
- Modify: `db/migrations/0001_core.sql` only if schema fields are missing; otherwise add a new forward-only migration.

**Interfaces:**
- Produces: `hashPassword(password, salt?)`; `verifyPassword(password, encodedHash)`; `createSession(env, user, device) -> session`; `requireSession(request, env) -> AuthContext`; rotas `POST /api/v1/auth/login`, `POST /api/v1/auth/logout`, `GET /api/v1/session`.

- [ ] **Step 1: Escrever testes login/logout/revogação**

Testar senha correta, errada, usuário inativo, cookie `HttpOnly; Secure; SameSite`, expiração e sessão revogada.

- [ ] **Step 2: Rodar RED**

Run: `node --test tests/cloud-auth.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implementar hash via Web Crypto PBKDF2-SHA-256**

Usar salt aleatório individual e formato versionado que permita elevar parâmetros no futuro. Não manter senha `1234` como default de produção.

- [ ] **Step 4: Implementar sessões persistidas no D1**

Guardar somente token hash, user/device/installation, expiração/revogação; cookie carrega token opaco.

- [ ] **Step 5: Implementar primeiro acesso**

Conta inicial deve exigir troca/definição de credencial real antes de acesso normal quando marcada `must_change_password`.

- [ ] **Step 6: Rodar testes**

Run: `node --test tests/cloud-auth.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add cloudflare/auth cloudflare/api/auth-routes.mjs tests/cloud-auth.test.mjs db/migrations
git commit -m "feat: add server-side authentication sessions"
```

---

### Task 4: Aplicar RBAC backend aos recursos

**Files:**
- Create: `cloudflare/auth/permissions.mjs`
- Modify: `cloudflare/api/router.mjs`
- Modify: `cloudflare/api/auth-routes.mjs`
- Create: `tests/cloud-rbac.test.mjs`

**Interfaces:**
- Consumes: permissões equivalentes ao `src/domain/auth.mjs` atual.
- Produces: `can(authContext, permission) -> boolean`; `requirePermission(authContext, permission)`.

- [ ] **Step 1: Escrever matriz de testes**

Admin, atendente e vistoriador exercitam permissões de leitura/escrita de clientes, frota, financeiro, billing, inspeção, manutenção e contratos; adulteração de request sem permissão retorna 403.

- [ ] **Step 2: Rodar RED**

Run: `node --test tests/cloud-rbac.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implementar permission map server-side**

Manter nomes de permissões atuais para reduzir divergência; API route declara permissão necessária explicitamente.

- [ ] **Step 4: Testar nenhuma mutação em 403**

Verificar contador/version das entidades antes/depois.

- [ ] **Step 5: Commit**

```bash
git add cloudflare/auth/permissions.mjs cloudflare/api tests/cloud-rbac.test.mjs
git commit -m "feat: enforce rbac in worker api"
```

---

### Task 5: Implementar operações críticas de domínio no Worker

**Files:**
- Create: `cloudflare/domain/rentals.mjs`
- Create: `cloudflare/domain/payments.mjs`
- Create: `cloudflare/domain/audit.mjs`
- Create: `cloudflare/api/rental-routes.mjs`
- Create: `cloudflare/api/billing-routes.mjs`
- Create: `tests/cloud-rentals-payments.test.mjs`

**Interfaces:**
- Produces: `createRentalOperation(context, input, operationId)`; `recordRentalPaymentOperation(context, input, operationId)`; `recordInstallmentPaymentOperation(context, input, operationId)`; todas retornam `{ result, change }` e gravam audit.

- [ ] **Step 1: Escrever teste de conflito de reserva**

Duas requests concorrentes para o mesmo veículo/período: somente uma confirma; a outra retorna conflito explícito.

- [ ] **Step 2: Escrever teste de idempotência de pagamento**

Enviar o mesmo `operationId` três vezes; quantidade de pagamentos/ledger/audit financeiro permanece uma contabilização, e retries devolvem o mesmo resultado lógico.

- [ ] **Step 3: Rodar RED**

Run: `node --test tests/cloud-rentals-payments.test.mjs`

Expected: FAIL.

- [ ] **Step 4: Implementar transações D1 e operation receipt**

Criar/usar tabela de operações idempotentes via migration forward-only. Nunca apagar pagamento para estornar; estorno é evento próprio.

- [ ] **Step 5: Preservar `rental_schedule`**

Asserções server-side mantêm recebível pai e parcelas sem dupla receita; pagamentos parciais reconciliam rental/ledger/installment como no domínio atual.

- [ ] **Step 6: Rodar testes financeiros existentes + cloud**

Run: `node --test tests/cloud-rentals-payments.test.mjs tests/daily-billing*.test.mjs tests/commercial.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add cloudflare/domain cloudflare/api/rental-routes.mjs cloudflare/api/billing-routes.mjs tests/cloud-rentals-payments.test.mjs db/migrations
git commit -m "feat: add transactional rental and payment api"
```

---

### Task 6: Implementar R2 autenticado e metadata D1

**Files:**
- Create: `cloudflare/storage/r2-attachments.mjs`
- Create: `cloudflare/api/attachment-routes.mjs`
- Create: `cloudflare/jobs/orphan-attachments.mjs`
- Create: `tests/cloud-attachments.test.mjs`

**Interfaces:**
- Produces: `putAttachment(env, auth, meta, body) -> AttachmentMetadata`; `getAttachment(...) -> Response`; `deleteAttachment(...)`; `findOrphanObjects(...)`.

- [ ] **Step 1: Escrever testes de object key e autorização**

Chave física deve seguir `installations/<installationId>/<entityType>/<entityId>/<attachmentId>.<ext>`; usuário de outra instalação/sem permissão não obtém objeto.

- [ ] **Step 2: Rodar RED**

Run: `node --test tests/cloud-attachments.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implementar upload com SHA-256**

Validar MIME/tamanho permitido antes do `put`; registrar metadata D1 com checksum/tamanho/status.

- [ ] **Step 4: Implementar falha entre R2 e D1**

Se objeto subir e metadata falhar, registrar/permitir cleanup determinístico por prefix+id; teste não pode deixar órfão invisível.

- [ ] **Step 5: Implementar download condicionado a RBAC/entidade**

Nunca tornar bucket público para contornar autenticação.

- [ ] **Step 6: Commit**

```bash
git add cloudflare/storage cloudflare/api/attachment-routes.mjs cloudflare/jobs tests/cloud-attachments.test.mjs
git commit -m "feat: store authorized attachments in r2"
```

---

### Task 7: Criar API client e repository cloud-first na PWA

**Files:**
- Create: `src/api/client.mjs`
- Create: `src/storage/cloud-repository.mjs`
- Create: `src/storage/cache-store.mjs`
- Modify: `src/storage/repository.mjs`
- Modify: `src/app.mjs`
- Create: `tests/cloud-repository.test.mjs`

**Interfaces:**
- Produces: `createApiClient({ baseUrl, fetchImpl })`; `createCloudRepository({ api, cache, outbox })`; repository mantém `loadViewState`, `query`, `mutate`, `flush`.

- [ ] **Step 1: Escrever testes online**

Com fetch fake, `query customers` atualiza cache; mutation online só marca sincronizada após resposta 2xx; 401 limpa estado de sessão e exige login.

- [ ] **Step 2: Rodar RED**

Run: `node --test tests/cloud-repository.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implementar `client.mjs`**

`credentials: 'include'`, JSON estrito, timeout/retry apenas para operações idempotentes ou com `operationId`.

- [ ] **Step 4: Implementar cloud repository**

PWA usa API como autoridade online; cache local não sobrescreve resposta server-side mais nova.

- [ ] **Step 5: Alterar bootstrap da PWA**

Electron local continua usando repository local; build/publicação cloud usa cloud repository. Não exigir Electron bridge.

- [ ] **Step 6: Rodar**

Run: `node --test tests/cloud-repository.test.mjs && npm test`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/api src/storage src/app.mjs tests/cloud-repository.test.mjs
git commit -m "feat: make pwa consume cloud api"
```

---

### Task 8: Implementar outbox persistente e anexos offline

**Files:**
- Create: `src/sync/outbox.mjs`
- Create: `src/sync/outbox-runner.mjs`
- Create: `src/storage/offline-blob-store.mjs`
- Modify: `src/domain/offline.mjs`
- Modify: `src/app.mjs`
- Create: `tests/cloud-outbox.test.mjs`

**Interfaces:**
- Produces: `createOutbox(store)` com `enqueue/list/markSending/markSynced/markConflict/retry`; `runOutbox({ outbox, api, blobs }) -> SyncRunResult`.

- [ ] **Step 1: Escrever teste sobrevivência a reload**

Enfileirar duas operações + 1 blob, recriar instâncias sobre o mesmo storage, verificar que ordem/conteúdo permanecem.

- [ ] **Step 2: Escrever teste retry idempotente**

Simular timeout depois do Worker ter aceitado pagamento; segundo envio usa o mesmo `operationId` e termina synced sem duplicação.

- [ ] **Step 3: Rodar RED**

Run: `node --test tests/cloud-outbox.test.mjs`

Expected: FAIL.

- [ ] **Step 4: Implementar estados da outbox**

`pending | sending | synced | conflict | failed`; não remover item até confirmação.

- [ ] **Step 5: Implementar blob store offline**

Armazenar Blob por `attachmentId`; remover apenas depois de confirmação de R2 + metadata.

- [ ] **Step 6: Integrar eventos `online` e retry controlado**

Backoff limitado; UI mostra pendências e conflito, sem loop agressivo.

- [ ] **Step 7: Commit**

```bash
git add src/sync src/storage/offline-blob-store.mjs src/domain/offline.mjs src/app.mjs tests/cloud-outbox.test.mjs
git commit -m "feat: add durable offline outbox"
```

---

### Task 9: Implementar change log e cursor incremental

**Files:**
- Create: `cloudflare/sync/change-log.mjs`
- Create: `cloudflare/api/sync-routes.mjs`
- Create: `src/sync/cloud-sync.mjs`
- Create: `tests/cloud-sync.test.mjs`

**Interfaces:**
- Produces: `appendChange(tx, change)`; `listChangesAfter(db, installationId, cursor, limit)`; `POST /api/v1/sync/operations`; `GET /api/v1/sync/changes?after=<cursor>`; cliente `pullChanges`/`pushOperations`.

- [ ] **Step 1: Escrever teste de dois dispositivos**

Device A cria cliente; B puxa após cursor 0; B altera; A puxa após seu cursor; ambos convergem sem transferência de snapshot completo.

- [ ] **Step 2: Escrever teste tombstone**

Delete lógico aparece como change e remove/oculta entidade no outro dispositivo sem hard-delete silencioso.

- [ ] **Step 3: Rodar RED**

Run: `node --test tests/cloud-sync.test.mjs`

Expected: FAIL.

- [ ] **Step 4: Implementar cursor monotônico server-side**

Cursor é derivado de sequência de `sync_changes`, não de relógio do cliente.

- [ ] **Step 5: Implementar version conflict**

Mutation com `baseVersion` antiga retorna conflito estruturado com versão atual; financeiro segue operações específicas da Task 5.

- [ ] **Step 6: Integrar cliente**

Após outbox push, puxar deltas até o cursor mais recente; persistir cursor local somente depois de aplicar mudanças no cache.

- [ ] **Step 7: Commit**

```bash
git add cloudflare/sync cloudflare/api/sync-routes.mjs src/sync/cloud-sync.mjs tests/cloud-sync.test.mjs
git commit -m "feat: replace snapshot sync with incremental changes"
```

---

### Task 10: Publicar experiência PWA mobile-first e retirar protocolo legado

**Files:**
- Modify: `src/app.mjs`
- Modify: `src/ui/p2.mjs`
- Modify: `sw.js`
- Modify: `manifest.webmanifest`
- Modify: `styles.css`
- Modify: `styles-p1.css`
- Modify: `styles-p2.css`
- Modify: `electron/sync-server.cjs`
- Create: `qa/e2e/cloud-mobile.test.cjs`
- Create: `qa/e2e/cloud-offline-sync.test.cjs`
- Modify: `package.json`

**Interfaces:**
- Produces: PWA HTTPS instalável, telas de estado `salvo neste aparelho/sincronizado/conflito`, sem `/api/sync/exchange` como caminho ordinário.

- [ ] **Step 1: Criar E2E mobile online com PC ausente**

Fluxo obrigatório: login → cliente → veículo → locação diária → recebimento → vistoria/anexo → consulta financeira. Nenhum Electron/localhost participa.

- [ ] **Step 2: Criar E2E offline/reconexão**

Carregar dados → cortar rede → registrar alteração e foto → reload da PWA → restaurar rede → sincronizar → confirmar uma única operação no backend.

- [ ] **Step 3: Atualizar Service Worker**

Cachear shell/assets; nunca cachear resposta autenticada de `/api/` como shell público; navegação offline cai no app shell.

- [ ] **Step 4: Ajustar UI mobile dos fluxos usados no E2E**

Não redesenhar todo o sistema. Garantir leitura/toque/inputs sem menu lateral obrigatório em viewport de celular e exibir estado da outbox.

- [ ] **Step 5: Desativar sync snapshot legado**

`electron/sync-server.cjs` não expõe mais `/api/sync/exchange` para o fluxo final; manter somente compatibilidade explicitamente temporária se necessária para rollback, atrás de flag não-default.

- [ ] **Step 6: Rodar gates**

```bash
npm run check
npm test
npm run verify
npm run coverage
npm run e2e
npm run qa:release
npm run cloud:test
npm run cloud:migrations:local
```

Expected: todos PASS.

- [ ] **Step 7: Commit**

```bash
git add src sw.js manifest.webmanifest styles*.css electron/sync-server.cjs qa/e2e package.json
git commit -m "feat: ship cloud-first mobile pwa and delta sync"
```

---

## Gate de saída do Plano 02

A branch `feat/george-cloud-mobile-sync` só está pronta para PR quando:

- [ ] PWA conclui operação diária com o PC desligado;
- [ ] sessão/RBAC são validados no Worker;
- [ ] mesmo pagamento reenviado 3 vezes contabiliza 1 vez;
- [ ] bucket R2 permanece privado e anexos exigem autorização;
- [ ] outbox sobrevive reload e reconecta sem duplicação;
- [ ] dois dispositivos convergem por delta/cursor;
- [ ] snapshot sync não é protocolo ordinário;
- [ ] migrations D1 aplicam localmente do zero e sobre schema anterior;
- [ ] nenhum teste principal exige credencial/serviço pago.