const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const { syncAllRegularStudentFees } = require('../services/studentFeeSyncService');

async function runBulkStudentSync() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB.\n');

        console.log('===========================================================');
        console.log('STARTING FULL STUDENT FEE SYNC & DEDUPLICATION FOR ALL STUDENTS');
        console.log('===========================================================');

        const startTime = Date.now();
        const result = await syncAllRegularStudentFees({
            concurrency: 10,
            skipTransport: false,
            skipHostel: false,
            skipClub: false,
            skipStandard: false
        });

        const durationSec = Math.round((Date.now() - startTime) / 1000);
        console.log('\n===========================================================');
        console.log('FULL SYNC COMPLETED SUCCESSFULLY!');
        console.log(`- Total Regular Students Processed : ${result.total}`);
        console.log(`- Successful                       : ${result.success}`);
        console.log(`- Failed                           : ${result.failed}`);
        console.log(`- Time Taken                       : ${durationSec} seconds`);
        console.log('===========================================================');

        process.exit(0);
    } catch (err) {
        console.error('Error running bulk sync:', err);
        process.exit(1);
    }
}

runBulkStudentSync();
