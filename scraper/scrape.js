const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const fs = require("fs");

puppeteer.use(StealthPlugin());

const AFFILIATE_TAG = "dealszone001-20";
const PROMO_HUB_URL =
  "https://affiliate-program.amazon.com/home/promohub/promocodes?ac-ms-src=nav&type=mpc&active_date_range=0";


// ─── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randomDelay(min = 1500, max = 3500) {
  return sleep(Math.floor(Math.random() * (max - min) + min));
}

// "Save 50.0% on select products from ZAFUL with promo code PPNVUXUX, through 6/1"
function parsePromoText(text) {
  const percentMatch = text.match(/Save\s+(\d+\.?\d*)%/i);
  const codeMatch = text.match(/promo code\s+([A-Z0-9]+)/i);
  return {
    couponExtra: percentMatch ? parseFloat(percentMatch[1]) / 100 : 0,
    couponText: codeMatch ? codeMatch[1] : "",
  };
}

// "Jun 01, 2026 at 11:59 PM PDT" → unix epoch
function parseDateToEpoch(dateStr) {
  // PDT = UTC-7, PST = UTC-8
  const withOffset = dateStr
    .replace(" PDT", " -07:00")
    .replace(" PST", " -08:00")
    .replace(" at ", " ");
  const date = new Date(withOffset);
  return isNaN(date.getTime()) ? 0 : Math.floor(date.getTime() / 1000);
}

// Extract ASIN from any Amazon product URL
function extractAsin(url) {
  const match = url.match(/\/dp\/([A-Z0-9]{10})/);
  return match ? match[1] : "";
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function run() {
  // Connect to your already-running Chrome (started via npm run start-chrome)
  const browser = await puppeteer.connect({
    browserURL: "http://localhost:9222",
    defaultViewport: null,
  });

  console.log("✅ Browser launched");
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });

  // ── Step 1: PromoHub page ──────────────────────────────────────────────────
  console.log("\n[1/3] Opening PromoHub...");
  await page.goto(PROMO_HUB_URL, { waitUntil: "domcontentloaded", timeout: 40000 });
  await randomDelay();

  const promoEntry = await page.evaluate(() => {
    // Real promo entries link to amazon.com/promocode/... — filter by href
    const links = Array.from(document.querySelectorAll("a")).filter((a) =>
      a.href.includes("amazon.com/promocode/")
    );

    if (links.length === 0) return null;

    const link = links[0];
    const href = link.href;

    // The visible text is on the link itself: "Save 50.0% on select products from ZAFUL with promo code PPNVUXUX..."
    const text = link.textContent.trim();

    // Walk up to find the container row that holds the full date/category info
    let row = link.parentElement;
    for (let i = 0; i < 8; i++) {
      if (!row) break;
      if (row.textContent.includes("End Date")) break;
      row = row.parentElement;
    }
    const rowText = row ? row.textContent : "";

    // Category lives in .promo-category inside the same .a-span10 as .promo-desc
    // The date row also uses .promo-category but has a .promo-date-range child — skip that one
    let category = "";
    const promoDesc = link.closest(".promo-desc");
    if (promoDesc) {
      const container = promoDesc.closest(".a-span10");
      if (container) {
        const cats = Array.from(container.querySelectorAll(".promo-category"));
        const nameEl = cats.find((c) => !c.querySelector(".promo-date-range"));
        if (nameEl) category = nameEl.textContent.trim();
      }
    }

    // Extract end date string e.g. "Jun 01, 2026 at 11:59 PM PDT"
    const endMatch = rowText.match(/End Date[:\s]+([A-Za-z]+ \d+, \d+ at \d+:\d+ [AP]M (?:PDT|PST))/i);
    const endDateStr = endMatch ? endMatch[1].trim() : "";

    return { text, href, category, endDateStr };
  });

  if (!promoEntry) {
    console.error("❌ Could not find any promo entries. Check if you are logged in.");
    await browser.close();
    return;
  }

  const { couponText, couponExtra } = parsePromoText(promoEntry.text);
  const couponEndTimeEpoch = parseDateToEpoch(promoEntry.endDateStr);

  console.log("   Promo text :", promoEntry.text);
  console.log("   Code       :", couponText);
  console.log("   Discount   :", `${couponExtra * 100}%`);
  console.log("   End epoch  :", couponEndTimeEpoch);
  console.log("   Category   :", promoEntry.category);
  console.log("   Link       :", promoEntry.href);

  // ── Step 2: PromoCode product listing page ─────────────────────────────────
  console.log("\n[2/3] Opening promo product page...");
  await page.goto(promoEntry.href, { waitUntil: "domcontentloaded", timeout: 40000 });
  await randomDelay();

  // Find first in-stock product — collect all /dp/ links then skip out-of-stock ones
  const firstProductUrl = await page.evaluate(() => {
    const allProductLinks = Array.from(document.querySelectorAll("a[href*='/dp/']"));
    console.log("Found product links:", allProductLinks.length);

    for (const link of allProductLinks) {
      // Check if the parent card area mentions "Out of Stock"
      const card = link.closest("li, div[class*='card'], div[class*='item'], td") || link.parentElement;
      const cardText = card ? card.textContent : "";
      if (/out of stock/i.test(cardText)) continue;
      if (link.href && link.href.includes("/dp/")) return link.href;
    }
    // Fallback: just return first product link regardless of stock
    return allProductLinks.length > 0 ? allProductLinks[0].href : null;
  });

  if (!firstProductUrl) {
    console.error("❌ Could not find an in-stock product on the promo page.");
    await browser.close();
    return;
  }

  console.log("   First product:", firstProductUrl);

  // ── Step 3: Product detail page ────────────────────────────────────────────
  console.log("\n[3/3] Opening product page...");
  await page.goto(firstProductUrl, { waitUntil: "domcontentloaded", timeout: 40000 });
  await randomDelay();

  const productData = await page.evaluate(() => {
    // Title
    const title = document.querySelector("#productTitle")?.textContent?.trim() ?? "";

    // Price — try multiple selectors Amazon uses
    let realPrice = "";
    const priceSelectors = [
      ".a-price .a-offscreen",
      "#priceblock_ourprice",
      "#price_inside_buybox",
      "#corePrice_feature_div .a-offscreen",
      ".a-price-whole",
    ];
    for (const sel of priceSelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) {
        realPrice = el.textContent.replace(/[^0-9.]/g, "").trim();
        break;
      }
    }

    // Main product image — prefer high-res, strip Amazon size suffix to get original
    let imageDeal = "";
    const imgEl = document.querySelector("#landingImage, #imgTagWrapperId img");
    if (imgEl) {
      const hiRes = imgEl.getAttribute("data-old-hires");
      const dynRaw = imgEl.getAttribute("data-a-dynamic-image");
      if (hiRes) {
        imageDeal = hiRes;
      } else if (dynRaw) {
        // Pick the largest image from the dynamic image map
        const map = JSON.parse(dynRaw);
        imageDeal = Object.entries(map).sort((a, b) => b[1][0] - a[1][0])[0]?.[0] || "";
      } else {
        imageDeal = imgEl.src;
      }
      // Remove Amazon size suffixes to get the full-size image
      imageDeal = imageDeal.replace(/\._[A-Z0-9,_]+_\./g, ".");
    }

    // "About this item" bullet points
    const details = Array.from(
      document.querySelectorAll("#feature-bullets .a-unordered-list .a-list-item")
    )
      .map((el) => el.textContent.trim())
      .filter((s) => s.length > 0);

    return { title, realPrice, imageDeal, details };
  });

  const asin = extractAsin(page.url());
  const realPrice = parseFloat(productData.realPrice) || 0;

  const result = {
    id: asin,
    title: productData.title,
    price: realPrice.toFixed(2),
    realPrice: realPrice.toFixed(2),
    category: promoEntry.category,
    link: `https://www.amazon.com/dp/${asin}?tag=${AFFILIATE_TAG}`,
    imageDeal: productData.imageDeal,
    couponText,
    couponEndTimeEpoch,
    couponExtra,
    details: productData.details,
  };

  console.log("\n=== RESULT ===");
  console.log(JSON.stringify(result, null, 2));

  fs.writeFileSync("output.json", JSON.stringify([result], null, 2));
  console.log("\n✅ Saved to output.json");

  await browser.close();
}

run().catch(console.error);
