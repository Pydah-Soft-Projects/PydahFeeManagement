const cron = require('node-cron');
const ReminderConfig = require('../models/ReminderConfig');
const Setting = require('../models/Setting');
const User = require('../models/User');

const { processLateFees, processServiceLateFees } = require('../controllers/lateFeeController');
const { syncAllRegularStudentFees } = require('./studentFeeSyncService');
const { executeTimelyReminderConfig } = require('./timelyReminderService');
const { processNightlyProceedingTransactions } = require('../controllers/proceedingController');

// Track the currently scheduled payment-reset job so we can reschedule if settings change
let paymentResetJob = null;

// Track the scheduled email report job
let emailReportJob = null;

/**
 * Run a nightly task without letting failures crash the process or skip siblings.
 * Never rethrows — logs and returns { ok, error }.
 */
const runSafe = async (label, fn) => {
    const started = Date.now();
    try {
        console.log(`[Scheduler] ▶ ${label} starting...`);
        const result = await fn();
        console.log(`[Scheduler] ✓ ${label} finished in ${Date.now() - started}ms`);
        return { ok: true, result };
    } catch (error) {
        console.error(
            `[Scheduler] ✗ ${label} failed (continuing remaining tasks):`,
            error?.message || error
        );
        if (error?.stack) console.error(error.stack);
        return { ok: false, error };
    }
};

const scheduleEmailReport = (hour, minute, enabled, recipients) => {
    if (emailReportJob) {
        emailReportJob.stop();
        emailReportJob = null;
    }
    if (!enabled || !recipients || recipients.trim() === '') {
        console.log('[EmailReportScheduler] Automated daily email report is disabled or has no recipients configured.');
        return;
    }

    const { sendDailyAllCollegesReportEmail } = require('./emailReportService');
    const cronExpr = `${minute} ${hour} * * *`;
    
    emailReportJob = cron.schedule(cronExpr, async () => {
        console.log(`[EmailReportScheduler] Running daily collection report email task at ${hour}:${String(minute).padStart(2,'0')}...`);
        try {
            await sendDailyAllCollegesReportEmail(recipients);
            console.log('[EmailReportScheduler] Daily collection report email completed.');
        } catch (err) {
            console.error('[EmailReportScheduler] Daily report email failed (non-fatal):', err?.message || err);
            if (err?.stack) console.error(err.stack);
        }
    }, { timezone: 'Asia/Kolkata' });

    console.log(`[EmailReportScheduler] Scheduled daily email report at ${hour}:${String(minute).padStart(2,'0')} to recipients: ${recipients} (IST).`);
};


const schedulePaymentAccessReset = (hour, minute) => {
    if (paymentResetJob) {
        paymentResetJob.stop();
        paymentResetJob = null;
    }
    const cronExpr = `${minute} ${hour} * * *`;
    paymentResetJob = cron.schedule(cronExpr, async () => {
        console.log(`[PaymentReset] Running payment access auto-reset at ${hour}:${String(minute).padStart(2,'0')}...`);
        try {
            await User.updateMany(
                { 'paymentAccess.autoResetEnabled': true },
                {
                    $set: {
                        'paymentAccess.enableCashPayment': null,
                        'paymentAccess.enableBankPayment': null,
                        'paymentAccess.enableSplitPayment': null,
                        'paymentAccess.autoResetEnabled': false
                    }
                }
            );
            console.log('[PaymentReset] All user payment access overrides have been reset.');
        } catch (err) {
            console.error('[PaymentReset] Error resetting payment access (non-fatal):', err?.message || err);
            if (err?.stack) console.error(err.stack);
        }
    }, { timezone: 'Asia/Kolkata' });
    console.log(`[PaymentReset] Scheduled payment access reset at ${hour}:${String(minute).padStart(2,'0')} daily (IST).`);
};

const initScheduler = async () => {
    console.log('Initializing Timely Reminder & Late Fee Scheduler...');

    // Run every day at 3:00 AM IST for fee sync & late-fee reconciliation.
    // Each step is isolated so one failure never aborts siblings or crashes the Node process.
    cron.schedule('0 3 * * *', async () => {
        console.log('[Scheduler] ========== Nightly automated tasks start ==========');
        try {
            await runSafe('Student fee structure sync', () => processStudentFeeStructureSync());
            await runSafe('Academic late fees', () => processLateFees());
            await runSafe('Hostel/Transport late fees', () => processServiceLateFees());
            await runSafe('Proceeding transaction generation', () => processNightlyProceedingTransactions());
        } catch (fatal) {
            // Belts-and-suspenders: runSafe should never throw, but never let cron crash the server
            console.error('[Scheduler] Unexpected nightly runner failure (non-fatal):', fatal?.message || fatal);
            if (fatal?.stack) console.error(fatal.stack);
        }
        console.log('[Scheduler] ========== Nightly automated tasks end ==========');
    }, { timezone: 'Asia/Kolkata' });

    // Send timely reminders at 6:00 AM IST (separate job so reminders time is independent).
    cron.schedule('0 6 * * *', async () => {
        console.log('[Scheduler] ========== Timely reminders start (06:00 IST) ==========');
        try {
            await runSafe('Reminder configs', () => processReminderConfigs());
        } catch (fatal) {
            console.error('[Scheduler] Unexpected reminder runner failure (non-fatal):', fatal?.message || fatal);
            if (fatal?.stack) console.error(fatal.stack);
        }
        console.log('[Scheduler] ========== Timely reminders end ==========');
    }, { timezone: 'Asia/Kolkata' });

    // Load current payment reset schedule from settings and start it
    try {
        const setting = await Setting.findOne();
        const autoReset = setting ? setting.paymentAccessAutoReset !== false : true;
        const hour = setting ? (setting.paymentAccessResetHour ?? 9) : 9;
        const minute = setting ? (setting.paymentAccessResetMinute ?? 0) : 0;
        if (autoReset) {
            schedulePaymentAccessReset(hour, minute);
        }
    } catch (err) {
        console.error('[PaymentReset] Failed to read settings, defaulting to 9:00 AM reset:', err?.message || err);
        try {
            schedulePaymentAccessReset(9, 0);
        } catch (scheduleErr) {
            console.error('[PaymentReset] Failed to schedule default reset (non-fatal):', scheduleErr?.message || scheduleErr);
        }
    }

    // Load email report configuration from settings and start it
    try {
        const setting = await Setting.findOne();
        if (setting) {
            const enabled = setting.emailReportEnabled === true;
            const rHour = setting.emailReportHour ?? 18;
            const rMinute = setting.emailReportMinute ?? 0;
            const recipients = setting.emailReportRecipients || '';
            scheduleEmailReport(rHour, rMinute, enabled, recipients);
        }
    } catch (err) {
        console.error('[EmailReportScheduler] Failed to initialize daily email report schedule (non-fatal):', err?.message || err);
    }
};

const processStudentFeeStructureSync = async () => {
    try {
        console.log('[Scheduler] Starting nightly student fee structure sync...');
        const result = await syncAllRegularStudentFees({
            concurrency: 5,
            skipTransport: false,
            skipHostel: false
        });
        console.log(
            `[Scheduler] Student fee structure sync done: total=${result.total}, ok=${result.success}, failed=${result.failed}`
        );
        return result;
    } catch (error) {
        console.error('[Scheduler] Student fee structure sync failed:', error?.message || error);
        if (error?.stack) console.error(error.stack);
        return null;
    }
};

const processReminderConfigs = async () => {
    try {
        const configs = await ReminderConfig.find({ isActive: true });
        if (configs.length === 0) return;

        console.log(`Checking ${configs.length} active timely reminder rules...`);

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (const config of configs) {
            try {
                // Skip legacy college-scoped rules that lack dueSourceType
                if (!config.dueSourceType || !config.academicYear) {
                    console.log(`[Scheduler] Skipping legacy reminder rule ${config._id} (missing dueSourceType/academicYear)`);
                    continue;
                }
                await executeTimelyReminderConfig(config, today);
            } catch (ruleErr) {
                console.error(
                    `[Scheduler] Reminder rule ${config?._id} failed (continuing):`,
                    ruleErr?.message || ruleErr
                );
            }
        }

    } catch (error) {
        console.error('[Scheduler] Reminder configs error (non-fatal):', error?.message || error);
        if (error?.stack) console.error(error.stack);
    }
};

module.exports = { initScheduler, schedulePaymentAccessReset, scheduleEmailReport };
