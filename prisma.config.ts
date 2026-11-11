import { defineConfig } from 'prisma/config';

// dotenv only exists in dev installs; slim runtime images (see Dockerfile for more info)
// run the CLI with real env vars and no .env file to load.
try {
    await import('dotenv/config');
} catch {
    // dotenv not installed: fall through, env vars are already set
}

export default defineConfig({
    schema: 'prisma/schema.prisma',
    migrations: {
        path: 'prisma/migrations'
    },
    // CLI commands without a database (generate, build-only CI) must not
    // throw here; only migrate/db commands consume the URL.
    datasource: {
        url: process.env.DATABASE_URL ?? ''
    }
});
