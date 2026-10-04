import type { ChatMessage, LlmProvider, Tool, ToolCallRef } from './llm.js'

/** Events emitted to the SSE stream (ADR-0004 message types). */
export type AgentEvent =
	| { type: 'token'; text: string }
	| { type: 'tool_call'; name: string; args: Record<string, unknown> }
	| { type: 'tool_result'; name: string; ok: boolean; summary: string }
	| { type: 'final'; content: string }
	| { type: 'error'; message: string }

export interface RunAgentOptions {
	provider: LlmProvider
	tools: Tool[]
	messages: ChatMessage[]
	/** Maximum provider round-trips (bounds tool loops). */
	maxSteps?: number
	/**
	 * Token accounting hook (metering); called with the visible text delta.
	 */
	onTokens?: (text: string) => void
}

/**
 * Run the agent loop: provider stream, tool execution, bounded steps.
 *
 * The loop runs entirely server-side (ADR-0004); only display-bound
 * events are yielded. Tool failures become tool_result events (the model
 * sees them) rather than stream errors; stream-level errors surface as a
 * terminal error event.
 *
 * @param opts - provider, tools, conversation
 * @returns async generator of AgentEvent
 */
export async function* runAgent(
	opts: RunAgentOptions,
): AsyncIterable<AgentEvent> {
	const maxSteps = opts.maxSteps ?? 6
	const messages: ChatMessage[] = [...opts.messages]

	for (let step = 0; step < maxSteps; step += 1) {
		let finalText = ''
		const toolCalls: ToolCallRef[] = []

		try {
			for await (const event of opts.provider.chat(messages, opts.tools)) {
				if (event.kind === 'token') {
					finalText += event.text
					opts.onTokens?.(event.text)
					yield { type: 'token', text: event.text }
				} else if (event.kind === 'tool_call') {
					const call: ToolCallRef = {
						id: `call_${step}_${toolCalls.length}`,
						name: event.name,
						args: event.args,
					}
					toolCalls.push(call)
					yield { type: 'tool_call', name: call.name, args: call.args }

					const tool = opts.tools.find((t) => t.name === call.name)
					let ok = true
					let summary: string
					if (tool === undefined) {
						ok = false
						summary = `unknown tool: ${call.name}`
					} else {
						try {
							summary = await tool.run(call.args)
						} catch (err) {
							ok = false
							summary = err instanceof Error ? err.message : String(err)
						}
					}
					yield { type: 'tool_result', name: call.name, ok, summary }
					messages.push({
						role: 'assistant',
						content: '',
						toolCalls: [call],
					})
					messages.push({
						role: 'tool',
						toolCallId: call.id,
						content: ok ? summary : `error: ${summary}`,
					})
				}
			}
		} catch (err) {
			yield {
				type: 'error',
				message: err instanceof Error ? err.message : 'agent error',
			}
			return
		}

		if (toolCalls.length === 0) {
			yield { type: 'final', content: finalText }
			return
		}
		// Tool results queued: continue the loop so the model can answer.
	}
	yield { type: 'error', message: 'agent exceeded maximum steps' }
}
