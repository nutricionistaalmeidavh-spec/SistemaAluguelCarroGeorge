import path from 'node:path';
import { resolveEnvironment, resolveFlow, resolveViewport } from './manifest.js';
import { runQaFlow } from './runner.js';
import { resolveQaProfile } from './profiles.js';
import { runDesktopSmoke } from './desktop.js';
import { aggregateQaReport, writeQaReport } from './reporting.js';
import { writeCiQaSummary } from './ci-summary.js';
import { evaluateReleaseGate } from './release-gate.js';

function durationFromSummary(summary) {
  const start = Date.parse(summary?.startedAt || '');
  const end = Date.parse(summary?.finishedAt || '');
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : null;
}

export async function runQaProfile({
  manifest,
  rootDir,
  profileName = 'quick',
  environment: requestedEnvironment,
  viewport: requestedViewport,
  outputRoot = 'qa-artifacts',
  ciSummaryPath = null,
  demoProfile = null,
  demoAdapter = null,
  releaseOverride = false,
  releaseOverrideReason = null,
  onProgress = null,
  flowRunner = runQaFlow,
  desktopRunner = runDesktopSmoke,
} = {}) {
  let lastProgress = null;
  const notify = async event => {
    lastProgress = event;
    try { await onProgress?.(event); } catch {}
  };
  const profile = resolveQaProfile(manifest, profileName);
  const { name: environmentName, environment } = resolveEnvironment(manifest, requestedEnvironment);
  const viewport = resolveViewport(manifest, requestedViewport);
  const results = [];
  const resolvedCiSummaryPath = ciSummaryPath || path.resolve(rootDir, 'artifacts', 'qa-summary.json');
  await notify({ type: 'profile-start', profile: profile.name, total: profile.flows.length });

  for (let index = 0; index < profile.flows.length; index++) {
    const flow = profile.flows[index];
    await notify({ type: 'flow-start', profile: profile.name, flow, current: index + 1, total: profile.flows.length });
    try {
      const { file: flowFile } = resolveFlow(manifest, flow, rootDir);
      const result = await flowRunner({
        manifest,
        rootDir,
        environmentName,
        environment,
        flowName: flow,
        flowFile,
        viewport,
        outputRoot,
        demoProfile,
        demoAdapter,
        onProgress: notify,
      });
      results.push({ flow, status: 'passed', critical: profile.criticalFlows.includes(flow), durationMs: durationFromSummary(result.summary), outputDir: result.outputDir, summary: result.summary });
      await notify({ type: 'flow-end', profile: profile.name, flow, status: 'passed', current: index + 1, total: profile.flows.length });
    } catch (error) {
      results.push({ flow, status: 'failed', critical: profile.criticalFlows.includes(flow), error: error?.message || String(error), summary: error?.summary || null });
      await notify({ type: 'flow-end', profile: profile.name, flow, status: 'failed', current: index + 1, total: profile.flows.length, error: error?.message || String(error) });
      if (profile.name === 'quick' && profile.stopOnFailure !== false) break;
    }
  }

  if (profile.includeDesktop && manifest.desktop?.executable) {
    const executable = path.resolve(rootDir, manifest.desktop.executable);
    await notify({ type: 'desktop-start', profile: profile.name, check: 'desktop-smoke' });
    try {
      const desktop = await desktopRunner({ executable, args: manifest.desktop.args || [], cwd: manifest.desktop.cwd ? path.resolve(rootDir, manifest.desktop.cwd) : rootDir, env: environment.env, startupGraceMs: manifest.desktop.startupGraceMs, shutdownTimeoutMs: manifest.desktop.shutdownTimeoutMs });
      results.push({ check: 'desktop-smoke', status: 'passed', critical: profile.name === 'release', durationMs: desktop.durationMs });
      await notify({ type: 'desktop-end', profile: profile.name, check: 'desktop-smoke', status: 'passed' });
    } catch (error) {
      results.push({ check: 'desktop-smoke', status: 'failed', critical: profile.name === 'release', error: error?.message || String(error) });
      await notify({ type: 'desktop-end', profile: profile.name, check: 'desktop-smoke', status: 'failed', error: error?.message || String(error) });
    }
  }

  const gate = evaluateReleaseGate({ profile: profile.name, results, override: releaseOverride, overrideReason: releaseOverrideReason });
  const report = aggregateQaReport({ systemId: manifest.systemId, profile: profile.name, runs: results, gate });
  await notify({ type: 'report-start', profile: profile.name, gateAllowed: gate.allowed });
  const files = await writeQaReport({ report, outputRoot });
  const ciSummary = await writeCiQaSummary({ targetPath: resolvedCiSummaryPath, report, lastProgress });
  files.ciSummaryFile = ciSummary.file;
  await notify({ type: 'profile-end', profile: profile.name, gateAllowed: gate.allowed, counts: report.counts, report: files.jsonFile, ciSummary: files.ciSummaryFile });
  if (profile.name === 'release' && !gate.allowed) {
    const error = new Error(`QA release gate failed for ${manifest.systemId}`);
    error.report = report;
    error.reportFiles = files;
    throw error;
  }
  return { profile, results, gate, report, ...files };
}
