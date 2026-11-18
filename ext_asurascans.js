// ID: asurascans
// NAME: Asura Scans
// TYPE: comic
// VERSION: 1.0.0
// COLOR: #7C3AED
// ICON: https://asurascans.com/favicon.ico
// REFERER: https://asurascans.com/

const BASE = "https://asurascans.com";

const HEADERS = {
  "Referer": BASE + "/",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
};

async function fetchHtml(url) {
  const response = await fetch(url, {
    method: "GET",
    headers: HEADERS
  });

  if (!response || !response.ok) {
    throw new Error("HTTP error: " + (response ? response.status : "unknown"));
  }

  return await response.text();
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCharCode(parseInt(n, 16))
    );
}

function absoluteUrl(url, base) {
  const value = decodeHtml(String(url || "").trim());

  if (!value || /^(data:|javascript:)/i.test(value)) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return "https:" + value;

  const root = base || BASE;

  if (value.startsWith("/")) return root + value;

  return root + "/" + value.replace(/^\.?\//, "");
}

function stripTags(value) {
  return decodeHtml(
    String(value || "")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function getAttr(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const match = tag.match(
    new RegExp(
      "\\b" + escaped + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))",
      "i"
    )
  );

  return match
    ? decodeHtml(match[1] || match[2] || match[3] || "")
    : "";
}

function uniqueBy(items, keyFn) {
  const seen = new Set();

  return items.filter(item => {
    const key = keyFn(item);

    if (!key || seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

function chapterNumber(text, url) {
  const source = String(text || "") + " " + String(url || "");

  const patterns = [
    /chapter(?:[-\s_]*)(\d+(?:\.\d+)?)/i,
    /\/chapter\/(\d+(?:\.\d+)?)(?:[/?#-]|$)/i,
    /(?:^|\D)(\d+(?:\.\d+)?)(?:\D|$)/
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) return Number(match[1]);
  }

  return Number.MAX_SAFE_INTEGER;
}

function parseComicCards(html) {
  const results = [];

  const regex =
    /<a\b[^>]*href\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>[\s\S]*?<\/a>/gi;

  let match;

  while ((match = regex.exec(html)) !== null) {
    const whole = match[0];

    const href = decodeHtml(
      match[1] || match[2] || match[3] || ""
    );

    if (!/\/comics\/[^"'?#]+/i.test(href)) continue;
    if (/\/chapter\//i.test(href)) continue;

    const imageMatch = whole.match(/<img\b[^>]*>/i);
    const imageTag = imageMatch ? imageMatch[0] : "";

    const image =
      getAttr(imageTag, "src") ||
      getAttr(imageTag, "data-src") ||
      getAttr(imageTag, "data-lazy-src");

    const alt = getAttr(imageTag, "alt");

    const title =
      (alt && !/^image$/i.test(alt) ? alt : stripTags(whole))
        .replace(/\s+/g, " ")
        .trim();

    if (!title || title.length < 2) continue;

    results.push({
      id: absoluteUrl(href),
      title: title,
      cover_url: absoluteUrl(image),
      rating: "-",
      views: "-"
    });
  }

  return uniqueBy(results, item => item.id);
}

function parseChapters(html, seriesUrl) {
  const chapters = [];

  const regex =
    /<a\b[^>]*href\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>[\s\S]*?<\/a>/gi;

  let match;

  while ((match = regex.exec(html)) !== null) {
    const whole = match[0];

    const href = decodeHtml(
      match[1] || match[2] || match[3] || ""
    );

    if (!/\/chapter\//i.test(href)) continue;

    const title =
      stripTags(whole) ||
      ("Chapter " + chapterNumber("", href));

    chapters.push({
      id: absoluteUrl(href, seriesUrl),
      title: title,
      number: chapterNumber(title, href),
      date: "-"
    });
  }

  const unique = uniqueBy(chapters, item => item.id);

  unique.sort((a, b) => {
    if (a.number !== b.number) {
      return a.number - b.number;
    }

    return a.title.localeCompare(
      b.title,
      undefined,
      { numeric: true }
    );
  });

  return unique.map(item => ({
    id: item.id,
    title: item.title,
    date: item.date
  }));
}

function parseImages(html, chapterUrl) {
  const images = [];

  const regex = /<img\b[^>]*>/gi;

  let match;

  while ((match = regex.exec(html)) !== null) {
    const tag = match[0];

    const src =
      getAttr(tag, "src") ||
      getAttr(tag, "data-src") ||
      getAttr(tag, "data-lazy-src") ||
      getAttr(tag, "data-original");

    if (!src) continue;

    const url = absoluteUrl(src, chapterUrl);

    if (!url) continue;

    if (/logo|avatar|icon|banner|profile/i.test(url)) {
      continue;
    }

    images.push(url);
  }

  const jsonRegex =
    /"(?:url|src|image|imageUrl)"\s*:\s*"(https?:\\?\/\\?\/[^"]+\.(?:jpg|jpeg|png|webp)(?:\?[^"]*)?)"/gi;

  while ((match = jsonRegex.exec(html)) !== null) {
    const url = match[1]
      .replace(/\\\//g, "/")
      .replace(/\\u0026/g, "&");

    if (/cdn\.asurascans\.com/i.test(url)) {
      images.push(url);
    }
  }

  return uniqueBy(images, url => url);
}

// MAIN EXTENSION

var KonmikExtension = {

  async getList(page, query, filters) {
    const pageNumber = Math.max(1, Number(page) || 1);

    let url = BASE + "/comics";

    if (query && String(query).trim()) {
      url =
        BASE +
        "/search?query=" +
        encodeURIComponent(String(query).trim()) +
        "&type=comics";
    } else if (pageNumber > 1) {
      url += "?page=" + pageNumber;
    }

    const html = await fetchHtml(url);

    let mangaList = parseComicCards(html);

    if (query && mangaList.length === 0) {
      const fallback = await fetchHtml(
        BASE +
        "/comics?search=" +
        encodeURIComponent(String(query).trim())
      );

      mangaList = parseComicCards(fallback);
    }

    return {
      manga_list: mangaList
    };
  },

  async getDetail(urlPath) {
    const seriesUrl = absoluteUrl(urlPath);

    if (
      !seriesUrl ||
      !/asurascans\.com\/comics\//i.test(seriesUrl)
    ) {
      throw new Error("URL komik Asura Scans tidak valid.");
    }

    const html = await fetchHtml(seriesUrl);

    const title =
      stripTags(
        (html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]
      ) ||
      "Unknown Title";

    const description = stripTags(
      (
        html.match(
          /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i
        ) || []
      )[1] || ""
    );

    const cover =
      (
        html.match(
          /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i
        ) || []
      )[1] || "";

    const genres = [];

    const genreRegex =
      /<a\b[^>]*href=["'][^"']*genre[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;

    let genreMatch;

    while (
      (genreMatch = genreRegex.exec(html)) !== null
    ) {
      const genre = stripTags(genreMatch[1]);

      if (genre) genres.push(genre);
    }

    const chapters = parseChapters(html, seriesUrl);

    return {
      title: title,
      cover_url: absoluteUrl(cover, seriesUrl),
      description: description || "Tidak ada deskripsi.",
      rating: "-",
      views: "-",
      genres: uniqueBy(
        genres,
        value => value.toLowerCase()
      ),
      author: "-",
      artist: "-",
      chapters: chapters
    };
  },

  async getChapterImages(chapterUrl) {
    const url = absoluteUrl(chapterUrl);

    if (
      !url ||
      !/asurascans\.com\/.*chapter\//i.test(url)
    ) {
      throw new Error("URL chapter tidak valid.");
    }

    const html = await fetchHtml(url);

    const images = parseImages(html, url);

    if (images.length === 0) {
      throw new Error(
        "Gambar chapter tidak ditemukan. Struktur halaman mungkin berubah."
      );
    }

    return images;
  }

};
