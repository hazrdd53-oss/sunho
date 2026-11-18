// ID: ext_asurascans
// NAME: Asura Scans
// VERSION: 1.0.0
// TYPE: comic
// COLOR: #9333EA
// ICON: https://asurascans.com/favicon.ico
// REFERER: https://asurascans.com

var ASURA_BASE = "https://asurascans.com";
var ASURA_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  "Referer": "https://asurascans.com",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9"
};

// ---------------------------------------------------------------- helpers

async function asuraFetch(url) {
  try {
    var res = await fetch(url, { method: "GET", headers: ASURA_HEADERS });
    if (!res || (typeof res.ok === "boolean" && !res.ok)) return "";
    return await res.text();
  } catch (e) {
    return "";
  }
}

function safeFromCodePoint(n) {
  try { return String.fromCodePoint(n); } catch (e) { return ""; }
}

function decodeEntities(s) {
  return String(s == null ? "" : s)
    .replace(/&#x([0-9a-f]+);/gi, function (m, h) { return safeFromCodePoint(parseInt(h, 16)); })
    .replace(/&#(\d+);/g, function (m, d) { return safeFromCodePoint(parseInt(d, 10)); })
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&rsquo;|&lsquo;/g, "'")
    .replace(/&rdquo;|&ldquo;/g, '"')
    .replace(/&hellip;/g, "...")
    .replace(/&ndash;|&mdash;/g, "-")
    .replace(/&amp;/g, "&");
}

function decodeHtml(str) {
  var s = String(str == null ? "" : str)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]*>/g, " ");
  return decodeEntities(s).replace(/\s+/g, " ").trim();
}

// Un-escape JSON-in-script payloads (\" \/ \u0026 ...)
function unescapeJs(s) {
  return String(s == null ? "" : s)
    .replace(/\\u([0-9a-fA-F]{4})/g, function (m, h) { return String.fromCharCode(parseInt(h, 16)); })
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function absUrl(u) {
  if (!u) return "";
  u = decodeEntities(String(u)).trim();
  if (!u || /^(data|javascript|blob):/i.test(u)) return "";
  if (/^https?:\/\//i.test(u)) return u;
  if (u.indexOf("//") === 0) return "https:" + u;
  if (u.charAt(0) === "/") return ASURA_BASE + u;
  return ASURA_BASE + "/" + u.replace(/^\.\//, "");
}

function toSlug(href) {
  var h = decodeEntities(String(href || "")).trim();
  h = h.replace(/^https?:\/\/(?:www\.)?asurascans\.com/i, "");
  h = h.replace(/[?#].*$/, "").replace(/\/+$/, "");
  return h;
}

function getAttr(tag, name) {
  var re = new RegExp("\\s" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')", "i");
  var m = re.exec(tag);
  return m ? (m[1] !== undefined ? m[1] : m[2]) : "";
}

function bestFromSrcset(srcset) {
  if (!srcset) return "";
  var parts = String(srcset).split(/,\s+/);
  var best = "", bestVal = -1;
  for (var i = 0; i < parts.length; i++) {
    var seg = parts[i].trim().split(/\s+/);
    if (!seg[0]) continue;
    var val = seg[1] ? parseFloat(seg[1]) : 1;
    if (isNaN(val)) val = 1;
    if (val >= bestVal) { bestVal = val; best = seg[0]; }
  }
  return best;
}

// data-src -> data-lazy-src -> srcset (highest res) -> src
function imgUrl(tag) {
  var v = getAttr(tag, "data-src") || getAttr(tag, "data-lazy-src");
  if (!v) v = bestFromSrcset(getAttr(tag, "data-srcset") || getAttr(tag, "srcset"));
  if (!v) v = getAttr(tag, "src");
  return absUrl(v);
}

function getMeta(html, prop) {
  var re1 = new RegExp("<meta[^>]+(?:property|name)=[\"']" + prop + "[\"'][^>]*content=\"([^\"]*)\"", "i");
  var re2 = new RegExp("<meta[^>]+content=\"([^\"]*)\"[^>]*(?:property|name)=[\"']" + prop + "[\"']", "i");
  var m = re1.exec(html) || re2.exec(html);
  return m ? decodeEntities(m[1]).trim() : "";
}

function stripScripts(html) {
  return String(html || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
}

function cleanTitle(t) {
  t = decodeHtml(t);
  t = t.replace(/^(.+?)\s+\d{1,2}\.\d\s+\1$/, "$1");
  t = t.replace(/\s*Chapter\s*[\d.]+.*$/i, "");
  t = t.replace(/\s+\d{1,2}\.\d$/, "");
  t = t.replace(/^(.+?)\s+\1$/, "$1");
  return t.trim();
}

function titleFromSlug(slug) {
  var s = String(slug || "").split("/").pop().replace(/-[0-9a-f]{8}$/i, "").replace(/-/g, " ");
  return s.replace(/\b\w/g, function (c) { return c.toUpperCase(); }).trim();
}

function unwrapProp(v) {
  // Astro island props encode values as [type, value]
  if (Array.isArray(v) && v.length === 2 && typeof v[0] === "number") return v[1];
  return v;
}

// ---------------------------------------------------------- list parsing

function parseListFromHtml(html) {
  var map = {}, order = [];
  var re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi, m;
  while ((m = re.exec(html))) {
    var attrs = m[1], inner = m[2];
    var href = getAttr("<a " + attrs, "href");
    if (!href) continue;
    if (!/^(?:https?:\/\/(?:www\.)?asurascans\.com)?\/comics\/[^\/?#]+\/?(?:[?#].*)?$/i.test(decodeEntities(href))) continue;
    var slug = toSlug(href);
    if (!slug || slug === "/comics") continue;

    var cover = "", alt = "";
    var im = /<img\b[^>]*>/i.exec(inner);
    if (im) { cover = imgUrl(im[0]); alt = decodeHtml(getAttr(im[0], "alt")); }
    var hm = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(inner);
    var title = alt || decodeHtml(getAttr("<a " + attrs, "title")) || (hm ? cleanTitle(hm[1]) : "") || cleanTitle(inner);

    if (!map[slug]) { map[slug] = { slug: slug, title: "", cover: "" }; order.push(slug); }
    if (title && !map[slug].title) map[slug].title = title;
    if (cover && !map[slug].cover) map[slug].cover = cover;
  }
  var out = [];
  for (var i = 0; i < order.length; i++) {
    var it = map[order[i]];
    if (!it.title) it.title = titleFromSlug(it.slug);
    out.push(it);
  }
  return out;
}

function parseListFromJson(html) {
  var txt = unescapeJs(decodeEntities(html));
  var out = [], seen = {};
  var re = /\{[^{}]*"(?:slug|public_url|url)"\s*:\s*[^{}]*\}/g, m;
  while ((m = re.exec(txt))) {
    var obj;
    try { obj = JSON.parse(m[0]); } catch (e) { continue; }
    var slugRaw = unwrapProp(obj.slug) || unwrapProp(obj.public_url) || unwrapProp(obj.url);
    if (typeof slugRaw !== "string" || /\/chapter\//i.test(slugRaw)) continue;
    var slug = slugRaw.indexOf("/comics/") >= 0 ? toSlug(slugRaw) : "/comics/" + slugRaw.replace(/^\/+/, "");
    var title = unwrapProp(obj.title) || unwrapProp(obj.name);
    if (typeof title !== "string" || !title || seen[slug]) continue;
    var cov = unwrapProp(obj.cover) || unwrapProp(obj.cover_url) || unwrapProp(obj.thumbnail) ||
      unwrapProp(obj.poster) || unwrapProp(obj.image) || "";
    seen[slug] = 1;
    out.push({ slug: slug, title: decodeHtml(title), cover: typeof cov === "string" ? absUrl(cov) : "" });
  }
  return out;
}

function parseList(html) {
  if (!html) return [];
  var list = parseListFromHtml(html);
  if (list.length === 0) list = parseListFromJson(html);
  return list;
}

function dedupeBySlug(list) {
  var seen = {}, out = [];
  for (var i = 0; i < list.length; i++) {
    var it = list[i];
    if (!it || !it.slug || seen[it.slug]) continue;
    seen[it.slug] = 1;
    out.push(it);
  }
  return out;
}

function buildBrowseUrl(page, queryKey, query, filters) {
  var params = ["page=" + (page || 1)];
  if (query) params.push(queryKey + "=" + encodeURIComponent(query));
  if (filters && typeof filters === "object") {
    var keys = ["genres", "status", "type", "order", "sort"];
    for (var i = 0; i < keys.length; i++) {
      var v = filters[keys[i]];
      if (v === undefined || v === null || v === "") continue;
      if (Array.isArray(v)) v = v.join(",");
      params.push(keys[i] + "=" + encodeURIComponent(v));
    }
  }
  return ASURA_BASE + "/browse?" + params.join("&");
}

// -------------------------------------------------------- detail parsing

function labelValue(html, labels) {
  var re = new RegExp("(?:>|^)\\s*(?:" + labels + ")s?\\s*:?\\s*<\\/[^>]*>[\\s\\S]{0,250}?>\\s*([^<>]{2,80}?)\\s*<", "i");
  var m = re.exec(html);
  return m ? decodeHtml(m[1]) : "";
}

function extractChapters(html, slug) {
  var chapters = [], seen = {};
  var dateRe = /\s*(\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago|last\s+(?:week|month|year)|yesterday|today|just now|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\s*$/i;

  var re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi, m;
  while ((m = re.exec(html))) {
    var href = decodeEntities(getAttr("<a " + m[1], "href"));
    var cm = /\/comics\/([^\/?#]+)\/chapter\/([^\/?#]+)/i.exec(href);
    if (!cm) continue;
    var id = "/comics/" + cm[1] + "/chapter/" + cm[2];
    if (seen[id]) continue;
    var text = decodeHtml(m[2]);
    var date = "";
    var tm = /<time[^>]*datetime="([^"]+)"/i.exec(m[2]);
    var dm = dateRe.exec(text);
    if (dm) { date = dm[1]; text = text.replace(dateRe, "").trim(); }
    else if (tm) date = tm[1];
    if (!text) text = "Chapter " + cm[2].replace(/-/g, ".");
    seen[id] = 1;
    chapters.push({ id: id, title: text, date: date });
  }

  // Fallback: chapter URLs that only exist inside script payloads
  var txt = unescapeJs(decodeEntities(html));
  var re2 = /\/comics\/([a-z0-9][a-z0-9_-]*)\/chapter\/([A-Za-z0-9._-]+)/g, m2;
  while ((m2 = re2.exec(txt))) {
    var id2 = "/comics/" + m2[1] + "/chapter/" + m2[2];
    if (seen[id2]) continue;
    if (slug && id2.indexOf(slug + "/chapter/") !== 0) continue;
    seen[id2] = 1;
    chapters.push({ id: id2, title: "Chapter " + m2[2].replace(/-/g, "."), date: "" });
  }
  return chapters;
}

function chapterNumber(ch) {
  var m = /\/chapter\/([^\/?#]+)/i.exec(ch.id);
  var seg = m ? m[1].replace(/^chapter-?/i, "") : "";
  if (/^\d+-\d+$/.test(seg)) seg = seg.replace("-", ".");
  var n = /^\d+(?:\.\d+)?$/.test(seg) ? parseFloat(seg) : NaN;
  if (isNaN(n)) {
    var t = /(\d+(?:\.\d+)?)/.exec(ch.title);
    if (t) n = parseFloat(t[1]);
    else if (/prolog|prelude/i.test(ch.title)) n = -1;
    else n = Number.MAX_SAFE_INTEGER;
  }
  return n;
}

function sortChaptersAsc(chapters) {
  var arr = chapters.map(function (c, i) { return { c: c, n: chapterNumber(c), i: i }; });
  arr.sort(function (a, b) { return a.n !== b.n ? a.n - b.n : a.i - b.i; });
  return arr.map(function (x) { return x.c; });
}

// ------------------------------------------------------- image filtering

function isJunkImage(u) {
  var l = String(u).toLowerCase();
  var bad = ["logo", "icon", "avatar", "banner", "discord", "donate", "thumbnail", "/covers/", "default-pp", "toraka"];
  for (var i = 0; i < bad.length; i++) if (l.indexOf(bad[i]) >= 0) return true;
  return /\.(svg|gif)(\?|#|$)/.test(l);
}

// ------------------------------------------------------------- extension

var KonmikExtension = {
  async getList(page, query, filters) {
    try {
      page = parseInt(page, 10) || 1;
      query = (query || "").trim();
      var list = [];

      if (query) {
        var keys = ["search", "q", "query"];
        for (var i = 0; i < keys.length && list.length === 0; i++) {
          list = parseList(await asuraFetch(buildBrowseUrl(page, keys[i], query, filters)));
        }
        if (list.length === 0) {
          // Fallback: client-side filtering of the first browse pages
          var q = query.toLowerCase(), all = [];
          for (var p = 1; p <= 3; p++) {
            all = all.concat(parseList(await asuraFetch(buildBrowseUrl(p, "", "", filters))));
          }
          list = all.filter(function (it) { return it.title.toLowerCase().indexOf(q) >= 0; });
        }
      } else {
        list = parseList(await asuraFetch(buildBrowseUrl(page, "", "", filters)));
        if (list.length === 0 && page === 1) list = parseList(await asuraFetch(ASURA_BASE + "/"));
      }
      return dedupeBySlug(list);
    } catch (e) {
      return [];
    }
  },

  async getDetail(slug) {
    var empty = { title: "", cover: "", author: "", status: "Ongoing", genres: [], synopsis: "", chapters: [] };
    try {
      var path = toSlug(slug);
      var html = await asuraFetch(absUrl(path));
      if (!html) return empty;
      var clean = stripScripts(html);
      var text = decodeHtml(clean);
      var json = unescapeJs(decodeEntities(html));

      // Title
      var title = "";
      var h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(clean);
      if (h1) title = decodeHtml(h1[1]);
      if (!title) title = getMeta(html, "og:title").replace(/\s*[-|]\s*Asura Scans.*$/i, "");
      if (!title) title = titleFromSlug(path);

      // Cover
      var cover = absUrl(getMeta(html, "og:image"));
      if (!cover) {
        var cm = /<img\b[^>]*\/covers\/[^>]*>/i.exec(clean);
        if (cm) cover = imgUrl(cm[0]);
      }

      // Author
      var author = labelValue(clean, "Author|Studio|Artist|Creator");
      if (!author) {
        var am = /"(?:author|studio)"\s*:\s*"([^"]{2,80})"/i.exec(json);
        if (am) author = decodeHtml(am[1]);
      }

      // Status
      var status = "Ongoing";
      var sm = /Status\s*[:\-]?\s*(Ongoing|Completed|Hiatus|Dropped|Cancelled|Season End|Coming Soon)/i.exec(text) ||
        /\b(Ongoing|Completed|Hiatus|Dropped|Cancelled|Season End)\b/i.exec(text);
      if (sm) status = sm[1].charAt(0).toUpperCase() + sm[1].slice(1).toLowerCase();

      // Genres
      var genres = [], gseen = {}, gre = /<a\b[^>]*href="[^"]*[?&]genres=[^"]*"[^>]*>([\s\S]*?)<\/a>/gi, gm;
      while ((gm = gre.exec(clean))) {
        var g = decodeHtml(gm[1]).replace(/,$/, "").trim();
        if (g && !gseen[g.toLowerCase()]) { gseen[g.toLowerCase()] = 1; genres.push(g); }
      }

      // Synopsis
      var synopsis = "";
      var sy = /<(?:div|p|section)[^>]*(?:id|class)="[^"]*(?:synopsis|description)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|p|section)>/i.exec(clean);
      if (sy) synopsis = decodeHtml(sy[1]);
      if (!synopsis) {
        var sy2 = />\s*Synopsis\s*<\/[^>]+>([\s\S]{0,3000}?)<\/(?:div|section)>/i.exec(clean);
        if (sy2) synopsis = decodeHtml(sy2[1]);
      }
      if (!synopsis) synopsis = decodeHtml(getMeta(html, "og:description") || getMeta(html, "description"));
      if (!synopsis) {
        var dm = /"(?:description|synopsis)"\s*:\s*"((?:[^"\\]|\\.)*)"/i.exec(json);
        if (dm) synopsis = decodeHtml(dm[1].replace(/\\n/g, " "));
      }

      var plainPath = path;
      var chapters = sortChaptersAsc(extractChapters(html, plainPath));

      return {
        title: title,
        cover: cover,
        author: author,
        status: status,
        genres: genres,
        synopsis: synopsis,
        chapters: chapters
      };
    } catch (e) {
      return empty;
    }
  },

  async getChapterImages(chapterId) {
    try {
      var html = await asuraFetch(absUrl(chapterId));
      if (!html) return [];
      var out = [], seen = {};
      var push = function (u) {
        u = absUrl(u);
        if (!u || seen[u] || isJunkImage(u)) return;
        seen[u] = 1;
        out.push(u);
      };

      // 1) Standard <img> tags
      var im, re = /<img\b[^>]*>/gi;
      while ((im = re.exec(html))) push(imgUrl(im[0]));

      // 2) Fallback: image URLs inside <script> JSON payloads
      if (out.length < 2) {
        var txt = unescapeJs(decodeEntities(html));
        var re2 = /https?:\/\/[^\s"'\\<>()]+?\.(?:webp|jpe?g|png|avif)(?:\?[^\s"'\\<>()]*)?/gi, m2;
        while ((m2 = re2.exec(txt))) push(m2[0]);
      }
      return out;
    } catch (e) {
      return [];
    }
  }
};
