
import fs from "node:fs/promises";
import path from "node:path";

const OUTPUT_DIR = "./temp";
const CLASS_FILE = "./class_names.txt";

const USER_AGENT =
    "DoodleNetScienceDay/1.0 (educational image downloader)";

const REQUEST_DELAY_MS = 1500;
const MAX_RETRIES = 3;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchWithRetry(url, options = {}) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const response = await fetch(url, options);

        if (response.ok) {
            return response;
        }

        if (response.status === 429) {
            const retryAfter = response.headers.get("retry-after");

            let delay;

            if (retryAfter) {
                const seconds = Number(retryAfter);

                if (!Number.isNaN(seconds)) {
                    delay = seconds * 1000;
                } else {
                    const date = Date.parse(retryAfter);
                    delay = Math.max(0, date - Date.now());
                }
            }

            if (!delay) {
                delay = Math.min(
                    60000,
                    REQUEST_DELAY_MS * Math.pow(2, attempt)
                );
            }

            console.warn(
                `429 Too Many Requests. Waiting ${Math.ceil(delay / 1000)}s...`
            );

            await sleep(delay);
            continue;
        }

        throw new Error(`Request failed: ${response.status}`);
    }

    throw new Error("Too many 429 responses; giving up.");
}


/**
 * Words that usually indicate an image that is less useful
 * for a children's educational dataset.
 */
const BAD_WORDS = [
    "logo",
    "logos",
    "flag",
    "flags",
    "coat of arms",
    "heraldry",
    "painting",
    "paintings",
    "artwork",
    "art",
    "sculpture",
    "statue",
    "monument",
    "poster",
    "advertisement",
    "advertising",
    "icon",
    "icons",
    "symbol",
    "symbols",
    "map",
    "maps",
    "diagram of",
    "chart of",
    "screenshot",
    "computer",
    "website",
    "book cover",
    "album",
    "film",
    "movie",
    "game",
    "meme",
    "collage",
    "stamp",
    "coin",
    "seal",
    "historic",
    "historical",
    "old photo",
    "microscope",
    "electron microscope",
    "x-ray",
    "radiograph",
    "pathology",
    "dissection"
];


/**
 * Words that often indicate useful educational images.
 */
const GOOD_WORDS = [
    "photo",
    "photograph",
    "illustration",
    "illustrated",
    "diagram",
    "biology",
    "science",
    "scientific",
    "animal",
    "plant",
    "nature",
    "school",
    "educational",
    "education",
    "children",
    "kids",
    "anatomy",
    "structure",
    "species",
    "organism",
    "life",
    "natural",
    "physical",
    "experiment"
];


function normalizeText(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}


function scoreCandidate(page, category) {
    const info = page.imageinfo?.[0];

    if (!info) {
        return -Infinity;
    }

    const title = normalizeText(page.title);
    const description = normalizeText(
        info.extmetadata?.ImageDescription?.value
    );

    const text = `${title} ${description}`;

    let score = 0;

    // ------------------------------------------------------------
    // Strong preference for useful educational terminology.
    // ------------------------------------------------------------

    for (const word of GOOD_WORDS) {
        if (text.includes(word)) {
            score += 5;
        }
    }

    // ------------------------------------------------------------
    // Penalize things that are often visually weird/unhelpful.
    // ------------------------------------------------------------

    for (const word of BAD_WORDS) {
        if (text.includes(word)) {
            score -= 15;
        }
    }

    // ------------------------------------------------------------
    // Prefer the actual requested subject appearing in the title.
    // ------------------------------------------------------------

    const normalizedCategory = normalizeText(category);

    if (title.includes(normalizedCategory)) {
        score += 20;
    }

    // ------------------------------------------------------------
    // Prefer reasonably large images.
    // ------------------------------------------------------------

    const width = info.width || 0;
    const height = info.height || 0;

    if (width >= 600 && height >= 400) {
        score += 10;
    }

    if (width >= 1000 && height >= 600) {
        score += 5;
    }

    // Avoid tiny images.
    if (width < 300 || height < 200) {
        score -= 20;
    }

    // ------------------------------------------------------------
    // Prefer images that aren't extremely narrow/tall.
    // ------------------------------------------------------------

    if (width > 0 && height > 0) {
        const ratio = width / height;

        if (ratio >= 0.5 && ratio <= 2.5) {
            score += 5;
        } else {
            score -= 5;
        }
    }

    // ------------------------------------------------------------
    // Prefer actual image files.
    // ------------------------------------------------------------

    const mime = info.mime || "";

    if (mime.startsWith("image/")) {
        score += 5;
    }

    return score;
}


/**
 * Search Wikimedia Commons and choose the best candidate
 * rather than blindly taking the first result.
 */
async function searchCommonsImage(category) {
    const queries = [
        `"${category}"`,
        `${category} educational`,
        `${category} science`,
        `${category} photograph`,
        `${category} illustration`
    ];

    const candidates = [];

    for (const query of queries) {
        const params = new URLSearchParams({
            action: "query",
            generator: "search",

            gsrsearch: query,
            gsrnamespace: "6",
            gsrlimit: "20",

            prop: "imageinfo",
            iiprop: "url|size|mime|extmetadata",
            iiurlwidth: "600",

            format: "json",
            origin: "*"
        });

        const response = await fetchWithRetry(
            `https://commons.wikimedia.org/w/api.php?${params}`,
            {
                headers: {
                    "User-Agent": USER_AGENT
                }
            }
        );

        const data = await response.json();

        const pages = Object.values(
            data.query?.pages || {}
        );

        candidates.push(...pages);

        // Be polite to Wikimedia.
        await sleep(REQUEST_DELAY_MS);
    }

    // Remove duplicates.
    const unique = [
        ...new Map(
            candidates.map(page => [page.pageid, page])
        ).values()
    ];

    // Score candidates.
    const ranked = unique
        .map(page => ({
            page,
            score: scoreCandidate(page, category)
        }))
        .sort((a, b) => b.score - a.score);

    if (ranked.length === 0) {
        return null;
    }

    const best = ranked[0];

    console.log(
        `Best Commons result for "${category}":`,
        best.page.title,
        `(score ${best.score})`
    );

    return (
        best.page.imageinfo?.[0]?.thumburl ||
        best.page.imageinfo?.[0]?.url ||
        null
    );
}


/**
 * Wikipedia is often a better source for a clean,
 * recognizable educational image.
 */
async function searchWikipediaImage(category) {
    const params = new URLSearchParams({
        action: "query",

        generator: "search",
        gsrsearch: category,
        gsrnamespace: "0",
        gsrlimit: "5",

        prop: "pageimages",
        piprop: "thumbnail",
        pithumbsize: "600",

        format: "json",
        origin: "*"
    });

    const response = await fetchWithRetry(
        `https://en.wikipedia.org/w/api.php?${params}`,
        {
            headers: {
                "User-Agent": USER_AGENT
            }
        }
    );

    const data = await response.json();

    const pages = Object.values(
        data.query?.pages || {}
    );

    // Prefer an article whose title closely matches the class.
    const normalizedCategory = normalizeText(category);

    pages.sort((a, b) => {
        const aTitle = normalizeText(a.title);
        const bTitle = normalizeText(b.title);

        const aExact =
            aTitle === normalizedCategory ? 1 : 0;

        const bExact =
            bTitle === normalizedCategory ? 1 : 0;

        return bExact - aExact;
    });

    const page = pages.find(
        p => p.thumbnail?.source
    );

    if (!page) {
        return null;
    }

    console.log(
        `Wikipedia result for "${category}": ${page.title}`
    );

    return page.thumbnail.source;
}


function filenameFor(category) {
    return category
        .trim()
        .toLowerCase()
        .replaceAll(" ", "_")
        .replace(/[^a-z0-9_-]/g, "") + ".jpg";
}


async function downloadImage(category) {
    const filename = filenameFor(category);
    const filepath = path.join(OUTPUT_DIR, filename);

    try {
        await sleep(REQUEST_DELAY_MS);

        // --------------------------------------------------------
        // First try Wikipedia.
        //
        // Wikipedia article images tend to be much more
        // predictable for educational content.
        // --------------------------------------------------------

        let url = await searchWikipediaImage(category);

        // --------------------------------------------------------
        // If Wikipedia doesn't have a useful image,
        // use the smarter Commons search.
        // --------------------------------------------------------

        if (!url) {
            await sleep(REQUEST_DELAY_MS);

            url = await searchCommonsImage(category);
        }

        if (!url) {
            console.log(`No image found: ${category}`);
            return;
        }

        await sleep(REQUEST_DELAY_MS);

        const response = await fetchWithRetry(url, {
            headers: {
                "User-Agent": USER_AGENT
            }
        });

        const buffer = Buffer.from(
            await response.arrayBuffer()
        );

        await fs.writeFile(filepath, buffer);

        console.log(`Downloaded: ${filename}`);
    } catch (error) {
        console.error(
            `Failed: ${category}: ${error.message}`
        );
    }
}


async function main() {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });

    const text = await fs.readFile(
        CLASS_FILE,
        "utf8"
    );

    const classes = [
        ...new Set(
            text
                .split(/\r?\n/)
                .map(name => name.trim())
                .filter(Boolean)
        )
    ];

    console.log(
        `Downloading images for ${classes.length} classes...`
    );

    for (const category of classes) {
        await downloadImage(category);

        await sleep(REQUEST_DELAY_MS);
    }

    console.log("Finished downloading images.");
}


main();
