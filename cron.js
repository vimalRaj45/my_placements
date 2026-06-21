const cron = require('node-cron');
const db = require('./db');
const { syncEmails } = require('./routes/emails');

// Function to perform daily sync of Gmail
async function performDailyEmailSync() {
  console.log('[Scheduler] Running scheduled Gmail IMAP sync...');
  try {
    const synced = await syncEmails(console);
    console.log(`[Scheduler] Gmail sync completed. Synced ${synced.length} new important emails.`);
  } catch (err) {
    console.error('[Scheduler] Gmail scheduled sync failed:', err);
  }
}

// Setup the scheduler
function initScheduler() {
  console.log('[Scheduler] Initializing cron scheduler...');

  // Run daily at midnight (12:00 AM)
  cron.schedule('0 0 * * *', async () => {
    console.log('[Scheduler] Running daily scheduled tasks...');
    await performDailyEmailSync();
  });
}

module.exports = {
  initScheduler,
  performDailyEmailSync
};

