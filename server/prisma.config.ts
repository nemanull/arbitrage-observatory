import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Prisma 7 reads the datasource URL from here instead of from the schema file.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
