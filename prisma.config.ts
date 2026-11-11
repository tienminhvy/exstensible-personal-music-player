import 'dotenv/config';
import { defineConfig } from 'prisma/config';

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
