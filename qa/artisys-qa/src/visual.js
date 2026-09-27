import fs from 'node:fs/promises';
import path from 'node:path';

function normalizeBoolean(value) {
  if (value === true || value === false) return value;
  if (value == null) return false;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

export function isVisualValidationRequested(value = process.env.ARTISYS_QA_VISUAL) {
  return normalizeBoolean(value);
}

export function shouldUpdateVisualBaselines(value = process.env.ARTISYS_QA_UPDATE_VISUAL_BASELINES) {
  return normalizeBoolean(value);
}

export function sanitizeVisualName(name) {
  if (typeof name !== 'string' || !name.trim()) throw new TypeError('visual snapshot name is required');
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'snapshot';
}

export class VisualValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'VisualValidationError';
    this.details = details;
  }
}

async function comparePngs(page, expected, actual, pixelThreshold) {
  return page.evaluate(async ({ expectedBase64, actualBase64, threshold }) => {
    const decode = async (base64) => {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0);
      return {
        width: bitmap.width,
        height: bitmap.height,
        data: context.getImageData(0, 0, bitmap.width, bitmap.height).data,
      };
    };

    const expectedImage = await decode(expectedBase64);
    const actualImage = await decode(actualBase64);
    if (expectedImage.width !== actualImage.width || expectedImage.height !== actualImage.height) {
      return {
        dimensionsMatch: false,
        expectedWidth: expectedImage.width,
        expectedHeight: expectedImage.height,
        actualWidth: actualImage.width,
        actualHeight: actualImage.height,
        diffPixels: null,
        totalPixels: null,
        diffRatio: 1,
        diffDataUrl: null,
      };
    }

    const width = expectedImage.width;
    const height = expectedImage.height;
    const totalPixels = width * height;
    const diffCanvas = document.createElement('canvas');
    diffCanvas.width = width;
    diffCanvas.height = height;
    const diffContext = diffCanvas.getContext('2d');
    const diffImage = diffContext.createImageData(width, height);
    let diffPixels = 0;

    for (let i = 0; i < expectedImage.data.length; i += 4) {
      const dr = Math.abs(expectedImage.data[i] - actualImage.data[i]);
      const dg = Math.abs(expectedImage.data[i + 1] - actualImage.data[i + 1]);
      const db = Math.abs(expectedImage.data[i + 2] - actualImage.data[i + 2]);
      const da = Math.abs(expectedImage.data[i + 3] - actualImage.data[i + 3]);
      const changed = Math.max(dr, dg, db, da) > threshold;

      if (changed) {
        diffPixels++;
        diffImage.data[i] = 255;
        diffImage.data[i + 1] = 0;
        diffImage.data[i + 2] = 255;
        diffImage.data[i + 3] = 255;
      } else {
        const gray = Math.round((expectedImage.data[i] + expectedImage.data[i + 1] + expectedImage.data[i + 2]) / 3);
        diffImage.data[i] = gray;
        diffImage.data[i + 1] = gray;
        diffImage.data[i + 2] = gray;
        diffImage.data[i + 3] = 90;
      }
    }

    diffContext.putImageData(diffImage, 0, 0);
    return {
      dimensionsMatch: true,
      expectedWidth: width,
      expectedHeight: height,
      actualWidth: width,
      actualHeight: height,
      diffPixels,
      totalPixels,
      diffRatio: totalPixels ? diffPixels / totalPixels : 0,
      diffDataUrl: diffCanvas.toDataURL('image/png'),
    };
  }, {
    expectedBase64: expected.toString('base64'),
    actualBase64: actual.toString('base64'),
    threshold: pixelThreshold,
  });
}

function dimensionDiffSvg(result) {
  const message = `Expected ${result.expectedWidth}x${result.expectedHeight} — Actual ${result.actualWidth}x${result.actualHeight}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="180" viewBox="0 0 960 180"><rect width="100%" height="100%" fill="#111"/><text x="40" y="84" fill="#fff" font-family="Arial, sans-serif" font-size="28">Visual dimensions mismatch</text><text x="40" y="130" fill="#ddd" font-family="Arial, sans-serif" font-size="22">${message}</text></svg>`;
}

export async function validateVisualSnapshot({
  page,
  name,
  target = null,
  requested = isVisualValidationRequested(),
  updateBaseline = shouldUpdateVisualBaselines(),
  baselineDir = path.resolve('qa/visual-baselines'),
  artifactDir = path.resolve('qa-artifacts/visual'),
  fullPage = false,
  pixelThreshold = 8,
  maxDiffRatio = 0.001,
  screenshotOptions = {},
} = {}) {
  if (!requested) {
    return { status: 'skipped', reason: 'visual-validation-not-requested' };
  }
  if (!page || typeof page.evaluate !== 'function') throw new TypeError('page is required');
  if (!Number.isFinite(pixelThreshold) || pixelThreshold < 0 || pixelThreshold > 255) {
    throw new RangeError('pixelThreshold must be between 0 and 255');
  }
  if (!Number.isFinite(maxDiffRatio) || maxDiffRatio < 0 || maxDiffRatio > 1) {
    throw new RangeError('maxDiffRatio must be between 0 and 1');
  }

  const snapshotName = sanitizeVisualName(name);
  const baselinePath = path.join(path.resolve(baselineDir), `${snapshotName}.png`);
  const captureTarget = target || page;
  const actual = await captureTarget.screenshot({
    animations: 'disabled',
    caret: 'hide',
    ...(target ? {} : { fullPage }),
    ...screenshotOptions,
  });

  await fs.mkdir(path.dirname(baselinePath), { recursive: true });

  let expected;
  try {
    expected = await fs.readFile(baselinePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    if (updateBaseline) {
      await fs.writeFile(baselinePath, actual);
      return { status: 'baseline-created', baselinePath, snapshotName };
    }
    await fs.mkdir(path.resolve(artifactDir), { recursive: true });
    const actualPath = path.join(path.resolve(artifactDir), `${snapshotName}.actual.png`);
    await fs.writeFile(actualPath, actual);
    throw new VisualValidationError(`Visual baseline missing for ${snapshotName}`, {
      snapshotName,
      baselinePath,
      actualPath,
      hint: 'Re-run with --update-visual-baselines after reviewing the expected UI.',
    });
  }

  if (updateBaseline) {
    await fs.writeFile(baselinePath, actual);
    return { status: 'baseline-updated', baselinePath, snapshotName };
  }

  const result = await comparePngs(page, expected, actual, pixelThreshold);
  const passed = result.dimensionsMatch && result.diffRatio <= maxDiffRatio;
  if (passed) {
    return {
      status: 'passed',
      snapshotName,
      baselinePath,
      diffPixels: result.diffPixels,
      totalPixels: result.totalPixels,
      diffRatio: result.diffRatio,
      maxDiffRatio,
      pixelThreshold,
    };
  }

  const resolvedArtifactDir = path.resolve(artifactDir);
  await fs.mkdir(resolvedArtifactDir, { recursive: true });
  const expectedPath = path.join(resolvedArtifactDir, `${snapshotName}.expected.png`);
  const actualPath = path.join(resolvedArtifactDir, `${snapshotName}.actual.png`);
  await Promise.all([
    fs.writeFile(expectedPath, expected),
    fs.writeFile(actualPath, actual),
  ]);

  let diffPath;
  if (result.diffDataUrl) {
    diffPath = path.join(resolvedArtifactDir, `${snapshotName}.diff.png`);
    await fs.writeFile(diffPath, Buffer.from(result.diffDataUrl.split(',')[1], 'base64'));
  } else {
    diffPath = path.join(resolvedArtifactDir, `${snapshotName}.diff.svg`);
    await fs.writeFile(diffPath, dimensionDiffSvg(result), 'utf8');
  }

  throw new VisualValidationError(`Visual regression detected for ${snapshotName}`, {
    snapshotName,
    baselinePath,
    expectedPath,
    actualPath,
    diffPath,
    ...result,
    maxDiffRatio,
    pixelThreshold,
  });
}
