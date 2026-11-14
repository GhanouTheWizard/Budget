// Le Glaneur : fonction de recommandation (Supabase Edge Function), 100 % gratuite
// Un seul secret à définir dans Supabase > Edge Functions > Secrets :
//   TMDB_API_KEY  clé v3 ou jeton de lecture TMDB (themoviedb.org, gratuit)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-glaneur-code",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const IMG = "https://image.tmdb.org/t/p/w342";

type Mood = { movie: string; tv: string; label: string; phrase: string; yt: [string, string][]; zik: [string, string][]; pod: string };
const MOODS: Record<string, Mood> = {
  rire: { movie: "35", tv: "35", label: "rire", phrase: "De quoi se détendre les zygomatiques.", pod: "humour",
    yt: [["Palmashow", "Palmashow sketch"], ["Golden Moustache", "Golden Moustache court métrage"], ["Studio Bagel", "Studio Bagel sketch"]],
    zik: [["Funk qui donne le sourire", "funk feel good playlist"], ["Chanson française joyeuse", "chanson française bonne humeur playlist"]] },
  frissons: { movie: "27|53|9648", tv: "9648|80", label: "frissons", phrase: "Lumière éteinte recommandée.", pod: "affaires criminelles",
    yt: [["Feldup", "Feldup findings"], ["Le Grand JD", "Le Grand JD exploration"], ["Squeezie", "Squeezie threads horreur"]],
    zik: [["Ambiance sombre", "dark ambient playlist"], ["Bandes originales de thrillers", "thriller soundtrack playlist"]] },
  evasion: { movie: "12|14|878", tv: "10765|10759", label: "évasion", phrase: "Pour partir loin sans bouger du canapé.", pod: "voyage",
    yt: [["Bruno Maltor", "Bruno Maltor voyage"], ["Hugo Lisoir", "Hugo Lisoir espace"], ["ARTE Découverte", "ARTE Découverte voyage documentaire"]],
    zik: [["Musiques du monde", "world music voyage playlist"], ["Bandes originales épiques", "epic soundtrack playlist"]] },
  emotion: { movie: "18|10749", tv: "18", label: "émotion", phrase: "Une histoire qui reste en tête.", pod: "récits de vie",
    yt: [["Brut", "Brut documentaire portrait"], ["ARTE", "ARTE court métrage"], ["France Culture", "France Culture grand entretien"]],
    zik: [["Piano doux", "piano néoclassique playlist"], ["Chanson française à texte", "chanson française à texte playlist"]] },
  curieux: { movie: "99|36", tv: "99|10768", label: "curiosité", phrase: "Tu en sortiras un peu plus savant.", pod: "sciences",
    yt: [["ScienceEtonnante", "ScienceEtonnante"], ["Nota Bene", "Nota Bene histoire"], ["Le Réveilleur", "Le Réveilleur"], ["Balade Mentale", "Balade Mentale"]],
    zik: [["Musique pour réfléchir", "lofi concentration playlist"], ["Jazz tranquille", "jazz calme playlist"]] },
  cocon: { movie: "10751|16|35", tv: "10751|16|35", label: "cocon", phrase: "Doux et réconfortant, idéal sous un plaid.", pod: "histoires du soir",
    yt: [["ARTE Découverte", "ARTE Découverte nature documentaire"], ["Le Monde de Jamy", "Le Monde de Jamy"], ["Cuisine de saison", "recette réconfortante hiver"]],
    zik: [["Acoustique au coin du feu", "acoustic cosy playlist"], ["Bossa nova", "bossa nova playlist"]] },
  adrenaline: { movie: "28|53|80", tv: "10759|80", label: "action", phrase: "Ça ne traîne pas.", pod: "sport aventure",
    yt: [["Riding Zone", "Riding Zone"], ["Red Bull", "Red Bull best of sports extrêmes"], ["Zone Interdite aventure", "expédition extrême documentaire"]],
    zik: [["Rock énergique", "rock énergie playlist"], ["Électro qui réveille", "electro workout playlist"]] },
};

function tmdbFetch(path: string, params: Record<string, string>) {
  const key = Deno.env.get("TMDB_API_KEY")!;
  const url = new URL("https://api.themoviedb.org/3" + path);
  const headers: Record<string, string> = { accept: "application/json" };
  if (key.startsWith("eyJ")) headers.Authorization = "Bearer " + key;
  else url.searchParams.set("api_key", key);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return fetch(url, { headers }).then((r) => (r.ok ? r.json() : { results: [] })).catch(() => ({ results: [] }));
}

// Titres disponibles gratuitement (gratuit ou avec pub) en France
async function discover(kind: "movie" | "tv", genres: string, maxMinutes?: number) {
  const params: Record<string, string> = {
    language: "fr-FR", watch_region: "FR", with_watch_monetization_types: "free|ads",
    with_genres: genres, sort_by: "popularity.desc", "vote_count.gte": "40",
    page: String(1 + Math.floor(Math.random() * 3)),
  };
  if (kind === "movie" && maxMinutes && maxMinutes < 300) params["with_runtime.lte"] = String(maxMinutes);
  let data = await tmdbFetch(`/discover/${kind}`, params);
  if (!data.results?.length) { params.page = "1"; data = await tmdbFetch(`/discover/${kind}`, params); }
  return (data.results || []).map((x: any) => ({
    id: x.id, titre: x.title || x.name,
    annee: (x.release_date || x.first_air_date || "").slice(0, 4),
    note: x.vote_average, affiche: x.poster_path ? IMG + x.poster_path : null,
  }));
}

async function providers(kind: "movie" | "tv", id: number) {
  const fr = (await tmdbFetch(`/${kind}/${id}/watch/providers`, {}))?.results?.FR;
  if (!fr) return { plateformes: [], lien: null };
  const names = [...new Set([...(fr.free || []), ...(fr.ads || [])].map((p: any) => p.provider_name))];
  return { plateformes: names, lien: fr.link || null };
}

async function podcasts(term: string) {
  try {
    const r = await fetch(`https://itunes.apple.com/search?media=podcast&country=FR&lang=fr_fr&limit=15&term=${encodeURIComponent(term)}`);
    return ((await r.json()).results || []).map((p: any) => ({
      id: p.collectionId, titre: p.collectionName, auteur: p.artistName,
      affiche: p.artworkUrl600 || p.artworkUrl100, lien: p.collectionViewUrl,
    }));
  } catch { return []; }
}

async function livres(term: string) {
  try {
    const r = await fetch(`https://gutendex.com/books/?languages=fr${term ? "&search=" + encodeURIComponent(term) : ""}`);
    return ((await r.json()).results || []).slice(0, 20).map((b: any) => ({
      id: b.id, titre: b.title, auteur: b.authors?.[0]?.name || "",
      affiche: b.formats?.["image/jpeg"] || null, lien: `https://www.gutenberg.org/ebooks/${b.id}`,
    }));
  } catch { return []; }
}

const hasard = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!Deno.env.get("TMDB_API_KEY")) return json({ error: "config", missing: ["TMDB_API_KEY"] });

  let body: any = {};
  try { body = await req.json(); } catch { /* vide */ }

  const mood = MOODS[body.humeur] || MOODS.cocon;
  const minutes = Number(body.temps) || 120;
  const cats: string[] = Array.isArray(body.categories) && body.categories.length
    ? body.categories : ["film", "serie", "docu", "podcast", "livre", "youtube", "musique"];
  const envie = String(body.envie || "").trim().slice(0, 100);
  const gouts = String(body.gouts || "").split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
  const deja = new Set((Array.isArray(body.deja) ? body.deja : []).map(String));
  const famille = String(body.avec || "").includes("famille");

  const [films, series, docus, pods, books] = await Promise.all([
    cats.includes("film") ? discover("movie", famille ? "10751|16" : mood.movie, minutes) : [],
    cats.includes("serie") ? discover("tv", famille ? "10751|16" : mood.tv) : [],
    cats.includes("docu") ? discover("movie", "99", minutes) : [],
    cats.includes("podcast") ? podcasts(envie || (gouts.length ? hasard(gouts) : mood.pod)) : [],
    cats.includes("livre") ? livres(envie.split(" ")[0] || "") : [],
  ]);

  // Choix : on écarte le déjà proposé, on garde les mieux notés, puis on tire au sort
  const choisir = (arr: any[]) => {
    let pool = arr.filter((x) => !deja.has(x.titre));
    if (!pool.length) pool = arr;
    if (pool[0]?.note !== undefined) pool = [...pool].sort((a, b) => b.note - a.note).slice(0, 8);
    const pick = hasard(pool);
    const reste = pool.filter((x) => x !== pick);
    return { pick, planB: reste.length ? hasard(reste) : null };
  };
  const duree = minutes >= 300 ? "" : ` Tient dans tes ${minutes >= 60 ? Math.floor(minutes / 60) + " h" + (minutes % 60 ? " " + (minutes % 60) : "") : minutes + " min"}.`;

  const out: any[] = [];
  const ecran = async (key: string, arr: any[], kind: "movie" | "tv", label: string, phrase: string) => {
    if (!arr.length) return;
    const { pick, planB } = choisir(arr);
    const prov = await providers(kind, pick.id);
    const note = pick.note ? ` Noté ${pick.note.toFixed(1)}/10.` : "";
    out.push({ type: key, label, ...pick, ...prov, pourquoi: phrase + note + (kind === "movie" ? duree : ""),
      planB: planB ? { titre: planB.titre, annee: planB.annee } : null });
  };
  await Promise.all([
    ecran("film", films, "movie", "Film", mood.phrase),
    ecran("serie", series, "tv", "Série", mood.phrase + " Un épisode ou dix, à toi de voir."),
    ecran("docu", docus, "movie", "Documentaire", "Un docu gratuit pour nourrir ta curiosité."),
  ]);

  if (pods.length) {
    const { pick } = choisir(pods);
    out.push({ type: "podcast", label: "Podcast", ...pick, pourquoi: envie ? `Trouvé pour ton envie : ${envie}.` : "À écouter en voiture ou en cuisinant.",
      plateformes: ["Apple Podcasts", "aussi sur Deezer, Radio France…"] });
  }
  if (books.length) {
    const { pick } = choisir(books);
    out.push({ type: "livre", label: "Livre libre", ...pick, pourquoi: "Un classique libre de droits, à lire gratuitement sur liseuse ou téléphone.", plateformes: ["Projet Gutenberg"] });
  }
  if (cats.includes("youtube")) {
    const [chaine, rech] = envie ? [envie, envie + " documentaire"] : hasard(mood.yt.filter(([c]) => !deja.has(c)).length ? mood.yt.filter(([c]) => !deja.has(c)) : mood.yt);
    out.push({ type: "youtube", label: "YouTube", titre: chaine, auteur: envie ? "Recherche sur ton envie" : "Chaîne à explorer",
      pourquoi: envie ? "Les meilleures vidéos sur ton envie du moment." : mood.phrase,
      lien: "https://www.youtube.com/results?search_query=" + encodeURIComponent(rech), plateformes: ["YouTube"] });
  }
  if (cats.includes("musique")) {
    const [titre, rech] = hasard(mood.zik);
    const q = encodeURIComponent(rech);
    out.push({ type: "musique", label: "Musique", titre, auteur: "Ambiance " + mood.label, pourquoi: "Une ambiance sonore raccord avec ton humeur.",
      lien: "https://open.spotify.com/search/" + q, lien2: "https://www.youtube.com/results?search_query=" + q, plateformes: ["Spotify gratuit", "YouTube"] });
  }

  const order = ["film", "serie", "docu", "youtube", "podcast", "musique", "livre"];
  out.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  const accroches = [`Voilà ta récolte, spéciale ${mood.label}.`, `Glané pour toi : humeur ${mood.label}.`, `Ta pioche ${mood.label} est prête.`];
  return json({ accroche: hasard(accroches), resultats: out });
});
