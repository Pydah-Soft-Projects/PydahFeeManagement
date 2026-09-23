const db = require('../config/sqlDb');
const admissionsDb = require('../config/admissionsDb');
const StudentFee = require('../models/StudentFee');
const FeeHead = require('../models/FeeHead');
const FeeStructure = require('../models/FeeStructure');
const OverallConcessionRequest = require('../models/OverallConcessionRequest');
const collegeScope = require('../utils/collegeScope');
const {
  formatConcessionEntry,
  mapStoredEntryForResponse,
  resolveStudentFeeAmount,
  getConcessionAmount,
  normalizeSemester,
  normalizeConcessionType,
  buildFeeHeadMaps,
  resolveFeeHeadId
} = require('../utils/overallConcessionFees');
const { syncStandardFees } = require('../services/studentFeeSyncService');
const {
  validateRevisedEntriesAgainstStructures,
  applyRevisedConcessionTransactions,
  cancelDeclarationConcessionTransactions
} = require('../services/overallConcessionRevisedService');

// @desc    Get all students with their overall concessions (revised fees)
// @route   GET /api/overall-concessions
const getOverallConcessions = async (req, res) => {
    try {
        const { college, course, branch, batch, search } = req.query;

        // Enforce user colleges scope
        const allowedColleges = await collegeScope.getEffectiveCollegeNames(req.user);
        
        // 1. Query students matching filters
        let sqlQuery = `SELECT admission_number, pin_no, student_name, college, course, branch, batch, current_year, current_semester, stud_type, student_status FROM students WHERE 1=1`;
        const params = [];

        if (college) {
            const requested = college.split(',').map(c => c.trim()).filter(Boolean);
            const scoped = collegeScope.intersectCollegeNames(requested, allowedColleges);
            if (scoped.length > 0) {
                sqlQuery += ` AND college IN (${scoped.map(() => '?').join(',')})`;
                params.push(...scoped);
            } else {
                return res.json([]);
            }
        } else if (allowedColleges && allowedColleges.length > 0) {
            sqlQuery += ` AND college IN (${allowedColleges.map(() => '?').join(',')})`;
            params.push(...allowedColleges);
        }

        // Filter by user's assigned courses if specified
        const userAllowedCourses = (req.user.courses || []).map(c => c.includes('|') ? c.split('|')[1] : c);
        if (course) {
            if (userAllowedCourses.length > 0 && !userAllowedCourses.includes(course)) {
                return res.json([]);
            }
            sqlQuery += ` AND course = ?`;
            params.push(course);
        } else if (userAllowedCourses.length > 0) {
            sqlQuery += ` AND course IN (${userAllowedCourses.map(() => '?').join(',')})`;
            params.push(...userAllowedCourses);
        }

        if (branch) {
            sqlQuery += ` AND branch = ?`;
            params.push(branch);
        }
        if (batch) {
            sqlQuery += ` AND batch = ?`;
            params.push(batch);
        }
        if (search) {
            sqlQuery += ` AND (student_name LIKE ? OR admission_number LIKE ? OR pin_no LIKE ?)`;
            const searchPattern = `%${search}%`;
            params.push(searchPattern, searchPattern, searchPattern);
        }

        const [students] = await db.query(sqlQuery, params);

        if (students.length === 0) {
            return res.json([]);
        }

        // 2. Fetch all concessions (revised fees) from MongoDB for these students
        const studentIds = students.map(s => s.admission_number);
        const approvedRequests = await OverallConcessionRequest.find({
            admissionNumber: { $in: studentIds },
            status: 'APPROVED'
        }).sort({ updatedAt: -1, createdAt: -1 }).lean();

        const feeHeads = await FeeHead.find({}).lean();
        const { codeMap } = buildFeeHeadMaps(feeHeads);

        // Map concessions by student admission_number
        const concessionMap = {};
        studentIds.forEach(id => {
            concessionMap[id] = [];
        });

        const processedStudents = new Set();
        approvedRequests.forEach(req => {
            if (!processedStudents.has(req.admissionNumber)) {
                processedStudents.add(req.admissionNumber);
                const fees = req.concessions || [];
                concessionMap[req.admissionNumber] = fees.map((rf, idx) => ({
                    id: `${req._id.toString()}_${idx}`,
                    ...mapStoredEntryForResponse(rf, feeHeads, codeMap)
                }));
            }
        });

        // 3. Return students with revised fees attached
        const results = students.map(s => ({
            admission_number: s.admission_number,
            pin_no: s.pin_no || '-',
            student_name: s.student_name,
            college: s.college,
            course: s.course,
            branch: s.branch,
            batch: s.batch,
            current_year: s.current_year,
            current_semester: s.current_semester,
            stud_type: s.stud_type || 'Regular',
            student_status: s.student_status,
            revisedFees: concessionMap[s.admission_number] || []
        }));

        res.json(results);
    } catch (error) {
        console.error('Error fetching overall concessions:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// @desc    Assign or Update a revised fee (concession) for a student
// @route   POST /api/overall-concessions
const saveOverallConcession = async (req, res) => {
    const { 
        admissionNumber, 
        pinNo, 
        studentName, 
        college,
        course, 
        branch, 
        batch, 
        category,
        feeHeadId, 
        studentYear, 
        semester, 
        amount,
        revisedAmount,
        concessionType,
        remarks
    } = req.body;

    const concessionAmount = amount ?? revisedAmount;
    if (!admissionNumber || !feeHeadId || !studentYear || concessionAmount === undefined) {
        return res.status(400).json({ message: 'Missing required fields' });
    }

    try {
        const sYear = Number(studentYear);
        const sem = normalizeSemester(semester);
        const numericAmount = Number(concessionAmount);

        // Fetch student's actual parameters from SQL database to resolve any misconfigurations
        const [studentRows] = await db.query(
            'SELECT college, course, branch, batch, stud_type, student_name, pin_no FROM students WHERE admission_number = ?',
            [admissionNumber]
        );
        const sqlStudent = studentRows[0];
        const resolvedCollege = sqlStudent?.college || college;
        const resolvedCourse = sqlStudent?.course || course;
        const resolvedBranch = sqlStudent?.branch || branch;
        const resolvedBatch = sqlStudent?.batch || batch;
        const resolvedCategory = sqlStudent?.stud_type || category || 'Regular';
        const resolvedStudentName = sqlStudent?.student_name || studentName;
        const resolvedPinNo = sqlStudent?.pin_no || pinNo || '-';

        const feeHead = await FeeHead.findById(feeHeadId).lean();
        const feeHeadCode = feeHead ? feeHead.code : '';

        const storedEntry = formatConcessionEntry({
            feeHeadId,
            feeHeadCode,
            studentYear: sYear,
            semester: sem,
            amount: numericAmount,
            concessionType,
            remarks
        });

        if (normalizeConcessionType(storedEntry.concessionType) === 'REVISED') {
            const validation = await validateRevisedEntriesAgainstStructures({
                entries: [storedEntry],
                college: resolvedCollege,
                course: resolvedCourse,
                branch: resolvedBranch,
                batch: resolvedBatch,
                category: resolvedCategory,
                admissionNumber
            });
            if (!validation.ok) {
                return res.status(400).json({ message: validation.message, warnings: validation.warnings });
            }
        }

        // 1. Fetch existing approved request from MongoDB
        let approvedRequest = await OverallConcessionRequest.findOne({
            admissionNumber,
            status: 'APPROVED'
        }).sort({ updatedAt: -1, createdAt: -1 });

        let revisedFees = [];
        if (approvedRequest) {
            revisedFees = approvedRequest.concessions || [];
        }

        // 2. Update or insert concession in the array
        const existingIndex = revisedFees.findIndex(f => 
            String(f.feeHeadId) === String(feeHeadId) && 
            Number(f.studentYear) === sYear && 
            normalizeSemester(f.semester) === sem
        );

        if (existingIndex > -1) {
            revisedFees[existingIndex] = storedEntry;
        } else {
            revisedFees.push(storedEntry);
        }

        // 3. Upsert in MongoDB OverallConcessionRequest table
        if (approvedRequest) {
            approvedRequest.concessions = revisedFees;
            approvedRequest.studentName = resolvedStudentName || approvedRequest.studentName;
            approvedRequest.pinNo       = resolvedPinNo || approvedRequest.pinNo;
            approvedRequest.college     = resolvedCollege || approvedRequest.college;
            approvedRequest.course      = resolvedCourse || approvedRequest.course;
            approvedRequest.branch      = resolvedBranch || approvedRequest.branch;
            approvedRequest.batch       = resolvedBatch || approvedRequest.batch;
            approvedRequest.category    = resolvedCategory || approvedRequest.category;
            approvedRequest.approvedBy  = req.user?.username || approvedRequest.approvedBy || 'system';
            approvedRequest.approvedByName = req.user?.name || approvedRequest.approvedByName || 'System';
            await approvedRequest.save();
        } else {
            approvedRequest = await OverallConcessionRequest.create({
                admissionNumber,
                pinNo:           resolvedPinNo || '-',
                studentName:     resolvedStudentName || '',
                college:         resolvedCollege || '',
                course:          resolvedCourse || '',
                branch:          resolvedBranch || '',
                batch:           resolvedBatch || '',
                category:        resolvedCategory || 'Regular',
                concessions:     revisedFees,
                status:          'APPROVED',
                requestedBy:     req.user?.username || 'system',
                requestedByName: req.user?.name || 'System',
                approvedBy:      req.user?.username || 'system',
                approvedByName:  req.user?.name || 'System'
            });
        }

        const concessionId = approvedRequest._id.toString();

        // 4. Propagate to MongoDB StudentFee collection immediately (only if standard fees already exist for this student and batch)
        const standardFeesApplied = await StudentFee.exists({
            studentId: admissionNumber,
            academicYear: resolvedBatch,
            $or: [{ remarks: { $exists: false } }, { remarks: null }, { remarks: '' }]
        });

        if (standardFeesApplied) {
            const standardFee = await FeeStructure.findOne({
                feeHead: feeHeadId,
                college: resolvedCollege,
                course: resolvedCourse,
                branch: resolvedBranch,
                batch: resolvedBatch,
                category: resolvedCategory,
                studentYear: sYear,
                semester: sem
            }).lean();

            const isTermsDivided = standardFee ? standardFee.isTermsDivided : false;
            const targetAmt = resolveStudentFeeAmount(standardFee ? standardFee.amount : 0, storedEntry);

            await StudentFee.findOneAndUpdate(
                {
                    studentId: admissionNumber,
                    feeHead: feeHeadId,
                    academicYear: resolvedBatch,
                    studentYear: sYear,
                    semester: sem
                },
                {
                    $set: {
                        studentName: resolvedStudentName,
                        college: resolvedCollege || 'ANY',
                        course: resolvedCourse,
                        branch: resolvedBranch,
                        amount: targetAmt,
                        semester: sem,
                        batch: resolvedBatch,
                        stud_type: resolvedCategory,
                        isScholarshipApplicable: false,
                        isTermsDivided: isTermsDivided || false,
                        remarks: storedEntry.remarks || undefined
                    }
                },
                { upsert: true, new: true }
            );

            await applyRevisedConcessionTransactions({
                admissionNumber,
                studentName: resolvedStudentName,
                college: resolvedCollege,
                course: resolvedCourse,
                branch: resolvedBranch,
                batch: resolvedBatch,
                category: resolvedCategory,
                entries: [storedEntry],
                collectedBy: req.user?.username || 'system',
                collectedByName: req.user?.name || 'System'
            });
        }

        res.status(201).json({
            message: 'Revised fee saved successfully',
            concession: {
                id: `${concessionId}_new`,
                admissionNumber,
                ...storedEntry
            }
        });
    } catch (error) {
        console.error('Error saving overall concession:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// @desc    Delete a revised fee (restore standard fees)
// @route   DELETE /api/overall-concessions/:id
const deleteOverallConcession = async (req, res) => {
    try {
        const { id } = req.params;

        // 1. Fetch details first so we can remove corresponding MongoDB records
        const request = await OverallConcessionRequest.findById(id);
        if (!request) {
            return res.status(404).json({ message: 'Concession not found' });
        }

        // 2. Delete from MongoDB
        await OverallConcessionRequest.findByIdAndDelete(id);

        // 3. Parse list of concessions and restore standard fee amounts in MongoDB
        const fees = request.concessions || [];

        await cancelDeclarationConcessionTransactions({
            admissionNumber: request.admissionNumber,
            entries: fees,
            collectedBy: req.user?.username || 'system',
            collectedByName: req.user?.name || 'System'
        });

        const standardFeesApplied = await StudentFee.exists({
            studentId: request.admissionNumber,
            academicYear: request.batch,
            $or: [{ remarks: { $exists: false } }, { remarks: null }, { remarks: '' }]
        });

        let syncResult = null;
        if (standardFeesApplied && Array.isArray(fees) && fees.length > 0) {
            const [students] = await db.query(
                `SELECT admission_number, student_name, college, course, branch, batch, current_year, current_semester, stud_type
                 FROM students WHERE admission_number = ?`,
                [request.admissionNumber]
            );
            if (students.length > 0) {
                syncResult = await syncStandardFees(students[0], request.admissionNumber);
            }
        }

        console.log(`Restored standard fees after concession delete. Sync result:`, syncResult);

        res.json({ message: 'Concession removed and standard fees restored' });
    } catch (error) {
        console.error('Error deleting overall concession:', error);
        res.status(500).json({ message: 'Server Error' });
    }
};

// ── Shared helper: save concessions for ONE student inside a given connection/transaction ──
const _saveStudentConcessions = async ({
    admissionNumber, pinNo, studentName, college, course, branch, batch,
    category, concessions, feeHeads, codeMap, user
}) => {
    // Fetch student's actual parameters from SQL database to resolve any misconfigurations
    let resolvedCollege = college;
    let resolvedCourse = course;
    let resolvedBranch = branch;
    let resolvedBatch = batch;
    let resolvedCategory = category || 'Regular';
    let resolvedStudentName = studentName;
    let resolvedPinNo = pinNo;

    try {
        const [studentRows] = await db.query(
            'SELECT college, course, branch, batch, stud_type, student_name, pin_no FROM students WHERE admission_number = ?',
            [admissionNumber]
        );
        if (studentRows && studentRows.length > 0) {
            const sqlStudent = studentRows[0];
            resolvedCollege = sqlStudent.college || college;
            resolvedCourse = sqlStudent.course || course;
            resolvedBranch = sqlStudent.branch || branch;
            resolvedBatch = sqlStudent.batch || batch;
            resolvedCategory = sqlStudent.stud_type || category || 'Regular';
            resolvedStudentName = sqlStudent.student_name || studentName;
            resolvedPinNo = sqlStudent.pin_no || pinNo;
        }
    } catch (err) {
        console.error('[ConcessionSync] Error fetching student SQL fallback in _saveStudentConcessions:', err);
    }

    // Normalize one entry. For REVISED type, amount=0 means "student pays ₹0" (full waiver).
    // We keep amount=0 in the stored entry so that applyRevisedConcessionTransactions
    // correctly computes concessionCredit = structureAmount - 0 = full structure amount.
    const normalizeIncomingEntry = async (c) => {
        const sem = normalizeSemester(c.semester);
        const resolvedId = resolveFeeHeadId(c, codeMap);
        const resolvedFh = feeHeads.find(fh => fh._id.toString() === resolvedId);
        const amount = getConcessionAmount(c);

        return formatConcessionEntry({
            feeHeadId: resolvedId,
            feeHeadCode: resolvedFh ? resolvedFh.code : (c.feeHeadCode || ''),
            studentYear: Number(c.studentYear),
            semester: sem,
            amount,
            concessionType: c.concessionType,
            remarks: c.remarks
        });
    };

    const updatedConcessions = await Promise.all(concessions.map(normalizeIncomingEntry));

    const validation = await validateRevisedEntriesAgainstStructures({
        entries: updatedConcessions,
        college: resolvedCollege,
        course: resolvedCourse,
        branch: resolvedBranch,
        batch: resolvedBatch,
        category: resolvedCategory,
        admissionNumber,
        codeMap
    });
    if (!validation.ok) {
        return { ok: false, message: validation.message, warnings: validation.warnings };
    }

    let approvedRequest = await OverallConcessionRequest.findOne({
        admissionNumber,
        status: 'APPROVED'
    }).sort({ updatedAt: -1, createdAt: -1 });

    let previousFees = approvedRequest ? approvedRequest.concessions || [] : [];

    if (concessions.length === 0) {
        if (approvedRequest) {
            await OverallConcessionRequest.findByIdAndDelete(approvedRequest._id);
        }
    } else {
        if (approvedRequest) {
            approvedRequest.concessions = updatedConcessions;
            approvedRequest.studentName = resolvedStudentName || approvedRequest.studentName;
            approvedRequest.pinNo       = resolvedPinNo || approvedRequest.pinNo;
            approvedRequest.college     = resolvedCollege || approvedRequest.college;
            approvedRequest.course      = resolvedCourse || approvedRequest.course;
            approvedRequest.branch      = resolvedBranch || approvedRequest.branch;
            approvedRequest.batch       = resolvedBatch || approvedRequest.batch;
            approvedRequest.category    = resolvedCategory || approvedRequest.category;
            approvedRequest.approvedBy  = user?.username || approvedRequest.approvedBy || 'system';
            approvedRequest.approvedByName = user?.name || approvedRequest.approvedByName || 'System';
            await approvedRequest.save();
        } else {
            await OverallConcessionRequest.create({
                admissionNumber,
                pinNo:           resolvedPinNo || '-',
                studentName:     resolvedStudentName || '',
                college:         resolvedCollege || '',
                course:          resolvedCourse || '',
                branch:          resolvedBranch || '',
                batch:           resolvedBatch || '',
                category:        resolvedCategory || 'Regular',
                concessions:     updatedConcessions,
                status:          'APPROVED',
                requestedBy:     user?.username || 'system',
                requestedByName: user?.name || 'System',
                approvedBy:      user?.username || 'system',
                approvedByName:  user?.name || 'System'
            });
        }
    }

    const nextKeys = new Set(
        updatedConcessions
            .filter(e => normalizeConcessionType(e.concessionType) === 'REVISED')
            .map(e => `${e.feeHeadId}_${Number(e.studentYear)}_${normalizeSemester(e.semester) ?? 'null'}`)
    );
    const removedRevised = previousFees.filter(e => {
        if (normalizeConcessionType(e.concessionType) !== 'REVISED') return false;
        const key = `${e.feeHeadId}_${Number(e.studentYear)}_${normalizeSemester(e.semester) ?? 'null'}`;
        return !nextKeys.has(key);
    });
    if (removedRevised.length > 0 || concessions.length === 0) {
        await cancelDeclarationConcessionTransactions({
            admissionNumber,
            entries: concessions.length === 0 ? previousFees : removedRevised,
            collectedBy: user?.username || 'system',
            collectedByName: user?.name || 'System',
            codeMap
        });
    }

    const standardFeesApplied = await StudentFee.exists({
        studentId: admissionNumber,
        academicYear: batch,
        $or: [{ remarks: { $exists: false } }, { remarks: null }, { remarks: '' }]
    });

    if (standardFeesApplied) {
        const [students] = await db.query(
            `SELECT admission_number, student_name, college, course, branch, batch, current_year, current_semester, stud_type
             FROM students WHERE admission_number = ?`,
            [admissionNumber]
        );
        if (students.length > 0) {
            // Pass pre-loaded feeHeads to avoid re-fetching inside syncStandardFees.
            // syncStandardFees internally calls applyRevisedConcessionTransactions,
            // so no separate call needed here.
            await syncStandardFees(students[0], admissionNumber, feeHeads);
        }
    }

    return { ok: true, updatedConcessions };
};

// @desc    Bulk Assign, Update or Delete revised fees (concessions) for a student
// @route   POST /api/overall-concessions/bulk
const bulkSaveOverallConcessions = async (req, res) => {
    const { 
        admissionNumber, pinNo, studentName, college, course, branch, batch,
        category, concessions
    } = req.body;

    if (!admissionNumber || !Array.isArray(concessions)) {
        return res.status(400).json({ message: 'Missing required fields' });
    }

    try {
        const feeHeads = await FeeHead.find({}).lean();
        const { codeMap } = buildFeeHeadMaps(feeHeads);

        const result = await _saveStudentConcessions({
            admissionNumber, pinNo, studentName, college, course,
            branch, batch, category, concessions, feeHeads, codeMap, user: req.user
        });

        if (!result.ok) {
            return res.status(400).json({ message: result.message, warnings: result.warnings });
        }

        const approvedRequest = await OverallConcessionRequest.findOne({
            admissionNumber,
            status: 'APPROVED'
        }).sort({ updatedAt: -1, createdAt: -1 }).lean();

        const responseConcessions = approvedRequest
            ? (approvedRequest.concessions || []).map((c, idx) => ({
                id: `${approvedRequest._id.toString()}_${idx}`,
                ...mapStoredEntryForResponse(c, feeHeads, codeMap)
            }))
            : [];

        res.json({ message: 'Revised fees updated successfully', revisedFees: responseConcessions });

    } catch (error) {
        console.error('Error performing bulk concession update:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// @desc    Bulk save concessions for MULTIPLE students at once
// @route   POST /api/overall-concessions/bulk-multi
const bulkSaveMultipleStudents = async (req, res) => {
    const { students } = req.body;
    if (!Array.isArray(students) || students.length === 0) {
        return res.status(400).json({ message: 'No students provided' });
    }

    try {
        const feeHeads = await FeeHead.find({}).lean();
        const { codeMap } = buildFeeHeadMaps(feeHeads);

        const errors = [];
        let saved = 0;

        // Process in parallel batches of 5 to avoid overwhelming the DB
        // while still being much faster than pure serial execution.
        const CONCURRENCY = 5;
        for (let i = 0; i < students.length; i += CONCURRENCY) {
            const batch = students.slice(i, i + CONCURRENCY);
            const results = await Promise.allSettled(
                batch.map(async (s) => {
                    if (!s.admissionNumber || !Array.isArray(s.concessions)) {
                        return { ok: false, admissionNumber: s.admissionNumber || '?', message: 'Missing required fields' };
                    }
                    const result = await _saveStudentConcessions({
                        admissionNumber: s.admissionNumber,
                        pinNo: s.pinNo,
                        studentName: s.studentName,
                        college: s.college,
                        course: s.course,
                        branch: s.branch,
                        batch: s.batch,
                        category: s.category,
                        concessions: s.concessions,
                        feeHeads, codeMap, user: req.user
                    });
                    return { ...result, admissionNumber: s.admissionNumber };
                })
            );

            for (const outcome of results) {
                if (outcome.status === 'rejected') {
                    const err = outcome.reason;
                    errors.push({ admissionNumber: '?', message: err?.message || String(err) });
                } else {
                    const r = outcome.value;
                    if (!r.ok) {
                        errors.push({ admissionNumber: r.admissionNumber, message: r.message });
                    } else {
                        saved++;
                    }
                }
            }
        }

        res.json({ message: `Saved ${saved} of ${students.length} students`, saved, total: students.length, errors });

    } catch (error) {
        console.error('Error performing bulk-multi concession update:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// ---------------------------------------------------------------------------
// REQUEST WORKFLOW
// ---------------------------------------------------------------------------

// @desc    Submit a concession request for approval
// @route   POST /api/overall-concessions/request
const submitConcessionRequest = async (req, res) => {
    const {
        admissionNumber, pinNo, studentName,
        college, course, branch, batch, category,
        remarks,
        concessions // [{ feeHeadId, feeHeadCode, studentYear, semester, amount, concessionType }]
    } = req.body;

    if (!admissionNumber || !Array.isArray(concessions) || concessions.length === 0) {
        return res.status(400).json({ message: 'admissionNumber and at least one concession entry are required.' });
    }

    try {
        // Resolve student quota from SQL (stud_type). Request.category stores this quota.
        const [studentRows] = await db.query(
            `SELECT admission_number, student_name, pin_no, college, course, branch, batch, stud_type
             FROM students WHERE admission_number = ?`,
            [admissionNumber]
        );
        const student = studentRows[0];
        if (!student) {
            return res.status(404).json({ message: 'Student not found' });
        }

        const studentQuota = (student.stud_type && String(student.stud_type).trim()) || category || 'Regular';
        const snapCollege = student.college || college || '';
        const snapCourse = student.course || course || '';
        const snapBranch = student.branch || branch || '';
        const snapBatch = student.batch || batch || '';
        const snapName = student.student_name || studentName || '';
        const snapPin = student.pin_no || pinNo || '-';

        const feeHeads = await FeeHead.find({}).lean();
        const { codeMap } = buildFeeHeadMaps(feeHeads);

        // Normalize incoming entries.
        // For REVISED type, amount=0 means "student pays ₹0" (full waiver) — keep as-is.
        // applyRevisedConcessionTransactions will compute the credit as structureAmount - 0.
        const normalizedEntries = concessions.map(c => {
            const sem = normalizeSemester(c.semester);
            const resolvedId = resolveFeeHeadId(c, codeMap);
            const resolvedFh = feeHeads.find(fh => fh._id.toString() === resolvedId);
            const cType = String(c.concessionType || 'CONCESSION').trim().toUpperCase() === 'REVISED' ? 'REVISED' : 'CONCESSION';
            const amount = getConcessionAmount(c);

            return {
                feeHeadId:      resolvedId,
                feeHeadCode:    resolvedFh ? resolvedFh.code : (c.feeHeadCode || ''),
                studentYear:    Number(c.studentYear),
                semester:       sem,
                amount,
                concessionType: cType,
                remarks:        c.remarks || ''
            };
        });

        // Find existing PENDING request for this student
        let existingRequest = await OverallConcessionRequest.findOne({
            admissionNumber,
            status: 'PENDING'
        });

        if (existingRequest) {
            // Merge: same feeHeadId + studentYear combo replaces, new combos are added
            const mergedMap = {};
            existingRequest.concessions.forEach(e => {
                mergedMap[`${e.feeHeadId}_${e.studentYear}_${e.semester ?? 'null'}`] = e;
            });
            normalizedEntries.forEach(e => {
                mergedMap[`${e.feeHeadId}_${e.studentYear}_${e.semester ?? 'null'}`] = e;
            });
            existingRequest.concessions = Object.values(mergedMap);
            if (remarks) existingRequest.remarks = remarks;
            existingRequest.requestedBy = req.user?.username || 'Unknown';
            existingRequest.requestedByName = req.user?.name || '';
            // Refresh student snapshot — category = student quota
            existingRequest.studentName = snapName || existingRequest.studentName;
            existingRequest.pinNo       = snapPin || existingRequest.pinNo;
            existingRequest.college     = snapCollege || existingRequest.college;
            existingRequest.course      = snapCourse || existingRequest.course;
            existingRequest.branch      = snapBranch || existingRequest.branch;
            existingRequest.batch       = snapBatch || existingRequest.batch;
            existingRequest.category    = studentQuota;
            await existingRequest.save();
            return res.status(200).json({ message: 'Pending request updated with new entries.', request: existingRequest });
        }

        // No existing pending request — create fresh
        const newRequest = await OverallConcessionRequest.create({
            admissionNumber,
            pinNo:           snapPin,
            studentName:     snapName,
            college:         snapCollege,
            course:          snapCourse,
            branch:          snapBranch,
            batch:           snapBatch,
            category:        studentQuota,
            concessions:     normalizedEntries,
            remarks:         remarks || '',
            status:          'PENDING',
            requestedBy:     req.user?.username || 'Unknown',
            requestedByName: req.user?.name || ''
        });

        res.status(201).json({ message: 'Concession request submitted for approval.', request: newRequest });
    } catch (error) {
        console.error('Error submitting concession request:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// @desc    List all concession requests (admin/superadmin only)
// @route   GET /api/overall-concessions/requests
const getConcessionRequests = async (req, res) => {
    try {
        const { status, college, course, branch, batch, admissionNumber, search, category } = req.query;
        const mongoFilter = {};
        if (status) mongoFilter.status = status.toUpperCase();
        if (admissionNumber) mongoFilter.admissionNumber = admissionNumber;

        const searchTerm = String(search || '').trim();
        const hasExplicitStudentFilters = !!(college || course || branch || batch || category || searchTerm);

        const allowedColleges = await collegeScope.getEffectiveCollegeNames(req.user);
        const userAllowedCourses = (req.user.courses || []).map(c => c.includes('|') ? c.split('|')[1] : c);
        const needsSqlScope = hasExplicitStudentFilters
            || (allowedColleges && allowedColleges.length > 0)
            || userAllowedCourses.length > 0;

        let studentMap = {};

        if (needsSqlScope) {
            let sqlQuery = `SELECT admission_number, stud_type, college, course, branch, batch, student_name, pin_no
                            FROM students WHERE 1=1`;
            const params = [];

            if (college) {
                const requested = college.split(',').map(c => c.trim()).filter(Boolean);
                const scoped = collegeScope.intersectCollegeNames(requested, allowedColleges);
                if (scoped.length === 0) {
                    return res.json([]);
                }
                sqlQuery += ` AND college IN (${scoped.map(() => '?').join(',')})`;
                params.push(...scoped);
            } else if (allowedColleges && allowedColleges.length > 0) {
                sqlQuery += ` AND college IN (${allowedColleges.map(() => '?').join(',')})`;
                params.push(...allowedColleges);
            }

            if (course) {
                if (userAllowedCourses.length > 0 && !userAllowedCourses.includes(course)) {
                    return res.json([]);
                }
                sqlQuery += ` AND course = ?`;
                params.push(course);
            } else if (userAllowedCourses.length > 0) {
                sqlQuery += ` AND course IN (${userAllowedCourses.map(() => '?').join(',')})`;
                params.push(...userAllowedCourses);
            }

            if (branch) {
                sqlQuery += ` AND branch = ?`;
                params.push(branch);
            }
            if (batch) {
                sqlQuery += ` AND batch = ?`;
                params.push(batch);
            }
            if (category) {
                sqlQuery += ` AND stud_type = ?`;
                params.push(category);
            }
            if (searchTerm) {
                sqlQuery += ` AND (student_name LIKE ? OR admission_number LIKE ? OR pin_no LIKE ?)`;
                const searchPattern = `%${searchTerm}%`;
                params.push(searchPattern, searchPattern, searchPattern);
            }

            const [studentRows] = await db.query(sqlQuery, params);
            if (hasExplicitStudentFilters && studentRows.length === 0) {
                return res.json([]);
            }

            studentRows.forEach(s => {
                studentMap[s.admission_number] = s;
            });

            const scopedAdmissionNumbers = studentRows.map(s => s.admission_number);
            if (scopedAdmissionNumbers.length === 0) {
                return res.json([]);
            }

            if (admissionNumber) {
                if (!scopedAdmissionNumbers.includes(admissionNumber)) {
                    return res.json([]);
                }
            } else {
                mongoFilter.admissionNumber = { $in: scopedAdmissionNumbers };
            }
        }

        let mongoQuery = OverallConcessionRequest.find(mongoFilter).sort({ createdAt: -1 });
        if (req.query.limit) {
            mongoQuery = mongoQuery.limit(Number(req.query.limit));
        }
        const requests = await mongoQuery.lean();

        const feeHeads = await FeeHead.find({}).lean();
        const fhById = {};
        const fhByCode = {};
        feeHeads.forEach(fh => {
            fhById[fh._id.toString()] = fh;
            const code = String(fh.code || '').trim().toUpperCase();
            if (code) fhByCode[code] = fh;
        });

        if (Object.keys(studentMap).length === 0) {
            const admissionNos = [...new Set(requests.map(r => r.admissionNumber).filter(Boolean))];
            if (admissionNos.length > 0) {
                const [studentRows] = await db.query(
                    `SELECT id, admission_number, stud_type, college, course, branch, batch, student_name, pin_no
                     FROM students WHERE admission_number IN (?)`,
                    [admissionNos]
                );
                studentRows.forEach(s => {
                    studentMap[s.admission_number] = s;
                });
            }
        }

        // Fetch merit statuses for these students (keyed by admission_number and student_id)
        const admissionNosForMerit = [...new Set(requests.map(r => r.admissionNumber).filter(Boolean))];
        const meritMap = {};
        if (admissionNosForMerit.length > 0) {
            const meritQueryIds = [];
            admissionNosForMerit.forEach(adm => {
                meritQueryIds.push(adm);
                const st = studentMap[adm];
                if (st && st.id) meritQueryIds.push(st.id);
            });

            try {
                const [meritRows] = await db.query(
                    `SELECT student_id, student_year, merit_status, remarks
                     FROM student_merit_status
                     WHERE student_id IN (?)
                     ORDER BY student_year ASC`,
                    [meritQueryIds]
                );
                meritRows.forEach(m => {
                    const matchedStudent = Object.values(studentMap).find(
                        s => String(s.id) === String(m.student_id) || String(s.admission_number).trim() === String(m.student_id).trim()
                    );
                    const admKey = matchedStudent ? String(matchedStudent.admission_number).trim() : String(m.student_id).trim();
                    if (admKey) {
                        if (!meritMap[admKey]) meritMap[admKey] = [];
                        meritMap[admKey].push(m);
                    }
                });
            } catch (mErr) {
                console.error('Error fetching merit status:', mErr.message);
            }
        }

        const enriched = requests.map(r => {
            const student = studentMap[r.admissionNumber];
            const admKey = String(r.admissionNumber || '').trim();
            const studentMerits = meritMap[admKey] || (student ? (meritMap[student.id] || []) : []);
            
            // Pick 1st available year status (Year 1 or 1st record when sorted by student_year ASC)
            const firstMeritRecord = studentMerits.find(m => Number(m.student_year) === 1) || studentMerits[0];
            const firstMeritStatus = firstMeritRecord ? firstMeritRecord.merit_status : '';

            return {
                ...r,
                college: student?.college || r.college,
                course: student?.course || r.course,
                branch: student?.branch || r.branch,
                batch: student?.batch || r.batch,
                studentName: student?.student_name || r.studentName,
                pinNo: student?.pin_no || r.pinNo,
                studentQuota: student?.stud_type || '',
                meritStatus: firstMeritStatus,
                meritStatusRecords: studentMerits,
                // Prefer feeHeadCode (business id) over feeHeadId (ObjectId) for display
                concessions: r.concessions.map(c => {
                    const codeKey = String(c.feeHeadCode || '').trim().toUpperCase();
                    const byCode = codeKey ? fhByCode[codeKey] : null;
                    const byId = fhById[String(c.feeHeadId || '')];
                    const fh = byCode || byId;
                    return {
                        ...c,
                        feeHeadId: fh ? fh._id.toString() : c.feeHeadId,
                        feeHeadName: fh?.name || c.feeHeadCode || 'Unknown',
                        feeHeadCode: fh?.code || c.feeHeadCode || ''
                    };
                })
            };
        });

        // Attach admissions lead reference (lead_data.reference1) by admission number
        const admissionNosForRef = [...new Set(enriched.map(r => r.admissionNumber).filter(Boolean))];
        const referenceMap = {};
        if (admissionNosForRef.length > 0) {
            try {
                const [admRows] = await admissionsDb.query(
                    `SELECT admission_number,
                            COALESCE(
                                NULLIF(JSON_UNQUOTE(JSON_EXTRACT(lead_data, '$.reference1')), ''),
                                NULLIF(JSON_UNQUOTE(JSON_EXTRACT(lead_data, '$.dynamicFields.reference1')), ''),
                                NULLIF(JSON_UNQUOTE(JSON_EXTRACT(lead_data, '$.reference')), ''),
                                NULLIF(JSON_UNQUOTE(JSON_EXTRACT(lead_data, '$.referenceName')), '')
                            ) AS reference_name
                     FROM admissions
                     WHERE admission_number IN (?)`,
                    [admissionNosForRef]
                );
                admRows.forEach(row => {
                    if (row.admission_number) {
                        referenceMap[String(row.admission_number).trim()] = row.reference_name || '';
                    }
                });
            } catch (admErr) {
                console.error('Error fetching admissions references:', admErr.message);
            }
        }

        const withReference = enriched.map(r => ({
            ...r,
            referenceName: referenceMap[String(r.admissionNumber || '').trim()] || ''
        }));

        res.json(withReference);
    } catch (error) {
        console.error('Error fetching concession requests:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// @desc    Approve a concession request — writes to overall_concessions + syncs StudentFee
// @route   PUT /api/overall-concessions/requests/:id/approve
const approveConcessionRequest = async (req, res) => {
    try {
        const { concessionGivenBy } = req.body;
        const request = await OverallConcessionRequest.findById(req.params.id);
        if (!request) return res.status(404).json({ message: 'Request not found' });
        if (request.status !== 'PENDING') return res.status(400).json({ message: `Request is already ${request.status}` });

        const { admissionNumber, pinNo, studentName, college, course, branch, batch, category, concessions } = request;

        // Prefer live student quota (students.stud_type → CONV/MANG/SPOT).
        // Request.category is the quota snapshot; never confuse with student_status.
        const [studentRows] = await db.query(
            `SELECT admission_number, student_name, college, course, branch, batch, current_year, current_semester, stud_type
             FROM students WHERE admission_number = ?`,
            [admissionNumber]
        );
        const student = studentRows[0] || null;
        const effectiveQuota = student?.stud_type || category || 'Regular';
        const effectiveCollege = student?.college || college;
        const effectiveCourse = student?.course || course;
        const effectiveBranch = student?.branch || branch;
        const effectiveBatch = student?.batch || batch;

        // Re-use the exact same bulk-save logic -------------------------
        const feeHeads = await FeeHead.find({}).lean();
        const { codeMap } = buildFeeHeadMaps(feeHeads);

        // Prefer feeHeadCode over stored ObjectId, then persist matching catalog id+code
        const normalizedConcessions = (concessions || []).map(c => {
            const resolvedId = resolveFeeHeadId(c, codeMap);
            const resolvedFh = feeHeads.find(fh => fh._id.toString() === resolvedId);
            return formatConcessionEntry({
                feeHeadId:      resolvedId || c.feeHeadId,
                feeHeadCode:    resolvedFh ? resolvedFh.code : (c.feeHeadCode || ''),
                studentYear:    Number(c.studentYear),
                semester:       normalizeSemester(c.semester),
                amount:         c.amount,
                concessionType: c.concessionType,
                remarks:        c.remarks
            });
        }).filter(e => e.feeHeadId && e.studentYear);

        const validation = await validateRevisedEntriesAgainstStructures({
            entries: normalizedConcessions,
            college: effectiveCollege,
            course: effectiveCourse,
            branch: effectiveBranch,
            batch: effectiveBatch,
            category: effectiveQuota,
            codeMap
        });
        if (!validation.ok) {
            return res.status(400).json({ message: validation.message, warnings: validation.warnings });
        }

        // 1. Fetch existing approved request from MongoDB and merge
        let approvedRequest = await OverallConcessionRequest.findOne({
            admissionNumber,
            status: 'APPROVED'
        }).sort({ updatedAt: -1, createdAt: -1 });

        let existingFees = approvedRequest ? approvedRequest.concessions || [] : [];

        // Merge: request entries override matching keys, preserve others
        const mergedMap = {};
        existingFees.forEach(e => {
            const resolvedId = resolveFeeHeadId(e, codeMap) || String(e.feeHeadId || '');
            const resolvedFh = feeHeads.find(fh => fh._id.toString() === resolvedId);
            const normalizedExisting = formatConcessionEntry({
                feeHeadId:      resolvedId,
                feeHeadCode:    resolvedFh ? resolvedFh.code : (e.feeHeadCode || ''),
                studentYear:    Number(e.studentYear),
                semester:       normalizeSemester(e.semester),
                amount:         e.amount,
                concessionType: e.concessionType,
                remarks:        e.remarks
            });
            const key = `${normalizedExisting.feeHeadId}_${Number(normalizedExisting.studentYear)}_${normalizeSemester(normalizedExisting.semester) ?? 'null'}`;
            mergedMap[key] = normalizedExisting;
        });
        normalizedConcessions.forEach(c => {
            const key = `${c.feeHeadId}_${Number(c.studentYear)}_${normalizeSemester(c.semester) ?? 'null'}`;
            mergedMap[key] = c;
        });
        const mergedFees = Object.values(mergedMap);

        // 1. Mark request as APPROVED first so downstream sync reads updated concessions
        request.concessions      = mergedFees;
        request.status           = 'APPROVED';
        request.category         = effectiveQuota;
        request.college          = effectiveCollege || request.college;
        request.course           = effectiveCourse || request.course;
        request.branch           = effectiveBranch || request.branch;
        request.batch            = effectiveBatch || request.batch;
        request.approvedBy       = req.user?.username || 'Unknown';
        request.approvedByName   = req.user?.name || '';
        request.concessionGivenBy = concessionGivenBy || '';
        await request.save();

        // 2. Re-sync MongoDB StudentFee amounts & apply revised transactions once using preloaded feeHeads
        if (student) {
            await syncStandardFees(student, admissionNumber, feeHeads);
        }

        // Return enriched concessions for frontend to refresh
        const responseConcessions = mergedFees.map((c, idx) => ({
            id: `${request._id.toString()}_${idx}`,
            ...mapStoredEntryForResponse(c, feeHeads, codeMap)
        }));

        res.json({
            message: 'Concession request approved and fees updated.',
            request,
            revisedFees: responseConcessions
        });
    } catch (error) {
        console.error('Error approving concession request:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// @desc    Update the entries of a PENDING concession request (edit before approval)
// @route   PUT /api/overall-concessions/requests/:id
const updateConcessionRequestEntries = async (req, res) => {
    try {
        const { concessions } = req.body;
        if (!Array.isArray(concessions) || concessions.length === 0) {
            return res.status(400).json({ message: 'At least one concession entry is required.' });
        }

        const request = await OverallConcessionRequest.findById(req.params.id);
        if (!request) return res.status(404).json({ message: 'Request not found' });
        if (request.status !== 'PENDING') {
            return res.status(400).json({ message: `Request is already ${request.status}` });
        }

        const feeHeads = await FeeHead.find({}).lean();
        const { codeMap } = buildFeeHeadMaps(feeHeads);

        const normalizedEntries = concessions.map(c => {
            const resolvedId = resolveFeeHeadId(c, codeMap);
            const resolvedFh = feeHeads.find(fh => fh._id.toString() === resolvedId);
            return {
                feeHeadId:      resolvedId,
                feeHeadCode:    resolvedFh ? resolvedFh.code : (c.feeHeadCode || ''),
                studentYear:    Number(c.studentYear),
                semester:       normalizeSemester(c.semester),
                amount:         getConcessionAmount(c),
                concessionType: normalizeConcessionType(c.concessionType)
            };
        }).filter(e => e.feeHeadId && e.studentYear);

        if (normalizedEntries.length === 0) {
            return res.status(400).json({ message: 'No valid concession entries provided.' });
        }

        // Validate REVISED entries against the student's actual structure/quota
        const [studentRows] = await db.query(
            `SELECT college, course, branch, batch, stud_type FROM students WHERE admission_number = ?`,
            [request.admissionNumber]
        );
        const student = studentRows[0];
        const validation = await validateRevisedEntriesAgainstStructures({
            entries: normalizedEntries,
            college: student?.college || request.college,
            course: student?.course || request.course,
            branch: student?.branch || request.branch,
            batch: student?.batch || request.batch,
            category: student?.stud_type || request.category || 'Regular',
            admissionNumber: request.admissionNumber,
            codeMap
        });
        if (!validation.ok) {
            return res.status(400).json({ message: validation.message, warnings: validation.warnings });
        }

        request.concessions = normalizedEntries;
        if (student) {
            request.college = student.college || request.college;
            request.course = student.course || request.course;
            request.branch = student.branch || request.branch;
            request.batch = student.batch || request.batch;
            request.category = student.stud_type || request.category || 'Regular';
        }
        await request.save();

        const enriched = {
            ...request.toObject(),
            studentQuota: student?.stud_type || '',
            concessions: request.concessions.map(c => {
                const fh = feeHeads.find(f => f._id.toString() === String(c.feeHeadId));
                return {
                    ...(c.toObject ? c.toObject() : c),
                    feeHeadName: fh ? fh.name : (c.feeHeadCode || 'Unknown')
                };
            })
        };

        res.json({ message: 'Request updated successfully.', request: enriched });
    } catch (error) {
        console.error('Error updating concession request:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// @desc    Update admissions lead reference for a concession request student
// @route   PUT /api/overall-concessions/requests/:id/reference
const updateConcessionRequestReference = async (req, res) => {
    try {
        const referenceName = String(req.body?.referenceName ?? '').trim();
        const request = await OverallConcessionRequest.findById(req.params.id).lean();
        if (!request) return res.status(404).json({ message: 'Request not found' });

        const admissionNumber = String(request.admissionNumber || '').trim();
        if (!admissionNumber) {
            return res.status(400).json({ message: 'Request has no admission number' });
        }

        if (!admissionsDb?.isConfigured) {
            return res.status(503).json({ message: 'Admissions database is not configured' });
        }

        const [existing] = await admissionsDb.query(
            `SELECT id, lead_data FROM admissions WHERE admission_number = ? LIMIT 1`,
            [admissionNumber]
        );
        if (!existing.length) {
            return res.status(404).json({
                message: `No admissions record found for admission number ${admissionNumber}`
            });
        }

        // Persist into lead_data.reference1 (and dynamicFields.reference1 when present)
        await admissionsDb.query(
            `UPDATE admissions
             SET lead_data = JSON_SET(
                    COALESCE(lead_data, JSON_OBJECT()),
                    '$.reference1', ?,
                    '$.dynamicFields.reference1', ?
                 ),
                 updated_at = NOW()
             WHERE admission_number = ?`,
            [referenceName, referenceName, admissionNumber]
        );

        res.json({
            message: 'Reference updated successfully.',
            admissionNumber,
            referenceName
        });
    } catch (error) {
        console.error('Error updating concession request reference:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// @desc    Reject a concession request
// @route   PUT /api/overall-concessions/requests/:id/reject
const rejectConcessionRequest = async (req, res) => {
    try {
        const { rejectionReason } = req.body;
        const request = await OverallConcessionRequest.findById(req.params.id);
        if (!request) return res.status(404).json({ message: 'Request not found' });
        if (request.status !== 'PENDING') return res.status(400).json({ message: `Request is already ${request.status}` });

        request.status          = 'REJECTED';
        request.rejectionReason = rejectionReason || '';
        request.approvedBy      = req.user?.username || 'Unknown';
        request.approvedByName  = req.user?.name || '';
        await request.save();

        res.json({ message: 'Concession request rejected.', request });
    } catch (error) {
        console.error('Error rejecting concession request:', error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

module.exports = {
    getOverallConcessions,
    saveOverallConcession,
    deleteOverallConcession,
    bulkSaveOverallConcessions,
    bulkSaveMultipleStudents,
    submitConcessionRequest,
    getConcessionRequests,
    approveConcessionRequest,
    updateConcessionRequestEntries,
    updateConcessionRequestReference,
    rejectConcessionRequest
};
