import { S3Client, HeadBucketCommand, CreateBucketCommand } from '@aws-sdk/client-s3';
import { setTimeout as pause } from 'node:timers/promises';
const client = new S3Client({
  region: process.env.S3_REGION ?? 'us-east-1',
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: true,
  maxAttempts: 1,
  requestHandler: { connectionTimeout: 2000, requestTimeout: 5000 },
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY ?? '',
    secretAccessKey: process.env.S3_SECRET_KEY ?? '',
  },
});
const Bucket = process.env.S3_BUCKET ?? 'sitescope';
let ready = false;
for (let attempt = 0; attempt < 60; attempt++) {
  try {
    await client.send(new HeadBucketCommand({ Bucket }));
    ready = true;
    break;
  } catch {
    try {
      await client.send(new CreateBucketCommand({ Bucket }));
      ready = true;
      break;
    } catch {
      await pause(2000);
    }
  }
}
client.destroy();
if (!ready)
  throw new Error(
    'Private S3 bucket could not be initialized. Check storage connectivity and credentials.',
  );
console.log('Private S3 bucket ready; no anonymous bucket policy was created.');
