import { PrismaPg } from '@prisma/adapter-pg';
import { DATABASE_URL } from '$app/env/private';
import { PrismaClient } from '../../generated/prisma/client';

type PrismaClientInstance = InstanceType<typeof PrismaClient>;
type PrismaGlobal = { prisma?: PrismaClientInstance };

// Reused across dev-server reloads so HMR does not leak pg pools.
const prismaGlobal = globalThis as PrismaGlobal;

export const prisma = (prismaGlobal.prisma ??= new PrismaClient({
    adapter: new PrismaPg({ connectionString: DATABASE_URL })
}));
