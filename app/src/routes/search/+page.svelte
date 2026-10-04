<script lang="ts">
import type { PageData } from './$types'
export let data: PageData
</script>

<svelte:head>
	<title>Search — Master Library</title>
</svelte:head>

<h1>Search</h1>
<form method="get">
	<input type="search" name="q" value={data.query} placeholder="Search the catalog" required />
	<button type="submit">Search</button>
</form>

{#if data.query !== ""}
	<p>{data.items.length} result(s)</p>
	<ul class="video-list">
		{#each data.items as item (item.slug)}
			<li>
				<a href="/videos/{item.slug}">{item.title}</a>
				<span class="meta">{item.content_tier} · {item.year}</span>
			</li>
		{/each}
	</ul>
{/if}
