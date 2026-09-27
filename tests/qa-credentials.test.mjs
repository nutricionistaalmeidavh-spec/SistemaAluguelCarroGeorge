import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveSecret } from '../qa/artisys-qa/src/helpers.js';

const flowsDir = new URL('../qa/artisys-qa/flows/locadora/', import.meta.url);
for (const file of fs.readdirSync(flowsDir).filter(name => name.endsWith('.json'))) {
  test(`QA ${file}: login resolves the configured password and rejects missing credentials`, () => {
    const flow = JSON.parse(fs.readFileSync(new URL(file, flowsDir), 'utf8'));
    const passwordStep = flow.steps.find(step => step.action === 'fill' && step.label === 'Senha');
    assert.ok(passwordStep, 'Flow must include a password step');
    assert.equal(resolveSecret(passwordStep, { LOCADORA_QA_ADMIN_PASSWORD: 'qa-regression-value' }), 'qa-regression-value');
    assert.throws(() => resolveSecret(passwordStep, {}), /Missing environment variable/);
  });
}
