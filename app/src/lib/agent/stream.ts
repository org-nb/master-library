import type { AgentEvent } from './orchestrate.js'

/**
 * Encode one event in the SSE wire format.
 *
 * @param type - event type (token, tool_call, tool_result, final, error)
 * @param data - JSON-serializable payload
 * @returns SSE frame
 */
export function sseEncode(type: string, data: unknown): string {
	return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
}

/**
 * Wrap an agent event stream as an SSE Response.
 *
 * Headers disable intermediate buffering; the proxy in front of the
 * container must not buffer this route either (ADR-0004 risk note).
 *
 * @param events - agent event stream
 * @returns Response with text/event-stream body
 */
export function toSseResponse(events: AsyncIterable<AgentEvent>): Response {
	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const encoder = new TextEncoder()
			try {
				for await (const event of events) {
					controller.enqueue(encoder.encode(sseEncode(event.type, event)))
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : 'stream error'
				controller.enqueue(encoder.encode(sseEncode('error', { message })))
			} finally {
				controller.close()
			}
		},
	})

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache, no-transform',
			connection: 'keep-alive',
			'x-accel-buffering': 'no',
		},
	})
}
