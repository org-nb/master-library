<script lang="ts">
import type { PageData } from './$types'
export let data: PageData
</script>

<svelte:head>
	<title>{data.title} — Master Library</title>
	<meta name="description" content={data.description} />
	{#if data.playbackUrl !== null}
		<meta property="og:title" content={data.title} />
		<meta property="og:type" content="video.other" />
	{/if}
</svelte:head>

<h1>{data.title}</h1>
<p class="meta">{data.content_tier} · {data.year} · {data.place_slug}</p>
{#if data.description !== ""}<p>{data.description}</p>{/if}

{#if data.playbackUrl !== null}
	<video controls preload="metadata" src={data.playbackUrl} width="640"></video>
{:else}
	<p class="notice">Playback is not available for your access level.</p>
{/if}

{#if data.related.length > 0}
	<h2>Related</h2>
	<ul class="video-list">
		{#each data.related as item (item.slug)}
			<li><a href="/videos/{item.slug}">{item.title}</a> <span class="meta">{item.content_tier} · {item.year}</span></li>
		{/each}
	</ul>
{/if}
