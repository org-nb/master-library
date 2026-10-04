import type { Role } from '../roles.js'

/** One event in a provider stream. */
export type LlmStreamEvent =
	| { kind: 'token'; text: string }
	| { kind: 'tool_call'; name: string; args: Record<string, unknown> }
	| { kind: 'done' }

export interface ToolCallRef {
	id: string
	name: string
	args: Record<string, unknown>
}

/** Chat message in the canonical (provider-agnostic) form. */
export interface ChatMessage {
	role: 'system' | 'user' | 'assistant' | 'tool'
	content: string
	toolCallId?: string
	toolCalls?: ToolCallRef[]
}

/**
 * A registered agent tool (ADR-0004 tool classes).
 */
export interface Tool {
	name: string
	description: string
	/** JSON Schema for the tool arguments. */
	parameters: Record<string, unknown>
	/** Minimum role allowed to invoke the tool (default: anonymous). */
	minRole?: Role
	/**
	 * Execute the tool.
	 *
	 * @param args - validated arguments
	 * @returns JSON-serializable result summary
	 */
	run(args: Record<string, unknown>): Promise<string>
}

/**
 * LLM provider abstraction (ADR-0004: orchestration stays server-side;
 * tests run a deterministic fake, CI never needs a provider key).
 */
export interface LlmProvider {
	/**
	 * Stream a chat completion.
	 *
	 * @param messages - conversation so far
	 * @param tools - tools the model may call
	 * @returns stream of tokens, tool calls, and a terminal done event
	 */
	chat(messages: ChatMessage[], tools: Tool[]): AsyncIterable<LlmStreamEvent>
}

/**
 * Deterministic scripted provider for tests and demos.
 *
 * Each call returns the next script; the last script repeats.
 */
export class ScriptedLlm implements LlmProvider {
	#calls = 0

	constructor(private readonly scripts: LlmStreamEvent[][]) {}

	chat(): AsyncIterable<LlmStreamEvent> {
		const script = this.scripts[Math.min(this.#calls, this.scripts.length - 1)]
		this.#calls += 1
		return (async function* (): AsyncGenerator<LlmStreamEvent> {
			for (const event of script) yield event
			yield { kind: 'done' }
		})()
	}
}

interface OpenAiConfig {
	baseUrl: string
	apiKey: string
	model: string
	fetchImpl?: typeof fetch
}

/**
 * Minimal OpenAI-compatible chat-completions streaming client.
 *
 * Maps `delta.content` to token events and `delta.tool_calls` to tool_call
 * events. Kept deliberately small: one tool call per stream chunk, no
 * parallel calls.
 */
export class OpenAiCompatibleLlm implements LlmProvider {
	#cfg: OpenAiConfig

	constructor(cfg: OpenAiConfig) {
		this.#cfg = cfg
	}

	async *chat(
		messages: ChatMessage[],
		tools: Tool[],
	): AsyncIterable<LlmStreamEvent> {
		const doFetch = this.#cfg.fetchImpl ?? fetch
		const body: Record<string, unknown> = {
			model: this.#cfg.model,
			stream: true,
			messages: messages.map((m) => {
				if (
					m.role === 'assistant' &&
					m.toolCalls !== undefined &&
					m.toolCalls.length > 0
				) {
					return {
						role: 'assistant',
						content: m.content === '' ? null : m.content,
						tool_calls: m.toolCalls.map((tc) => ({
							id: tc.id,
							type: 'function',
							function: { name: tc.name, arguments: JSON.stringify(tc.args) },
						})),
					}
				}
				if (m.role === 'tool') {
					return {
						role: 'tool',
						tool_call_id: m.toolCallId,
						content: m.content,
					}
				}
				return { role: m.role, content: m.content }
			}),
		}
		if (tools.length > 0) {
			body.tools = tools.map((t) => ({
				type: 'function',
				function: {
					name: t.name,
					description: t.description,
					parameters: t.parameters,
				},
			}))
		}

		const response = await doFetch(
			`${this.#cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`,
			{
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					authorization: `Bearer ${this.#cfg.apiKey}`,
				},
				body: JSON.stringify(body),
			},
		)
		if (!response.ok || response.body === null) {
			throw new Error(`llm provider returned ${response.status}`)
		}

		const reader = response.body.getReader()
		const decoder = new TextDecoder()
		let buffer = ''
		for (;;) {
			const { done, value } = await reader.read()
			if (done) break
			buffer += decoder.decode(value, { stream: true })
			const lines = buffer.split('\n')
			buffer = lines.pop() ?? ''
			for (const line of lines) {
				const trimmed = line.trim()
				if (!trimmed.startsWith('data:')) continue
				const data = trimmed.slice(5).trim()
				if (data === '[DONE]') continue
				try {
					const json = JSON.parse(data) as {
						choices?: {
							delta?: { content?: string; tool_calls?: ToolDelta[] }
						}[]
					}
					const delta = json.choices?.[0]?.delta
					if (delta?.content) yield { kind: 'token', text: delta.content }
					for (const tc of delta?.tool_calls ?? []) {
						if (tc.function?.name) {
							let args: Record<string, unknown> = {}
							try {
								args = JSON.parse(tc.function.arguments ?? '{}')
							} catch {
								args = { raw: tc.function.arguments }
							}
							yield { kind: 'tool_call', name: tc.function.name, args }
						}
					}
				} catch {
					// Skip malformed SSE payloads; the model may send comments.
				}
			}
		}
		yield { kind: 'done' }
	}
}

interface ToolDelta {
	function?: { name?: string; arguments?: string }
}
