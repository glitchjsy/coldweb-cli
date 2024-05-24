# coldweb-cli
Scrapes all products from [coldweb](https://coldweb.co.uk) systems, such as the [ValleyFoods Site](https://valley.coldweb.co.uk).

## Installation
1. Clone the repo
2. Run `npm install`
3. Open the config file and set the `siteUrl` to the intended URL
4. Create an account on the coldweb site
5. Log in to the account
6. Find the `PHPSESSID` cookie, copy the value and set the `token` property in the config to that value
7. Run the program!

## Commands
* `list-categories` - Prints a list of all categories to the console
* `scrape-all <output> [--format -f] [--with-extra-data -e]` - Scrapes all product data from the site
    * `<output>` Specify the output file path
    * `--format <json|csv>` Specifies the format to output the data in (default: `json`)
    * `--with-extra-data` If set, will scrape each product page individually to retrieve a description, allergen info and more. This can add considerably more time

## Tested Websites
The websites below have been confirmed as working with this tools. I imagine all coldweb sites will work, but I can't confirm that.

* https://valley.coldweb.co.uk
* https://lacollette.coldweb.co.uk