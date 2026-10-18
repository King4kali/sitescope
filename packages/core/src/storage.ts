import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';

const mimeTypes: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.pdf': 'application/pdf',
  '.json': 'application/json',
};
function validKey(key: string): string {
  if (
    !key ||
    key.length > 512 ||
    key.startsWith('/') ||
    key.includes('..') ||
    key.includes('\\') ||
    !/^[a-zA-Z0-9_./-]+$/.test(key)
  )
    throw new Error('Invalid storage key');
  return key;
}
function client(): S3Client {
  return new S3Client({
    region: process.env.S3_REGION ?? 'us-east-1',
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: true,
    maxAttempts: 2,
    requestHandler: { connectionTimeout: 3000, requestTimeout: 10000 },
    credentials: process.env.S3_ACCESS_KEY
      ? { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY ?? '' }
      : undefined,
  });
}
function localPath(key: string): string {
  return path.resolve(process.env.STORAGE_LOCAL_PATH ?? '.sitescope/artifacts', validKey(key));
}
export async function putObject(key: string, body: Buffer, mimeType: string): Promise<void> {
  validKey(key);
  if (process.env.STORAGE_DRIVER === 'local') {
    const file = localPath(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
    return;
  }
  await client().send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET ?? 'sitescope',
      Key: key,
      Body: body,
      ContentType: mimeType,
    }),
  );
}
export async function getObject(key: string): Promise<{ body: Buffer; mimeType: string }> {
  validKey(key);
  if (process.env.STORAGE_DRIVER === 'local')
    return {
      body: await readFile(localPath(key)),
      mimeType: mimeTypes[path.extname(key)] ?? 'application/octet-stream',
    };
  const obj = await client().send(
    new GetObjectCommand({ Bucket: process.env.S3_BUCKET ?? 'sitescope', Key: key }),
  );
  if (!obj.Body) throw new Error('Artifact not found');
  return {
    body: Buffer.from(await obj.Body.transformToByteArray()),
    mimeType: obj.ContentType ?? 'application/octet-stream',
  };
}
export async function signedObjectUrl(key: string): Promise<string> {
  validKey(key);
  if (process.env.STORAGE_DRIVER === 'local')
    throw new Error('Local objects must be served through the authorized API.');
  return getSignedUrl(
    client(),
    new GetObjectCommand({ Bucket: process.env.S3_BUCKET ?? 'sitescope', Key: key }),
    { expiresIn: 120 },
  );
}
export async function deleteObject(key: string): Promise<void> {
  validKey(key);
  if (process.env.STORAGE_DRIVER === 'local') {
    try {
      await unlink(localPath(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    return;
  }
  await client().send(
    new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET ?? 'sitescope', Key: key }),
  );
}
