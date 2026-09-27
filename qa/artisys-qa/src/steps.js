import path from 'node:path';
import { resolveSecret, stepLabel } from './helpers.js';
import { isVisualValidationRequested, shouldUpdateVisualBaselines, validateVisualSnapshot } from './visual.js';

function locator(page, step) {
  if (step.testId) return page.getByTestId(step.testId);
  if (step.role) return page.getByRole(step.role, step.name ? { name: step.name } : undefined);
  if (step.text) return page.getByText(step.text, { exact: step.exact ?? false });
  if (step.label) return page.getByLabel(step.label, { exact: step.exact ?? false });
  if (step.selector) return page.locator(step.selector);
  throw new Error(`Step ${step.action} requires selector, testId, role, text or label`);
}

export async function executeStep({ page, step, index, screenshotsDir, baseURL, env = process.env, adapter = null, runtimeContext = null }) {
  const label = stepLabel(step, index);
  switch (step.action) {
    case 'goto': {
      const target = step.url || (step.path && baseURL ? new URL(step.path, baseURL).toString() : step.path);
      if (!target) throw new Error('goto requires url or path');
      await page.goto(target, { waitUntil: step.waitUntil || 'domcontentloaded' });
      break;
    }
    case 'click': await locator(page, step).click(); break;
    case 'fill': await locator(page, step).fill(resolveSecret(step, env)); break;
    case 'press': await locator(page, step).press(step.key || 'Enter'); break;
    case 'check': await locator(page, step).check(); break;
    case 'uncheck': await locator(page, step).uncheck(); break;
    case 'hover': await locator(page, step).hover(); break;
    case 'selectOption': await locator(page, step).selectOption(resolveSecret(step, env)); break;
    case 'reload': await page.reload({ waitUntil: step.waitUntil || 'domcontentloaded' }); break;
    case 'waitFor': await locator(page, step).waitFor({ state: step.state || 'visible', timeout: step.timeoutMs }); break;
    case 'waitForTimeout': await page.waitForTimeout(step.timeoutMs ?? 250); break;
    case 'expectVisible': {
      await locator(page, step).waitFor({ state: 'visible', timeout: step.timeoutMs ?? 30000 });
      break;
    }
    case 'expectText': {
      const actual = (await locator(page, step).textContent()) ?? '';
      if (!actual.includes(step.expected ?? '')) throw new Error(`${label}: expected text ${JSON.stringify(step.expected)}, got ${JSON.stringify(actual)}`);
      break;
    }
    case 'expectURL': {
      const actual = page.url();
      if (step.equals && actual !== step.equals) throw new Error(`${label}: URL mismatch: ${actual}`);
      if (step.includes && !actual.includes(step.includes)) throw new Error(`${label}: URL does not include ${step.includes}: ${actual}`);
      break;
    }
    case 'screenshot': {
      await page.screenshot({ path: path.join(screenshotsDir, `${label}.png`), fullPage: step.fullPage ?? false });
      break;
    }
    case 'visualSnapshot': {
      const requested = isVisualValidationRequested(env.ARTISYS_QA_VISUAL);
      if (!requested) break;
      const hasLocator = Boolean(step.testId || step.role || step.text || step.label || step.selector);
      await validateVisualSnapshot({
        page,
        name: step.snapshot || step.name || label,
        target: hasLocator ? locator(page, step) : null,
        requested,
        updateBaseline: shouldUpdateVisualBaselines(env.ARTISYS_QA_UPDATE_VISUAL_BASELINES),
        baselineDir: step.baselineDir ? path.resolve(step.baselineDir) : path.resolve('qa/visual-baselines'),
        artifactDir: step.artifactDir ? path.resolve(step.artifactDir) : path.join(path.dirname(screenshotsDir), 'visual'),
        fullPage: step.fullPage ?? false,
        pixelThreshold: step.pixelThreshold ?? 8,
        maxDiffRatio: step.maxDiffRatio ?? 0.001,
      });
      break;
    }
    case 'capability': {
      if (!step.name || typeof step.name !== 'string') throw new Error('capability requires name');
      const capability = adapter?.capabilities?.[step.name];
      if (typeof capability !== 'function') throw new Error(`Missing demo adapter capability: ${step.name}`);
      await capability({ page, step, runtimeContext });
      break;
    }
    default: throw new Error(`Unsupported QA action: ${step.action}`);
  }
  if (step.holdMs != null) {
    if (!Number.isFinite(step.holdMs) || step.holdMs < 0) throw new TypeError(`${label}: holdMs must be a non-negative number`);
    if (step.holdMs > 0) await page.waitForTimeout(step.holdMs);
  }
  return label;
}
