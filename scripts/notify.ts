/**
 * Real-Telegram check. Sends one sample notification with two linked cities, two categories,
 * and both tags to every configured destination (the group plus each category channel set in
 * env), then one plain-text line to the admin chat. Usage: pnpm notify:test
 */
import { loadConfig, parseEnv } from "../src/config.ts";
import { log } from "../src/log.ts";
import { createNotifier, type Notification } from "../src/notifier/index.ts";

const env = parseEnv();
const config = loadConfig(env.CONFIG_PATH);

const sample: Notification = {
  key: "spectrum|software engineer intern",
  title: "Software Engineer Intern <test>",
  company: "Spectrum & Co",
  postings: [
    { location: "Greenwood Village, CO", url: "https://www.linkedin.com/jobs/view/4000000001" },
    { location: "Englewood, CO", url: "https://www.linkedin.com/jobs/view/4000000002" },
  ],
  categories: ["aiml", "perf"],
  tags: [
    { text: "no sponsorship", level: "info" },
    { text: "eligibility unclear", level: "info" },
  ],
};

const notifier = createNotifier(config, env);
await notifier.start();
let failed = false;
for (const destination of notifier.destinations()) {
  try {
    const { messageId } = await notifier.send(sample, destination);
    log.info({ destination, messageId }, "message sent");
  } catch (err) {
    failed = true;
    log.error({ destination, err }, "message failed");
  }
}
await notifier.sendAdmin("MALJA notify:test: admin alerts work");
log.info({ chatId: env.TELEGRAM_ADMIN_CHAT_ID }, "admin message sent");
await notifier.stop();
if (failed) process.exitCode = 1;
