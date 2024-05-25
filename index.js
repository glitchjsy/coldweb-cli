#!/usr/bin/env node
const puppeteer = require("puppeteer");
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");
const chalk = require("chalk");
const jsonToCsv = require("json-2-csv");
const fs = require("fs");
const config = require("./config.json");

async function run() {
    yargs(hideBin(process.argv))
        .command("list-categories", "list all categories", () => { }, async (argv) => {
            console.log(chalk.green("Fetching categories..."));

            const page = await setupBrowser();
            const links = await listCategories(page);

            links.forEach(link => console.log(`  ${link.name}`));
            process.exit(0);
        })
        .command("scrape-all <output>", "scrape all products", (yargs) => {
            return yargs
                .positional("output", {
                    type: "string",
                    description: "Specify output file"
                })
                .option("format", {
                    alias: "f",
                    type: "string",
                    choices: ["json", "csv"],
                    default: "json",
                    description: "Specify output file"
                })
                .option("with-extra-data", {
                    alias: "e",
                    type: "boolean",
                    description: "Include extra data such as product description"
                });
        }, async (argv) => {
            console.log(chalk.green(`Fetching products${argv["with-extra-data"] ? " with extra data" : ""} (this may take a while)...`));
            
            if(config.debug) console.log(chalk.gray(`> Selected format: ${argv.format}`));

            const page = await setupBrowser();
            const products = await scrapeAllProducts(page);

            console.log(chalk.green(`Fetched ${products.length} products`));

            if (argv["with-extra-data"]) {
                console.log(chalk.green("Fetching extra data..."));

                for (const product of products) {
                    if (config.debug) console.log(chalk.gray("> Retrieving extra data for " + product.name));
                    try {
                        const extraData = await scrapeProductExtraInfo(page, product.link);
                        Object.keys(extraData).forEach(field => product[field] = extraData[field]);
                    } catch (e) {
                        console.error(e.message)
                        continue;
                    }
                }
            }

            // Write file
            const output = argv.format === "json" ? JSON.stringify(products, null, 2) : await jsonToCsv.json2csv(products);
            fs.writeFileSync(argv.output, output);

            console.log(chalk.green("Done"));
            process.exit(0);
        })
        .demandCommand(1)
        .parse();
}

/**
 * Sets up pupeteer, launches the browser and sets relevant cookies.
 * 
 * @return {puppeteer.Page} The page instance
 */
async function setupBrowser() {
    const browser = await puppeteer.launch({
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();

    // Set relevant cookies
    await page.setCookie({
        url: config.siteUrl,
        name: "PHPSESSID",
        value: config.token
    });
    await page.setCookie({
        url: config.siteUrl,
        name: "USE_LISTVIEW",
        value: "true"
    });

    // Relay console messages in the browser to the Node log
    page.on("console", c => console.log(`[page] ${c.text()}`));

    return page;
}

/**
 * Returns a list of all categories on the website.
 * 
 * @param {puppeteer.Page} page The page instance from {@link setupBrowser}.
 * @returns A list of categories
 */
async function listCategories(page) {
    // Go to the home page
    await page.goto(`${config.siteUrl}/ordering/pages/default.php`);

    // Retrieve all category links
    const categoriesElement = await page.$(".cat-menu");
    const categoryLinks = await page.evaluate(el => {
        return Array.from(el.children).map(child => ({
            name: child.children[0].text,
            link: child.children[0].href
        }));
    }, categoriesElement);

    return categoryLinks;
}

/**
 * Returns information about all products on the website.
 * 
 * This does not include information such as product description,
 * allgens. For that, use {@link scrapeProductExtraInfo}.
 * 
 * @param {puppeteer.Page} page The page instance from {@link setupBrowser}.
 * @returns A list of products
 */
async function scrapeAllProducts(page) {
    let completeProductData = [];

    // Go to the home page
    await page.goto(`${config.siteUrl}/ordering/pages/default.php`);

    // Retrieve all category links
    const categoriesElement = await page.$(".cat-menu");
    const categoryLinks = await page.evaluate(el => {
        return Array.from(el.children).map(child => child.children[0].href)
    }, categoriesElement);

    // Loop through the category links to get the sub category links
    for (const link of categoryLinks) {
        await page.waitForNetworkIdle();
        await page.goto(link);

        const subCategories = await page.$("#default_page_subtitle_table");

        // Find the sub category links on the page
        const subCategoryLinks = await page.evaluate(async el => {
            let cats = document.getElementsByClassName("category-card-item");
            let subCategoryLinks = [];

            for (let i = 0; i < cats.length; i++) {
                subCategoryLinks.push(cats[i].children[0].href);
            }
            return subCategoryLinks;
        }, subCategories);


        // Loop through to get all product links in each sub category
        for (const subLink of subCategoryLinks) {
            await getProductData(subLink);

            async function getProductData(dataLink) {
                await page.goto(dataLink);
                await page.addScriptTag({ url: "https://code.jquery.com/jquery-3.2.1.min.js" });

                const productElements = await page.$("tr");

                if (config.debug) console.log(chalk.gray("> Retrieving products on page " + dataLink));

                // Retrieve the data we need from each product listing
                const productData = await page.evaluate((el, dataLink, siteUrl) => {
                    const tr = $("#product_listing_table_in_form tr");
                    const next = $(".prods[title=\" Next Page \"]");

                    let prodData = [];

                    let runs = 0;

                    for (let prods of tr.toArray()) {
                        if (runs < 2) {
                            runs++;
                            continue;
                        }
                        const sku = $(prods).find(".pl_code").first().text().trim();

                        prodData.push({
                            name: $(prods).find(".pl_name").first().text().trim(),
                            sku,
                            price: $(prods).find(".pl_incvat").first().text().trim(),
                            inStock: !$(prods).find(".pl_instock").text().includes("-"),
                            unit: $(prods).find(".pl_units").text().trim(), // TODO: Check if I need to convert this
                            stockCount: $(prods).find(".pl_instock").text().trim(),
                            link: `${siteUrl}/ordering/pages/product_info.php?products_id=${sku}`,
                            brand: $(prods).find(".pl_brand").first().text().trim(),
                        });
                    }
                    if (next.length !== 0) {
                        return {
                            data: prodData,
                            next: next.attr("href")
                        }
                    }
                    return { data: prodData };
                }, productElements, dataLink, config.siteUrl);

                completeProductData = [...completeProductData, ...productData.data];

                // If there is another page of results, do it all over again
                if (productData.next !== undefined) {
                    await getProductData(productData.next);
                }
            }
        }
    }
    return completeProductData;
}

/**
 * Returns information about a specific products.
 * 
 * This only includes information that {@link scrapeAllProducts}
 * does not contain. Currently this is only product description.
 * 
 * @param {puppeteer.Page} page The page instance from {@link setupBrowser}.
 * @param {String} link The product page link to scrape
 * @returns Product information
 */
async function scrapeProductExtraInfo(page, link) {
    await page.goto(link);
    await page.addScriptTag({ url: "https://code.jquery.com/jquery-3.2.1.min.js" });

    const productData = await page.evaluate(() => {
        const allergenTr = $(".middle_column_div > table > tbody > tr:eq(2)");
        const allergenInner = $(allergenTr).first().find("div");

        for (const allergen of allergenInner.children()) {
            if ($(allergen).hasClass("allergens")) {
                const imgUrl = $(allergen).first().find("img").attr("src");
                const text = $(allergen).first().text().trim();

                if (imgUrl.includes("red")) {
                    console.log("Allergen: " + text);
                }
            }
        }
        return {
            description: $(".product_info_description").first().text().trim()
        }
    });
    return productData;
}

run();