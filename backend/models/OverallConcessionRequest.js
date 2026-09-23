const mongoose = require('mongoose');

const concessionEntrySchema = new mongoose.Schema({
    feeHeadId:      { type: String, required: true },
    feeHeadCode:    { type: String, default: '' },
    studentYear:    { type: Number, required: true },
    semester:       { type: Number, default: null },
    amount:         { type: Number, required: true },
    concessionType: { type: String, enum: ['CONCESSION', 'REVISED'], default: 'CONCESSION' },
    remarks:        { type: String, default: '' }
}, { _id: false });

const overallConcessionRequestSchema = new mongoose.Schema({
    admissionNumber: { type: String, required: true },
    studentName:     { type: String, required: true },
    pinNo:           { type: String, default: '-' },
    college:         { type: String, required: true },
    course:          { type: String, required: true },
    branch:          { type: String, required: true },
    batch:           { type: String, required: true },
    // Student quota code (students.stud_type), e.g. CONV / MANG / SPOT — matches FeeStructure.category
    category:        { type: String, default: 'Regular' },

    // The full set of concession entries being requested
    concessions: [concessionEntrySchema],

    // Top-level request remarks / justification
    remarks: { type: String, default: '' },

    status: {
        type: String,
        enum: ['PENDING', 'APPROVED', 'REJECTED'],
        default: 'PENDING'
    },

    requestedBy:     { type: String, required: true },   // username
    requestedByName: { type: String, default: '' },       // display name

    approvedBy:      { type: String, default: '' },
    approvedByName:  { type: String, default: '' },

    // Name from ConcessionApprover dropdown (selected at approval time)
    concessionGivenBy: { type: String, default: '' },

    rejectionReason: { type: String, default: '' },
}, {
    timestamps: true
});

// Compound index: one PENDING request per student (allows multiple if prior was resolved)
overallConcessionRequestSchema.index({ admissionNumber: 1, status: 1 });

module.exports = mongoose.model('OverallConcessionRequest', overallConcessionRequestSchema);
