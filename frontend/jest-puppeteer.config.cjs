const fs = require("fs");

const headless = process.env.HEADLESS === "false" ? false : true;

function resolveChromePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ];

  return candidates.find((path) => fs.existsSync(path));
}

const executablePath = resolveChromePath();

module.exports = {
  launch: {
    headless,
    executablePath,
    dumpio: process.env.PUPPETEER_DUMPIO === "1",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  },
  browserContext: "default",
};
