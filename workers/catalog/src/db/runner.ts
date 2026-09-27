export function splitSqlStatements(sql: string): string[] {
	return sql
		.split(';')
		.map((s) => s.trim())
		.filter((s) => s.length > 0)
}

export async function runMigration(db: D1Database, sql: string): Promise<void> {
	const statements = splitSqlStatements(sql)
	for (const statement of statements) {
		await db.prepare(statement).run()
	}
}
