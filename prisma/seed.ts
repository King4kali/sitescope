import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
const prisma = new PrismaClient();
try {
  const email = process.env.SEED_ADMIN_EMAIL?.toLowerCase().trim();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password || password.length < 12)
    throw new Error('Set SEED_ADMIN_EMAIL and a SEED_ADMIN_PASSWORD of at least 12 characters.');
  await prisma.user.upsert({
    where: { email },
    create: {
      email,
      name: 'Administrator',
      role: 'ADMIN',
      emailVerifiedAt: new Date(),
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
    },
    update: {},
  });
  console.log('Administrator provisioned. No audit results or sample measurements were created.');
} finally {
  await prisma.$disconnect();
}
