const FeeStructure = require('../models/FeeStructure');
const StudentFee = require('../models/StudentFee');
const Transaction = require('../models/Transaction');
const FeeHead = require('../models/FeeHead');
const OverallConcessionRequest = require('../models/OverallConcessionRequest');
const db = require('../config/sqlDb');
const { getHostelConnection, connectHostelDB } = require('../config/dbHostel');
const { getTransportConnection, connectTransportDB } = require('../config/dbTransport');
const {
  buildRevisedFeesMap,
  buildConcessionLookupKey,
  resolveStudentFeeAmount,
  buildFeeHeadMaps
} = require('../utils/overallConcessionFees');
const { applyRevisedConcessionTransactions, cancelAllDeclarationConcessionTransactions } = require('./overallConcessionRevisedService');

const STUDENT_SELECT = `
  SELECT id, admission_number, student_name, current_year, batch, current_semester,
         college, course, branch, stud_type, college_id, course_id, branch_id
  FROM students
  WHERE admission_number = ?
`;

/**
 * Only APPROVED overall-concession requests drive revised demand + DECL credits
 * during nightly sync. Pending/rejected/direct SQL rows alone are ignored here.
 */
const loadApprovedOverallConcessionEntries = async (admissionNo) => {
  const approved = await OverallConcessionRequest.findOne({
    admissionNumber: admissionNo,
    status: 'APPROVED'
  })
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();

  if (!approved || !Array.isArray(approved.concessions) || approved.concessions.length === 0) {
    return [];
  }
  return approved.concessions;
};

const loadRevisedFeesMapForStudent = async (admissionNo, preloadedFeeHeads = null) => {
  const fees = await loadApprovedOverallConcessionEntries(admissionNo);
  if (fees.length === 0) return {};

  const feeHeads = preloadedFeeHeads || await FeeHead.find({}).lean();
  const { codeMap } = buildFeeHeadMaps(feeHeads);
  return buildRevisedFeesMap(fees, codeMap);
};

const resolveTargetAmount = (structureAmount, revisedFeesMap, fs) => {
  const fsKey = buildConcessionLookupKey(
    fs.feeHead.toString(),
    fs.studentYear,
    fs.semester
  );

  if (revisedFeesMap[fsKey] === undefined) {
    return structureAmount;
  }

  return resolveStudentFeeAmount(structureAmount, revisedFeesMap[fsKey]);
};

const normalizeSemester = (semester) => {
  if (semester === null || semester === undefined || semester === '') return null;
  return Number(semester);
};

/** Match Number or String studentYear stored in Mongo. */
const studentYearQuery = (studentYear) => {
  const n = Number(studentYear);
  if (!Number.isFinite(n)) return studentYear;
  return { $in: [n, String(n)] };
};

const isVagueTransportRemarks = (remarks) => {
  const existing = String(remarks || '').trim();
  return !existing || /^transport$/i.test(existing);
};

const isVagueHostelRemarks = (remarks) => {
  const existing = String(remarks || '').trim();
  return !existing || /^hostel$/i.test(existing);
};

const getTransactionsForDemand = async (admissionNo, feeHeadId, studentYear) => (
  Transaction.find({
    studentId: admissionNo,
    feeHead: feeHeadId,
    studentYear: String(studentYear),
    status: 'active'
  }).sort({ paymentDate: 1 })
);

const resolveSemesterForDemand = async (admissionNo, feeHeadId, studentYear, preferredSemester) => {
  const txs = await getTransactionsForDemand(admissionNo, feeHeadId, studentYear);
  if (txs.length > 0) {
    return normalizeSemester(txs[0].semester);
  }
  return preferredSemester ?? null;
};

const findMergeableStudentFee = async ({
  admissionNo,
  feeHeadId,
  academicYear,
  studentYear,
  semester,
  remarks,
  matchByRemarks = false
}) => {
  const yearQ = studentYearQuery(studentYear);

  if (matchByRemarks && remarks) {
    const byRemarks = await StudentFee.findOne({
      studentId: admissionNo,
      feeHead: feeHeadId,
      academicYear,
      studentYear: yearQ,
      remarks
    });
    if (byRemarks) return byRemarks;

    // Legacy remarks omitted academic year — e.g. "Hostel: Girls Hostel - B"
    // New format: "Hostel: Girls Hostel - B (2026-2027)"
    const legacyBase = String(remarks).replace(/\s*\(\d{4}-\d{4}\)\s*$/, '').trim();
    const sameYearFees = await StudentFee.find({
      studentId: admissionNo,
      feeHead: feeHeadId,
      academicYear,
      studentYear: yearQ
    }).sort({ createdAt: 1 });

    if (legacyBase) {
      const legacyMatch = sameYearFees.find((f) => {
        const existing = String(f.remarks || '').trim();
        if (!existing) return false;
        if (existing === legacyBase) return true;
        if (existing === remarks) return true;
        // Same hostel/transport base with any year suffix
        const existingBase = existing.replace(/\s*\(\d{4}-\d{4}\)\s*$/, '').trim();
        return existingBase === legacyBase;
      });
      if (legacyMatch) return legacyMatch;
    }

    // Older transport assignments used bare remarks like "Transport"
    const vagueTransport = sameYearFees.find((f) => isVagueTransportRemarks(f.remarks));
    if (vagueTransport) return vagueTransport;

    const vagueHostel = sameYearFees.find((f) => isVagueHostelRemarks(f.remarks));
    if (vagueHostel) return vagueHostel;

    // Broader legacy match: bare "Transport"/"Hostel" often has WRONG or missing academicYear
    // (manual assign / old sync) while studentYear is correct — still upgrade that row.
    const isTransportRemark = /^transport:/i.test(String(remarks).trim()) || /^transport$/i.test(legacyBase);
    const isHostelRemark = /^hostel:/i.test(String(remarks).trim()) || /^hostel$/i.test(legacyBase);

    if (isTransportRemark || isHostelRemark) {
      // 1) Same studentYear, any academicYear, vague remarks
      const byStudentYear = await StudentFee.find({
        studentId: admissionNo,
        feeHead: feeHeadId,
        studentYear: yearQ
      }).sort({ createdAt: 1 });

      const vagueBySy = byStudentYear.find((f) =>
        isTransportRemark ? isVagueTransportRemarks(f.remarks) : isVagueHostelRemarks(f.remarks)
      );
      if (vagueBySy) return vagueBySy;

      // 2) Same academicYear, any studentYear, vague remarks
      const byAy = await StudentFee.find({
        studentId: admissionNo,
        feeHead: feeHeadId,
        academicYear
      }).sort({ createdAt: 1 });

      const vagueByAy = byAy.find((f) =>
        isTransportRemark ? isVagueTransportRemarks(f.remarks) : isVagueHostelRemarks(f.remarks)
      );
      if (vagueByAy) return vagueByAy;
    }

    // Transport/Hostel: never merge onto a different route/hostel demand
    // (would overwrite the request fare with another amount).
    return null;
  }

  const exact = await StudentFee.findOne({
    studentId: admissionNo,
    feeHead: feeHeadId,
    academicYear,
    studentYear: yearQ,
    semester: semester ?? null
  });
  if (exact) return exact;

  const sameYearFees = await StudentFee.find({
    studentId: admissionNo,
    feeHead: feeHeadId,
    academicYear,
    studentYear: yearQ
  }).sort({ createdAt: 1 });

  if (sameYearFees.length > 0) {
    const txs = await getTransactionsForDemand(admissionNo, feeHeadId, studentYear);
    if (txs.length > 0) {
      const txSemester = normalizeSemester(txs[0].semester);
      const matched = sameYearFees.find(f => normalizeSemester(f.semester) === txSemester);
      if (matched) return matched;

      const nullSemFee = sameYearFees.find(f => normalizeSemester(f.semester) === null);
      if (nullSemFee) return nullSemFee;

      return sameYearFees[0];
    }

    const sameSemesterFees = sameYearFees.filter(
      f => normalizeSemester(f.semester) === normalizeSemester(semester)
    );
    if (sameSemesterFees.length > 0) return sameSemesterFees[0];
  }

  const txs = await getTransactionsForDemand(admissionNo, feeHeadId, studentYear);
  if (txs.length > 0) {
    const broaderMatch = await StudentFee.findOne({
      studentId: admissionNo,
      feeHead: feeHeadId,
      studentYear: yearQ
    }).sort({ createdAt: 1 });
    if (broaderMatch) return broaderMatch;
  }

  return null;
};

const consolidateStudentFeeDemands = async (admissionNo, feeHeadId, academicYear, studentYear) => {
  const allFees = await StudentFee.find({
    studentId: admissionNo,
    feeHead: feeHeadId,
    academicYear,
    studentYear
  }).sort({ createdAt: 1 });

  if (allFees.length <= 1) return;

  const txs = await getTransactionsForDemand(admissionNo, feeHeadId, studentYear);
  let fees = allFees;

  if (txs.length === 0) {
    const distinctSemesters = new Set(allFees.map(f => normalizeSemester(f.semester)));
    if (distinctSemesters.size > 1) return;
  } else {
    const txSemester = normalizeSemester(txs[0].semester);
    fees = allFees.filter(f => {
      const feeSemester = normalizeSemester(f.semester);
      return feeSemester === txSemester || feeSemester === null || txSemester === null;
    });
    if (fees.length <= 1) return;
  }

  const txSemester = txs.length > 0 ? normalizeSemester(txs[0].semester) : null;

  let canonical = fees.find(f => normalizeSemester(f.semester) === txSemester)
    || fees.find(f => (f.amount || 0) > 0)
    || fees[0];

  const maxAmount = Math.max(...fees.map(f => Number(f.amount) || 0));
  if (maxAmount > (canonical.amount || 0)) {
    canonical.amount = maxAmount;
  }

  if (txs.length > 0) {
    canonical.semester = txSemester;
  }

  const bestRemarks = fees.find(f => f.remarks)?.remarks;
  if (bestRemarks && !canonical.remarks) {
    canonical.remarks = bestRemarks;
  }

  await canonical.save();

  for (const fee of fees) {
    if (fee._id.equals(canonical._id)) continue;
    await StudentFee.deleteOne({ _id: fee._id });
  }
};

const upsertStudentFeeDemand = async ({
  admissionNo,
  student,
  feeHeadId,
  academicYear,
  studentYear,
  semester,
  amount,
  remarks,
  matchByRemarks = false,
  extraFields = {}
}) => {
  let created = 0;
  let updated = 0;

  const existingFee = await findMergeableStudentFee({
    admissionNo,
    feeHeadId,
    academicYear,
    studentYear,
    semester,
    remarks,
    matchByRemarks
  });

  if (existingFee) {
    let changed = false;

    if (Number(existingFee.amount) !== Number(amount)) {
      existingFee.amount = amount;
      changed = true;
    }

    // Keep student profile strings in sync (for branch/course transfers)
    if (student.student_name && existingFee.studentName !== student.student_name) {
      existingFee.studentName = student.student_name;
      changed = true;
    }
    if (student.college && existingFee.college !== student.college) {
      existingFee.college = student.college;
      changed = true;
    }
    if (student.course && existingFee.course !== student.course) {
      existingFee.course = student.course;
      changed = true;
    }
    if (student.branch && existingFee.branch !== student.branch) {
      existingFee.branch = student.branch;
      changed = true;
    }
    if (student.stud_type && existingFee.stud_type !== student.stud_type) {
      existingFee.stud_type = student.stud_type;
      changed = true;
    }

    if (remarks && existingFee.remarks !== remarks) {
      existingFee.remarks = remarks;
      changed = true;
    }

    if (semester !== undefined && normalizeSemester(existingFee.semester) !== normalizeSemester(semester)) {
      existingFee.semester = semester ?? null;
      changed = true;
    }

    if (academicYear && existingFee.academicYear !== academicYear) {
      existingFee.academicYear = academicYear;
      changed = true;
    }

    if (Number(existingFee.studentYear) !== Number(studentYear)) {
      existingFee.studentYear = studentYear;
      changed = true;
    }

    Object.entries(extraFields).forEach(([key, value]) => {
      if (value !== undefined && existingFee[key] !== value) {
        existingFee[key] = value;
        changed = true;
      }
    });

    if (changed) {
      await existingFee.save();
      updated += 1;
    }

    // Transport/Hostel request rows are unique by remarks — do not consolidate
    // (would merge routes / take max amount and wipe the request fare).
    if (!matchByRemarks) {
      await consolidateStudentFeeDemands(admissionNo, feeHeadId, academicYear, studentYear);
    }
    return { created, updated };
  }

  const resolvedSemester = await resolveSemesterForDemand(
    admissionNo,
    feeHeadId,
    studentYear,
    semester
  );

  await StudentFee.create({
    studentId: admissionNo,
    studentName: student.student_name || '',
    feeHead: feeHeadId,
    college: student.college || 'ANY',
    course: student.course || 'ANY',
    branch: student.branch || 'ANY',
    academicYear,
    studentYear,
    semester: resolvedSemester,
    amount,
    batch: student.batch,
    stud_type: student.stud_type,
    remarks: remarks || undefined,
    ...extraFields
  });
  created += 1;

  if (!matchByRemarks) {
    await consolidateStudentFeeDemands(admissionNo, feeHeadId, academicYear, studentYear);
  }
  return { created, updated };
};

const syncClubFees = async (student, admissionNo) => {
  let created = 0;
  const [approvedClubs] = await db.query(`
    SELECT cm.club_id, c.membership_fee, c.name
    FROM club_members cm
    JOIN clubs c ON cm.club_id = c.id
    WHERE cm.student_id = ? AND cm.status = 'approved'
  `, [student.id]);

  if (approvedClubs.length === 0) return { created };

  const clubFeeHead = await FeeHead.findOne({ code: 'CF' });
  if (!clubFeeHead) return { created };

  for (const club of approvedClubs) {
    const remarksKey = `Club Fee: ${club.name}`;
    const existingFee = await StudentFee.findOne({
      studentId: admissionNo,
      feeHead: clubFeeHead._id,
      remarks: remarksKey
    });

    if (!existingFee) {
      await StudentFee.create({
        studentId: admissionNo,
        studentName: student.student_name || '',
        feeHead: clubFeeHead._id,
        college: student.college || 'ANY',
        course: student.course || 'ANY',
        branch: student.branch || 'ANY',
        academicYear: student.batch,
        studentYear: student.current_year,
        semester: student.current_semester || 1,
        amount: Number(club.membership_fee),
        remarks: remarksKey
      });
      created += 1;
    }
  }

  return { created };
};

const findTransportFeeHead = async () => {
  let feeHead = await FeeHead.findOne({ name: 'Transport Fee' });
  if (!feeHead) {
    feeHead = await FeeHead.findOne({ code: { $in: ['TRN', 'TRN01'] } });
  }
  return feeHead;
};

const buildTransportRemarks = (routeName, stageName, academicYear) => {
  const route = (routeName || '').trim();
  const stage = (stageName || '').trim();
  const base = `Transport: ${route} - ${stage}`;
  const year = String(academicYear || '').trim();
  return year ? `${base} (${year})` : base;
};

const buildHostelRemarks = (hostelName, categoryName, academicYear) => {
  const hostel = (hostelName || 'Hostel').trim();
  const category = (categoryName || 'Category').trim();
  const base = `Hostel: ${hostel} - ${category}`;
  const year = String(academicYear || '').trim();
  return year ? `${base} (${year})` : base;
};

const syncTransportFees = async (student, admissionNo) => {
  let created = 0;
  let updated = 0;
  const academicYears = new Set();
  /** @type {Map<string, Set<string>>} academicYear -> expected remarks */
  const expectedRemarksByYear = new Map();

  let transportConnection = getTransportConnection();
  if (!transportConnection || transportConnection.readyState !== 1) {
    console.log(`[TransportSync] Attempting connection refresh for ${admissionNo}...`);
    transportConnection = await connectTransportDB();
  }
  if (!transportConnection) {
    console.error(`[TransportSync] Skipped ${admissionNo}: no active transport database connection`);
    return { created, updated, requestsMatched: 0, academicYears: [] };
  }

  const admissionVariants = Array.from(new Set([
    admissionNo,
    String(admissionNo).trim(),
    String(admissionNo).trim().toUpperCase(),
    String(admissionNo).trim().toLowerCase()
  ].filter(Boolean)));

  const requests = await transportConnection.db
    .collection('transport_requests')
    .find({
      admission_number: { $in: admissionVariants },
      status: { $regex: /^approved$/i }
    })
    .sort({ updated_at: -1 })
    .toArray();

  const transportFeeHead = await findTransportFeeHead();
  if (!transportFeeHead) {
    return { created, updated, requestsMatched: requests.length, academicYears: [] };
  }

  // One demand per academic year — prefer latest updated request
  const latestByYear = new Map();
  for (const request of requests) {
    const academicYear = String(request.academicYear || request.academic_year || '').trim();
    if (!academicYear) continue;
    if (!latestByYear.has(academicYear)) latestByYear.set(academicYear, request);
  }

  if (requests.length > 0) {
    for (const request of latestByYear.values()) {
      const academicYear = String(request.academicYear || request.academic_year || '').trim();
      const yearKey = academicYear;
      academicYears.add(yearKey);

      // Amount source of truth = transport request fare only (never stage/structure amount).
      const fare = request.fare !== undefined ? request.fare : request.amount;
      if (fare === null || fare === undefined || fare === '') {
        console.warn(`[TransportSync] Skipping ${admissionNo} AY ${yearKey}: missing fare/amount on request`);
        continue;
      }
      const amount = Number(fare);
      if (!Number.isFinite(amount) || amount < 0) {
        console.warn(`[TransportSync] Skipping ${admissionNo} AY ${yearKey}: invalid fare`, fare);
        continue;
      }

      const studentYear = Number(request.year_of_study || request.yearOfStudy || student.current_year || 1) || 1;
      const semester = Number(request.semester_number || request.semesterNumber || student.current_semester || 1) || 1;
      const routeName = request.route_name || request.routeName || '';
      const stageName = request.stage_name || request.stageName || '';
      const remarks = buildTransportRemarks(routeName, stageName, academicYear);

      // Find all existing transport demands for this student & academicYear
      const existingAyDemands = await StudentFee.find({
        studentId: admissionNo,
        feeHead: transportFeeHead._id,
        academicYear: yearKey
      }).sort({ updatedAt: -1, createdAt: -1 });

      if (existingAyDemands.length > 0) {
        // Pick canonical document (prefer exact remark match if any, or latest updated)
        const canonicalDoc = existingAyDemands.find(f => String(f.remarks || '').trim() === remarks) || existingAyDemands[0];

        // Delete any extra duplicate demand rows for this academicYear FIRST to prevent E11000 index conflicts
        const extraDocs = existingAyDemands.filter(f => f._id.toString() !== canonicalDoc._id.toString());
        if (extraDocs.length > 0) {
          const extraIds = extraDocs.map(f => f._id);
          await StudentFee.deleteMany({ _id: { $in: extraIds } });
          updated += extraDocs.length;
        }

        // Now update canonicalDoc safely without E11000 duplicate key collision
        let changed = false;
        if (Number(canonicalDoc.amount) !== Number(amount)) {
          canonicalDoc.amount = amount;
          changed = true;
        }
        if (canonicalDoc.remarks !== remarks) {
          canonicalDoc.remarks = remarks;
          changed = true;
        }
        if (Number(canonicalDoc.studentYear) !== Number(studentYear)) {
          canonicalDoc.studentYear = studentYear;
          changed = true;
        }
        if (semester !== undefined && normalizeSemester(canonicalDoc.semester) !== normalizeSemester(semester)) {
          canonicalDoc.semester = semester ?? null;
          changed = true;
        }
        if (student.college && canonicalDoc.college !== student.college) {
          canonicalDoc.college = student.college;
          changed = true;
        }
        if (student.course && canonicalDoc.course !== student.course) {
          canonicalDoc.course = student.course;
          changed = true;
        }
        if (student.branch && canonicalDoc.branch !== student.branch) {
          canonicalDoc.branch = student.branch;
          changed = true;
        }
        if (student.student_name && canonicalDoc.studentName !== student.student_name) {
          canonicalDoc.studentName = student.student_name;
          changed = true;
        }
        if (changed) {
          await StudentFee.updateOne(
            { _id: canonicalDoc._id },
            {
              $set: {
                amount,
                remarks,
                studentYear,
                semester: semester ?? null,
                college: student.college || canonicalDoc.college,
                course: student.course || canonicalDoc.course,
                branch: student.branch || canonicalDoc.branch,
                studentName: student.student_name || canonicalDoc.studentName,
                updatedAt: new Date()
              }
            }
          );
          updated += 1;
        }
      } else {
        const result = await upsertStudentFeeDemand({
          admissionNo,
          student,
          feeHeadId: transportFeeHead._id,
          academicYear: yearKey,
          studentYear,
          semester,
          amount,
          remarks,
          matchByRemarks: false
        });
        created += result.created;
        updated += result.updated;
      }
    }
  }

  // Drop any obsolete or duplicate transport demands for this student for each academic year.
  const existingTransportFees = await StudentFee.find({
    studentId: admissionNo,
    feeHead: transportFeeHead._id
  }).sort({ updatedAt: -1, createdAt: -1 });

  const feesByAy = new Map();
  for (const fee of existingTransportFees) {
    const feeAy = String(fee.academicYear || '').trim();
    if (!feesByAy.has(feeAy)) feesByAy.set(feeAy, []);
    feesByAy.get(feeAy).push(fee);
  }

  for (const [feeAy, feeList] of feesByAy.entries()) {
    const approvedReq = latestByYear.get(feeAy);

    if (!approvedReq) {
      // No approved request for this AY -> delete unpaid demands
      for (const fee of feeList) {
        const txs = await Transaction.find({
          studentId: admissionNo,
          feeHead: transportFeeHead._id,
          studentYear: String(fee.studentYear),
          status: 'active',
          transactionType: 'DEBIT'
        }).lean();
        const paid = txs.reduce((s, t) => s + (Number(t.amount) || 0), 0);
        if (paid === 0) {
          await StudentFee.deleteOne({ _id: fee._id });
          updated += 1;
        }
      }
    } else {
      // Approved request exists! Pick canonical document and delete redundant duplicates.
      const expectedRemarks = buildTransportRemarks(
        approvedReq.route_name || approvedReq.routeName,
        approvedReq.stage_name || approvedReq.stageName,
        feeAy
      );

      let canonicalDoc = feeList.find(f => String(f.remarks || '').trim() === expectedRemarks) || feeList[0];

      const fare = Number(approvedReq.fare !== undefined ? approvedReq.fare : approvedReq.amount);
      if (Number.isFinite(fare) && fare >= 0) {
        let changed = false;
        if (Number(canonicalDoc.amount) !== fare) {
          canonicalDoc.amount = fare;
          changed = true;
        }
        if (canonicalDoc.remarks !== expectedRemarks) {
          canonicalDoc.remarks = expectedRemarks;
          changed = true;
        }
        if (student.college && canonicalDoc.college !== student.college) {
          canonicalDoc.college = student.college;
          changed = true;
        }
        if (student.course && canonicalDoc.course !== student.course) {
          canonicalDoc.course = student.course;
          changed = true;
        }
        if (student.branch && canonicalDoc.branch !== student.branch) {
          canonicalDoc.branch = student.branch;
          changed = true;
        }
        if (student.student_name && canonicalDoc.studentName !== student.student_name) {
          canonicalDoc.studentName = student.student_name;
          changed = true;
        }
        if (changed) {
          await StudentFee.updateOne(
            { _id: canonicalDoc._id },
            {
              $set: {
                amount: fare,
                remarks: expectedRemarks,
                college: student.college || canonicalDoc.college,
                course: student.course || canonicalDoc.course,
                branch: student.branch || canonicalDoc.branch,
                studentName: student.student_name || canonicalDoc.studentName,
                updatedAt: new Date()
              }
            }
          );
          updated += 1;
        }
      }

      // Delete all OTHER duplicate demand documents for this AY
      for (const fee of feeList) {
        if (fee._id.toString() !== canonicalDoc._id.toString()) {
          await StudentFee.deleteOne({ _id: fee._id });
          updated += 1;
          console.log(`[TransportSync] Cleaned up duplicate Transport Fee demand ID: ${fee._id} (AY: ${feeAy})`);
        }
      }
    }
  }

  return {
    created,
    updated,
    requestsMatched: requests.length,
    academicYears: Array.from(academicYears).sort()
  };
};

const findHostelFeeHead = async () => {
  let feeHead = await FeeHead.findOne({ code: 'HST01' });
  if (!feeHead) {
    feeHead = await FeeHead.findOne({ name: 'Hostel Fee' });
  }
  if (!feeHead) {
    feeHead = await FeeHead.findOne({ code: 'HOSTEL' });
  }
  if (!feeHead) {
    feeHead = await FeeHead.create({
      name: 'Hostel Fee',
      code: 'HST01',
      description: 'Hostel accommodation fee'
    });
  }
  return feeHead;
};

const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const findHostelFeeStructure = async (connection, request, student, studentYear) => {
  const baseQuery = {
    academicYear: request.academicYear,
    course: { $regex: new RegExp(`^${escapeRegex(student.course)}$`, 'i') },
    year: Number(studentYear),
    hostelId: request.hostelId,
    categoryId: request.hostelCategoryId,
    feeType: { $regex: /^hostel[ _-]?fee$/i },
    isActive: true
  };

  const structures = connection.db.collection('feestructures');
  if (student.branch) {
    const exactBranch = await structures.findOne({
      ...baseQuery,
      branch: { $regex: new RegExp(`^${escapeRegex(student.branch)}$`, 'i') }
    });
    if (exactBranch) return exactBranch;
  }

  return structures.findOne({
    ...baseQuery,
    $or: [
      { branch: null },
      { branch: { $exists: false } }
    ]
  });
};

const syncHostelFees = async (student, admissionNo) => {
  let created = 0;
  let updated = 0;
  const academicYears = new Set();

  let hostelConnection = getHostelConnection();
  if (!hostelConnection || hostelConnection.readyState !== 1) {
    console.log(`[HostelSync] Attempting connection refresh for ${admissionNo}...`);
    hostelConnection = await connectHostelDB();
  }
  if (!hostelConnection) {
    console.error(`[HostelSync] Skipped ${admissionNo}: no active hostel database connection`);
    return { created, updated, requestsMatched: 0, academicYears: [] };
  }

  const admissionVariants = Array.from(new Set([
    admissionNo,
    String(admissionNo).trim(),
    String(admissionNo).trim().toUpperCase(),
    String(admissionNo).trim().toLowerCase()
  ].filter(Boolean)));

  const requests = await hostelConnection.db
    .collection('hostelrequests')
    .find({
      admissionNumber: { $in: admissionVariants },
      status: { $regex: /^(active|approved)$/i }
    })
    .sort({ updatedAt: -1 })
    .toArray();

  const hostelFeeHead = await findHostelFeeHead();
  const hostels = hostelConnection.db.collection('hostels');
  const categories = hostelConnection.db.collection('hostelcategories');

  if (requests.length > 0) {
    for (const request of requests) {
      const academicYear = String(request.academicYear || request.academic_year || '').trim();
      const hostelId = request.hostelId;
      const hostelCategoryId = request.hostelCategoryId;
      if (!academicYear || !hostelId || !hostelCategoryId) continue;
      academicYears.add(academicYear);

      const studentYear = request.sdmsYearOfStudy || request.yearOfStudy || student.current_year || 1;
      const structure = await findHostelFeeStructure(
        hostelConnection,
        {
          ...request,
          academicYear
        },
        student,
        studentYear
      );
      if (!structure) continue;

      const [hostel, category] = await Promise.all([
        hostels.findOne({ _id: hostelId }, { projection: { name: 1 } }),
        categories.findOne({ _id: hostelCategoryId }, { projection: { name: 1 } })
      ]);

      const amount = Math.max(
        0,
        (Number(structure.amount) || 0) - (Number(request.concession) || 0)
      );
      const remarks = buildHostelRemarks(
        hostel?.name || 'Hostel',
        category?.name || 'Category',
        academicYear
      );

      const result = await upsertStudentFeeDemand({
        admissionNo,
        student,
        feeHeadId: hostelFeeHead._id,
        academicYear: request.academicYear,
        studentYear,
        semester: student.current_semester || 1,
        amount,
        remarks,
        matchByRemarks: true
      });
      created += result.created;
      updated += result.updated;
    }
  }

  // Drop any hostel demands for this student that do not match the current approved request.
  const existingHostelFees = await StudentFee.find({
    studentId: admissionNo,
    feeHead: hostelFeeHead._id
  });

  // Group approved requests by academic year
  const approvedHostelByYear = new Map();
  for (const req of requests) {
    const ay = String(req.academicYear || req.academic_year || '').trim();
    if (ay && !approvedHostelByYear.has(ay)) {
      approvedHostelByYear.set(ay, req);
    }
  }

  for (const fee of existingHostelFees) {
    const feeAy = String(fee.academicYear || '').trim();
    const approvedReq = approvedHostelByYear.get(feeAy);
    let shouldDelete = false;

    if (!approvedReq) {
      shouldDelete = true;
    } else {
      // Request exists, verify remarks (hostel & category name)
      const [hostel, category] = await Promise.all([
        hostels.findOne({ _id: approvedReq.hostelId }, { projection: { name: 1 } }),
        categories.findOne({ _id: approvedReq.hostelCategoryId }, { projection: { name: 1 } })
      ]);
      const expectedRemarks = buildHostelRemarks(
        hostel?.name || 'Hostel',
        category?.name || 'Category',
        feeAy
      );
      const feeRemarks = String(fee.remarks || '').trim();
      const feeBase = feeRemarks.replace(/\s*\(\d{4}-\d{4}\)\s*$/, '').trim();
      const expectedBase = expectedRemarks.replace(/\s*\(\d{4}-\d{4}\)\s*$/, '').trim();
      
      if (feeRemarks !== expectedRemarks && feeBase !== expectedBase) {
        shouldDelete = true;
      }
    }

    if (shouldDelete) {
      const txs = await Transaction.find({
        studentId: admissionNo,
        feeHead: hostelFeeHead._id,
        studentYear: String(fee.studentYear),
        status: 'active',
        transactionType: 'DEBIT'
      }).lean();
      const paid = txs.reduce((s, t) => s + (Number(t.amount) || 0), 0);
      if (paid === 0) {
        await StudentFee.deleteOne({ _id: fee._id });
        updated += 1;
        console.log(`[HostelSync] Cleaned up orphaned/obsolete demand ID: ${fee._id} (AY: ${feeAy}, amount: ${fee.amount})`);
      }
    }
  }

  return {
    created,
    updated,
    requestsMatched: requests.length,
    academicYears: Array.from(academicYears).sort()
  };
};

const syncStandardFees = async (student, admissionNo, preloadedFeeHeads = null) => {
  let created = 0;
  let updated = 0;

  const category = student.stud_type || 'Regular';
  const applicableStructures = await FeeStructure.find({
    college: student.college,
    course: student.course,
    branch: student.branch,
    batch: student.batch,
    category
  }).lean();

  if (applicableStructures.length === 0) {
    return { created, updated, structuresMatched: 0 };
  }

  // Transport / Hostel amounts come only from approved requests — never from FeeStructure.
  const serviceHeadIds = new Set();
  const transportHead = await findTransportFeeHead();
  const hostelHead = await findHostelFeeHead();
  if (transportHead?._id) serviceHeadIds.add(String(transportHead._id));
  if (hostelHead?._id) serviceHeadIds.add(String(hostelHead._id));

  const revisedFeesMap = await loadRevisedFeesMapForStudent(admissionNo, preloadedFeeHeads);

  for (const fs of applicableStructures) {
    if (serviceHeadIds.has(String(fs.feeHead))) continue;

    const fsKey = buildConcessionLookupKey(
      fs.feeHead.toString(),
      fs.studentYear,
      fs.semester
    );
    const revisedConcession = revisedFeesMap[fsKey];
    const targetRemarks = revisedConcession ? revisedConcession.remarks : '';

    const targetAmount = resolveTargetAmount(fs.amount, revisedFeesMap, fs);
    const result = await upsertStudentFeeDemand({
      admissionNo,
      student,
      feeHeadId: fs.feeHead,
      academicYear: fs.batch,
      studentYear: fs.studentYear,
      semester: fs.semester || null,
      amount: targetAmount,
      remarks: targetRemarks || undefined,
      extraFields: {
        structureId: fs._id,
        stud_type: fs.category,
        isScholarshipApplicable: fs.isScholarshipApplicable || false,
        isTermsDivided: fs.isTermsDivided || false
      }
    });
    created += result.created;
    updated += result.updated;
  }

  // DECL credits only when an APPROVED overall-concession request exists.
  // If none, cancel any leftover DECL credits from earlier syncs.
  const approvedEntries = await loadApprovedOverallConcessionEntries(admissionNo);
  if (approvedEntries.length > 0) {
    await applyRevisedConcessionTransactions({
      admissionNumber: admissionNo,
      studentName: student.student_name,
      college: student.college,
      course: student.course,
      branch: student.branch,
      batch: student.batch,
      category: student.stud_type || 'Regular',
      entries: approvedEntries
    });
  } else {
    await cancelAllDeclarationConcessionTransactions({
      admissionNumber: admissionNo,
      reason: 'No approved overall concession request'
    });
  }

  return { created, updated, structuresMatched: applicableStructures.length };
};

const resolveStudentMetadata = async (student) => {
  if (!student) return student;

  // Resolve college if missing but college_id exists
  if ((!student.college || String(student.college).trim() === '') && student.college_id) {
    try {
      const [rows] = await db.query('SELECT name FROM colleges WHERE id = ?', [student.college_id]);
      if (rows && rows.length > 0) {
        student.college = rows[0].name;
      }
    } catch (err) {
      console.error('[SyncService] Error resolving college name from ID:', err);
    }
  }

  // Resolve course if missing but course_id exists
  if ((!student.course || String(student.course).trim() === '') && student.course_id) {
    try {
      const [rows] = await db.query('SELECT name FROM courses WHERE id = ?', [student.course_id]);
      if (rows && rows.length > 0) {
        student.course = rows[0].name;
      }
    } catch (err) {
      console.error('[SyncService] Error resolving course name from ID:', err);
    }
  }

  // Resolve branch if missing but branch_id exists
  if ((!student.branch || String(student.branch).trim() === '') && student.branch_id) {
    try {
      const [rows] = await db.query('SELECT name FROM course_branches WHERE id = ?', [student.branch_id]);
      if (rows && rows.length > 0) {
        student.branch = rows[0].name;
      }
    } catch (err) {
      console.error('[SyncService] Error resolving branch name from ID:', err);
    }
  }

  return student;
};

const fetchStudentByAdmissionNumber = async (admissionNo) => {
  const [students] = await db.query(STUDENT_SELECT, [admissionNo]);
  const student = students[0] || null;
  if (student) {
    await resolveStudentMetadata(student);
  }
  return student;
};

const syncStudentFeesByAdmissionNumber = async (admissionNo, options = {}) => {
  const {
    skipClub = false,
    skipTransport = false,
    skipHostel = false,
    skipStandard = false
  } = options;

  const student = await fetchStudentByAdmissionNumber(admissionNo);
  if (!student) {
    const error = new Error('Student not found');
    error.statusCode = 404;
    throw error;
  }

  const clubResult = skipClub
    ? { created: 0 }
    : await syncClubFees(student, admissionNo);
  const transportResult = skipTransport
    ? { created: 0, updated: 0, requestsMatched: 0, academicYears: [] }
    : await syncTransportFees(student, admissionNo);
  const hostelResult = skipHostel
    ? { created: 0, updated: 0, requestsMatched: 0, academicYears: [] }
    : await syncHostelFees(student, admissionNo);
  const standardResult = skipStandard
    ? { created: 0, updated: 0, structuresMatched: 0 }
    : await syncStandardFees(student, admissionNo);

  return {
    admissionNumber: admissionNo,
    clubFeesCreated: clubResult.created,
    transportFeesCreated: transportResult.created,
    transportFeesUpdated: transportResult.updated,
    transportRequestsMatched: transportResult.requestsMatched,
    transportAcademicYears: transportResult.academicYears || [],
    hostelFeesCreated: hostelResult.created,
    hostelFeesUpdated: hostelResult.updated,
    hostelRequestsMatched: hostelResult.requestsMatched,
    hostelAcademicYears: hostelResult.academicYears || [],
    standardFeesCreated: standardResult.created,
    standardFeesUpdated: standardResult.updated,
    structuresMatched: standardResult.structuresMatched
  };
};

/**
 * Nightly / bulk sync for all regular students.
 * Standard fee structures (+ club + declaration credits). Transport/hostel skipped by default.
 */
const syncAllRegularStudentFees = async ({
  concurrency = 5,
  skipTransport = true,
  skipHostel = true,
  skipClub = false,
  skipStandard = false
} = {}) => {
  let students = [];
  try {
    const [rows] = await db.query(`
      SELECT admission_number
      FROM students
      WHERE LOWER(COALESCE(student_status, '')) = 'regular'
        AND admission_number IS NOT NULL
        AND TRIM(admission_number) <> ''
    `);
    students = rows || [];
  } catch (err) {
    console.error('[FeeSync] Failed to load regular students list:', err?.message || err);
    if (err?.stack) console.error(err.stack);
    return { total: 0, success: 0, failed: 0, aborted: true };
  }

  const total = students.length;
  let success = 0;
  let failed = 0;
  const limit = Math.max(1, Number(concurrency) || 5);
  const syncOptions = { skipTransport, skipHostel, skipClub, skipStandard };

  console.log(
    `[FeeSync] Starting nightly student fee sync for ${total} regular student(s)` +
    ` (skipTransport=${skipTransport}, skipHostel=${skipHostel})...`
  );

  for (let i = 0; i < students.length; i += limit) {
    const batch = students.slice(i, i + limit);
    await Promise.all(batch.map(async (row) => {
      const admissionNo = String(row.admission_number || '').trim();
      if (!admissionNo) {
        failed += 1;
        return;
      }
      try {
        await syncStudentFeesByAdmissionNumber(admissionNo, syncOptions);
        success += 1;
      } catch (err) {
        failed += 1;
        console.error(`[FeeSync] Failed for ${admissionNo}:`, err?.message || err);
      }
    }));

    const done = Math.min(i + limit, total);
    if (done % 200 === 0 || done === total) {
      console.log(`[FeeSync] Progress ${done}/${total} (ok=${success}, failed=${failed})`);
    }
  }

  console.log(`[FeeSync] Nightly student fee sync finished. total=${total}, ok=${success}, failed=${failed}`);
  return { total, success, failed };
};

module.exports = {
  fetchStudentByAdmissionNumber,
  syncClubFees,
  syncTransportFees,
  syncHostelFees,
  syncStandardFees,
  syncStudentFeesByAdmissionNumber,
  syncAllRegularStudentFees,
  loadRevisedFeesMapForStudent,
  resolveTargetAmount
};
