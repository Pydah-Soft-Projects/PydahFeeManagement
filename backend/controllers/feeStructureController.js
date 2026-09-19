const mongoose = require('mongoose');
const FeeStructure = require('../models/FeeStructure');
const StudentFee = require('../models/StudentFee');
const Transaction = require('../models/Transaction');
const FeeHead = require('../models/FeeHead');
const OverallConcessionRequest = require('../models/OverallConcessionRequest');
const DefaultLateFeeConfig = require('../models/DefaultLateFeeConfig');
const ServiceLateFeeConfig = require('../models/ServiceLateFeeConfig');
const db = require('../config/sqlDb');
const {
  resolveStudentFeeAmount,
  buildFeeHeadMaps,
  resolveFeeHeadId
} = require('../utils/overallConcessionFees');
const {
  isDeclarationConcessionTxn,
  allocateTermBalances,
  resolveEffectiveTerms
} = require('../utils/termConcessionAllocation');

// Small in-memory cache — FeeHead list rarely changes and was loaded on every student open
let feeHeadCache = { at: 0, rows: null };
const FEE_HEAD_CACHE_MS = 5 * 60 * 1000;
const getCachedFeeHeads = async () => {
  if (feeHeadCache.rows && Date.now() - feeHeadCache.at < FEE_HEAD_CACHE_MS) {
    return feeHeadCache.rows;
  }
  const rows = await FeeHead.find().sort({ name: 1 }).lean();
  feeHeadCache = { at: Date.now(), rows };
  return rows;
};

const hasPositiveLateFeeAmount = (terms = []) =>
  Array.isArray(terms) && terms.some((t) => Number(t?.lateFeeAmount) > 0);

// Helper to automatically apply a fee structure to all students in the batch
const applyFeeStructureToBatchInternal = async (structure) => {
  if (!structure) return;
  try {
    const [students] = await db.query(`
      SELECT admission_number, student_name, college, course, branch, current_year, current_semester, batch
      FROM students 
      WHERE college = ? AND course = ? AND branch = ? AND batch = ? AND stud_type = ?
    `, [structure.college, structure.course, structure.branch, structure.batch, structure.category]);

    if (students.length === 0) return;

    // Fetch revised fees from MongoDB OverallConcessionRequest collection
    const approvedRequests = await OverallConcessionRequest.find({
        batch: structure.batch,
        status: 'APPROVED'
    }).sort({ updatedAt: -1, createdAt: -1 }).lean();

    // Group by student to get the latest approved request per student
    const studentLatestRequest = {};
    approvedRequests.forEach(req => {
        if (!studentLatestRequest[req.admissionNumber]) {
            studentLatestRequest[req.admissionNumber] = req;
        }
    });

    const concessions = Object.values(studentLatestRequest).map(req => ({
        admission_number: req.admissionNumber,
        revised_fees: req.concessions
    }));
    const feeHeads = await FeeHead.find({}).lean();
    const { codeMap } = buildFeeHeadMaps(feeHeads);
    const revisedFeesMap = {};

    if (concessions.length > 0) {
        concessions.forEach(c => {
            const fees = typeof c.revised_fees === 'string' ? JSON.parse(c.revised_fees) : (c.revised_fees || []);
            if (!Array.isArray(fees)) return;

            const match = fees.find(f => {
                const resolvedId = resolveFeeHeadId(f, codeMap);
                return (
                    resolvedId === structure.feeHead.toString() &&
                    Number(f.studentYear) === Number(structure.studentYear) &&
                    (f.semester === null || f.semester === undefined || Number(f.semester) === Number(structure.semester))
                );
            });

            if (match) {
                revisedFeesMap[c.admission_number] = resolveStudentFeeAmount(structure.amount, match);
            }
        });
    }

    const operations = students.map(s => {
      const targetAmount = revisedFeesMap[s.admission_number] !== undefined 
          ? revisedFeesMap[s.admission_number] 
          : structure.amount;

      return {
        updateOne: {
          filter: {
            studentId: s.admission_number,
            feeHead: structure.feeHead,
            academicYear: structure.batch,
            studentYear: structure.studentYear,
            semester: structure.semester || null,
            $or: [{ remarks: { $exists: false } }, { remarks: null }, { remarks: '' }]
          },
          update: {
            $set: {
              studentName: s.student_name,
              college: s.college,
              course: s.course,
              branch: s.branch,
              amount: targetAmount,
              structureId: structure._id,
              semester: structure.semester,
              batch: s.batch,
              stud_type: structure.category,
              isScholarshipApplicable: structure.isScholarshipApplicable || false,
              isTermsDivided: structure.isTermsDivided || false
            }
          },
          upsert: true
        }
      };
    });

    await StudentFee.bulkWrite(operations);
  } catch (error) {
    console.error('Error in applyFeeStructureToBatchInternal:', error);
  }
};


// @desc    Create/Update Fee Structure (Single or Bulk)
// @route   POST /api/fee-structures
const createFeeStructure = async (req, res) => {
  const { feeHeadId, college, course, branch, batch, category, categories, studentYear, amount, description, semester, isScholarshipApplicable, isTermsDivided, terms, isGroupWiseLateFee } = req.body;

  try {
    // Basic Validation
    if (!feeHeadId || !college || !course || !branch || !batch || !studentYear || amount === undefined || amount === null || amount === '') {
      return res.status(400).json({ message: 'All fields including Batch, Student Year and Amount are required' });
    }

    // Determine categories to process: either key 'categories' (array) or 'category' (single string)
    let catsToProcess = [];
    if (Array.isArray(categories) && categories.length > 0) {
      catsToProcess = categories;
    } else if (category) {
      catsToProcess = [category];
    } else {
      return res.status(400).json({ message: 'Category is required' });
    }

    // Build effective terms first, then only keep/apply a late-fee head when
    // a real late-fee amount is configured on at least one term.
    const rawTerms = (isTermsDivided && Array.isArray(terms) && terms.length > 0)
      ? terms
      : [{ termNumber: 1, percentage: 100, amount: Number(amount) }];
    const termsCount = rawTerms.length;

    const defaultConfig = await DefaultLateFeeConfig.findOne({ termsCount, isActive: true });

    const processedTerms = rawTerms.map(t => {
      const dTerm = defaultConfig?.terms?.find(dt => Number(dt.termNumber) === Number(t.termNumber));
      return {
        ...t,
        dueDateMode: t.dueDateMode || (dTerm ? dTerm.dueDateMode : 'offset'),
        referenceSemester: t.referenceSemester !== undefined ? t.referenceSemester : (dTerm ? dTerm.referenceSemester : undefined),
        dueOffsetDays: (t.dueOffsetDays !== undefined && t.dueOffsetDays !== 0) ? t.dueOffsetDays : (dTerm ? dTerm.dueOffsetDays : 0),
        fixedDueDate: t.fixedDueDate || (dTerm ? dTerm.fixedDueDate : undefined),
        dueDescription: t.dueDescription || (dTerm ? dTerm.dueDescription : '')
      };
    });

    const hasConfiguredLateFee = hasPositiveLateFeeAmount(processedTerms);
    let autoLateFeeHead = req.body.lateFeeHead || null;
    if (!hasConfiguredLateFee) {
      autoLateFeeHead = null;
    } else if (!autoLateFeeHead && defaultConfig && defaultConfig.lateFeeHead) {
      autoLateFeeHead = defaultConfig.lateFeeHead;
    }

    let collegeId = null;
    let courseId = null;
    let branchId = null;

    try {
      const [colRows] = await db.query('SELECT id FROM colleges WHERE name = ?', [college]);
      if (colRows.length > 0) {
        collegeId = colRows[0].id;
        const [crsRows] = await db.query('SELECT id FROM courses WHERE name = ? AND college_id = ?', [course, collegeId]);
        if (crsRows.length > 0) {
          courseId = crsRows[0].id;
          const [brRows] = await db.query('SELECT id FROM course_branches WHERE name = ? AND course_id = ?', [branch, courseId]);
          if (brRows.length > 0) {
            branchId = brRows[0].id;
          }
        }
      }
    } catch (sqlErr) {
      console.error('Error resolving IDs in createFeeStructure:', sqlErr);
    }

    const results = [];
    const errors = [];

    for (const cat of catsToProcess) {
      try {
        // Build clear query and update objects
        // Strict Type Casting to ensure we match the unique index exactly
        const sYear = Number(studentYear);
        const sem = semester ? Number(semester) : null;

        const query = {
          feeHead: mongoose.Types.ObjectId.isValid(feeHeadId) ? new mongoose.Types.ObjectId(feeHeadId) : feeHeadId,
          college,
          course,
          branch,
          batch,
          category: cat,
          studentYear: sYear,
          semester: sem // Explicitly null if falsy to match index
        };

        const update = {
          $set: {
            amount: Number(amount),
            description,
            isScholarshipApplicable: isScholarshipApplicable || false,
            isTermsDivided: isTermsDivided || false,
            terms: processedTerms,
            semester: sem, // Explicitly set/update semester in document to match index
            isGroupWiseLateFee: hasConfiguredLateFee ? !!isGroupWiseLateFee : false,
            lateFeeHead: autoLateFeeHead || null,
            collegeId,
            courseId,
            branchId
          }
        };

        const options = { new: true, upsert: true, runValidators: true };

        const structure = await FeeStructure.findOneAndUpdate(query, update, options);
        
        await StudentFee.updateMany(
          {
            $and: [
              {
                $or: [
                  { structureId: structure._id },
                  {
                    feeHead: feeHeadId,
                    college,
                    course,
                    branch,
                    academicYear: batch, // academicYear stores batch string
                    studentYear: sYear,
                    semester: sem,
                    stud_type: cat
                  }
                ]
              },
              {
                $or: [
                  { remarks: { $exists: false } },
                  { remarks: null },
                  { remarks: '' }
                ]
              }
            ]
          },
          {
            $set: {
              isScholarshipApplicable: isScholarshipApplicable || false,
              isTermsDivided: isTermsDivided || false
            }
          }
        );

        await applyFeeStructureToBatchInternal(structure);
        results.push(structure);
      } catch (err) {
        console.error(`Error saving fee structure for category ${cat}:`, err.message);
        if (err.code === 11000) {
          console.error("Duplicate Key Collision Details:", err.keyValue);
        }
        errors.push({ category: cat, error: err.message });
      }
    }

    // Consolidated Response
    if (results.length > 0) {
      const msg = errors.length > 0
        ? `Saved for ${results.length} categories. Failed for ${errors.length}.`
        : `Fee definitions created successfully for ${results.length} categories.`;

      return res.status(201).json({
        message: msg,
        results,
        errors
      });
    } else {
      // All failed
      return res.status(500).json({
        message: 'Failed to create fee structures.',
        errors
      });
    }

  } catch (error) {
    console.error("Error creating fee structure:", error);
    res.status(500).json({ message: 'Server Error', error: error.message });
  }
};

// @desc    Get All Fee Structures
// @route   GET /api/fee-structures
const getFeeStructures = async (req, res) => {
  try {
    const { college, course, branch, batch, category } = req.query;
    const filter = {};
    if (college) filter.college = college;
    if (course) filter.course = course;
    if (branch) filter.branch = branch;
    if (batch) filter.batch = batch;
    if (category) filter.category = category;

    const structures = await FeeStructure.find(filter)
      .populate('feeHead', 'name code')
      .populate('lateFeeHead', 'name code')
      .sort({ studentYear: 1, createdAt: -1 });
    res.json(structures);
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Get Student Fee Details (Due vs Paid) from StudentFee table (Explicit Assignment)
// @route   GET /api/fee-structures/student/:admissionNo
// @query   college, course, branch, academicYear, studentYear, dueSourceType
const getStudentFeeDetails = async (req, res) => {
  const { admissionNo } = req.params;
  const { academicYear, studentYear: queryYear, dueSourceType } = req.query;

  try {
    // 1. Fetch Student Info (to get current batch and year)
    const [students] = await db.query('SELECT id, student_name, current_year, batch, current_semester, scholar_status, college, course, branch, stud_type, is_scholar_applicable FROM students WHERE admission_number = ?', [admissionNo]);
    const student = students[0];

    // Fetch scholarship records for semester-wise lookup
    let scholarshipRows = [];
    if (student) {
        [scholarshipRows] = await db.query(
            `SELECT student_year, student_semester, eligible 
             FROM student_scholarship 
             WHERE student_id = ?`,
            [student.id]
        );
    }

    const getScholarshipStatus = (year, semester) => {
        if (!student) return null;
        const yr = Number(year);
        const currentYearRecords = scholarshipRows.filter(s => Number(s.student_year) === yr);

        if (currentYearRecords.length > 0) {
            if (semester) {
                const sem = Number(semester);
                const match = currentYearRecords.find(s => Number(s.student_semester) === sem);
                if (match) return match.eligible;
                // Fallback to yearly record in current year
                const yearlyMatch = currentYearRecords.find(s => !s.student_semester);
                if (yearlyMatch) return yearlyMatch.eligible;
                return null;
            } else {
                const hasEligible = currentYearRecords.some(s => String(s.eligible).toLowerCase() === 'eligible');
                return hasEligible ? 'eligible' : currentYearRecords[0].eligible;
            }
        } else {
            // Fallback to previous year last semester
            const prevYear = yr - 1;
            if (prevYear > 0) {
                const prevYearMatch = scholarshipRows.find(s => 
                    Number(s.student_year) === prevYear && 
                    Number(s.student_semester) === 2
                );
                if (prevYearMatch) {
                    return prevYearMatch.eligible;
                }
                const prevYearYearlyMatch = scholarshipRows.find(s => 
                    Number(s.student_year) === prevYear && 
                    !s.student_semester
                );
                if (prevYearYearlyMatch) {
                    return prevYearYearlyMatch.eligible;
                }
            }
            // Fallback to student table flag
            return (student && student.is_scholar_applicable) ? 'eligible' : null;
        }
    };
    const currentYear = (student && student.current_year) ? Number(student.current_year) : (Number(queryYear) || 1);
    const batch = student ? student.batch : '';
    const college = student ? student.college : '';
    const course = student ? student.course : '';
    const branch = student ? student.branch : '';
    const category = student ? student.stud_type : 'Regular';

    // NOTE: Do NOT auto-sync club/transport/hostel/standard fees here.
    // That path hits SQL + fee Mongo + transport Mongo + hostel Mongo and made
    // Fee Collection student loads very slow. Sync only via POST /students/:id/sync-fees.

    // 2–5. Fetch structures, demands, transactions, and fee heads in parallel
    const [applicableStructures, rawStudentFees, transactions, feeHeads, serviceConfigs] = await Promise.all([
      FeeStructure.find({
        college,
        course,
        branch,
        batch,
        category
      }).lean(),
      StudentFee.find({ studentId: admissionNo }).populate('feeHead', 'name code').lean(),
      Transaction.find({ studentId: admissionNo, status: { $ne: 'cancelled' } }).lean(),
      getCachedFeeHeads(),
      ServiceLateFeeConfig.find({ isActive: { $ne: false } })
        .select('type applicableFeeHead academicYear defaultTermsCount defaultTerms lateFeeRules')
        .lean()
    ]);

    // Filter out orphan 'Default' college demands if student has demands matching their college
    const hasRealCollegeFees = rawStudentFees.some(f => f.college && f.college !== 'Default');
    const studentFees = hasRealCollegeFees 
      ? rawStudentFees.filter(f => f.college !== 'Default')
      : rawStudentFees;

    // Map structures by [headId-year-semester] for quick lookup
    const structureMap = {};
    applicableStructures.forEach(fs => {
      const key = `${fs.feeHead.toString()}-${fs.studentYear}-${fs.semester || 'null'}`;
      structureMap[key] = fs;
    });

    // Hostel/Transport heads have no FeeStructure — their term split comes from
    // the per-academic-year service config (Late Fees > Hostel/Transport Config).
    const serviceTermsMap = {};
    (serviceConfigs || []).forEach(cfg => {
      if (!cfg.applicableFeeHead || !cfg.academicYear) return;
      const terms = (cfg.defaultTerms || [])
        .filter(t => t && Number(t.percentage) > 0)
        .map((t, idx) => ({
          termNumber: Number(t.termNumber) || idx + 1,
          percentage: Number(t.percentage) || 0
        }));
      if (terms.length === 0) return;
      serviceTermsMap[`${cfg.applicableFeeHead.toString()}|${String(cfg.academicYear).trim()}`] = terms;
    });

    const getServiceTerms = (headId, feeAcademicYear) => {
      if (!headId || !feeAcademicYear) return null;
      return serviceTermsMap[`${headId}|${String(feeAcademicYear).trim()}`] || null;
    };

    const groupedData = {};

    const getGroupKey = (headId, year, feeCode, remarks, semester) => {
      const semKey = semester ? `S${semester}` : 'Y';
      if (feeCode === 'CF' || feeCode === 'SSF') {
        return `${headId}-${year}-${semKey}-${remarks || 'General'}`;
      }
      if (feeCode === 'TRN' || feeCode === 'TRN01') {
        return `${headId}-${year}-transport`;
      }
      return `${headId}-${year}-${semKey}`;
    };

    // Prefer an existing demand row for the same head+year when semester differs
    // (e.g. application CREDIT on Sem 1 vs demand on Sem null for OTH/TUI).
    // Keeps application + declaration concessions on one fee-head row.
    const resolveTxnGroupKey = (headId, year, feeCode, remarks, semester) => {
      const exactKey = getGroupKey(headId, year, feeCode, remarks, semester);

      // Club / transport keep their specialized keys — no cross-semester merge
      if (feeCode === 'CF' || feeCode === 'SSF' || feeCode === 'TRN' || feeCode === 'TRN01') {
        return exactKey;
      }

      const yearPrefix = `${headId}-${year}-`;
      const candidates = Object.keys(groupedData).filter((k) => k.startsWith(yearPrefix));
      const withDemand = candidates
        .map((k) => ({ k, amt: Number(groupedData[k].totalAmount) || 0 }))
        .filter((x) => x.amt > 0)
        .sort((a, b) => b.amt - a.amt);

      // Always attach payments/credits to a real demand for this head+year when one exists
      if (withDemand.length > 0) return withDemand[0].k;
      if (groupedData[exactKey]) return exactKey;
      return exactKey;
    };

    const formatServiceFeeName = (headName, remarks) => {
      if (!remarks) return headName;
      // Clean "Service Request: Name (Ref: 123)" -> "Name"
      let name = remarks.replace(/^Service Request:\s*/i, '').replace(/\s*\(Ref:.*?\)\s*$/i, '');
      return `${headName} - ${name.trim()}`;
    };

    // A. Initialize with actual Demands
    studentFees.forEach(fee => {
      const hId = fee.feeHead ? fee.feeHead._id.toString() : 'unknown';
      const hCode = fee.feeHead ? fee.feeHead.code : '';
      const year = String(fee.studentYear || 1);
      const key = getGroupKey(hId, year, hCode, fee.remarks, fee.semester);

      if (!groupedData[key]) {
        // Find matching structure for terms
        const structKey = `${hId}-${year}-${fee.semester || 'null'}`;
        const matchedStructure = structureMap[structKey];
        // Hostel/Transport: ServiceLateFeeConfig default terms win over FeeStructure
        const serviceTerms = getServiceTerms(hId, fee.academicYear);
        const effectiveTerms = serviceTerms || matchedStructure?.terms;

        groupedData[key] = {
          _id: fee._id, // Keep the actual demand ID if found
          feeHeadId: fee.feeHead ? fee.feeHead._id : null,
          feeHeadName: (fee.feeHead && (fee.feeHead.code === 'CF' || fee.feeHead.code === 'SSF')) ? formatServiceFeeName(fee.feeHead.name, fee.remarks) : (fee.feeHead ? fee.feeHead.name : 'Unknown'),
          feeHeadCode: fee.feeHead ? fee.feeHead.code : '',
          academicYear: fee.academicYear || batch,
          studentYear: year,
          semester: fee.semester,
          totalAmount: 0,
          concessionAmount: 0,
          declarationConcessionAmount: 0,
          applicationConcessionAmount: 0,
          extraDemandAmount: 0,
          paidAmount: 0,
          dueAmount: 0,
          isActive: fee.isActive !== false,
          remarks: fee.remarks, // Important to pass back to frontend for correct payment matching
          remarksList: fee.remarks ? [fee.remarks] : [],
          isScholarshipApplicable: fee.isScholarshipApplicable || false,
          isTermsDivided: serviceTerms
            ? serviceTerms.length > 1
            : (fee.isTermsDivided !== undefined ? fee.isTermsDivided : (matchedStructure ? matchedStructure.isTermsDivided : false)),
          studentScholarStatus: getScholarshipStatus(year, fee.semester) || 'not_eligible',
          // Non-divided structures still expose Term 1 (100%) for dues + late-fee display
          terms: resolveEffectiveTerms(
            effectiveTerms,
            fee.amount || matchedStructure?.amount || 0
          )
        };
      } else {
        if (fee.remarks && !groupedData[key].remarksList.includes(fee.remarks)) {
          groupedData[key].remarksList.push(fee.remarks);
          groupedData[key].remarks = groupedData[key].remarksList.join('\n');
        }
      }
      groupedData[key].totalAmount += (fee.amount || 0);
    });

    // B. Inject Default Fee Heads ONLY for years where a FeeStructure exists
    // This ensures that if a structure is deleted, it doesn't show up as an "empty" due
    applicableStructures.forEach(fs => {
      const hId = fs.feeHead.toString();
      const year = String(fs.studentYear);
      const head = feeHeads.find(h => h._id.toString() === hId);
      if (!head) return;

      const key = getGroupKey(hId, year, head.code, null, fs.semester);
      if (!groupedData[key]) {
        groupedData[key] = {
          _id: `temp-${hId}-${year}-${fs.semester || 'null'}`,
          feeHeadId: hId,
          feeHeadName: head.name,
          feeHeadCode: head.code || '',
          academicYear: batch,
          studentYear: year,
          semester: fs.semester || null,
          totalAmount: 0,
          concessionAmount: 0,
          declarationConcessionAmount: 0,
          applicationConcessionAmount: 0,
          extraDemandAmount: 0,
          paidAmount: 0,
          dueAmount: 0,
          isActive: true,
          isScholarshipApplicable: fs.isScholarshipApplicable || false,
          studentScholarStatus: getScholarshipStatus(fs.studentYear, fs.semester) || 'not_eligible',
          isTermsDivided: fs.isTermsDivided || false,
          terms: resolveEffectiveTerms(fs.terms, fs.amount || 0)
        };
      }
    });

    // C. Aggregate Transactions by (Head, Year)
    transactions.forEach(t => {
      if (t.feeHead) {
        const hId = t.feeHead.toString();
        const year = String(t.studentYear || 1);

        const head = feeHeads.find(h => h._id.toString() === hId);
        const hCode = head ? head.code : '';
        const key = resolveTxnGroupKey(hId, year, hCode, t.remarks, t.semester);

        // If we have a payment for a head/year that wasn't previously in grouping, add it
        if (!groupedData[key]) {
          const structKey = `${hId}-${year}-${t.semester || 'null'}`;
          const matchedStructure = structureMap[structKey];

          groupedData[key] = {
            _id: `pay-${hId}-${year}-${t.semester || 'null'}`,
            feeHeadId: hId,
            feeHeadName: (head && (head.code === 'CF' || head.code === 'SSF')) ? formatServiceFeeName(head.name, t.remarks) : (head ? head.name : 'Unknown'),
            feeHeadCode: head ? head.code : '',
            academicYear: batch,
            studentYear: year,
            semester: t.semester || null,
            totalAmount: 0,
            concessionAmount: 0,
            declarationConcessionAmount: 0,
            applicationConcessionAmount: 0,
            extraDemandAmount: 0,
            paidAmount: 0,
            dueAmount: 0,
            isActive: true,
            isScholarshipApplicable: matchedStructure?.isScholarshipApplicable || false,
            studentScholarStatus: getScholarshipStatus(year, t.semester) || 'not_eligible',
            terms: resolveEffectiveTerms(
              matchedStructure?.terms,
              matchedStructure?.amount || 0
            )
          };
        }
        if (t.transactionType === 'DEBIT') {
          if (t.remarks === 'Extra Demand as per declaration') {
            groupedData[key].extraDemandAmount = (groupedData[key].extraDemandAmount || 0) + (t.amount || 0);
            groupedData[key].totalAmount += (t.amount || 0);
          } else {
            groupedData[key].paidAmount += (t.amount || 0);
          }
        } else if (t.transactionType === 'CREDIT') {
          const amt = t.amount || 0;
          groupedData[key].concessionAmount += amt;
          if (isDeclarationConcessionTxn(t)) {
            groupedData[key].declarationConcessionAmount += amt;
          } else {
            groupedData[key].applicationConcessionAmount += amt;
          }
        }
      } else {
        // Global Credits/Concessions (no specific feeHead)
      }
    });

    // Drop empty stub rows created only by mismatched-semester credits that
    // were remapped onto a real demand (total/paid/concession all zero).
    Object.keys(groupedData).forEach((k) => {
      const row = groupedData[k];
      const empty =
        Number(row.totalAmount || 0) === 0 &&
        Number(row.paidAmount || 0) === 0 &&
        Number(row.concessionAmount || 0) === 0;
      if (empty && String(row._id || '').startsWith('pay-')) {
        delete groupedData[k];
      }
    });

    // D. Final Calculation + term-wise concession distribution
    // Non–terms-divided heads are treated as Term 1 (100%).
    let processedResults = Object.values(groupedData).map(item => {
      item.declarationConcessionAmount = Number(item.declarationConcessionAmount) || 0;
      item.applicationConcessionAmount = Number(item.applicationConcessionAmount) || 0;
      item.concessionAmount = Number(item.concessionAmount) || 0;
      item.dueAmount = Math.max(0, item.totalAmount - item.paidAmount - item.concessionAmount);

      item.terms = resolveEffectiveTerms(item.terms, item.totalAmount);
      const allocation = allocateTermBalances({
        totalAmount: item.totalAmount,
        terms: item.terms,
        paidAmount: item.paidAmount,
        declarationConcession: item.declarationConcessionAmount,
        applicationConcession: item.applicationConcessionAmount
      });
      item.termBalances = allocation.terms;
      return item;
    });

    // Apply global credits (not tied to a specific fee head) as application concessions
    let globalCreditPool = transactions.reduce((acc, t) => {
      if (!t.feeHead && t.transactionType === 'CREDIT') {
        return acc + (t.amount || 0);
      }
      return acc;
    }, 0);

    if (globalCreditPool > 0) {
      // Sort by year to apply credit to oldest dues first
      processedResults.sort((a, b) => Number(a.studentYear) - Number(b.studentYear));
      processedResults.forEach(item => {
        if (item.dueAmount > 0 && globalCreditPool > 0) {
          const allocationAmt = Math.min(item.dueAmount, globalCreditPool);
          item.concessionAmount += allocationAmt;
          item.applicationConcessionAmount = (Number(item.applicationConcessionAmount) || 0) + allocationAmt;
          item.dueAmount -= allocationAmt;
          globalCreditPool -= allocationAmt;

          item.terms = resolveEffectiveTerms(item.terms, item.totalAmount);
          const allocation = allocateTermBalances({
            totalAmount: item.totalAmount,
            terms: item.terms,
            paidAmount: item.paidAmount,
            declarationConcession: item.declarationConcessionAmount,
            applicationConcession: item.applicationConcessionAmount
          });
          item.termBalances = allocation.terms;
        }
      });
    }

    const isLateFeeRow = (r) => {
      const name = String(r.feeHeadName || '');
      const code = String(r.feeHeadCode || '');
      const remarks = String(r.remarks || '');
      return /late\s*fee/i.test(name) || /late\s*fee/i.test(code) || /late\s*fee/i.test(remarks);
    };

    // Filter by academicYear if requested.
    // Shared LATE FEE head may store AY only in remarks: "Transport Fee (2026-2027) - ..."
    if (academicYear) {
      const ay = String(academicYear).trim();
      processedResults = processedResults.filter((r) => {
        if (String(r.academicYear || '').trim() === ay) return true;
        if (isLateFeeRow(r) && String(r.remarks || '').includes(ay)) return true;
        // Also check remarksList if present
        if (isLateFeeRow(r) && Array.isArray(r.remarksList) && r.remarksList.some((x) => String(x || '').includes(ay))) {
          return true;
        }
        return false;
      });
    }

    // Filter by due source (Academic / Hostel / Transport) for reminder send previews.
    // All late fees (academic / hostel / transport) share ONE "LATE FEE" head —
    // distinguish them by remarks, e.g. "Transport Fee (2026-2027) - Term 1 Late Fee".
    const source = String(dueSourceType || '').toUpperCase();

    if (source === 'HOSTEL' || source === 'TRANSPORT') {
      const matchedConfigs = (serviceConfigs || [])
        .filter((c) => String(c.type || '').toUpperCase() === source)
        .filter((c) => !academicYear || String(c.academicYear).trim() === String(academicYear).trim());

      const serviceHeads = new Set(
        matchedConfigs.map((c) => String(c.applicableFeeHead)).filter(Boolean)
      );

      processedResults = processedResults.filter((r) => {
        const headId = r.feeHeadId ? String(r.feeHeadId) : '';
        const code = String(r.feeHeadCode || '');
        const name = String(r.feeHeadName || '');
        const remarks = String(r.remarks || '');

        // Main applicable head dues (transport / hostel fee itself)
        if (headId && serviceHeads.has(headId)) return true;
        if (source === 'TRANSPORT' && (/trn/i.test(code) || (/transport/i.test(name) && !isLateFeeRow(r)))) {
          return true;
        }
        if (source === 'HOSTEL' && (/hos/i.test(code) || (/hostel/i.test(name) && !isLateFeeRow(r)))) {
          return true;
        }

        // Shared LATE FEE head → keep only rows whose remarks identify this source
        if (isLateFeeRow(r)) {
          if (source === 'TRANSPORT') return /transport/i.test(remarks);
          return /hostel/i.test(remarks);
        }

        return false;
      });
    } else if (source === 'ACADEMIC') {
      const serviceHeadIds = new Set(
        (serviceConfigs || [])
          .map((c) => String(c.applicableFeeHead))
          .filter(Boolean)
      );

      processedResults = processedResults.filter((r) => {
        const headId = r.feeHeadId ? String(r.feeHeadId) : '';
        const code = String(r.feeHeadCode || '');
        const name = String(r.feeHeadName || '');
        const remarks = String(r.remarks || '');

        // Exclude hostel/transport main heads
        if (headId && serviceHeadIds.has(headId)) return false;
        if (/trn/i.test(code) || (/transport/i.test(name) && !isLateFeeRow(r))) return false;
        if (/hos/i.test(code) || (/hostel/i.test(name) && !isLateFeeRow(r))) return false;

        // Shared LATE FEE head → exclude hostel/transport late fees (identified by remarks)
        if (isLateFeeRow(r)) {
          if (/transport/i.test(remarks) || /hostel/i.test(remarks)) return false;
          return true; // academic late fee (or group late fee remarks without transport/hostel)
        }

        return true;
      });
    }

    // Sort for display (Year descending, Name ascending)
    processedResults.sort((a, b) => {
      if (a.studentYear !== b.studentYear) return Number(b.studentYear) - Number(a.studentYear);
      return a.feeHeadName.localeCompare(b.feeHeadName);
    });

    res.json(processedResults);

  } catch (error) {
    console.error("Error in getStudentFeeDetails:", error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Update Fee Structure
// @route   PUT /api/fee-structures/:id
const updateFeeStructure = async (req, res) => {
  const { id } = req.params;
  const { feeHeadId, college, course, branch, batch, category, studentYear, amount, description, semester, isScholarshipApplicable, isTermsDivided, terms, lateFeeHead } = req.body;
  const user = req.user ? req.user.username : 'system';

  try {
    const existing = await FeeStructure.findById(id);
    if (!existing) return res.status(404).json({ message: 'Fee Structure not found' });

    // History Logic
    const historyEntry = {
      updatedBy: user,
      updatedAt: new Date(),
      changeDescription: `Updated amount from ${existing.amount} to ${amount}`
    };

    const fHead = feeHeadId || req.body.feeHead;
    const finalFeeHead = mongoose.Types.ObjectId.isValid(fHead) ? new mongoose.Types.ObjectId(fHead) : (fHead?._id || fHead);

    const hasConfiguredLateFee = hasPositiveLateFeeAmount(terms);
    let finalLateFeeHead = existing.lateFeeHead;
    if (!hasConfiguredLateFee) {
      finalLateFeeHead = null;
    } else if (lateFeeHead !== undefined) {
      if (!lateFeeHead) {
        finalLateFeeHead = null;
      } else {
        const lfHead = lateFeeHead?._id || lateFeeHead;
        finalLateFeeHead = mongoose.Types.ObjectId.isValid(lfHead) ? new mongoose.Types.ObjectId(lfHead) : lfHead;
      }
    }

    const updatedStructure = await FeeStructure.findByIdAndUpdate(
      id,
      {
        feeHead: finalFeeHead,
        college,
        course,
        branch,
        batch,
        category,
        studentYear,
        semester,
        amount,
        description,
        isScholarshipApplicable,
        isTermsDivided: isTermsDivided || false,
        lateFeeHead: finalLateFeeHead,
        // Non-divided structures still persist as Term 1 (100%) for dues + late fee
        terms: (isTermsDivided && Array.isArray(terms) && terms.length > 0)
          ? terms
          : [{ termNumber: 1, percentage: 100, amount: Number(amount) || 0, dueDescription: 'Term 1' }],
        isGroupWiseLateFee: hasConfiguredLateFee ? !!req.body.isGroupWiseLateFee : false,
        $push: { history: historyEntry }
      },
      { new: true }
    );

    await StudentFee.updateMany(
      {
        $and: [
          {
            $or: [
              { structureId: existing._id },
              {
                feeHead: existing.feeHead,
                college: existing.college,
                course: existing.course,
                branch: existing.branch,
                academicYear: existing.batch, // academicYear stores batch string
                studentYear: existing.studentYear,
                semester: existing.semester,
                stud_type: existing.category
              }
            ]
          },
          {
            $or: [
              { remarks: { $exists: false } },
              { remarks: null },
              { remarks: '' }
            ]
          }
        ]
      },
      {
        $set: {
          isScholarshipApplicable: isScholarshipApplicable || false,
          isTermsDivided: isTermsDivided || false
        }
      }
    );

    await applyFeeStructureToBatchInternal(updatedStructure);
    res.json(updatedStructure);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Delete Fee Structure
// @route   DELETE /api/fee-structures/:id
const deleteFeeStructure = async (req, res) => {
  const { id } = req.params;
  try {
    const structure = await FeeStructure.findById(id);
    if (!structure) {
      return res.status(404).json({ message: 'Fee Structure not found' });
    }

    // Cascading Deletion: Remove StudentFee assignments matching this structure's context
    // We match by the primary fields that define the structure's applicability
    const deleteCount = await StudentFee.deleteMany({
      feeHead: structure.feeHead,
      college: structure.college,
      course: structure.course,
      branch: structure.branch,
      academicYear: structure.batch, // academicYear stores batch string
      studentYear: structure.studentYear,
      semester: structure.semester,
      stud_type: structure.category
    });

    console.log(`Cascading Deletion: Removed ${deleteCount.deletedCount} student fee records for structure ${id}`);

    await FeeStructure.findByIdAndDelete(id);
    res.json({ message: 'Fee Structure and related student assignments removed' });
  } catch (error) {
    console.error("Error in deleteFeeStructure:", error);
    res.status(500).json({ message: 'Server Error' });
  }
};

module.exports = {
  createFeeStructure,
  getFeeStructures,
  getStudentFeeDetails,
  updateFeeStructure,
  deleteFeeStructure
};
