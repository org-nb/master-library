import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [
		cloudflareTest(async () => ({
			wrangler: { configPath: "./wrangler.jsonc" },
			miniflare: {
				bindings: {
					TEST_MIGRATIONS: await readD1Migrations(fileURLToPath(new URL("./migrations", import.meta.url))),
					TEST_SQL_MIGRATIONS: await readD1Migrations(
						fileURLToPath(new URL("./test/fixtures/sql-migrations", import.meta.url)),
					),
				},
			},
		})),
	],
});
