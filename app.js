const DEFAULT_POSITION = { lat: 45.4642, lon: 9.1900, label: "Milano" };
const SEARCH_RADIUS_METERS = 10000;
const MAX_RESULTS = 12;

const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const emptyStateEl = document.getElementById("emptyState");
const resultCountEl = document.getElementById("resultCount");
const locateButton = document.getElementById("locateButton");
const searchForm = document.getElementById("searchForm");
const searchInput = document.getElementById("searchInput");
const infoDialog = document.getElementById("infoDialog");
const categoryFilter = document.getElementById("categoryFilter");
const periodFilter = document.getElementById("periodFilter");

const map = L.map("map", { zoomControl: true }).setView(
  [DEFAULT_POSITION.lat, DEFAULT_POSITION.lon],
  12
);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);
const markers = L.markerClusterGroup();
map.addLayer(markers);

let userMarker = null;
let resultMarkers = [];
let activeCenter = DEFAULT_POSITION;
let allResults = [];

function setStatus(message, type = "normal") {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", type === "error");
}

function setLoading(isLoading) {
  locateButton.disabled = isLoading;
  searchForm.querySelector("button").disabled = isLoading;
}

function clearResultMarkers() {
  markers.clearLayers();
  resultMarkers = [];
}

function setCenterMarker(lat, lon, label) {
  if (userMarker) map.removeLayer(userMarker);

  userMarker = L.circleMarker([lat, lon], {
    radius: 9,
    color: "#ffffff",
    weight: 3,
    fillColor: "#2868d8",
    fillOpacity: 1
  }).addTo(map);

  userMarker.bindPopup(`<strong>${escapeHtml(label)}</strong><br>Punto di ricerca`);
}

function escapeHtml(value = "") {
  return value.replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const toRad = value => value * Math.PI / 180;
  const earthRadius = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
    Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(km) {
  if (km < 1) return `${Math.max(50, Math.round(km * 1000 / 50) * 50)} m`;
  return `${km.toFixed(km < 10 ? 1 : 0)} km`;
}

async function geocodePlace(query) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.search = new URLSearchParams({
    q: query,
    format: "jsonv2",
    limit: "1",
    addressdetails: "1",
    "accept-language": "it"
  });

  const response = await fetch(url, {
    headers: { "Accept": "application/json" }
  });

  if (!response.ok) throw new Error("Ricerca della località non disponibile.");

  const data = await response.json();
  if (!data.length) throw new Error("Località non trovata. Prova con un nome più preciso.");

  return {
    lat: Number(data[0].lat),
    lon: Number(data[0].lon),
    label: data[0].display_name
  };
}

async function fetchNearbyWikipedia(lat, lon) {
  const params = new URLSearchParams({
    action: "query",
    generator: "geosearch",
    ggsprimary: "all",
    ggsnamespace: "0",
    ggsradius: String(SEARCH_RADIUS_METERS),
    ggslimit: String(MAX_RESULTS),
    ggscoord: `${lat}|${lon}`,
    prop: "coordinates|pageimages|extracts|info",
    inprop: "url",
    piprop: "thumbnail",
    pithumbsize: "900",
    exintro: "1",
    explaintext: "1",
    exsentences: "4",
    redirects: "1",
    origin: "*",
    format: "json"
  });

  const response = await fetch(`https://it.wikipedia.org/w/api.php?${params.toString()}`);
  if (!response.ok) throw new Error("Wikipedia non è momentaneamente raggiungibile.");

  const payload = await response.json();
  const pages = Object.values(payload.query?.pages || {});

  return pages
    .map(page => {
      const coordinate = page.coordinates?.[0];
      if (!coordinate) return null;
      const km = distanceKm(lat, lon, coordinate.lat, coordinate.lon);
      return {
        id: page.pageid,
        title: page.title,
        description: page.extract || "Apri la voce per conoscere la storia di questo luogo.",
        image: page.thumbnail?.source || "",
        url: page.fullurl || `https://it.wikipedia.org/?curid=${page.pageid}`,
        lat: coordinate.lat,
        lon: coordinate.lon,
        distance: km
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.distance - b.distance);
}
function applyFilters() {
  const category = categoryFilter.value;
  const period = periodFilter.value;

  const filteredItems = allResults.filter(item => {
    const text = `${item.title} ${item.description}`.toLowerCase();

    const matchesCategory =
      !category ||
      (category === "evento" && /evento|rivolta|incendio|terremoto|epidemia|trattato/.test(text)) ||
      (category === "personaggio" && /nato|morto|pittore|scrittore|duca|re |regina|santo|artista/.test(text)) ||
      (category === "monumento" && /chiesa|duomo|palazzo|castello|monumento|museo|basilica|torre/.test(text)) ||
      (category === "battaglia" && /battaglia|guerra|assedio|scontro|esercito/.test(text));

    const matchesPeriod =
      !period ||
      (period === "antica" && /romano|romana|etrusco|greco|antichità|impero romano/.test(text)) ||
      (period === "medioevo" && /medioevo|medievale|longobardo|carolingio|secolo xi|secolo xii|secolo xiii|secolo xiv/.test(text)) ||
      (period === "rinascimento" && /rinascimento|secolo xv|secolo xvi|leonardo|sforza/.test(text)) ||
      (period === "moderna" && /secolo xvii|secolo xviii|barocco|illuminismo|napoleonico/.test(text)) ||
      (period === "contemporanea" && /secolo xix|secolo xx|secolo xxi|risorgimento|prima guerra mondiale|seconda guerra mondiale/.test(text));

    return matchesCategory && matchesPeriod;
  });

  renderResults(filteredItems);
}

categoryFilter.addEventListener("change", applyFilters);
periodFilter.addEventListener("change", applyFilters);

function renderResults(items) {
  resultsEl.innerHTML = "";
  resultCountEl.textContent = String(items.length);
  emptyStateEl.hidden = items.length > 0;
  clearResultMarkers();

  const template = document.getElementById("cardTemplate");
  const bounds = [];

  items.forEach(item => {
    const fragment = template.content.cloneNode(true);
    const card = fragment.querySelector(".history-card");
    const image = fragment.querySelector(".card-image");
    const title = fragment.querySelector(".card-title");
    const description = fragment.querySelector(".card-description");
    const distance = fragment.querySelector(".distance-badge");
    const readMore = fragment.querySelector(".read-more");
    const showOnMap = fragment.querySelector(".show-on-map");

    title.textContent = item.title;
    description.textContent = item.description;
    distance.textContent = formatDistance(item.distance);
    readMore.href = item.url;

    if (item.image) {
      image.src = item.image;
      image.alt = `Immagine di ${item.title}`;
    } else {
      image.src = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200">
          <rect width="300" height="200" fill="#eaf2ff"/>
          <path d="M55 150h190M75 145V85l75-40 75 40v60M105 145v-35h25v35M170 145v-35h25v35M95 88h110"
            fill="none" stroke="#2868d8" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`
      );
      image.alt = "";
      image.classList.add("is-placeholder");
    }

    const marker = L.marker([item.lat, item.lon])
      .addTo(markers)
      .bindPopup(`<strong>${escapeHtml(item.title)}</strong><br>${formatDistance(item.distance)} dal punto scelto`);
  marker.on("click", () => {
  card.scrollIntoView({
    behavior: "smooth",
    block: "center"
  });

  card.classList.add("card-highlight");

  setTimeout(() => {
    card.classList.remove("card-highlight");
  }, 1800);
});  resultMarkers.push(marker);
    bounds.push([item.lat, item.lon]);

    showOnMap.addEventListener("click", () => {
      map.setView([item.lat, item.lon], 16, { animate: true });
      marker.openPopup();
      document.getElementById("map").scrollIntoView({ behavior: "smooth", block: "center" });
    });

    card.dataset.pageId = String(item.id);
    resultsEl.appendChild(fragment);
  });

  if (bounds.length) {
    bounds.push([activeCenter.lat, activeCenter.lon]);
    map.fitBounds(bounds, { padding: [35, 35], maxZoom: 17 });
  }
}

async function explorePosition(position) {
  setLoading(true);
  activeCenter = position;
  setStatus(`Ricerca delle storie vicino a ${position.label}…`);
  setCenterMarker(position.lat, position.lon, position.label);
  map.setView([position.lat, position.lon], 14);

  try {
    const items = await fetchNearbyWikipedia(position.lat, position.lon);
    allResults = items;
    applyFilters();

    if (items.length) {
      setStatus(`Trovati ${items.length} luoghi e storie entro circa ${SEARCH_RADIUS_METERS / 1000} km.`);
    } else {
      setStatus("Nessun contenuto trovato nelle vicinanze. Prova con una città più grande.", "error");
    }
  } catch (error) {
    renderResults([]);
    setStatus(error.message || "Si è verificato un errore.", "error");
  } finally {
    setLoading(false);
  }
}

locateButton.addEventListener("click", () => {
  if (!navigator.geolocation) {
    setStatus("Il tuo browser non supporta la geolocalizzazione.", "error");
    return;
  }

  setLoading(true);
  setStatus("Richiesta della posizione in corso…");

  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      explorePosition({
        lat: coords.latitude,
        lon: coords.longitude,
        label: "la tua posizione"
      });
    },
    error => {
      setLoading(false);
      const messages = {
        1: "Permesso posizione negato. Abilitalo nel browser oppure usa la ricerca.",
        2: "Posizione non disponibile. Prova a cercare una città.",
        3: "Tempo scaduto durante il rilevamento. Riprova."
      };
      setStatus(messages[error.code] || "Impossibile rilevare la posizione.", "error");
    },
    {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 120000
    }
  );
});

searchForm.addEventListener("submit", async event => {
  event.preventDefault();
  const query = searchInput.value.trim();

  if (query.length < 2) {
    setStatus("Scrivi almeno due caratteri.", "error");
    return;
  }

  setLoading(true);
  setStatus(`Cerco “${query}”…`);

  try {
    const place = await geocodePlace(query);
    await explorePosition(place);
  } catch (error) {
    setLoading(false);
    setStatus(error.message || "Ricerca non riuscita.", "error");
  }
});

map.on("click", event => {
  const lat = Number(event.latlng.lat.toFixed(6));
  const lon = Number(event.latlng.lng.toFixed(6));
  explorePosition({ lat, lon, label: "il punto scelto sulla mappa" });
});

document.getElementById("infoButton")?.addEventListener("click", () => infoDialog?.showModal());
document.getElementById("closeDialog")?.addEventListener("click", () => infoDialog?.close());
infoDialog?.addEventListener("click", event => {
  if (event.target === infoDialog) infoDialog.close();
});
