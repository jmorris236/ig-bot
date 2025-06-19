const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const IG_SESSIONID = process.env.IG_SESSIONID;
const TARGET_USERNAME = process.env.TARGET_USERNAME;
const NUM_POSTS = parseInt(process.env.NUM_POSTS || "3", 10);
const PROXY_SERVER = process.env.PROXY_SERVER || ""; // e.g., "http://user:pass@proxyhost:port"

const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR);

async function run() {
    console.log("Starting Instagram autolike script...");
    console.log(`cwd: ${process.cwd()}`);

    // Proxy support + ignoreHTTPS
    let launchOpts = { headless: true, args: ['--no-sandbox'] };
    if (PROXY_SERVER) {
        launchOpts.proxy = { server: PROXY_SERVER };
        console.log('Using proxy:', PROXY_SERVER);
    }

    const browser = await chromium.launch(launchOpts);

    // Critical: ignoreHTTPS is set here!
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        locale: 'en-US',
        ignoreHTTPSErrors: true,
        extraHTTPHeaders: {
            'Accept-Language': 'en-US,en;q=0.9'
        }
    });

    // Set sessionid cookie for Instagram auth
    await context.addCookies([{
        name: 'sessionid',
        value: IG_SESSIONID,
        domain: '.instagram.com',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax'
    }]);

    const page = await context.newPage();
    try {
        const profileUrl = `https://www.instagram.com/${TARGET_USERNAME}/`;
        console.log(`Navigating to ${profileUrl} ...`);
        await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // Dismiss login/modal (if present)
        try {
            await page.waitForSelector('button:has-text("Not Now"), button:has-text("Allow all cookies"), button[aria-label="Close"]', { timeout: 8000 });
            await page.click('button:has-text("Not Now"), button:has-text("Allow all cookies"), button[aria-label="Close"]');
            console.log('Dismissed modal with X or Not Now.');
        } catch {
            console.log('No modal to dismiss, continuing...');
        }

        // Wait for posts to fully render after navigation
        await page.waitForTimeout(5000);

        // Dump HTML for debugging
        const htmlDumpPath = path.join(SCREENSHOT_DIR, `before_wait_posts_${Date.now()}.html`);
        const html = await page.content();
        fs.writeFileSync(htmlDumpPath, html);

        // Print sample anchors for debugging
        const anchors = await page.$$eval('a', as => as.map(a => a.outerHTML));
        console.log('Sample anchors:', anchors.slice(0, 10));

        // Now try a broad selector without 'state: visible'
        console.log('Waiting for posts to appear with broad selector...');
        await page.waitForSelector('a[href*="/p/"]', { timeout: 60000 });

        // Gather unique post links
        const postLinks = await page.$$eval('a[href*="/p/"]', links =>
            links.map(a => a.href).filter((v, i, a) => a.indexOf(v) === i)
        );
        console.log('Found post links:', postLinks);

        if (!postLinks.length) throw new Error('No posts found!');

        for (let i = 0; i < Math.min(NUM_POSTS, postLinks.length); i++) {
            const postUrl = postLinks[i];
            console.log(`Liking post: ${postUrl}`);
            const postPage = await context.newPage();
            await postPage.goto(postUrl, { waitUntil: 'domcontentloaded' });
            // Like button selector, could vary by UI update
            try {
                await postPage.waitForSelector('svg[aria-label="Like"], button svg[aria-label="Like"]', { timeout: 15000 });
                await postPage.click('svg[aria-label="Like"], button svg[aria-label="Like"]');
                console.log(`✅ Liked: ${postUrl}`);
            } catch {
                console.log(`⚠️  Could not like post: ${postUrl}`);
            }
            await postPage.close();
        }
        console.log('Done!');
        await browser.close();
    } catch (err) {
        const now = Date.now();
        const ssPath = path.join(SCREENSHOT_DIR, `error_screenshot_${now}.png`);
        const htmlPath = path.join(SCREENSHOT_DIR, `error_page_${now}.html`);
        await page.screenshot({ path: ssPath, fullPage: true });
        fs.writeFileSync(htmlPath, await page.content());
        console.error(`❌ Could not find posts. Screenshot saved to ${ssPath} and HTML saved to ${htmlPath}`);
        throw err;
    }
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
