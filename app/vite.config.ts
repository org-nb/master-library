/// <reference types="vitest/config" />
import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		include: ['tests/**/*.test.ts'],
		environment: 'node',
		testTimeout: 30_000,
		hookTimeout: 60_000,
	},
})
