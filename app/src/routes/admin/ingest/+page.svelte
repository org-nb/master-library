<script lang="ts">
import type { PageData } from './$types'
export let data: PageData
</script>

<svelte:head>
	<title>Ingest — Master Library</title>
</svelte:head>

<h1>Ingest</h1>

{#if data.issues.length > 0}
	<ul class="errors">
		{#each data.issues as issue}<li>{issue}</li>{/each}
	</ul>
{/if}

{#if data.upload !== null}
	<p class="success">
		Video <code>{data.upload.slug}</code> created. Upload the MP4 to the presigned URL,
		then post the ffprobe report to action <code>complete</code>.
	</p>
	<code>{data.upload.uploadUrl}</code>
{/if}

<form method="POST" action="?/default">
	<label>Title <input name="title" required /></label>
	<label>Description <textarea name="description"></textarea></label>
	<label>Year <input name="year" type="number" min="1900" max="2100" required /></label>
	<label>Place IRI <input name="place_iri" required /></label>
	<label>Event id <input name="event_id" required /></label>
	<label>Episode id <input name="episode_id" required /></label>
	<label>Episode slug <input name="episode_slug" required /></label>
	<label>Content tier
		<select name="content_tier">
			<option value="recording">recording</option>
			<option value="edit">edit</option>
			<option value="short">short</option>
		</select>
	</label>
	<label>Edition <input name="edition" type="number" min="1" value="1" /></label>
	<label>Source ranges (JSON) <textarea name="source_ranges" placeholder="JSON array of range objects: source_version_id, start_seconds, end_seconds"></textarea></label>
	<button type="submit">Create video</button>
</form>

<h2>Complete upload</h2>
<form method="POST" action="?/complete">
	<label>Slug <input name="slug" required /></label>
	<label>Probe report (JSON)
		<textarea name="probe" placeholder='ffprobe report: video_codec, audio_codec, duration_seconds, byte_size, sha256'></textarea>
	</label>
	<button type="submit">Mark verified</button>
</form>
