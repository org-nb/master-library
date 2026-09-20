const healthEl = document.querySelector('#health');
const videosEl = document.querySelector('#videos');
const searchEl = document.querySelector('#query');

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

async function loadHealth() {
  const data = await fetchJson('/api/health');
  healthEl.textContent = `${data.status} · ${data.service}`;
}

async function loadVideos(query = '') {
  const endpoint = query ? `/api/search?q=${encodeURIComponent(query)}` : '/api/videos?limit=5';
  const data = await fetchJson(endpoint);
  const items = data.items ?? [];

  videosEl.innerHTML = items.length
    ? items
        .map(
          (video) => `
            <li>
              <strong>${video.title}</strong>
              <div class="video-meta">${video.teacher} · ${video.topic} · ${video.status}</div>
              <p>${video.description}</p>
            </li>
          `,
        )
        .join('')
    : '<li>No videos matched the current query.</li>';
}

searchEl.addEventListener('input', async (event) => {
  await loadVideos(event.target.value);
});

(async () => {
  try {
    await loadHealth();
    await loadVideos();
  } catch (error) {
    healthEl.textContent = 'unavailable';
    videosEl.innerHTML = '<li>Unable to load the catalog right now.</li>';
    console.error(error);
  }
})();
