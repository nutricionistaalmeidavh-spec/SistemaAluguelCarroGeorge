# Sistema Locadora George

Sistema de gestão de locação de veículos da ArtiSys, com aplicativo Windows e PWA mobile usando a mesma conta.

## Arquitetura atual

- **Cloudflare Worker** como API autenticada.
- **D1** como fonte canônica dos dados estruturados.
- **R2** para fotos, documentos e backups cloud.
- **Electron/Windows** com réplica SQLite local e armazenamento local de anexos para operação offline.
- **PWA** com cache, outbox e blobs offline próprios do dispositivo.
- Sessão independente por dispositivo, usando a mesma conta da locadora.
- Sincronização automática por operações idempotentes e deltas incrementais.
- Nenhuma dependência paga obrigatória além da infraestrutura Cloudflare já adotada pelo projeto.

A antiga sincronização por servidor LAN não participa mais do fluxo de produção.

## Funcionalidades

- Agenda e reservas com bloqueio de conflito por veículo e período.
- Clientes e frota.
- Locações fixas e contínuas.
- Cobrança total ou por diária.
- Pagamentos parciais, despesas e caixa.
- Planos de cobrança, parcelas e inadimplência.
- Vistorias de retirada/devolução com checklist, fotos, KM, combustível e avarias.
- Manutenção por data/quilometragem.
- Contratos, recibos e relatórios em PDF.
- Auditoria.
- Backup local verificável com SHA-256.
- Backup lógico D1 → R2 e recuperação cloud.
- Gestão de dispositivos e sessões.
- Trabalho offline no Windows e no PWA.
- Conflitos explícitos: uma versão mais nova da nuvem nunca é sobrescrita silenciosamente.

## Uso no PC e no celular

1. Abra o aplicativo Windows e entre com a conta da locadora.
2. No celular, abra/instale o PWA e entre com a mesma conta.
3. Cada dispositivo mantém a própria sessão.
4. Alterações feitas offline ficam salvas localmente.
5. Quando a internet volta, a fila é enviada e o estado canônico é atualizado automaticamente.

## Migração de uma instalação antiga

Ao encontrar uma base SQLite existente, o aplicativo verifica a situação antes do primeiro bootstrap cloud:

- **PC com dados + nuvem vazia:** cria backup local verificável, envia os dados estruturados ao D1, envia anexos ao R2 e só depois passa a usar o estado cloud como canônico.
- **PC vazio + nuvem com dados:** reconstrói a réplica local a partir de D1/R2.
- **PC com dados + nuvem com dados:** bloqueia a troca automática. O administrador precisa escolher explicitamente usar a base cloud; antes disso, o sistema cria outro backup verificado do PC.

Usuários locais, sessões e credenciais antigas não são importados como identidade cloud.

## Disaster recovery

Um PC novo pode ser reconstruído somente com a conta cloud e o conteúdo de D1/R2. Restaurações cloud incrementam `restore_generation`, impedindo que uma réplica antiga volte a gravar sobre uma base restaurada.

Runbooks:

- `docs/runbooks/manual-operacao-cloud.md`
- `docs/runbooks/migracao-versao-cloud.md`
- `docs/runbooks/cloud-disaster-recovery.md`

## Desenvolvimento

```bash
npm install
npm run verify
npm run desktop
```

Para executar o gate completo de release:

```bash
npm run release:check
```

## Gerar instalador Windows

```bash
npm install
npm run dist
npm run windows:installer:verify
```

Saída esperada em `release/`, com nome no padrão:

```text
Sistema-Locadora-George-Setup-<versão>.exe
```

## Segurança

- Cookies de sessão cloud são `HttpOnly`, `Secure` e `SameSite=Strict`.
- No Electron, a sessão persistente fica criptografada com `safeStorage`.
- O renderer não recebe cookie, token de dispositivo ou segredo de sessão.
- D1/R2 são acessados através do Worker autenticado.
- Revogação de dispositivo encerra as sessões daquele dispositivo sem exigir a revogação dos demais.
