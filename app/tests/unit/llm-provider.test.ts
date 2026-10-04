import { describe, expect, it } from 'vitest'
import {
	type ChatMessage,
	type LlmStreamEvent,
	OpenAiCompatibleLlm,
} from '../../src/lib/agent/llm.js'

function sseResponse(chunks: string[]): Response {
	const encoder = new TextEncoder()
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
			controller.close()
		},
	})
	return new Response(stream, {
		status: 200,
		headers: { 'content-type': 'text/event-stream' },
	})
}

const content = (text: string) =>
	`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`
const toolCall = (name: string, args: string) =>
	`data: ${JSON.stringify({
		choices: [
			{ delta: { tool_calls: [{ function: { name, arguments: args } }] } },
		],
	})}\n\n`

describe('OpenAiCompatibleLlm', () => {
	it('streams tokens, tool calls, and done', async () => {
		const provider = new OpenAiCompatibleLlm({
			baseUrl: 'http://llm.test/v1',
			apiKey: 'k',
			model: 'test',
			fetchImpl: (async (input, init) => {
				const url = String(input)
				expect(url).toBe('http://llm.test/v1/chat/completions')
				expect(new Headers(init?.headers).get('authorization')).toBe('Bearer k')
				const body = JSON.parse(String(init?.body)) as {
					stream: boolean
					model: string
				}
				expect(body.stream).toBe(true)
				return sseResponse([
					content('Hello '),
					`data: ${JSON.stringify({ choices: [{ delta: {} }] })}\n\n`,
					content('world'),
					toolCall('search_catalog', '{"query":"bodhi"}'),
					'data: [DONE]\n\n',
				])
			}) as typeof fetch,
		})

		const events: LlmStreamEvent[] = []
		const messages: ChatMessage[] = [{ role: 'user', content: 'hi' }]
		for await (const event of provider.chat(messages, [])) {
			events.push(event)
		}
		expect(events).toEqual([
			{ kind: 'token', text: 'Hello ' },
			{ kind: 'token', text: 'world' },
			{ kind: 'tool_call', name: 'search_catalog', args: { query: 'bodhi' } },
			{ kind: 'done' },
		])
	})

	it('sends tool definitions and tool-role messages', async () => {
		let seen: Record<string, unknown> | null = null
		const provider = new OpenAiCompatibleLlm({
			baseUrl: 'http://llm.test/v1',
			apiKey: 'k',
			model: 'test',
			fetchImpl: (async (_input, init) => {
				seen = JSON.parse(String(init?.body))
				return sseResponse([content('ok'), 'data: [DONE]\n\n'])
			}) as typeof fetch,
		})
		const messages: ChatMessage[] = [
			{ role: 'system', content: 'sys' },
			{ role: 'user', content: 'q' },
			{
				role: 'assistant',
				content: '',
				toolCalls: [{ id: 'c1', name: 'search_catalog', args: { query: 'x' } }],
			},
			{ role: 'tool', toolCallId: 'c1', content: 'results' },
		]
		const events = (async () => {
			const out: LlmStreamEvent[] = []
			for await (const e of provider.chat(messages, [
				{
					name: 'search_catalog',
					description: 'd',
					parameters: {},
					run: async () => '',
				},
			])) {
				out.push(e)
			}
			return out
		})()
		await events
		expect(seen).not.toBeNull()
		const msgs = seen!.messages as Record<string, unknown>[]
		expect(msgs[2].tool_calls).toEqual([
			{
				id: 'c1',
				type: 'function',
				function: { name: 'search_catalog', arguments: '{"query":"x"}' },
			},
		])
		expect(msgs[3]).toEqual({
			role: 'tool',
			tool_call_id: 'c1',
			content: 'results',
		})
		expect((seen!.tools as unknown[]).length).toBe(1)
	})

	it('fails on non-2xx provider responses', async () => {
		const provider = new OpenAiCompatibleLlm({
			baseUrl: 'http://llm.test/v1',
			apiKey: 'k',
			model: 'test',
			fetchImpl: (async () =>
				new Response('boom', { status: 500 })) as typeof fetch,
		})
		await expect(
			(async () => {
				for await (const _e of provider.chat([], [])) {
					// drain
				}
			})(),
		).rejects.toThrow(/500/)
	})
})
