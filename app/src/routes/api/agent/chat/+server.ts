import { error } from '@sveltejs/kit'
import { z } from 'zod'
import type { ChatMessage } from '$lib/agent/llm.js'
import { runAgent } from '$lib/agent/orchestrate.js'
import { toSseResponse } from '$lib/agent/stream.js'
import { createReadTools } from '$lib/agent/tools.js'
import { sessionFromCookies } from '$lib/auth/guards.js'
import { getDeps } from '$lib/deps.js'
import { AppError, BudgetExceededError, RateLimitError } from '$lib/errors.js'
import type { RequestHandler } from './$types'

const messageSchema = z.object({
	role: z.enum(['user', 'assistant']),
	content: z.string().min(1).max(8000),
})

/**
 * Agent chat endpoint (ADR-0004): same-origin SSE, read-only tools,
 * per-caller rate limit and token metering before any provider call.
 */
export const POST: RequestHandler = async ({ request }) => {
	const deps = await getDeps()
	const claims = await sessionFromCookies(
		request.headers.get('cookie'),
		deps.cfg.session.cookie,
		deps.cfg.session.secret,
	)
	const key = claims?.sub ?? request.headers.get('cf-connecting-ip') ?? 'local'

	if (deps.llm === null) throw error(503, 'agent not configured')

	try {
		deps.agentGate.admit(key)
	} catch (err) {
		if (err instanceof RateLimitError) throw error(429, err.message)
		throw err
	}

	const body = (await request.json().catch(() => null)) as unknown
	const parsed = z
		.object({ messages: z.array(messageSchema).min(1).max(50) })
		.safeParse(body)
	if (!parsed.success)
		throw error(400, 'messages must be a non-empty array of {role, content}')

	const messages: ChatMessage[] = [
		{
			role: 'system',
			content:
				'You are the Master Library catalog assistant. Answer only from the catalog tools. ' +
				'Always cite the item titles you reference.',
		},
		...parsed.data.messages.map((m) => ({ role: m.role, content: m.content })),
	]

	const role = claims?.role ?? 'anonymous'
	const events = runAgent({
		provider: deps.llm,
		tools: createReadTools({ notes: deps.notes, role }),
		messages,
		onTokens: (text) => {
			try {
				deps.agentGate.meter.charge(key, Math.ceil(text.length / 4))
			} catch (err) {
				if (err instanceof BudgetExceededError) {
					throw new AppError('usage budget exceeded', 402)
				}
				throw err
			}
		},
	})
	return toSseResponse(events)
}
