// Le Glaneur : fonction de recommandation (Supabase Edge Function), sans clé payante
// Films, séries et docus : moins de 30 ans, disponibles en France sur Netflix, Canal+ ou Disney+
// Un seul secret à définir dans Supabase > Edge Functions > Secrets :
//   TMDB_API_KEY  clé v3 ou jeton de lecture TMDB (themoviedb.org, gratuit)
// Facultatif : YOUTUBE_API_KEY (clé gratuite « YouTube Data API v3 ») pour des vidéos plus fiables

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-glaneur-code",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
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

// Plateformes retenues (abonnements d'Abdelghani)
const PLATEFORMES: [RegExp, string][] = [[/netflix/i, "Netflix"], [/canal\s*\+|canal plus|mycanal/i, "Canal+"], [/disney/i, "Disney+"]];
const nomPlateforme = (n: string) => PLATEFORMES.find(([re]) => re.test(n))?.[1] || null;
const SECOURS_IDS = "8|381|337"; // Netflix, Canal+, Disney+ (identifiants TMDB)

// Identifiants TMDB des plateformes, relus dans la liste officielle pour la France
async function idsPlateformes(kind: "movie" | "tv") {
  const d = await tmdbFetch(`/watch/providers/${kind}`, { watch_region: "FR", language: "fr-FR" });
  const ids = (d.results || []).filter((p: any) => nomPlateforme(p.provider_name || "")).map((p: any) => p.provider_id);
  return ids.length ? ids.join("|") : SECOURS_IDS;
}

// Titres de moins de 30 ans, inclus dans l'abonnement Netflix, Canal+ ou Disney+ en France
async function discover(kind: "movie" | "tv", genres: string, maxMinutes?: number, motsCles = "", vo = "") {
  const il30 = new Date(); il30.setFullYear(il30.getFullYear() - 30);
  const params: Record<string, string> = {
    language: "fr-FR", watch_region: "FR", with_watch_monetization_types: "flatrate",
    with_watch_providers: await idsPlateformes(kind),
    [kind === "movie" ? "primary_release_date.gte" : "first_air_date.gte"]: il30.toISOString().slice(0, 10),
    sort_by: "popularity.desc", "vote_count.gte": motsCles ? "10" : "40",
    page: motsCles ? "1" : String(1 + Math.floor(Math.random() * 3)),
  };
  if (genres) params.with_genres = genres;
  if (vo) { params.with_original_language = vo; params["vote_count.gte"] = "5"; params.page = "1"; }
  if (motsCles) params.with_keywords = motsCles;
  if (kind === "movie" && maxMinutes && maxMinutes < 300) params["with_runtime.lte"] = String(maxMinutes);
  let data = await tmdbFetch(`/discover/${kind}`, params);
  if (!data.results?.length) { params.page = "1"; data = await tmdbFetch(`/discover/${kind}`, params); }
  return (data.results || []).map((x: any) => ({
    id: x.id, titre: x.title || x.name,
    annee: (x.release_date || x.first_air_date || "").slice(0, 4),
    note: x.vote_average, affiche: x.poster_path ? IMG + x.poster_path : null,
  }));
}

// Traduction gratuite (MyMemory). En cas d'échec on garde le texte d'origine.
async function traduire(texte: string, vers: string) {
  if (!texte || vers === "fr") return texte;
  try {
    const d = await (await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(texte)}&langpair=fr|${vers}`)).json();
    const t = String(d?.responseData?.translatedText || "").trim();
    return t && !/MYMEMORY WARNING|INVALID/i.test(t) ? t : texte;
  } catch { return texte; }
}

// Livres dans une langue donnée : Google Livres (sans clé), puis Open Library si Google ne répond pas
const NAV = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
async function googleLivres(term: string, langue: string) {
  let liste: any[] = [];
  try {
    const r = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(term)}&langRestrict=${langue}&printType=books&maxResults=25`);
    const d = await r.json();
    console.log("google livres", langue, r.status, (d.items || []).length, d.error?.message || "");
    liste = (d.items || []).map((x: any) => x.volumeInfo).filter((v: any) => v?.title && (!v.language || v.language === langue)).map((v: any) => ({
      id: v.title, titre: v.title, auteur: (v.authors || []).join(", "), annee: String(v.publishedDate || "").slice(0, 4),
      affiche: String(v.imageLinks?.thumbnail || "").replace("http://", "https://") || null,
    }));
  } catch (e) { console.log("google livres erreur", String(e)); }
  if (liste.length) return liste;
  try {
    const code = ({ ar: "ara", en: "eng", fr: "fre" } as Record<string, string>)[langue] || langue;
    const champs = "title,author_name,first_publish_year,cover_i";
    const lire = async (q: string) => {
      const r = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&language=${code}&limit=30&fields=${champs}`, { headers: { "User-Agent": "LeGlaneur/1.0 (appli personnelle)" } });
      const d = await r.json();
      console.log("open library", code, r.status, (d.docs || []).length);
      return d.docs || [];
    };
    let docs = await lire(term);
    // Rien sur ce terme : on prend au moins des livres dans cette langue
    if (!docs.length) docs = await lire(`language:${code}`);
    const dansLaLangue = (t: string) => langue !== "ar" || /[\u0600-\u06FF]/.test(t);
    liste = docs.filter((x: any) => x.title && dansLaLangue(x.title)).map((x: any) => ({
      id: x.title, titre: x.title, auteur: (x.author_name || []).slice(0, 2).join(", "), annee: String(x.first_publish_year || ""),
      affiche: x.cover_i ? `https://covers.openlibrary.org/b/id/${x.cover_i}-L.jpg` : null,
    }));
  } catch (e) { console.log("open library erreur", String(e)); }
  return liste;
}

// Sujet libre -> mots-clés TMDB. Ils sont en anglais, donc on traduit d'abord le sujet.
async function motsClesTmdb(sujet: string) {
  let en = "";
  try {
    en = await traduire(sujet, "en");
  } catch { /* on fera sans traduction */ }
  const termes = [...new Set([en, sujet, ...en.split(/\s+/).filter((w) => w.length > 3)].map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 5);
  const res = await Promise.all(termes.map((t) => tmdbFetch("/search/keyword", { query: t })));
  return [...new Set(res.flatMap((d: any) => (d.results || []).slice(0, 4).map((k: any) => k.id)))].slice(0, 12).join("|");
}

async function providers(kind: "movie" | "tv", id: number) {
  const fr = (await tmdbFetch(`/${kind}/${id}/watch/providers`, {}))?.results?.FR;
  if (!fr) return { plateformes: [] as string[], ou: null };
  const names = [...new Set([...(fr.flatrate || []), ...(fr.ads || [])].map((p: any) => nomPlateforme(p.provider_name || "")).filter(Boolean))] as string[];
  return { plateformes: names, ou: fr.link || null };
}

// Liens : Netflix en direct (recherche du titre), et la fiche « où regarder » qui mène à chaque plateforme
function liensEcran(titre: string, plateformes: string[], ou: string | null) {
  const liens: { t: string; u: string }[] = [];
  if (plateformes.includes("Netflix")) liens.push({ t: "Netflix", u: "https://www.netflix.com/search?q=" + encodeURIComponent(titre) });
  if (ou) liens.push({ t: "Où regarder", u: ou });
  return liens;
}

// Liens d'écoute : Spotify, YouTube, et un troisième selon le cas
function liensEcoute(titre: string, auteur: string, type: "podcast" | "audio", autre?: { t: string; u: string }) {
  const q = encodeURIComponent(titre);
  const liens = [
    { t: "Spotify", u: `https://open.spotify.com/search/${q}/${type === "podcast" ? "shows" : "audiobooks"}` },
    { t: "YouTube", u: "https://www.youtube.com/results?search_query=" + encodeURIComponent(`${titre} ${auteur} ${type === "podcast" ? "podcast" : "livre audio"}`.replace(/\s+/g, " ")) },
  ];
  if (autre?.u) liens.push(autre);
  return liens;
}

async function livresAudio(term: string) {
  try {
    const r = await fetch(`https://itunes.apple.com/search?media=audiobook&country=FR&lang=fr_fr&limit=20&term=${encodeURIComponent(term)}`);
    return ((await r.json()).results || []).map((p: any) => ({
      id: p.collectionId, titre: p.collectionName, auteur: p.artistName,
      affiche: (p.artworkUrl100 || "").replace("100x100", "600x600") || null, apple: p.collectionViewUrl,
    }));
  } catch { return []; }
}
const AUDIO: Record<string, string> = { rire: "humour", frissons: "thriller", evasion: "aventure", emotion: "roman", curieux: "histoire", cocon: "roman feel good", adrenaline: "polar" };

async function podcasts(term: string, pays = "FR") {
  try {
    const r = await fetch(`https://itunes.apple.com/search?media=podcast&country=${pays}&limit=15&term=${encodeURIComponent(term)}`);
    return ((await r.json()).results || []).map((p: any) => ({
      id: p.collectionId, titre: p.collectionName, auteur: p.artistName,
      affiche: p.artworkUrl600 || p.artworkUrl100, apple: p.collectionViewUrl,
    }));
  } catch { return []; }
}

async function livres(term: string, langue = "fr") {
  try {
    const r = await fetch(`https://gutendex.com/books/?languages=${langue}${term ? "&search=" + encodeURIComponent(term) : ""}`);
    return ((await r.json()).results || []).slice(0, 20).map((b: any) => ({
      id: b.id, titre: b.title, auteur: b.authors?.[0]?.name || "",
      affiche: b.formats?.["image/jpeg"] || null, lien: `https://www.gutenberg.org/ebooks/${b.id}`,
    }));
  } catch { return []; }
}

// Livres du commerce (récents ou non), cherchés dans le catalogue français
async function livresRecents(term: string) {
  try {
    const r = await fetch(`https://itunes.apple.com/search?media=ebook&country=FR&lang=fr_fr&limit=25&term=${encodeURIComponent(term)}`);
    return ((await r.json()).results || []).filter((b: any) => b.trackName && b.artistName).map((b: any) => ({
      id: b.trackId, titre: b.trackName, auteur: b.artistName, annee: (b.releaseDate || "").slice(0, 4),
      affiche: (b.artworkUrl100 || "").replace("100x100", "600x600") || null,
    }));
  } catch { return []; }
}

// Goodreads : une étagère publique, lue par le widget d'étagère (les flux RSS ont été supprimés fin octobre 2026).
// Le widget renvoie les 100 livres les plus récents de l'étagère.
const simple = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\(.*?\)/g, "").replace(/[^a-z0-9\u0600-\u06FF]+/g, " ").trim();
let statutGoodreads = 0;
async function etagere(id: string, nom: string) {
  try {
    const u = new URL(`https://www.goodreads.com/review/custom_widget/${id}`);
    u.searchParams.set("shelf", nom);
    u.searchParams.set("num_books", "100");
    u.searchParams.set("sort", "date_added");
    u.searchParams.set("order", "d");
    // Goodreads garde en cache par widget_id : on en change à chaque fois pour avoir la liste du moment
    u.searchParams.set("widget_id", `${nom}-${Date.now()}`);
    const r = await fetch(u, { headers: { "User-Agent": NAV, "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8" } });
    statutGoodreads = r.status;
    const script = await r.text();
    const brut = script.match(/var widget_code = '([\s\S]*?)'\n/)?.[1];
    const html = brut ? brut.replace(/\\n/g, "\n").replace(/\\(.)/g, "$1") : "";
    if (r.ok && !brut) statutGoodreads = -1; // réponse reçue, mais pas le contenu attendu
    const livres = html.split(/class="gr_custom_each_container/).slice(1).map((bloc) => {
      const lien = bloc.match(/gr_custom_book_container[^>]*>\s*(<a[^>]*>)/)?.[1] || "";
      const couverture = bloc.match(/<img[^>]*src="([^"]+)"/)?.[1] || "";
      return {
        id: couverture.match(/\/(\d+)(?:\._[^/]*)?\.\w+$/)?.[1] || "",
        titre: propre((lien.match(/title="([^"]*)"/)?.[1] || "").trim()),
        auteur: propre((bloc.match(/gr_custom_author[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/)?.[1] || "").trim()),
        affiche: couverture ? couverture.replace(/\._S[XY]\d+_/i, "") : null, annee: "",
      };
    }).filter((b) => b.titre);
    console.log("goodreads", nom, r.status, script.length, livres.length);
    return livres;
  } catch (e) { statutGoodreads = -2; console.log("goodreads erreur", String(e)); return []; }
}

// Vraies vidéos YouTube : API officielle si la clé gratuite YOUTUBE_API_KEY existe, sinon lecture de la page de recherche
const secondes = (t: string) => t.split(":").reduce((a, n) => a * 60 + Number(n), 0);
const propre = (t: string) => t.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
async function videosYoutube(rech: string, maxMinutes: number, langue = "fr", pays = "FR") {
  const key = Deno.env.get("YOUTUBE_API_KEY");
  try {
    if (key) {
      const u = new URL("https://www.googleapis.com/youtube/v3/search");
      const p: Record<string, string> = { part: "snippet", type: "video", maxResults: "20", q: rech, relevanceLanguage: langue, regionCode: pays,
        videoDuration: maxMinutes <= 30 ? "medium" : "any", key };
      for (const [k, v] of Object.entries(p)) u.searchParams.set(k, v);
      const d = await (await fetch(u)).json();
      return (d.items || []).filter((x: any) => x.id?.videoId).map((x: any) => ({
        id: x.id.videoId, titre: propre(x.snippet.title), auteur: propre(x.snippet.channelTitle),
        chaine: "https://www.youtube.com/channel/" + x.snippet.channelId,
      }));
    }
    const r = await fetch(`https://www.youtube.com/results?hl=${langue}&gl=${pays}&search_query=` + encodeURIComponent(rech), {
      headers: { "User-Agent": NAV,
        "Accept-Language": langue === "fr" ? "fr-FR,fr;q=0.9" : `${langue},fr;q=0.5`, Cookie: "SOCS=CAI; CONSENT=YES+1" },
    });
    const m = (await r.text()).match(/var ytInitialData = (\{.*?\});<\/script>/s);
    if (!m) return [];
    const vids: any[] = [];
    const fouille = (o: any) => {
      if (!o || typeof o !== "object") return;
      if (o.videoRenderer?.videoId) vids.push(o.videoRenderer);
      for (const k in o) fouille(o[k]);
    };
    fouille(JSON.parse(m[1]));
    return vids.map((v) => {
      const proprio = v.ownerText?.runs?.[0] || v.longBylineText?.runs?.[0];
      const base = proprio?.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl;
      return { id: v.videoId, titre: v.title?.runs?.[0]?.text || "", auteur: proprio?.text || "",
        duree: v.lengthText?.simpleText || "", chaine: base ? "https://www.youtube.com" + base : null };
    }).filter((v) => v.titre && v.duree && secondes(v.duree) >= 180 && secondes(v.duree) <= Math.max(maxMinutes, 20) * 60);
  } catch { return []; }
}

const hasard = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST" && req.method !== "GET") return json({ error: "method" }, 405);
  if (!Deno.env.get("TMDB_API_KEY")) return json({ error: "config", missing: ["TMDB_API_KEY"] });

  let body: any = {};
  if (req.method === "GET") {
    // Même demande, passée dans l'adresse (pratique pour vérifier) : ?humeur=rire&categories=film,serie
    const q = new URL(req.url).searchParams;
    body = Object.fromEntries(q);
    if (q.get("categories")) body.categories = q.get("categories")!.split(",");
  } else {
    try { body = await req.json(); } catch { /* vide */ }
  }

  const mood = MOODS[body.humeur] || MOODS.cocon;
  const minutes = Number(body.temps) || 120;
  const cats: string[] = Array.isArray(body.categories) && body.categories.length
    ? body.categories : ["film", "serie", "docu", "podcast", "audio", "livre", "youtube", "musique"];
  const envie = String(body.envie || "").trim().slice(0, 100);
  const gouts = String(body.gouts || "").split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
  const deja = new Set((Array.isArray(body.deja) ? body.deja : []).map(String));
  const famille = String(body.avec || "").includes("famille");

  // Langue du contenu : "" (toutes), fr, ar ou en
  const langue = ["fr", "ar", "en"].includes(body.langue) ? String(body.langue) : "";
  const L = langue || "fr";
  const autre = L !== "fr";
  const pays = ({ fr: "FR", ar: "EG", en: "US" } as Record<string, string>)[L];
  const nomLangue = ({ fr: "français", ar: "arabe", en: "anglais" } as Record<string, string>)[L];
  const SUJET_YT: Record<string, string> = { rire: "sketch humour", frissons: "histoires mystérieuses", evasion: "documentaire voyage", emotion: "histoire émouvante",
    curieux: "documentaire science", cocon: "documentaire nature", adrenaline: "sports extrêmes" };
  const cleHumeur = MOODS[body.humeur] ? String(body.humeur) : "cocon";

  const theme = envie || (gouts.length && !autre ? hasard(gouts) : "");
  const goodreads = (String(body.goodreads || "").match(/\d{3,}/) || [""])[0];

  // Vérification demandée depuis les réglages : est-ce que Goodreads répond, et avec combien de livres ?
  if (body.test === "goodreads") {
    if (!goodreads) return json({ ok: false, raison: "lien" });
    const [aLire, lus] = await Promise.all([etagere(goodreads, "to-read"), etagere(goodreads, "read")]);
    return json({ ok: aLire.length + lus.length > 0, aLire: aLire.length, lus: lus.length, statut: statutGoodreads, exemples: aLire.slice(0, 3).map((b) => b.titre) });
  }

  // Choix : on écarte le déjà proposé, on garde les mieux notés, puis on tire au sort
  const choisir = (arr: any[]) => {
    let pool = arr.filter((x) => !deja.has(x.titre));
    if (!pool.length) pool = arr;
    if (pool[0]?.note !== undefined) pool = [...pool].sort((a, b) => b.note - a.note).slice(0, 8);
    const pick = hasard(pool);
    const reste = pool.filter((x) => x !== pick);
    return { pick, planB: reste.length ? hasard(reste) : null };
  };

  // Films, séries, docus : si un sujet est décrit, on cherche d'abord dessus, sinon selon l'envie
  const mc = envie && cats.some((c) => ["film", "serie", "docu"].includes(c)) ? await motsClesTmdb(envie) : "";
  const trouver = async (kind: "movie" | "tv", genres: string, max?: number, docu = false) => {
    if (mc) {
      const liste = await discover(kind, docu ? genres : "", max, mc, langue);
      if (liste.length) return { liste, sujet: true };
    }
    const liste = await discover(kind, genres, max, "", langue);
    // Dans une langue précise le choix est plus mince : on élargit à tous les genres plutôt que de ne rien proposer
    return { liste: liste.length || !langue || docu ? liste : await discover(kind, "", max, "", langue), sujet: false };
  };
  const rien = { liste: [] as any[], sujet: false };

  // Livres : sujet décrit > liste « à lire » Goodreads (le livre lui-même, ou du même auteur) > livre du commerce > classique gratuit
  const proposerLivre = async () => {
    const liensLivre = (titre: string, auteur: string, fiche?: string) => {
      const q = encodeURIComponent(`${titre} ${auteur}`.trim());
      return [
        { t: "Voir sur Goodreads", u: fiche || "https://www.goodreads.com/search?q=" + q },
        { t: "Babelio", u: "https://www.babelio.com/recherche.php?Recherche=" + encodeURIComponent(titre) },
        { t: "En audio sur Spotify", u: `https://open.spotify.com/search/${q}/audiobooks` },
      ];
    };
    const [aLire, lus] = goodreads ? await Promise.all([etagere(goodreads, "to-read"), etagere(goodreads, "read")]) : [[], []];
    const connus = new Set([...aLire, ...lus].map((b) => simple(b.titre)));
    const neuf = (arr: any[]) => arr.filter((b) => !connus.has(simple(b.titre)));
    const carte = (p: any, pourquoi: string, label = "Livre", fiche?: string) =>
      ({ type: "livre", label, ...p, pourquoi, plateformes: [], liens: liensLivre(p.titre, p.auteur || "", fiche) });

    // En arabe : une fois sur deux, un livre arabe de ta liste « à lire » s'il y en a
    const arabes = L === "ar" ? aLire.filter((b) => /[\u0600-\u06FF]/.test(b.titre)) : [];
    if (!envie && arabes.length && Math.random() < 0.5) {
      const p = choisir(arabes).pick;
      return { ...carte(p, "Il attend dans ta liste « à lire » sur Goodreads.", "Dans ta liste à lire", (p.id ? "https://www.goodreads.com/book/show/" + p.id : undefined)), liens: liensLivre(p.titre, p.auteur || "", (p.id ? "https://www.goodreads.com/book/show/" + p.id : undefined)).filter((x) => x.t !== "Babelio") };
    }
    if (autre) {
      const l = neuf(await googleLivres(await traduire(envie || AUDIO[cleHumeur], L), L));
      if (!l.length) return null;
      const p = choisir(l).pick;
      return { ...carte(p, envie ? `En ${nomLangue}, en lien avec ton sujet : ${envie}.` : `Une lecture en ${nomLangue}.`), liens: liensLivre(p.titre, p.auteur || "").filter((x) => x.t !== "Babelio") };
    }
    if (envie) {
      const l = neuf(await livresRecents(envie));
      if (l.length) return carte(choisir(l).pick, `En lien avec ton sujet : ${envie}.`);
    }
    const tirage = Math.random();
    if (!envie && aLire.length && tirage < 0.4) {
      const p = choisir(aLire).pick;
      return carte(p, "Il attend dans ta liste « à lire » sur Goodreads.", "Dans ta liste à lire", (p.id ? "https://www.goodreads.com/book/show/" + p.id : undefined));
    }
    if (!envie && aLire.length && tirage < 0.8) {
      const source = hasard(aLire.filter((b) => b.auteur));
      const l = source ? neuf(await livresRecents(source.auteur)).filter((b) => simple(b.auteur).includes(simple(source.auteur).split(" ").pop() || "")) : [];
      if (l.length) return carte(choisir(l).pick, `Dans l'esprit de ta liste à lire : du même auteur que « ${source.titre} ».`);
    }
    if (Math.random() < 0.2) {
      const c = await livres(envie.split(" ")[0] || "");
      if (c.length) return { type: "livre", label: "Classique gratuit", ...choisir(c).pick,
        pourquoi: "Un classique libre de droits, à lire gratuitement sur liseuse ou téléphone.", plateformes: ["Projet Gutenberg"] };
    }
    const l = neuf(await livresRecents(theme || AUDIO[body.humeur] || "roman"));
    return l.length ? carte(choisir(l).pick, "Une lecture raccord avec ton envie du moment.") : null;
  };

  const [films, series, docus, pods, audios, livre] = await Promise.all([
    cats.includes("film") ? trouver("movie", famille ? "10751|16" : mood.movie, minutes) : rien,
    cats.includes("serie") ? trouver("tv", famille ? "10751|16" : mood.tv) : rien,
    cats.includes("docu") ? trouver("movie", "99", minutes, true) : rien,
    cats.includes("podcast") ? (async () => podcasts(await traduire(theme || mood.pod, L), pays))() : [],
    cats.includes("audio") ? (async () => autre ? googleLivres(await traduire(envie || AUDIO[cleHumeur], L), L) : livresAudio(theme || AUDIO[cleHumeur]))() : [],
    cats.includes("livre") ? proposerLivre() : null,
  ]);

  const duree = minutes >= 300 ? "" : ` Tient dans tes ${minutes >= 60 ? Math.floor(minutes / 60) + " h" + (minutes % 60 ? " " + (minutes % 60) : "") : minutes + " min"}.`;

  const out: any[] = [];
  const ecran = async (key: string, res: { liste: any[]; sujet: boolean }, kind: "movie" | "tv", label: string, phrase: string) => {
    const arr = res.liste;
    if (!arr.length) return;
    if (res.sujet) phrase = `En lien avec ton sujet : ${envie}.`;
    const { pick, planB } = choisir(arr);
    const prov = await providers(kind, pick.id);
    const note = pick.note ? ` Noté ${pick.note.toFixed(1)}/10.` : "";
    out.push({ type: key, label, ...pick, plateformes: prov.plateformes, liens: liensEcran(pick.titre, prov.plateformes, prov.ou),
      pourquoi: phrase + note + (kind === "movie" ? duree : ""),
      planB: planB ? { titre: planB.titre, annee: planB.annee } : null });
  };
  await Promise.all([
    ecran("film", films, "movie", "Film", mood.phrase),
    ecran("serie", series, "tv", "Série", mood.phrase + " Un épisode ou dix, à toi de voir."),
    ecran("docu", docus, "movie", "Documentaire", "Un docu pour nourrir ta curiosité."),
  ]);

  if (pods.length) {
    const { pick } = choisir(pods);
    const { apple, ...p } = pick;
    out.push({ type: "podcast", label: "Podcast", ...p, pourquoi: envie ? `En lien avec ton sujet : ${envie}.` : "À écouter en voiture ou en cuisinant.",
      plateformes: ["Spotify", "YouTube", "Apple Podcasts"], liens: liensEcoute(p.titre, p.auteur || "", "podcast", { t: "Apple Podcasts", u: apple }) });
  }
  if (audios.length) {
    const { apple, ...p } = choisir(audios).pick as any;
    out.push({ type: "audio", label: "Livre audio", ...p, pourquoi: envie ? `En lien avec ton sujet : ${envie}.` : "Une histoire à écouter, en voiture ou les yeux fermés.",
      plateformes: autre ? ["Spotify", "YouTube"] : ["Spotify"], liens: liensEcoute(`${p.titre} ${p.auteur || ""}`.trim(), "", "audio").slice(0, autre ? 2 : 1) });
  }
  if (livre) out.push(livre);
  if (cats.includes("youtube")) {
    const libres = mood.yt.filter(([c]) => !deja.has(c));
    let [chaine, rech] = envie ? [envie, envie] : hasard(libres.length ? libres : mood.yt);
    if (autre) { rech = await traduire(envie || SUJET_YT[cleHumeur], L); chaine = rech; }
    const recherche = "https://www.youtube.com/results?search_query=" + encodeURIComponent(rech);
    // Le plus souvent une vidéo précise, parfois une chaîne à explorer
    const vids = envie || autre || Math.random() < 0.75 ? (await videosYoutube(rech, minutes, L, pays)).slice(0, 12) : [];
    if (vids.length) {
      const v = choisir(vids).pick;
      const liens = [{ t: "Regarder", u: "https://www.youtube.com/watch?v=" + v.id }];
      if (v.chaine) liens.push({ t: "La chaîne", u: v.chaine });
      out.push({ type: "youtube", label: "Vidéo YouTube", titre: v.titre, auteur: [v.auteur, v.duree].filter(Boolean).join(" · "),
        affiche: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`, pourquoi: envie ? `En lien avec ton sujet : ${envie}.` : mood.phrase,
        liens, plateformes: ["YouTube"] });
    } else {
      out.push({ type: "youtube", label: envie || autre ? "YouTube" : "Chaîne YouTube", titre: chaine, auteur: envie ? "Recherche sur ton sujet" : autre ? `Vidéos en ${nomLangue}` : "Chaîne à explorer",
        pourquoi: envie ? "Les meilleures vidéos sur ton sujet du moment." : mood.phrase,
        liens: [{ t: "Voir sur YouTube", u: recherche }], plateformes: ["YouTube"] });
    }
  }
  if (cats.includes("musique")) {
    const tirage = hasard(mood.zik);
    const prefixe = ({ fr: "", ar: "arabic ", en: "english " } as Record<string, string>)[L];
    const [titre, rech] = envie ? [`Ambiance : ${envie}`, prefixe + envie + " playlist"]
      : autre ? [`${tirage[0]}, en ${nomLangue}`, prefixe + tirage[1]] : tirage;
    const q = encodeURIComponent(rech);
    out.push({ type: "musique", label: "Musique", titre, auteur: "Ambiance " + mood.label, pourquoi: envie ? "Une ambiance sonore raccord avec ton sujet." : "Une ambiance sonore raccord avec ton humeur.",
      lien: "https://open.spotify.com/search/" + q, lien2: "https://www.youtube.com/results?search_query=" + q, plateformes: ["Spotify gratuit", "YouTube"] });
  }

  const order = ["film", "serie", "docu", "youtube", "podcast", "audio", "musique", "livre"];
  out.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  const accroches = [`Voilà pour toi, spécial ${mood.label}.`, `Mes idées pour une envie de ${mood.label}.`];
  console.log("glaneur", JSON.stringify({ langue: L, sujet: !!envie, cats, goodreads: goodreads ? statutGoodreads : "non renseigné", cartes: out.map((x) => x.type + ":" + x.label) }));
  return json({ accroche: hasard(accroches), resultats: out });
});
