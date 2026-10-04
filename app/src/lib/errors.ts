/**
 * Application error hierarchy (ADR-0004 BFF).
 *
 * Every error carries the HTTP status it maps to so routes can translate
 * errors into responses without a per-type switch.
 */
export class AppError extends Error {
	readonly status: number

	constructor(message: string, status: number) {
		super(message)
		this.name = new.target.name
		this.status = status
	}
}

export class ValidationError extends AppError {
	readonly issues: string[]

	constructor(message: string, issues: string[] = []) {
		super(message, 400)
		this.issues = issues
	}
}

export class NotFoundError extends AppError {
	constructor(message = 'not found') {
		super(message, 404)
	}
}

export class ConflictError extends AppError {
	constructor(message = 'conflict') {
		super(message, 409)
	}
}

export class ForbiddenError extends AppError {
	constructor(message = 'forbidden') {
		super(message, 403)
	}
}

export class UnauthorizedError extends AppError {
	constructor(message = 'login required') {
		super(message, 401)
	}
}

export class RateLimitError extends AppError {
	constructor(message = 'rate limit exceeded') {
		super(message, 429)
	}
}

export class BudgetExceededError extends AppError {
	constructor(message = 'usage budget exceeded') {
		super(message, 402)
	}
}
