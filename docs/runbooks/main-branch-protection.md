# Proteção obrigatória da main

A branch `main` deve aceitar alterações somente por pull request com os gates verdes.

## Configuração esperada

- Require a pull request before merging.
- Require status checks to pass before merging.
- Require branches to be up to date before merging.
- Do not allow force pushes.
- Do not allow deletions.
- Required checks:
  - `Locadora Verify / verify`
  - `Locadora George Windows Build / verify-and-build`

O sistema também publica `/api/v1/version` e mostra a versão/build em **Diagnóstico avançado**, permitindo correlacionar o deploy com o commit que o gerou.

## Limite operacional

A integração GitHub usada pelo projeto consegue ler rulesets e branch protection, mas não possui operação administrativa para alterá-los. Por isso esta política deve ser ativada no painel administrativo do repositório.
