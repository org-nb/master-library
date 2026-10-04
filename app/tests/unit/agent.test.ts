import { describe, expect, it } from 'vitest'
import {
	type LlmStreamEvent,
	ScriptedLlm,
	type Tool,
} from '../../src/lib/agent/llm.js'
import { createAgentGate, createUsageMeter } from '../../src/lib/agent/meter.js'
import { runAgent } from '../../src/lib/agent/orchestrate.js'
import { sseEncode, toSseResponse } from '../../src/lib/agent/stream.js'
import { BudgetExceededError, RateLimitError } from '../../src/lib/errors.js'

function tools(): Tool[] {
	const search: Tool = {
		name: 'search_catalog',
		description: 'search',
		parameters: { type: 'object', properties: { query: { type: 'string' } } },
		async run(args) {
			return JSON.stringify({ found: String(args.query ?? '') })
		},
	}
	const failing: Tool = {
		name: 'broken_tool',
		description: 'always fails',
		parameters: { type: 'object' },
		async run() {
			throw new Error('tool exploded')
		},
	}
	return [search, failing]
}

async function collect(events: AsyncIterable<{ type: string }>) {
	const out: { type: string }[] = []
	for await (const e of events) out.push(e)
	return out
}

describe('agent orchestration', () => {
	it('streams tokens and ends with a final event', async () => {
		const script: LlmStreamEvent[] = [
			{ kind: 'token', text: 'Here are ' },
			{ kind: 'token', text: 'the results.' },
		]
		const events = await collect(
			runAgent({
				provider: new ScriptedLlm([script]),
				tools: tools(),
				messages: [{ role: 'user', content: 'hi' }],
			}),
		)
		expect(events.map((e) => e.type)).toEqual(['token', 'token', 'final'])
	})

	it('executes tool calls and feeds results back to the model', async () => {
		const call: LlmStreamEvent[] = [
			{ kind: 'token', text: 'Searching...' },
			{ kind: 'tool_call', name: 'search_catalog', args: { query: 'bodhi' } },
		]
		const answer: LlmStreamEvent[] = [{ kind: 'token', text: 'Done.' }]
		const events = await collect(
			runAgent({
				provider: new ScriptedLlm([call, answer]),
				tools: tools(),
				messages: [{ role: 'user', content: 'find bodhi' }],
			}),
		)
		expect(events.map((e) => e.type)).toEqual([
			'token',
			'tool_call',
			'tool_result',
			'token',
			'final',
		])
		const result = events[2] as {
			type: 'tool_result'
			ok: boolean
			summary: string
		}
		expect(result.ok).toBe(true)
		expect(result.summary).toContain('bodhi')
	})

	it('reports unknown tools as tool_result errors', async () => {
		const call: LlmStreamEvent[] = [
			{ kind: 'tool_call', name: 'nope', args: {} },
		]
		const answer: LlmStreamEvent[] = [{ kind: 'token', text: 'ok' }]
		const events = await collect(
			runAgent({
				provider: new ScriptedLlm([call, answer]),
				tools: tools(),
				messages: [],
			}),
		)
		const result = events.find((e) => e.type === 'tool_result')
		expect(result).toMatchObject({
			type: 'tool_result',
			name: 'nope',
			ok: false,
		})
	})

	it('surfaces tool failures without killing the stream', async () => {
		const call: LlmStreamEvent[] = [
			{ kind: 'tool_call', name: 'broken_tool', args: {} },
		]
		const answer: LlmStreamEvent[] = [{ kind: 'token', text: 'apologies' }]
		const events = await collect(
			runAgent({
				provider: new ScriptedLlm([call, answer]),
				tools: tools(),
				messages: [],
			}),
		)
		const result = events.find((e) => e.type === 'tool_result')
		expect(result).toMatchObject({ ok: false, summary: 'tool exploded' })
		expect(events.at(-1)).toMatchObject({ type: 'final' })
	})

	it('stops at the step bound with an error event', async () => {
		const loop: LlmStreamEvent[] = [
			{ kind: 'tool_call', name: 'search_catalog', args: { query: 'x' } },
		]
		const events = await collect(
			runAgent({
				provider: new ScriptedLlm([loop]),
				tools: tools(),
				messages: [],
				maxSteps: 3,
			}),
		)
		expect(events.at(-1)).toMatchObject({
			type: 'error',
			message: 'agent exceeded maximum steps',
		})
	})

	it('charges the token meter per visible text', async () => {
		const script: LlmStreamEvent[] = [{ kind: 'token', text: 'abcd' }]
		const meter = createUsageMeter({ budgetTokens: 10 })
		let charged = 0
		await collect(
			runAgent({
				provider: new ScriptedLlm([script]),
				tools: tools(),
				messages: [],
				onTokens: (text) => {
					meter.charge('s1', Math.ceil(text.length / 4))
				},
			}),
		)
		charged = meter.spent('s1')
		expect(charged).toBeGreaterThan(0)
	})
})

describe('SSE streaming', () => {
	it('encodes events per the wire format', () => {
		expect(sseEncode('token', { text: 'hi' })).toBe(
			'event: token\ndata: {"text":"hi"}\n\n',
		)
	})

	it('wraps the stream as a text/event-stream response', async () => {
		const events = runAgent({
			provider: new ScriptedLlm([[{ kind: 'token', text: 'hi' }]]),
			tools: tools(),
			messages: [],
		})
		const response = toSseResponse(events)
		expect(response.headers.get('content-type')).toBe('text/event-stream')
		expect(response.headers.get('x-accel-buffering')).toBe('no')
		const body = await response.text()
		expect(body).toContain('event: token')
		expect(body).toContain('event: final')
	})
})

describe('agent gate', () => {
	it('rate limits before provider calls', () => {
		const gate = createAgentGate({
			rateLimitPerWindow: 1,
			windowMs: 60_000,
			budgetTokens: 10,
		})
		expect(() => gate.admit('ip1')).not.toThrow()
		expect(() => gate.admit('ip1')).toThrowError(RateLimitError)
	})

	it('enforces the token budget per key', () => {
		const gate = createAgentGate({
			rateLimitPerWindow: 100,
			windowMs: 60_000,
			budgetTokens: 5,
		})
		gate.meter.charge('s', 5)
		expect(() => gate.meter.charge('s', 1)).toThrowError(BudgetExceededError)
		gate.meter.charge('other', 1)
	})
})
