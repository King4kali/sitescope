import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createPdf, runBrowserAudit } from './runner.js';

const destination = path.resolve(process.env.SMOKE_OUTPUT_DIR ?? '.sitescope/browser-smoke');
await mkdir(destination, { recursive: true });
const pdf = await createPdf(
  '<!doctype html><html lang="en"><meta charset="utf-8"><title>SiteScope smoke</title><body><h1>SiteScope PDF smoke test</h1><p>Real Chromium PDF rendering. No remote assets or scripts.</p></body></html>',
  AbortSignal.timeout(40_000),
);
if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('PDF_SMOKE_FAILED');
await writeFile(path.join(destination, 'smoke.pdf'), pdf);
console.log(
  JSON.stringify({ check: 'pdf', bytes: pdf.length, file: path.join(destination, 'smoke.pdf') }),
);
if (process.env.SMOKE_AUDIT_URL) {
  const output = await runBrowserAudit(process.env.SMOKE_AUDIT_URL, AbortSignal.timeout(170_000));
  for (const screenshot of output.screenshots)
    await writeFile(
      path.join(destination, `${screenshot.device}.png`),
      Buffer.from(screenshot.data, 'base64'),
    );
  await writeFile(
    path.join(destination, 'audit.json'),
    JSON.stringify(
      {
        ...output,
        screenshots: output.screenshots.map(({ data, ...metadata }) => ({
          ...metadata,
          sizeBytes: Buffer.from(data, 'base64').length,
        })),
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      check: 'audit',
      results: output.results.map(({ module, device, status, score, errorCode }) => ({
        module,
        device,
        status,
        score,
        errorCode,
      })),
      screenshots: output.screenshots.length,
    }),
  );
  if (output.results.some((item) => item.status === 'FAILED')) process.exitCode = 1;
}
