import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  putObject,
  getObject,
  deleteObject,
  signedObjectUrl,
} from '../packages/core/src/storage.js';
test('private local storage roundtrip, deletion and path traversal protection', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sitescope-storage-'));
  const priorDriver = process.env.STORAGE_DRIVER,
    priorPath = process.env.STORAGE_LOCAL_PATH;
  process.env.STORAGE_DRIVER = 'local';
  process.env.STORAGE_LOCAL_PATH = dir;
  try {
    await putObject('audit-id/mobile.png', Buffer.from('image bytes'), 'image/png');
    const value = await getObject('audit-id/mobile.png');
    assert.equal(value.body.toString(), 'image bytes');
    assert.equal(value.mimeType, 'image/png');
    for (const key of ['../secret', '/secret', 'a\\secret', 'https://x', 'a/../../secret'])
      await assert.rejects(() => getObject(key), /Invalid storage key/);
    await assert.rejects(() => signedObjectUrl('audit-id/mobile.png'), /authorized API/);
    await deleteObject('audit-id/mobile.png');
    await assert.rejects(() => getObject('audit-id/mobile.png'));
  } finally {
    if (priorDriver === undefined) delete process.env.STORAGE_DRIVER;
    else process.env.STORAGE_DRIVER = priorDriver;
    if (priorPath === undefined) delete process.env.STORAGE_LOCAL_PATH;
    else process.env.STORAGE_LOCAL_PATH = priorPath;
    await rm(dir, { recursive: true, force: true });
  }
});
