const express = require('express');
const router = express.Router();
const {
    getOverallConcessions,
    saveOverallConcession,
    deleteOverallConcession,
    bulkSaveOverallConcessions,
    bulkSaveMultipleStudents,
    submitConcessionRequest,
    getConcessionRequests,
    approveConcessionRequest,
    updateConcessionRequestEntries,
    updateConcessionRequestRemarks,
    updateConcessionRequestReference,
    rejectConcessionRequest
} = require('../controllers/overallConcessionController');

// ── Specific string paths MUST come before /:id to avoid param collision ──

// Base routes
router.route('/')
    .get(getOverallConcessions)
    .post(saveOverallConcession);

router.route('/bulk')
    .post(bulkSaveOverallConcessions);

router.route('/bulk-multi')
    .post(bulkSaveMultipleStudents);

// Request workflow
router.route('/request')
    .post(submitConcessionRequest);

router.route('/requests')
    .get(getConcessionRequests);

router.route('/requests/:id/approve')
    .put(approveConcessionRequest);

router.route('/requests/:id/reject')
    .put(rejectConcessionRequest);

router.route('/requests/:id/reference')
    .put(updateConcessionRequestReference);

router.route('/requests/:id/remarks')
    .put(updateConcessionRequestRemarks);

router.route('/requests/:id')
    .put(updateConcessionRequestEntries);

// Param route last — only matches numeric MySQL IDs, not the string paths above
router.route('/:id')
    .delete(deleteOverallConcession);

module.exports = router;
