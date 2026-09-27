# @artisys/qa

Módulo compartilhado ArtiSys para QA, automação e gravação de demonstrações em aplicações web ou Electron.

A versão **2.1.0** adiciona o **ArtiSys QA Windows Agent** opcional: instalação única no Windows 10/11, inicialização automática no logon, registro de múltiplos projetos, Remote Control supervisionado, atualização automática apenas pelo canal `stable` e rollback A/B quando uma atualização não fica saudável.

A versão 2.0 já havia consolidado perfis `quick`, `full` e `release`, smoke de executável desktop, helpers de rede/concorrência, packs de negócio, relatório HTML/JSON com histórico local, gate de release fail-closed e Remote Control 2.0.

## O que o módulo centraliza

- Playwright web e Electron;
- QA flows e Demo Flows declarativos;
- perfis de execução `quick`, `full` e `release`;
- smoke de executável desktop;
- helpers de concorrência e recuperação de falhas transitórias de rede;
- packs reutilizáveis `auth`, `commerce`, `finance` e `workforce`;
- relatórios JSON/HTML e histórico local limitado;
- release gate que falha fechado em verificações críticas;
- conta demo, fixtures e flows reutilizáveis;
- screenshots, trace, telemetria e vídeo;
- regressão visual opt-in;
- Remote Control opt-in para celular/rede local;
- Windows Agent opt-in com autostart e auto-update seguro;
- redaction de secrets nos summaries, telemetria e logs de processo.

## Perfis de QA

```sh
artisys-qa quick --config qa/artisys-qa.config.json
artisys-qa full --config qa/artisys-qa.config.json
artisys-qa release --config qa/artisys-qa.config.json
```

| Perfil | Objetivo | Gate crítico |
|---|---|---|
| `quick` | smoke e poucos fluxos críticos durante desenvolvimento | não |
| `full` | todos os flows declarados e checks adicionais disponíveis | não |
| `release` | validação completa antes de publicação | sim |

O consumidor pode sobrescrever os flows:

```json
{
  "qaProfiles": {
    "quick": { "flows": ["smoke", "login", "sale"] },
    "full": { "flows": ["smoke", "login", "sale", "cancel-sale", "cash-close"] },
    "release": {
      "flows": ["smoke", "login", "sale", "cancel-sale", "cash-close"],
      "criticalFlows": ["smoke", "sale", "cancel-sale", "cash-close"]
    }
  }
}
```

Override de release exige motivo explícito:

```sh
artisys-qa release --config qa/artisys-qa.config.json \
  --override-release-gate \
  --override-reason "motivo documentado"
```

## Desktop / executável

```json
{
  "desktop": {
    "executable": "dist/MyApp.exe",
    "args": [],
    "startupGraceMs": 1500,
    "shutdownTimeoutMs": 5000
  }
}
```

O kit verifica abertura, saída prematura, captura stdout/stderr e encerramento. Regras específicas de instalador permanecem no consumidor/release-validator.

## Packs de negócio

- `auth`: `login`, `logout`, `permissions`, `session`;
- `commerce`: `sale`, `cancel-sale`, `cash-open`, `cash-close`, `customer`, `inventory`;
- `finance`: `income`, `expense`, `reconciliation`, `dre`;
- `workforce`: `employee`, `attendance`, `payment`, `receipt`.

## Rede e concorrência

A API pública inclui:

- `withTerminals(...)` para múltiplos contextos Playwright isolados;
- `runConcurrent(...)` para ações simultâneas;
- `retryTransient(...)` para `ECONNRESET`, `ECONNREFUSED`, `ETIMEDOUT`, `EAI_AGAIN`, `ENETDOWN` e `ENETUNREACH`.

## Relatórios e histórico

```text
qa-artifacts/
├── history.json
├── reports/
│   └── <sistema>-<perfil>-<timestamp>/
│       ├── report.json
│       └── report.html
└── <execuções individuais>/
    ├── screenshots/
    ├── trace.zip
    ├── telemetry.json
    └── run-summary.json
```

## QA Remote Control — opcional

No próprio PC:

```sh
artisys-qa remote --config qa/artisys-qa.config.json
```

No celular conectado à mesma rede local/Wi-Fi:

```sh
artisys-qa remote --config qa/artisys-qa.config.json --host 0.0.0.0 --port 4173
```

O painel permite perfil `quick/full/release`, flow individual, environment, viewport, visual opt-in, status e histórico. O Remote Control exige token e não aceita shell arbitrário.

## Windows Agent — instalação única

O agente é **opcional**. Ele não muda o funcionamento normal do `artisys-qa` e não depende de GitHub Actions.

Pré-requisitos:

- Windows 10 ou 11;
- Node.js 22+;
- Git autenticado para o repositório `utilidades` quando ele for privado;
- PowerShell 5.1+.

Instalação a partir de um clone do repositório:

```powershell
powershell -ExecutionPolicy Bypass -File .\modules\artisys-qa\scripts\install-agent.ps1
```

O instalador:

1. resolve a versão declarada em `stable-channel.json`;
2. instala em `%LOCALAPPDATA%\ArtiSys\QA`;
3. roda `npm ci`, `npm test` e `npm run check` antes de ativar;
4. instala Chromium do Playwright;
5. cria os comandos `artisys-qa` e `artisys-qa-agent`;
6. adiciona o diretório `bin` ao PATH do usuário;
7. cria a tarefa **ArtiSys QA Agent** no Agendador de Tarefas;
8. inicia o agente imediatamente e depois em todo logon.

O script é idempotente. Para reconstruir os slots deliberadamente:

```powershell
powershell -ExecutionPolicy Bypass -File .\modules\artisys-qa\scripts\install-agent.ps1 -Repair
```

### Registrar sistemas

Cada sistema é registrado uma vez pelo caminho absoluto do manifest QA:

```powershell
artisys-qa-agent register --config C:\Projetos\PDVNexus\qa\artisys-qa.config.json --name "PDV Nexus"
```

O agente escolhe a primeira porta livre a partir de `4173`. Para fixar a porta:

```powershell
artisys-qa-agent register --config C:\Projetos\OficinaAgricola\qa\artisys-qa.config.json --name "Oficina Agrícola" --port 4174
```

Comandos de gestão:

```powershell
artisys-qa-agent list
artisys-qa-agent status
artisys-qa-agent unregister --project pdv-nexus
artisys-qa-agent autoupdate off
artisys-qa-agent autoupdate on
artisys-qa-agent check-update
```

O agente reabre automaticamente os Remote Controls dos projetos registrados quando o usuário entra no Windows.

### Atualização automática segura

A atualização automática **não acompanha qualquer commit da `main`**. O gatilho é a mudança de versão em `modules/artisys-qa/stable-channel.json`.

Fluxo:

```text
slot A ativo
   ↓
git fetch origin main
   ↓
stable-channel possui versão maior?
   ↓ sim
clona candidato no slot B
   ↓
npm ci + npm test + npm run check
   ↓
falhou ──→ mantém slot A
   ↓ passou
ativa slot B e reinicia
   ↓
health check de startup
   ├─ passou → mantém B
   └─ falhou → rollback automático para A
```

A versão anterior permanece disponível como `previousSlot`. O agente não grava token do GitHub; reusa a autenticação Git existente no PC.

## Demo Profile

```json
{
  "defaultDemoProfile": "default",
  "demoProfiles": {
    "default": {
      "adapter": "./demo-adapter.mjs",
      "account": {
        "createIfMissing": true,
        "usernameEnv": "ARTISYS_DEMO_USERNAME",
        "passwordEnv": "ARTISYS_DEMO_PASSWORD"
      },
      "workspace": {
        "strategy": "persistent",
        "resetBeforeRun": "baseline"
      },
      "fixtures": ["common/base", "common/customer"]
    }
  }
}
```

Credenciais ficam em variáveis de ambiente, nunca no manifest.

## CLI

```sh
artisys-qa validate --config qa/artisys-qa.config.json
artisys-qa list --config qa/artisys-qa.config.json
artisys-qa quick --config qa/artisys-qa.config.json
artisys-qa full --config qa/artisys-qa.config.json --visual
artisys-qa release --config qa/artisys-qa.config.json
artisys-qa run --config qa/artisys-qa.config.json --flow smoke
```

Configurações antigas sem `qaProfiles` continuam funcionando.

## Segurança

- nunca coloque senha/token literal no manifest;
- use variáveis de ambiente;
- use dados demo/sintéticos em screenshots, traces e vídeos;
- reset exige `workspace.demo === true`;
- Remote Control exige token e não recebe shell arbitrário;
- o agente só inicia projetos registrados localmente;
- atualização automática aceita apenas uma versão maior declarada no canal `stable`;
- candidato é validado antes da troca de slot;
- falha de startup após update dispara rollback;
- não exponha diretamente portas do Remote Control à internet sem VPN/reverse proxy seguro.

## GitHub Actions

GitHub Actions permanece uma alternativa independente. O Windows Agent e o Remote Control local não dependem dele.

## Compatibilidade

- Node.js `>=22`
- Playwright `>=1.51 <2`
- Windows Agent: Windows 10/11 + Git + PowerShell 5.1+
- Electron fornecido pelo consumidor
- ffmpeg para MP4/demo Electron
- ffprobe para normalização de duração

## Desenvolvimento

```sh
npm ci
npm test
npm run check
npx playwright install chromium
npm run test:example
npm pack --dry-run
```

## Custo

O núcleo, o Windows Agent, o Remote Control, os perfis QA, relatórios, release gate e helpers rodam localmente/self-hosted e não exigem serviço pago.
