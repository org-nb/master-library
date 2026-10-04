<script lang="ts">
import type { PageData } from './$types'
export let data: PageData
</script>

<svelte:head>
	<title>Master Library</title>
</svelte:head>

<h1>Master Library</h1>
<p>Published teachings, clips and shorts.</p>

<ul class="video-list">
	{#each data.items as item (item.slug)}
		<li>
			<a href="/videos/{item.slug}">{item.title}</a>
			<span class="meta">
				{item.content_tier} · {item.year} · {item.place_slug}
			</span>
		</li>
	{/each}
</ul>
