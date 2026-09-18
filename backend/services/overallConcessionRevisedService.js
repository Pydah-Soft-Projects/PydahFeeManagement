const FeeStructure = require('../models/FeeStructure');
const FeeHead = require('../models/FeeHead');
const Transaction = require('../models/Transaction');
const StudentFee = require('../models/StudentFee');
const {
  normalizeSemester,
  normalizeConcessionType,
  getConcessionAmount,
  resolveFeeHeadId,
  buildFeeHeadMaps
} = require('../utils/overallConcessionFees');

const DECLARATION_CONCESSION_REMARKS = 'Concession as per declaration';

const findMatchingFeeStructure = async ({
  feeHeadId,
  college,
  course,
  branch,
  batch,
  category,
  studentYear,
  semester
}) => {
  const sem = normalizeSemester(semester);
  const base = {
    feeHead: feeHeadId,
    college,
    course,
    branch,
    batch,
    category: category || 'Regular',
    studentYear: Number(studentYear)
  };

  let structure = await FeeStructure.findOne({
    ...base,
    semester: sem
  }).lean();

  if (!structure && sem === null) {
    structure = await FeeStructure.findOne({
      ...base,
      $or: [{ semester: null }, { semester: { $exists: false } }]
    }).lean();
  }

  return structure;
};

const validateRevisedEntriesAgainstStructures = async ({
  entries,
  college,
  course,
  branch,
  batch,
  category,
  admissionNumber,
  codeMap = {}
}) => {
  let resolvedCollege = college;
  let resolvedCourse = course;
  let resolvedBranch = branch;
  let resolvedBatch = batch;
  let resolvedCategory = category || 'Regular';

  if (admissionNumber && (!college || !course || !branch || !batch)) {
    try {
      const db = require('../config/sqlDb');
      const [studentRows] = await db.query(
        'SELECT college, course, branch, batch, stud_type FROM students WHERE admission_number = ?',
        [admissionNumber]
      );
      if (studentRows && studentRows.length > 0) {
        const sqlStudent = studentRows[0];
        resolvedCollege = sqlStudent.college || college;
        resolvedCourse = sqlStudent.course || course;
        resolvedBranch = sqlStudent.branch || branch;
        resolvedBatch = sqlStudent.batch || batch;
        resolvedCategory = sqlStudent.stud_type || category || 'Regular';
      }
    } catch (err) {
      console.error('[ConcessionSync] Error fetching student SQL fallback in validateRevisedEntriesAgainstStructures:', err);
    }
  }

  const warnings = [];
  const revisedEntries = (entries || []).filter(
    (e) => normalizeConcessionType(e.concessionType) === 'REVISED'
  );

  if (revisedEntries.length === 0) {
    return { ok: true, warnings: [], message: '' };
  }

  // Batch-fetch all relevant structures in one query instead of one per entry.
  const feeHeadIds = [...new Set(
    revisedEntries.map(e => resolveFeeHeadId(e, codeMap) || String(e.feeHeadId || '')).filter(Boolean)
  )];
  const studentYears = [...new Set(revisedEntries.map(e => Number(e.studentYear)).filter(Boolean))];

  const structures = await FeeStructure.find({
    feeHead: { $in: feeHeadIds },
    college: resolvedCollege,
    course: resolvedCourse,
    branch: resolvedBranch,
    batch: resolvedBatch,
    category: resolvedCategory || 'Regular',
    studentYear: { $in: studentYears }
  }).lean();

  // Build a lookup map: feeHeadId_year_sem → structure
  const structureMap = {};
  for (const s of structures) {
    const sem = normalizeSemester(s.semester);
    const key = `${s.feeHead}_${s.studentYear}_${sem ?? 'null'}`;
    structureMap[key] = s;
    // Also index with null semester as fallback
    if (sem !== null) {
      const nullKey = `${s.feeHead}_${s.studentYear}_null`;
      if (!structureMap[nullKey]) structureMap[nullKey] = s;
    }
  }

  for (const entry of revisedEntries) {
    const feeHeadId = resolveFeeHeadId(entry, codeMap) || String(entry.feeHeadId || '');
    const studentYear = Number(entry.studentYear);
    const semester = normalizeSemester(entry.semester);
    const revisedAmount = getConcessionAmount(entry);
    const label = entry.feeHeadCode || feeHeadId;

    if (!feeHeadId || !studentYear) {
      warnings.push(`Invalid REVISED entry for fee head ${label}.`);
      continue;
    }

    const key = `${feeHeadId}_${studentYear}_${semester ?? 'null'}`;
    const structure = structureMap[key];

    if (!structure) continue;
  }

  return {
    ok: warnings.length === 0,
    warnings,
    message: warnings.length
      ? `Cannot approve/save: ${warnings.join(' ')}`
      : ''
  };
};

const buildDeclarationTxnFilter = ({
  admissionNumber,
  feeHeadId,
  studentYear
}) => ({
  studentId: admissionNumber,
  feeHead: feeHeadId,
  studentYear: String(studentYear),
  transactionType: 'CREDIT',
  remarks: DECLARATION_CONCESSION_REMARKS,
  status: { $ne: 'cancelled' }
});

const upsertDeclarationConcessionTransaction = async ({
  admissionNumber,
  studentName,
  feeHeadId,
  studentYear,
  semester,
  amount,
  collectedBy,
  collectedByName
}) => {
  // Match by head + year + declaration remarks only (semester may differ across syncs)
  const filter = buildDeclarationTxnFilter({
    admissionNumber,
    feeHeadId,
    studentYear
  });

  const existing = await Transaction.findOne(filter);

  if (amount <= 0) {
    if (existing) {
      existing.status = 'cancelled';
      existing.cancellationReason = 'Revised fee no longer requires concession';
      existing.cancelledAt = new Date();
      existing.cancelledBy = collectedBy || 'system';
      existing.cancelledByName = collectedByName || 'System';
      await existing.save();
      return { cancelled: 1, created: 0, updated: 0 };
    }
    return { cancelled: 0, created: 0, updated: 0 };
  }

  const sem = normalizeSemester(semester);
  const semValue = sem === null ? null : String(sem);

  if (existing) {
    let changed = false;
    if (Number(existing.amount) !== Number(amount)) {
      existing.amount = amount;
      changed = true;
    }
    if (existing.paymentMode !== 'Credit') {
      existing.paymentMode = 'Credit';
      changed = true;
    }
    const existingSem = normalizeSemester(existing.semester);
    if (existingSem !== sem) {
      existing.semester = semValue;
      changed = true;
    }
    if (collectedBy && existing.collectedBy !== collectedBy) {
      existing.collectedBy = collectedBy;
      changed = true;
    }
    if (collectedByName && existing.collectedByName !== collectedByName) {
      existing.collectedByName = collectedByName;
      changed = true;
    }
    if (changed) await existing.save();
    return { cancelled: 0, created: 0, updated: changed ? 1 : 0 };
  }

  const timestamp = Date.now().toString().slice(-6);
  const random = Math.floor(100 + Math.random() * 900).toString();

  await Transaction.create({
    studentId: admissionNumber,
    studentName: studentName || '',
    feeHead: feeHeadId,
    amount,
    transactionType: 'CREDIT',
    paymentMode: 'Credit',
    receiptNumber: `DECL${timestamp}${random}`,
    paymentDate: new Date(),
    remarks: DECLARATION_CONCESSION_REMARKS,
    studentYear: String(studentYear),
    semester: semValue,
    collectedBy: collectedBy || 'system',
    collectedByName: collectedByName || 'System'
  });

  return { cancelled: 0, created: 1, updated: 0 };
};

// Variant that accepts an already-fetched Mongoose doc to avoid an extra findOne per entry.
const upsertDeclarationConcessionTransactionWithExisting = async ({
  admissionNumber,
  studentName,
  feeHeadId,
  studentYear,
  semester,
  amount,
  collectedBy,
  collectedByName,
  existingDoc // Mongoose document or null
}) => {
  const existing = existingDoc;

  if (amount <= 0) {
    if (existing) {
      existing.status = 'cancelled';
      existing.cancellationReason = 'Revised fee no longer requires concession';
      existing.cancelledAt = new Date();
      existing.cancelledBy = collectedBy || 'system';
      existing.cancelledByName = collectedByName || 'System';
      await existing.save();
      return { cancelled: 1, created: 0, updated: 0 };
    }
    return { cancelled: 0, created: 0, updated: 0 };
  }

  const sem = normalizeSemester(semester);
  const semValue = sem === null ? null : String(sem);

  if (existing) {
    let changed = false;
    if (Number(existing.amount) !== Number(amount)) { existing.amount = amount; changed = true; }
    if (existing.paymentMode !== 'Credit') { existing.paymentMode = 'Credit'; changed = true; }
    if (normalizeSemester(existing.semester) !== sem) { existing.semester = semValue; changed = true; }
    if (collectedBy && existing.collectedBy !== collectedBy) { existing.collectedBy = collectedBy; changed = true; }
    if (collectedByName && existing.collectedByName !== collectedByName) { existing.collectedByName = collectedByName; changed = true; }
    if (changed) await existing.save();
    return { cancelled: 0, created: 0, updated: changed ? 1 : 0 };
  }

  const timestamp = Date.now().toString().slice(-6);
  const random = Math.floor(100 + Math.random() * 900).toString();
  await Transaction.create({
    studentId: admissionNumber,
    studentName: studentName || '',
    feeHead: feeHeadId,
    amount,
    transactionType: 'CREDIT',
    paymentMode: 'Credit',
    receiptNumber: `DECL${timestamp}${random}`,
    paymentDate: new Date(),
    remarks: DECLARATION_CONCESSION_REMARKS,
    studentYear: String(studentYear),
    semester: semValue,
    collectedBy: collectedBy || 'system',
    collectedByName: collectedByName || 'System'
  });
  return { cancelled: 0, created: 1, updated: 0 };
};

const upsertDeclarationDemandTransactionWithExisting = async ({
  admissionNumber,
  studentName,
  feeHeadId,
  studentYear,
  semester,
  amount,
  collectedBy,
  collectedByName,
  existingDoc // Mongoose document or null
}) => {
  const existing = existingDoc;

  if (amount <= 0) {
    if (existing) {
      existing.status = 'cancelled';
      existing.cancellationReason = 'Revised fee no longer requires extra demand';
      existing.cancelledAt = new Date();
      existing.cancelledBy = collectedBy || 'system';
      existing.cancelledByName = collectedByName || 'System';
      await existing.save();
      return { cancelled: 1, created: 0, updated: 0 };
    }
    return { cancelled: 0, created: 0, updated: 0 };
  }

  const sem = normalizeSemester(semester);
  const semValue = sem === null ? null : String(sem);

  if (existing) {
    let changed = false;
    if (Number(existing.amount) !== Number(amount)) { existing.amount = amount; changed = true; }
    if (existing.paymentMode !== 'Adjustment') { existing.paymentMode = 'Adjustment'; changed = true; }
    if (normalizeSemester(existing.semester) !== sem) { existing.semester = semValue; changed = true; }
    if (collectedBy && existing.collectedBy !== collectedBy) { existing.collectedBy = collectedBy; changed = true; }
    if (collectedByName && existing.collectedByName !== collectedByName) { existing.collectedByName = collectedByName; changed = true; }
    if (changed) await existing.save();
    return { cancelled: 0, created: 0, updated: changed ? 1 : 0 };
  }

  const timestamp = Date.now().toString().slice(-6);
  const random = Math.floor(100 + Math.random() * 900).toString();
  await Transaction.create({
    studentId: admissionNumber,
    studentName: studentName || '',
    feeHead: feeHeadId,
    amount,
    transactionType: 'DEBIT',
    paymentMode: 'Adjustment',
    receiptNumber: `DEMD${timestamp}${random}`,
    paymentDate: new Date(),
    remarks: 'Extra Demand as per declaration',
    studentYear: String(studentYear),
    semester: semValue,
    collectedBy: collectedBy || 'system',
    collectedByName: collectedByName || 'System'
  });
  return { cancelled: 0, created: 1, updated: 0 };
};

const upsertDeclarationDemandTransaction = async ({
  admissionNumber,
  feeHeadId,
  studentYear,
  semester,
  amount,
  collectedBy,
  collectedByName
}) => {
  const existing = await Transaction.findOne({
    studentId: admissionNumber,
    feeHead: feeHeadId,
    studentYear: String(studentYear),
    transactionType: 'DEBIT',
    remarks: 'Extra Demand as per declaration',
    status: { $ne: 'cancelled' }
  });
  return upsertDeclarationDemandTransactionWithExisting({
    admissionNumber,
    feeHeadId,
    studentYear,
    semester,
    amount,
    collectedBy,
    collectedByName,
    existingDoc: existing
  });
};

const applyRevisedConcessionTransactions = async ({
  admissionNumber,
  studentName,
  college,
  course,
  branch,
  batch,
  category,
  entries,
  collectedBy,
  collectedByName,
  codeMap = null
}) => {
  let resolvedCollege = college;
  let resolvedCourse = course;
  let resolvedBranch = branch;
  let resolvedBatch = batch;
  let resolvedCategory = category || 'Regular';

  if (admissionNumber && (!college || !course || !branch || !batch)) {
    try {
      const db = require('../config/sqlDb');
      const [studentRows] = await db.query(
        'SELECT college, course, branch, batch, stud_type FROM students WHERE admission_number = ?',
        [admissionNumber]
      );
      if (studentRows && studentRows.length > 0) {
        const sqlStudent = studentRows[0];
        resolvedCollege = sqlStudent.college || college;
        resolvedCourse = sqlStudent.course || course;
        resolvedBranch = sqlStudent.branch || branch;
        resolvedBatch = sqlStudent.batch || batch;
        resolvedCategory = sqlStudent.stud_type || category || 'Regular';
      }
    } catch (err) {
      console.error('[ConcessionSync] Error fetching student SQL fallback in applyRevisedConcessionTransactions:', err);
    }
  }

  let maps = codeMap;
  if (!maps) {
    const feeHeads = await FeeHead.find({}).lean();
    maps = buildFeeHeadMaps(feeHeads).codeMap;
  }

  const revisedEntries = (entries || []).filter(
    (e) => normalizeConcessionType(e.concessionType) === 'REVISED'
  );

  if (revisedEntries.length === 0) return { created: 0, updated: 0, cancelled: 0, skipped: 0 };

  // ── Batch-fetch all needed fee structures in one query ──
  const feeHeadIds = [...new Set(
    revisedEntries.map(e => resolveFeeHeadId(e, maps) || String(e.feeHeadId || '')).filter(Boolean)
  )];
  const studentYears = [...new Set(revisedEntries.map(e => Number(e.studentYear)).filter(Boolean))];

  const allStructures = await FeeStructure.find({
    feeHead: { $in: feeHeadIds },
    college: resolvedCollege,
    course: resolvedCourse,
    branch: resolvedBranch,
    batch: resolvedBatch,
    category: resolvedCategory || 'Regular',
    studentYear: { $in: studentYears }
  }).lean();

  const structureMap = {};
  for (const s of allStructures) {
    const sem = normalizeSemester(s.semester);
    const key = `${s.feeHead}_${s.studentYear}_${sem ?? 'null'}`;
    if (!structureMap[key]) structureMap[key] = s;
    if (sem !== null && !structureMap[`${s.feeHead}_${s.studentYear}_null`]) {
      structureMap[`${s.feeHead}_${s.studentYear}_null`] = s;
    }
  }

  // ── Batch-fetch all existing DECL credit transactions for this student ──
  const existingTxns = await Transaction.find({
    studentId: admissionNumber,
    feeHead: { $in: feeHeadIds },
    transactionType: 'CREDIT',
    remarks: DECLARATION_CONCESSION_REMARKS,
    status: { $ne: 'cancelled' }
  });

  const txnMap = {};
  for (const t of existingTxns) {
    const key = `${t.feeHead}_${t.studentYear}`;
    txnMap[key] = t;
  }

  // ── Batch-fetch all existing Extra Demand debit transactions for this student ──
  const existingDemandTxns = await Transaction.find({
    studentId: admissionNumber,
    feeHead: { $in: feeHeadIds },
    transactionType: 'DEBIT',
    remarks: 'Extra Demand as per declaration',
    status: { $ne: 'cancelled' }
  });

  const demandTxnMap = {};
  for (const t of existingDemandTxns) {
    const key = `${t.feeHead}_${t.studentYear}`;
    demandTxnMap[key] = t;
  }

  // ── Batch-fetch StudentFee demands for fallback (no structure case) ──
  const existingDemands = await StudentFee.find({
    studentId: admissionNumber,
    feeHead: { $in: feeHeadIds },
    studentYear: { $in: studentYears.map(String) }
  }).lean();

  const demandMap = {};
  for (const d of existingDemands) {
    const key = `${d.feeHead}_${d.studentYear}`;
    demandMap[key] = d;
  }

  let created = 0;
  let updated = 0;
  let cancelled = 0;
  let skipped = 0;

  for (const entry of revisedEntries) {
    const feeHeadId = resolveFeeHeadId(entry, maps) || String(entry.feeHeadId || '');
    const studentYear = Number(entry.studentYear);
    const semester = normalizeSemester(entry.semester);
    const revisedAmount = getConcessionAmount(entry);

    if (!feeHeadId || !studentYear) {
      skipped += 1;
      continue;
    }

    const structKey = `${feeHeadId}_${studentYear}_${semester ?? 'null'}`;
    const structure = structureMap[structKey];
    const liveDemand = demandMap[`${feeHeadId}_${studentYear}`] || demandMap[`${feeHeadId}_${String(studentYear)}`];

    let structureAmount = 0;
    if (structure) {
      structureAmount = Number(structure.amount) || 0;
    } else if (liveDemand) {
      structureAmount = Number(liveDemand.amount) || 0;
    } else {
      skipped += 1;
      continue;
    }

    // Align txn semester with the live StudentFee demand
    let effectiveSemester = semester;
    if (effectiveSemester === null || effectiveSemester === undefined || effectiveSemester === '') {
      if (liveDemand && liveDemand.semester !== undefined && liveDemand.semester !== null && liveDemand.semester !== '') {
        effectiveSemester = liveDemand.semester;
      } else if (structure && structure.semester !== undefined && structure.semester !== null) {
        effectiveSemester = structure.semester;
      }
    }

    let concessionAmount = 0;
    let extraDemandAmount = 0;

    if (revisedAmount > structureAmount) {
      extraDemandAmount = revisedAmount - structureAmount;
    } else {
      concessionAmount = structureAmount - revisedAmount;
    }

    // Upsert credit concession transaction
    const existingTxn = txnMap[`${feeHeadId}_${String(studentYear)}`];
    const resultCredit = await upsertDeclarationConcessionTransactionWithExisting({
      admissionNumber,
      studentName,
      feeHeadId,
      studentYear,
      semester: effectiveSemester,
      amount: concessionAmount,
      collectedBy,
      collectedByName,
      existingDoc: existingTxn || null
    });

    // Upsert debit extra demand transaction
    const existingDemandTxn = demandTxnMap[`${feeHeadId}_${String(studentYear)}`];
    const resultDebit = await upsertDeclarationDemandTransactionWithExisting({
      admissionNumber,
      studentName,
      feeHeadId,
      studentYear,
      semester: effectiveSemester,
      amount: extraDemandAmount,
      collectedBy,
      collectedByName,
      existingDoc: existingDemandTxn || null
    });

    created += resultCredit.created + resultDebit.created;
    updated += resultCredit.updated + resultDebit.updated;
    cancelled += resultCredit.cancelled + resultDebit.cancelled;
  }

  return { created, updated, cancelled, skipped };
};

const cancelDeclarationConcessionTransactions = async ({
  admissionNumber,
  entries,
  collectedBy,
  collectedByName,
  codeMap = null
}) => {
  let maps = codeMap;
  if (!maps) {
    const feeHeads = await FeeHead.find({}).lean();
    maps = buildFeeHeadMaps(feeHeads).codeMap;
  }

  let cancelled = 0;
  for (const entry of entries || []) {
    if (normalizeConcessionType(entry.concessionType) !== 'REVISED') continue;
    const feeHeadId = resolveFeeHeadId(entry, maps) || String(entry.feeHeadId || '');
    if (!feeHeadId) continue;

    const resCredit = await upsertDeclarationConcessionTransaction({
      admissionNumber,
      feeHeadId,
      studentYear: Number(entry.studentYear),
      semester: entry.semester,
      amount: 0,
      collectedBy,
      collectedByName
    });

    const resDebit = await upsertDeclarationDemandTransaction({
      admissionNumber,
      feeHeadId,
      studentYear: Number(entry.studentYear),
      semester: entry.semester,
      amount: 0,
      collectedBy,
      collectedByName
    });

    cancelled += resCredit.cancelled + resDebit.cancelled;
  }
  return { cancelled };
};

/** Permanently delete DECL concessions and extra demands for a student. */
const cancelAllDeclarationConcessionTransactions = async ({
  admissionNumber
}) => {
  const result = await Transaction.deleteMany({
    studentId: admissionNumber,
    remarks: { $in: [DECLARATION_CONCESSION_REMARKS, 'Extra Demand as per declaration'] }
  });

  return { cancelled: result.deletedCount || 0, deleted: result.deletedCount || 0 };
};

module.exports = {
  DECLARATION_CONCESSION_REMARKS,
  findMatchingFeeStructure,
  validateRevisedEntriesAgainstStructures,
  applyRevisedConcessionTransactions,
  cancelDeclarationConcessionTransactions,
  cancelAllDeclarationConcessionTransactions
};
