const ConcessionRequest = require('../models/ConcessionRequest');
const Transaction = require('../models/Transaction');
const FeeHead = require('../models/FeeHead');
const { uploadToS3 } = require('../utils/s3Upload');

// Helper to get next voucher ID for a course
const getNextVoucherId = async (courseName) => {
  const lastRequest = await ConcessionRequest.findOne({ course: courseName })
    .sort({ createdAt: -1 })
    .select('voucherId');
  
  let nextNum = 1;
  if (lastRequest && lastRequest.voucherId) {
    nextNum = parseInt(lastRequest.voucherId, 10) + 1;
  }
  return nextNum.toString().padStart(3, '0');
};

// @desc    Get Next Voucher ID Preview
// @route   GET /api/concessions/next-voucher-id
const getNextVoucherIdPreview = async (req, res) => {
  const { course } = req.query;
  if (!course) return res.status(400).json({ message: 'Course is required' });

  try {
    const nextId = await getNextVoucherId(course);
    res.json({ nextVoucherId: nextId });
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Create a Concession Request
// @route   POST /api/concessions
const createConcessionRequest = async (req, res) => {
  let { students, feeHeadId, amount, reason, studentYear, semester, concessionGivenBy } = req.body;
  
  // Parse students if it comes as a string (FormData)
  if (typeof students === 'string') {
    try {
      students = JSON.parse(students);
    } catch (e) {
      return res.status(400).json({ message: 'Invalid students data' });
    }
  }

  const requestedBy = req.user ? (req.user.name || req.user.username) : 'system';

  if (!students || !Array.isArray(students) || students.length === 0) {
    return res.status(400).json({ message: 'No students selected' });
  }

  if (!feeHeadId || !amount || !reason || !studentYear) {
    return res.status(400).json({ message: 'Fee Head, Amount, Year and Reason are required' });
  }

  try {
    let imageUrl = null;
    if (req.file) {
      try {
        imageUrl = await uploadToS3(req.file);
      } catch (s3Error) {
        console.error("S3 Upload Failed:", s3Error);
        return res.status(500).json({ 
          message: 'S3 Upload failed. Please verify AWS credentials/configuration on the hosted server.', 
          error: s3Error.message 
        });
      }
    }

    // Generate a single voucher ID for the entire bulk request based on the first student's course
    let sharedVoucherId = null;
    if (students.length > 0) {
      const firstCourse = students[0].course;
      sharedVoucherId = await getNextVoucherId(firstCourse);
    }

    const requests = [];
    for (const s of students) {
      requests.push({
        studentId: s.studentId,
        studentName: s.studentName,
        feeHead: feeHeadId,
        voucherId: sharedVoucherId,
        amount: Number(amount),
        reason,
        studentYear,
        semester,
        studentPin: s.studentPin, // [NEW]
        college: s.college,
        course: s.course,
        branch: s.branch,
        batch: s.batch,
        type: students.length > 1 ? 'Bulk' : 'Single',
        requestedBy,
        imageUrl,
        concessionGivenBy // [NEW]
      });
    }

    const created = await ConcessionRequest.insertMany(requests);
    res.status(201).json({ message: `Created ${created.length} concession requests`, data: created });
  } catch (error) {
    console.error("Error creating concession:", error);
    res.status(500).json({ message: 'Server Error', error: error.message });
  }
};

// @desc    Get Concession Requests
// @route   GET /api/concessions
// @query   status, college, course, branch, batch
const getConcessionRequests = async (req, res) => {
  const { status, college, course, branch, batch, search, studentId, startDate, endDate, concessionGivenBy, requestedBy } = req.query;
  const filter = {};

  if (status && status !== 'ALL') filter.status = status;
  
  if (college) filter.college = college;
  if (course) filter.course = course;
  if (branch) filter.branch = branch;
  if (batch) filter.batch = batch;
  if (studentId) filter.studentId = studentId;
  if (concessionGivenBy) filter.concessionGivenBy = concessionGivenBy;
  if (requestedBy) filter.requestedBy = requestedBy;

  if (startDate || endDate) {
    filter.createdAt = {};
    if (startDate) {
      filter.createdAt.$gte = new Date(startDate);
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      filter.createdAt.$lte = end;
    }
  }

  if (search) {
      filter.$or = [
          { studentName: { $regex: search, $options: 'i' } },
          { studentId: { $regex: search, $options: 'i' } },
          { voucherId: { $regex: search, $options: 'i' } }
      ];
  }

  try {
    const requests = await ConcessionRequest.find(filter)
      .populate('feeHead', 'name')
      .sort({ createdAt: -1 });
    res.json(requests);
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Process Request (Approve/Reject)
// @route   PUT /api/concessions/:id/process
// Helper function for processing a single concession request (internal use)
const processSingleRequestLogic = async (id, { action, rejectionReason, approvedAmount }, processedBy, reqUser) => {
    const request = await ConcessionRequest.findById(id);
    if (!request) throw new Error(`Request ${id} not found`);

    if (request.status !== 'PENDING') {
        throw new Error(`Request ${id} is already processed`);
    }

    if (action === 'APPROVE') {
        let finalAmount = request.amount;
        if (approvedAmount !== undefined && approvedAmount !== null) {
            finalAmount = Number(approvedAmount);
            request.amount = finalAmount;
        }

        const existingTxn = await Transaction.findOne({ concessionRequestId: id });

        if (existingTxn) {
            existingTxn.amount = finalAmount;
            existingTxn.remarks = `Concession Approved (Modified): ${request.reason}`;
            existingTxn.collectedBy = processedBy;
            await existingTxn.save();
        } else {
            const timestamp = Date.now().toString().slice(-6);
            const random = Math.floor(100 + Math.random() * 900).toString();
            const receiptNumber = `CN${timestamp}${random}`;

            const newTransaction = new Transaction({
                studentId: request.studentId,
                studentName: request.studentName,
                feeHead: request.feeHead,
                amount: finalAmount,
                transactionType: 'CREDIT',
                paymentMode: 'Credit',
                receiptNumber,
                paymentDate: new Date(),
                remarks: `Concession: ${request.reason}`,
                collectedBy: processedBy,
                collectedByName: reqUser ? reqUser.name : 'Administrator',
                academicYear: request.batch,
                studentYear: request.studentYear,
                semester: request.semester || null,
                college: request.college,
                course: request.course,
                branch: request.branch,
                concessionRequestId: request._id
            });
            await newTransaction.save();
        }

        request.status = 'APPROVED';
        request.approvedBy = processedBy;
        request.approvedAt = new Date();
        await request.save();
        return request;
    } else {
        request.status = 'REJECTED';
        request.rejectionReason = rejectionReason;
        request.approvedBy = processedBy;
        request.approvedAt = new Date();
        await request.save();
        return request;
    }
};

// @desc    Process a single Concession Request
// @route   PUT /api/concessions/:id/process
const processConcessionRequest = async (req, res) => {
    const { id } = req.params;
    const processedBy = req.user ? (req.user.name || req.user.username) : 'admin';

    try {
        const result = await processSingleRequestLogic(id, req.body, processedBy, req.user);
        res.json({ message: 'Request processed successfully', data: result });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

// @desc    Process multiple Concession Requests (Bulk)
// @route   PUT /api/concessions/bulk-process
const processBulkConcessionRequests = async (req, res) => {
    const { requests, action, rejectionReason } = req.body; // requests: [{ id, approvedAmount }]
    const processedBy = req.user ? (req.user.name || req.user.username) : 'admin';

    if (!requests || !Array.isArray(requests)) {
        return res.status(400).json({ message: 'Invalid requests data' });
    }

    try {
        const results = [];
        for (const item of requests) {
            const resData = await processSingleRequestLogic(
                item.id,
                { action, rejectionReason, approvedAmount: item.approvedAmount },
                processedBy,
                req.user
            );
            results.push(resData);
        }
        res.json({ message: `Successfully processed ${results.length} requests`, data: results });
    } catch (error) {
        console.error("Bulk processing error:", error);
        res.status(500).json({ message: 'Bulk processing failed', error: error.message });
    }
};

// @desc    Modify Approved Concession
// @route   PUT /api/concessions/modify-approved/:id
const modifyApprovedConcession = async (req, res) => {
    const { id } = req.params;
    const { amount, reason, concessionGivenBy } = req.body;
    const processedBy = req.user ? (req.user.name || req.user.username) : 'admin';

    try {
        const request = await ConcessionRequest.findById(id);
        if (!request) return res.status(404).json({ message: 'Request not found' });

        if (request.status !== 'APPROVED') {
            return res.status(400).json({ message: 'Only approved requests can be modified here' });
        }

        // Update Request fields
        if (amount !== undefined) request.amount = Number(amount);
        if (reason) request.reason = reason;
        if (concessionGivenBy) request.concessionGivenBy = concessionGivenBy;
        request.lastModifiedBy = processedBy;
        request.lastModifiedAt = new Date();

        await request.save();

        // Find and update associated Transaction
        const transaction = await Transaction.findOne({ concessionRequestId: id });
        if (transaction) {
            if (amount !== undefined) transaction.amount = Number(amount);
            if (reason) transaction.remarks = `Concession Approved (Modified): ${reason}`;
            // Ensure student metadata is sync'd
            transaction.studentName = request.studentName;
            transaction.studentYear = request.studentYear;
            transaction.semester = request.semester || null;
            await transaction.save();
        }

        res.json({ 
            success: true, 
            message: 'Approved concession and related transaction updated successfully',
            data: request 
        });
    } catch (error) {
        console.error('Modification Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Delete Concession Request (only if not approved)
// @route   DELETE /api/concessions/:id
const deleteConcessionRequest = async (req, res) => {
    const { id } = req.params;

    try {
        const request = await ConcessionRequest.findById(id);
        if (!request) {
            return res.status(404).json({ message: 'Concession request not found' });
        }

        if (request.status === 'APPROVED') {
            return res.status(400).json({ message: 'Approved concession requests cannot be deleted' });
        }

        await ConcessionRequest.findByIdAndDelete(id);

        res.json({ message: 'Concession request deleted successfully' });
    } catch (error) {
        console.error('Error deleting concession request:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

module.exports = {
    createConcessionRequest,
    getConcessionRequests,
    processConcessionRequest,
    processBulkConcessionRequests,
    getNextVoucherIdPreview,
    modifyApprovedConcession,
    deleteConcessionRequest
};

