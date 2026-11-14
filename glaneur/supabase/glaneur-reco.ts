// Le Glaneur : fonction de recommandation (Supabase Edge Function)
// Secrets à définir dans Supabase > Edge Functions > Secrets :
//   ANTHROPIC_API_KEY  clé API Anthropic (console.anthropic.com)
//   TMDB_API_KEY       clé v3 ou jeton de lecture TMDB (themoviedb.org, gratuit)
//   GLANEUR_CODE       code d'accès de ton choix, demandé une fois dans l'appli

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-glaneur-code",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const MODEL = "claude-haiku-5-5";
const IMG = "https://image.tmdb.org/t/p/w342";

// Humeurs -> genres TMDB (films / séries)
const MOODS: Record<string, { movie: string; tv: string; label: string }> = {
  rire: { movie: "35", tv: "35", label: "envie de rire" },
  frissons: { movie: "27|53|9648", tv: "9648|80", label: "envie de frissons" },
  evasion: { movie: "12|14|878", tv: "10765|10759", label: "envie d'évasion" },
  emotion: { movie: "18|10749", tv: "18", label: "envie d'émotion" },
  curieux: { movie: "99|36", tv: "99|10768", label: "curiosité, envie d'apprendre" },
  cocon: { movie: "10751|16|35", tv: "10751|16|35", label: "cocooning, quelque chose de doux" },
  adrenaline: { movie: "28|53|80", tv: "10759|80", label: "adrénaline, action" },
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
    language: "fr-FR",
    watch_region: "FR",
    with_watch_monetization_types: "free|ads",
    with_genres: genres,
    sort_by: "popularity.desc",
    "vote_count.gte": "40",
    page: String(1 + Math.floor(Math.random() * 3)),
  };
  if (kind === "movie" && maxMinutes && maxMinutes < 300) params["with_runtime.lte"] = String(maxMinutes);
  let data = await tmdbFetch(`/discover/${kind}`, params);
  if (!data.results?.length) {
    params.page = "1";
    data = await tmdbFetch(`/discover/${kind}`, params);
  }
  return (data.results || []).slice(0, 15).map((x: any) => ({
    id: x.id,
    titre: x.title || x.name,
    annee: (x.release_date || x.first_air_date || "").slice(0, 4),
    note: x.vote_average,
    resume: (x.overview || "").slice(0, 220),
    affiche: x.poster_path ? IMG + x.poster_path : null,
  }));
}

async function providers(kind: "movie" | "tv", id: number) {
  const data = await tmdbFetch(`/${kind}/${id}/watch/providers`, {});
  const fr = data?.results?.FR;
  if (!fr) return { plateformes: [], lien: null };
  const list = [...(fr.free || []), ...(fr.ads || [])];
  const names = [...new Set(list.map((p: any) => p.provider_name))];
  return { plateformes: names, lien: fr.link || null };
}

async function podcasts(term: string) {
  try {
    const url = `https://itunes.apple.com/search?media=podcast&country=FR&lang=fr_fr&limit=12&term=${encodeURIComponent(term)}`;
    const r = await fetch(url);
    const d = await r.json();
    return (d.results || []).map((p: any) => ({
      id: p.collectionId,
      titre: p.collectionName,
      auteur: p.artistName,
      genre: p.primaryGenreName,
      affiche: p.artworkUrl600 || p.artworkUrl100,
      lien: p.collectionViewUrl,
    }));
  } catch {
    return [];
  }
}

async function livres(term: string) {
  try {
    const url = `https://gutendex.com/books/?languages=fr${term ? "&search=" + encodeURIComponent(term) : ""}`;
    const r = await fetch(url);
    const d = await r.json();
    return (d.results || []).slice(0, 12).map((b: any) => ({
      id: b.id,
      titre: b.title,
      auteur: b.authors?.[0]?.name || "",
      affiche: b.formats?.["image/jpeg"] || null,
      lien: `https://www.gutenberg.org/ebooks/${b.id}`,
    }));
  } catch {
    return [];
  }
}

async function askClaude(system: string, user: string) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 2000, system, messages: [{ role: "user", content: user }] }),
  });
  if (!r.ok) throw new Error("Claude API : " + r.status + " " + (await r.text()).slice(0, 200));
  const d = await r.json();
  const text = (d.content || []).map((c: any) => c.text || "").join("");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("Réponse IA illisible");
  return JSON.parse(m[0]);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const missing = ["ANTHROPIC_API_KEY", "TMDB_API_KEY", "GLANEUR_CODE"].filter((k) => !Deno.env.get(k));
  if (missing.length) return json({ error: "config", missing }, 200);

  if (req.headers.get("x-glaneur-code") !== Deno.env.get("GLANEUR_CODE")) return json({ error: "code" }, 401);

  let body: any = {};
  try {
    body = await req.json();
  } catch { /* vide */ }

  const moodKey = MOODS[body.humeur] ? body.humeur : "cocon";
  const mood = MOODS[moodKey];
  const minutes = Number(body.temps) || 120;
  const cats: string[] = Array.isArray(body.categories) && body.categories.length
    ? body.categories
    : ["film", "serie", "docu", "podcast", "livre", "youtube", "musique"];
  const envie = String(body.envie || "").slice(0, 200);
  const gouts = String(body.gouts || "").slice(0, 300);
  const deja = Array.isArray(body.deja) ? body.deja.slice(-60).map(String) : [];

  // 1) Récolte des candidats réels
  const podTerm = envie || gouts.split(/[,;]/)[0] || mood.label.split(",")[0];
  const [films, series, docus, pods, books] = await Promise.all([
    cats.includes("film") ? discover("movie", mood.movie, minutes) : [],
    cats.includes("serie") ? discover("tv", mood.tv) : [],
    cats.includes("docu") ? discover("movie", "99", minutes) : [],
    cats.includes("podcast") ? podcasts(podTerm) : [],
    cats.includes("livre") ? livres(envie.split(" ")[0] || "") : [],
  ]);

  const pool = { films, series, docus, podcasts: pods, livres: books };
  const compact = (arr: any[]) => arr.map((x) => ({ id: x.id, titre: x.titre, annee: x.annee, auteur: x.auteur, genre: x.genre, resume: x.resume }));

  const system = `Tu es Le Glaneur, un recommandeur chaleureux qui glane le meilleur du divertissement gratuit et légal en France.
Tu réponds UNIQUEMENT avec un objet JSON valide, sans texte autour.
Pour films, séries, docus, podcasts et livres, tu choisis STRICTEMENT parmi les candidats fournis (par leur id). N'invente jamais un id.
Pour youtube et musique, tu proposes une recherche précise (pas d'URL) et une chaîne ou un artiste réel et connu.
Ton style : français naturel, phrases courtes, tutoiement, pas de tirets longs, pas de superlatifs creux.`;

  const user = `Contexte :
- Humeur : ${mood.label}
- Temps disponible : ${minutes} minutes
- Énergie : ${body.energie || "normale"}
- Avec qui : ${body.avec || "seul"}
- Envie particulière : ${envie || "aucune"}
- Goûts habituels : ${gouts || "non précisés"}
- Déjà proposé récemment (à éviter) : ${deja.join(" | ") || "rien"}

Catégories voulues : ${cats.join(", ")}

Candidats disponibles gratuitement en France :
${JSON.stringify({
    films: compact(films),
    series: compact(series),
    docus: compact(docus),
    podcasts: compact(pods),
    livres: compact(books),
  })}

Réponds avec ce JSON (n'inclus que les catégories voulues et pour lesquelles il y a des candidats, sauf youtube et musique toujours possibles) :
{
  "accroche": "une phrase d'intro complice adaptée au contexte",
  "choix": {
    "film": {"id": 0, "pourquoi": "1 à 2 phrases", "planB": 0},
    "serie": {"id": 0, "pourquoi": "...", "planB": 0},
    "docu": {"id": 0, "pourquoi": "...", "planB": 0},
    "podcast": {"id": 0, "pourquoi": "..."},
    "livre": {"id": 0, "pourquoi": "..."},
    "youtube": {"titre": "nom de la vidéo ou du format", "chaine": "chaîne", "recherche": "termes de recherche", "pourquoi": "..."},
    "musique": {"titre": "ambiance ou album", "artiste": "artiste", "recherche": "termes de recherche", "pourquoi": "..."}
  }
}`;

  let ai: any;
  try {
    ai = await askClaude(system, user);
  } catch (e) {
    return json({ error: "ia", detail: String(e) }, 502);
  }

  // 2) Assemblage avec les vraies données
  const find = (arr: any[], id: any) => arr.find((x) => String(x.id) === String(id));
  const out: any[] = [];
  const c = ai.choix || {};

  const addScreen = async (key: string, arr: any[], kind: "movie" | "tv", label: string) => {
    const pick = c[key] && find(arr, c[key].id);
    if (!pick) return;
    const prov = await providers(kind, pick.id);
    const b = c[key].planB && find(arr, c[key].planB);
    out.push({
      type: key, label, ...pick, pourquoi: c[key].pourquoi, ...prov,
      planB: b ? { titre: b.titre, annee: b.annee } : null,
    });
  };

  await Promise.all([
    addScreen("film", films, "movie", "Film"),
    addScreen("serie", series, "tv", "Série"),
    addScreen("docu", docus, "movie", "Documentaire"),
  ]);

  const p = c.podcast && find(pods, c.podcast.id);
  if (p) out.push({ type: "podcast", label: "Podcast", ...p, pourquoi: c.podcast.pourquoi, plateformes: ["Apple Podcasts", "Radio France, Deezer, etc."] });

  const l = c.livre && find(books, c.livre.id);
  if (l) out.push({ type: "livre", label: "Livre libre", ...l, pourquoi: c.livre.pourquoi, plateformes: ["Projet Gutenberg"] });

  if (cats.includes("youtube") && c.youtube?.recherche) {
    out.push({
      type: "youtube", label: "YouTube", titre: c.youtube.titre, auteur: c.youtube.chaine, pourquoi: c.youtube.pourquoi,
      lien: "https://www.youtube.com/results?search_query=" + encodeURIComponent(c.youtube.recherche), plateformes: ["YouTube"],
    });
  }
  if (cats.includes("musique") && c.musique?.recherche) {
    const q = encodeURIComponent(c.musique.recherche);
    out.push({
      type: "musique", label: "Musique", titre: c.musique.titre, auteur: c.musique.artiste, pourquoi: c.musique.pourquoi,
      lien: "https://open.spotify.com/search/" + q, lien2: "https://www.youtube.com/results?search_query=" + q,
      plateformes: ["Spotify gratuit", "YouTube"],
    });
  }

  const order = ["film", "serie", "docu", "youtube", "podcast", "musique", "livre"];
  out.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));

  return json({ accroche: ai.accroche || "", resultats: out, sources: { films: films.length, series: series.length, docus: docus.length, podcasts: pods.length, livres: books.length } });
});
