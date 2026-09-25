const Proceeding = require('../models/Proceeding');
const ProceedingStudent = require('../models/ProceedingStudent');
const Transaction = require('../models/Transaction');
const FeeStructure = require('../models/FeeStructure');
const FeeHead = require('../models/FeeHead');
const collegeScope = require('../utils/collegeScope');
const db = require('../config/sqlDb');
const {
    getFeeHeadDueForYear,
    getStudentProceedingShareUtilized,
    syncProceedingStudentTxnStatus,
    syncProceedingCompletionStatus,
    roundMoney
} = require('../utils/proceedingDemand');
const { uploadToS3 } = require('../utils/s3Upload');

const parseStudentsBody = (raw) => {
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : null;
        } catch {
            return null;
        }
    }
    return null;
};

const uploadProceedingAttachment = async (file) => {
    if (!file) return null;
    const url = await uploadToS3(file, 'proceedings');
    // Derive key from URL path after bucket host
    let key = '';
    try {
        const u = new URL(url);
        key = u.pathname.replace(/^\//, '');
    } catch {
        key = '';
    }
    return {
        attachmentUrl: url,
        attachmentName: file.originalname || 'attachment',
        attachmentKey: key
    };
};

const canApproveProceeding = (user) => {
    if (!user) return false;
    if (user.role === 'superadmin') return true;
    return (user.permissions || []).includes('proceedings_approve');
};

const canVerifyProceeding = (user) => {
    if (!user) return false;
    if (user.role === 'superadmin') return true;
    return (user.permissions || []).includes('proceedings_verify');
};

const validateProceedingAccess = async (proceeding, user) => {
    if (!proceeding) return true;
    const allowedColleges = await collegeScope.getUserCollegeNames(user);
    const allowedCourses = user.courses?.length > 0 ? user.courses : null;

    // Multi-course / multi-college proceedings: allow if user can access any mapped student
    if (proceeding.college === 'Multiple' || proceeding.course === 'Multiple') {
        const students = await ProceedingStudent.find({ proceedingId: proceeding._id })
            .select('college course')
            .lean();
        if (!students.length) return true;
        return students.some(s => {
            if (allowedColleges && !allowedColleges.includes(s.college)) return false;
            if (allowedCourses && !allowedCourses.includes(`${s.college}|${s.course}`)) return false;
            return true;
        });
    }

    if (allowedColleges && !allowedColleges.includes(proceeding.college)) return false;
    if (allowedCourses) {
        const matchString = `${proceeding.college}|${proceeding.course}`;
        if (!allowedCourses.includes(matchString)) return false;
    }
    return true;
};

/** Derive real college/course/batch lists from mapped students (for Multiple headers). */
const enrichProceedingScopeFields = async (proceedingLike) => {
    const obj = proceedingLike?.toObject ? proceedingLike.toObject() : { ...proceedingLike };
    const isMulti =
        obj.college === 'Multiple'
        || obj.course === 'Multiple'
        || obj.batch === 'Multiple';

    if (isMulti && obj._id) {
        const students = await ProceedingStudent.find({ proceedingId: obj._id })
            .select('college course batch')
            .lean();
        const colleges = [...new Set(students.map((s) => s.college).filter((v) => v && v !== 'Multiple'))];
        const courses = [...new Set(students.map((s) => s.course).filter((v) => v && v !== 'Multiple'))];
        const batches = [...new Set(students.map((s) => s.batch).filter((v) => v && v !== 'Multiple'))];
        obj.colleges = colleges;
        obj.courses = courses;
        obj.batches = batches;
    } else {
        obj.colleges = obj.college && obj.college !== 'Multiple' ? [obj.college] : [];
        obj.courses = obj.course && obj.course !== 'Multiple' ? [obj.course] : [];
        obj.batches = obj.batch && obj.batch !== 'Multiple' ? [obj.batch] : [];
    }
    return obj;
};

/** Never stamp header "Multiple" onto a student row. */
const resolveStudentScopeValue = (studentVal, headerVal) => {
    const s = String(studentVal || '').trim();
    if (s && s !== 'Multiple') return s;
    const h = String(headerVal || '').trim();
    if (h && h !== 'Multiple') return h;
    return '';
};

/** batch 2024 + academicYear 2025-2026 => 2 */
const computeProceedingYear = (batch, academicYear) => {
    const batchStart = parseInt(String(batch || '').split('-')[0], 10);
    const ayStart = parseInt(String(academicYear || '').split('-')[0], 10);
    if (!Number.isFinite(batchStart) || !Number.isFinite(ayStart)) return null;
    const yearNum = ayStart - batchStart + 1;
    return yearNum >= 1 && yearNum <= 10 ? yearNum : null;
};

/** Scholarship-applicable fee structure total for a student year (from FeeStructure Mongo docs) */
const resolveScholarshipApplicableFeeForYear = (structures, feeHeadMap, student, studentYear) => {
    const yr = Number(studentYear);
    if (!Number.isFinite(yr)) {
        return { amount: null, note: 'Invalid student year' };
    }

    const matching = (structures || []).filter(fs =>
        fs.college === student.college
        && fs.course === student.course
        && fs.branch === student.branch
        && String(fs.batch) === String(student.batch)
        && fs.category === student.studType
        && Number(fs.studentYear) === yr
    );

    if (matching.length === 0) {
        return { amount: null, note: 'No fee structure found' };
    }

    const scholarshipStructs = matching.filter(fs => fs.isScholarshipApplicable);
    if (scholarshipStructs.length === 0) {
        return { amount: null, note: 'No scholarship applicable fee head' };
    }

    const byHead = new Map();
    scholarshipStructs.forEach(fs => {
        const hId = String(fs.feeHead?._id || fs.feeHead);
        if (!byHead.has(hId)) byHead.set(hId, []);
        byHead.get(hId).push(fs);
    });

    let total = 0;
    const heads = [];
    for (const [hId, structs] of byHead.entries()) {
        const yearly = structs.find(s => s.semester == null || s.semester === undefined);
        const headAmount = yearly
            ? (Number(yearly.amount) || 0)
            : structs.reduce((sum, fs) => sum + (Number(fs.amount) || 0), 0);
        total += headAmount;
        const fh = feeHeadMap[hId];
        heads.push({
            feeHeadName: fh?.name || 'Unknown',
            feeHeadCode: fh?.code || '',
            amount: headAmount,
        });
    }

    return {
        amount: roundMoney(total),
        note: null,
        heads,
    };
};

// ─── Load students from SQL for proceeding creation ────────────────────
const chunkArray = (arr, size) => {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
};

const parseApplicationIdFilter = (raw) => {
    if (Array.isArray(raw)) {
        return [...new Set(raw.map((s) => String(s ?? '').trim()).filter(Boolean))];
    }
    if (raw == null || raw === '') return [];
    return [...new Set(String(raw).split(',').map((s) => s.trim()).filter(Boolean))];
};

// GET/POST /api/proceedings/load-students
// Body (preferred for large Excel/PDF imports): { applicationIds: string[], college?, course?, caste?, batch? }
// Query: ?college=X&course=Y&caste=Z&batch=B&applicationIds=id1,id2
// When applicationIds are provided, college/course/batch are optional filters —
// matching is done across courses & batches so one proceeding can include mixed students.
const loadStudentsForProceeding = async (req, res) => {
    try {
        const college = req.body?.college ?? req.query.college;
        const course = req.body?.course ?? req.query.course;
        const caste = req.body?.caste ?? req.query.caste;
        const batch = req.body?.batch ?? req.query.batch;
        const applicationIdFilter = parseApplicationIdFilter(
            req.body?.applicationIds ?? req.query.applicationIds
        );
        const applicationIdSet = applicationIdFilter.length > 0
            ? new Set(applicationIdFilter.map(id => id.toLowerCase()))
            : null;
        const byApplicationIds = !!applicationIdSet;

        if (!byApplicationIds && (!college || !course)) {
            return res.status(400).json({ message: 'College and Course are required' });
        }

        let rows = [];
        const scholarshipByStudent = {};
        const scholarshipSeen = {}; // sid -> Set(`${appId}|${year}`) for O(1) dedupe

        const pushScholarship = (sid, appId, studentYear) => {
            if (!scholarshipByStudent[sid]) scholarshipByStudent[sid] = [];
            if (!scholarshipSeen[sid]) scholarshipSeen[sid] = new Set();
            const key = `${appId}|${Number(studentYear)}`;
            if (scholarshipSeen[sid].has(key)) return;
            scholarshipSeen[sid].add(key);
            scholarshipByStudent[sid].push({
                studentYear,
                applicationId: appId,
            });
        };

        if (byApplicationIds) {
            // Chunk large ID lists (~500) so MySQL IN clauses stay fast and packet-safe
            const ID_CHUNK = 200;
            const idChunks = chunkArray(applicationIdFilter, ID_CHUNK);

            const buildAppIdConditions = (ids) => {
                const placeholders = ids.map(() => '?').join(',');
                // No student_status filter — load Regular, Detained, Course Completed, etc.
                const conditions = [
                    // Prefer exact match (index-friendly). Also match lowercased TRIM for messy data.
                    `(ss.application_id IN (${placeholders}) OR LOWER(TRIM(ss.application_id)) IN (${placeholders}))`,
                ];
                const params = [...ids, ...ids.map((id) => id.toLowerCase())];
                if (college) {
                    conditions.push('s.college = ?');
                    params.push(college);
                }
                if (course) {
                    conditions.push('s.course = ?');
                    params.push(course);
                }
                if (caste) {
                    conditions.push('s.caste = ?');
                    params.push(caste);
                }
                if (batch) {
                    conditions.push('s.batch = ?');
                    params.push(batch);
                }
                return { conditions, params };
            };

            const chunkResults = await Promise.all(
                idChunks.map(async (ids) => {
                    const { conditions, params } = buildAppIdConditions(ids);
                    const [joinedRows] = await db.query(
                        `SELECT s.id, s.admission_number, s.pin_no, s.student_name, s.college, s.college_id,
                                s.course, s.course_id, s.branch, s.branch_id, s.caste, s.batch, s.current_year, s.stud_type,
                                ss.student_year, ss.application_id
                         FROM student_scholarship ss
                         INNER JOIN students s ON s.id = ss.student_id
                         WHERE ${conditions.join(' AND ')}
                         ORDER BY s.student_name ASC, ss.student_year ASC, ss.student_semester ASC`,
                        params
                    );
                    return joinedRows || [];
                })
            );

            const studentMap = new Map();
            chunkResults.flat().forEach((row) => {
                const sid = String(row.id);
                if (!studentMap.has(sid)) {
                    studentMap.set(sid, {
                        id: row.id,
                        admission_number: row.admission_number,
                        pin_no: row.pin_no,
                        student_name: row.student_name,
                        college: row.college,
                        college_id: row.college_id,
                        course: row.course,
                        course_id: row.course_id,
                        branch: row.branch,
                        branch_id: row.branch_id,
                        caste: row.caste,
                        batch: row.batch,
                        current_year: row.current_year,
                        stud_type: row.stud_type,
                    });
                }
                const appId = String(row.application_id || '').trim();
                if (!appId) return;
                pushScholarship(sid, appId, row.student_year);
            });
            rows = [...studentMap.values()];
        } else {
            // Load by college/course — include students of any student_status
            const conditions = [];
            const params = [];

            conditions.push('college = ?');
            params.push(college);
            conditions.push('course = ?');
            params.push(course);

            if (caste) {
                conditions.push('caste = ?');
                params.push(caste);
            }
            if (batch) {
                conditions.push('batch = ?');
                params.push(batch);
            }

            const query = `
                SELECT id, admission_number, pin_no, student_name, college, college_id, course, course_id, branch, branch_id, caste, batch, current_year, stud_type
                FROM students
                WHERE ${conditions.join(' AND ')}
                ORDER BY student_name
            `;
            const [sqlRows] = await db.query(query, params);
            rows = sqlRows || [];

            const sqlIds = rows.map(r => r.id).filter(Boolean);
            if (sqlIds.length > 0) {
                const placeholders = sqlIds.map(() => '?').join(',');
                const [scholarshipRows] = await db.query(
                    `SELECT student_id, student_year, application_id
                     FROM student_scholarship
                     WHERE student_id IN (${placeholders})
                       AND application_id IS NOT NULL
                       AND TRIM(application_id) != ''
                     ORDER BY student_year ASC, student_semester ASC`,
                    sqlIds
                );
                (scholarshipRows || []).forEach(row => {
                    const sid = String(row.student_id);
                    const appId = String(row.application_id || '').trim();
                    if (!appId) return;
                    pushScholarship(sid, appId, row.student_year);
                });
            }
        }

        const students = rows.map(r => {
            const scholarshipApplications = scholarshipByStudent[String(r.id)] || [];
            const applicationIdsList = [...new Set(scholarshipApplications.map(a => a.applicationId))];
            return {
                sqlId: r.id,
                studentId: r.admission_number,
                admissionNumber: r.admission_number,
                pinNo: r.pin_no || '',
                studentName: r.student_name || '',
                college: r.college || '',
                collegeId: r.college_id || null,
                course: r.course || '',
                courseId: r.course_id || null,
                branch: r.branch || '',
                branchId: r.branch_id || null,
                caste: r.caste || '',
                batch: r.batch || '',
                studentYear: r.current_year || '',
                studType: r.stud_type || '',
                scholarshipApplications,
                applicationIds: applicationIdsList,
            };
        }).filter(s => {
            if (!applicationIdSet) return true;
            return s.applicationIds.some(id => applicationIdSet.has(id.toLowerCase()));
        });

        if (applicationIdSet && applicationIdFilter.length > 0) {
            const matchedAppIdLower = new Set();
            students.forEach(s => {
                s.applicationIds.forEach(id => {
                    if (applicationIdSet.has(id.toLowerCase())) matchedAppIdLower.add(id.toLowerCase());
                });
            });

            const unmatchedLower = [...applicationIdSet].filter(id => !matchedAppIdLower.has(id));
            const notFound = [];

            if (unmatchedLower.length > 0) {
                const hintChunks = chunkArray(unmatchedLower, 200);
                const hintResults = await Promise.all(
                    hintChunks.map(async (ids) => {
                        const placeholders = ids.map(() => '?').join(',');
                        const [hintRows] = await db.query(
                            `SELECT ss.application_id, s.college, s.course, s.batch, s.caste, s.student_name,
                                    s.admission_number, s.student_status
                             FROM student_scholarship ss
                             INNER JOIN students s ON s.id = ss.student_id
                             WHERE ss.application_id IN (${placeholders})
                                OR LOWER(TRIM(ss.application_id)) IN (${placeholders})`,
                            [...ids, ...ids]
                        );
                        return hintRows || [];
                    })
                );
                const hintRows = hintResults.flat();

                const hintsByAppId = {};
                (hintRows || []).forEach(row => {
                    const key = String(row.application_id || '').trim().toLowerCase();
                    if (!key) return;
                    if (!hintsByAppId[key]) hintsByAppId[key] = [];
                    hintsByAppId[key].push(row);
                });

                applicationIdFilter.forEach(originalId => {
                    const lower = originalId.toLowerCase();
                    if (matchedAppIdLower.has(lower)) return;

                    const hints = hintsByAppId[lower] || [];
                    if (hints.length === 0) {
                        notFound.push({
                            applicationId: originalId,
                            status: 'not_in_system',
                            message: 'No student found with this application ID in the system',
                        });
                        return;
                    }

                    const h = hints[0];
                    const mismatches = [];
                    if (college && String(h.college || '') !== String(college || '')) mismatches.push(`college is ${h.college || '—'}`);
                    if (course && String(h.course || '') !== String(course || '')) mismatches.push(`course is ${h.course || '—'}`);
                    if (caste && String(h.caste || '') !== String(caste)) mismatches.push(`caste is ${h.caste || '—'}`);
                    if (batch && String(h.batch || '') !== String(batch)) mismatches.push(`batch is ${h.batch || '—'}`);

                    notFound.push({
                        applicationId: originalId,
                        status: mismatches.length > 0 ? 'filter_mismatch' : 'not_in_filter',
                        message: mismatches.length > 0
                            ? `Student exists (${h.student_name || h.admission_number}) but filter mismatch — ${mismatches.join('; ')}`
                            : `Student exists (${h.student_name || h.admission_number}) but not included with current filters`,
                        studentName: h.student_name || '',
                        admissionNumber: h.admission_number || '',
                        college: h.college || '',
                        course: h.course || '',
                        batch: h.batch || '',
                        studentStatus: h.student_status || '',
                    });
                });
            }

            const courses = [...new Set(students.map(s => s.course).filter(Boolean))];
            const batches = [...new Set(students.map(s => s.batch).filter(Boolean))];
            const colleges = [...new Set(students.map(s => s.college).filter(Boolean))];

            return res.json({
                students,
                importSummary: {
                    requested: applicationIdFilter.length,
                    matchedStudents: students.length,
                    matchedApplicationIds: matchedAppIdLower.size,
                    notFound,
                    courses,
                    batches,
                    colleges,
                    multiCourse: courses.length > 1,
                    multiBatch: batches.length > 1,
                },
            });
        }

        res.json(students);
    } catch (error) {
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// ─── Get all proceedings ────────────────────────────────────────────────
const getProceedings = async (req, res) => {
    try {
        const { college, course, batch, caste, status, studentId, activeStatus, isActive, academicYear } = req.query;
        let query = {};
        if (college) query.college = college;
        if (course) query.course = course;
        if (batch) query.batch = batch;
        if (status) query.status = status;
        if (academicYear) query.academicYear = academicYear;

        const activeOpt = String(activeStatus || isActive || 'all').toLowerCase();
        if (activeOpt === 'active' || activeOpt === 'true') {
            query.isActive = { $ne: false };
        } else if (activeOpt === 'inactive' || activeOpt === 'false') {
            query.isActive = false;
        }

        if (caste) {
            query.$or = [
                { caste: caste }, { caste: '' }, { caste: null }, { caste: { $exists: false } }
            ];
        }

        // Fee Collection: proceedings where this student is mapped OR proceedings with 0 students mapped (legacy proceedings)
        const studentKey = String(studentId || '').trim();
        let mappedProceedingIds = [];
        let allMappedProceedingIds = [];
        if (studentKey) {
            const mapped = await ProceedingStudent.find({ studentId: studentKey }).select('proceedingId shareAmount txnPending txnPendingReason').lean();
            mappedProceedingIds = mapped.map((m) => m.proceedingId);
            allMappedProceedingIds = await ProceedingStudent.distinct('proceedingId');
        }

        const requestedCollege = typeof query.college === 'string' ? query.college : null;
        const requestedCourse = typeof query.course === 'string' ? query.course : null;
        const casteOr = query.$or;
        delete query.college;
        delete query.course;
        delete query.$or;

        const andClauses = [];
        if (casteOr) andClauses.push({ $or: casteOr });

        if (studentKey) {
            andClauses.push({
                $or: [
                    { _id: { $in: mappedProceedingIds } },
                    { _id: { $nin: allMappedProceedingIds } }
                ]
            });
        }

        // Scope: include "Multiple" headers (multi course/batch/college), then post-filter by student access
        const allowedColleges = await collegeScope.getUserCollegeNames(req.user);
        const allowedCourses = req.user.courses?.length > 0 ? req.user.courses : null;
        const pairs = (allowedCourses || [])
            .map((ac) => {
                const p = String(ac).split('|');
                return p.length === 2 ? { college: p[0], course: p[1] } : null;
            })
            .filter(Boolean);

        if (allowedColleges) {
            if (requestedCollege && requestedCollege !== 'Multiple' && !allowedColleges.includes(requestedCollege)) {
                andClauses.push({ college: '__none__' });
            } else if (requestedCollege) {
                andClauses.push({ college: { $in: [requestedCollege, 'Multiple'] } });
            } else {
                andClauses.push({ college: { $in: [...allowedColleges, 'Multiple'] } });
            }
        } else if (requestedCollege) {
            andClauses.push({ college: { $in: [requestedCollege, 'Multiple'] } });
        }

        if (pairs.length > 0) {
            if (requestedCourse) {
                const matchingPairs = pairs.filter((p) =>
                    p.course === requestedCourse
                    && (!requestedCollege || requestedCollege === 'Multiple' || p.college === requestedCollege)
                );
                andClauses.push({
                    $or: [
                        ...(matchingPairs.length > 0 ? matchingPairs : [{ college: '__none__', course: '__none__' }]),
                        { course: 'Multiple' },
                        { college: 'Multiple' }
                    ]
                });
            } else {
                andClauses.push({
                    $or: [...pairs, { college: 'Multiple' }, { course: 'Multiple' }]
                });
            }
        } else if (requestedCourse) {
            andClauses.push({
                $or: [
                    { course: requestedCourse },
                    { course: 'Multiple' },
                    { college: 'Multiple' }
                ]
            });
        }

        if (andClauses.length > 0) {
            query.$and = [...(query.$and || []), ...andClauses];
        }

        let proceedings = await Proceeding.find(query).sort({ createdAt: -1 }).populate('feeHead', 'name');

        // Post-filter multi-scope proceedings by mapped-student permissions (+ UI college/course filters)
        const scopedProceedings = [];
        for (const p of proceedings) {
            const isMulti = p.college === 'Multiple' || p.course === 'Multiple' || p.batch === 'Multiple';
            if (isMulti) {
                // eslint-disable-next-line no-await-in-loop
                const ok = await validateProceedingAccess(p, req.user);
                if (!ok) continue;
                // eslint-disable-next-line no-await-in-loop
                const hasMappedStudents = await ProceedingStudent.exists({ proceedingId: p._id });
                if (hasMappedStudents) {
                    if (requestedCollege && requestedCollege !== 'Multiple') {
                        // eslint-disable-next-line no-await-in-loop
                        const hasCollege = await ProceedingStudent.exists({ proceedingId: p._id, college: requestedCollege });
                        if (!hasCollege) continue;
                    }
                    if (requestedCourse && requestedCourse !== 'Multiple') {
                        const courseMatch = { proceedingId: p._id, course: requestedCourse };
                        if (requestedCollege && requestedCollege !== 'Multiple') courseMatch.college = requestedCollege;
                        // eslint-disable-next-line no-await-in-loop
                        const hasCourse = await ProceedingStudent.exists(courseMatch);
                        if (!hasCourse) continue;
                    }
                }
            }
            scopedProceedings.push(p);
        }
        proceedings = scopedProceedings;

        const studentShareMap = new Map();
        if (studentKey) {
            const mapped = await ProceedingStudent.find({ studentId: studentKey, proceedingId: { $in: proceedings.map((p) => p._id) } }).lean();
            mapped.forEach((m) => studentShareMap.set(String(m.proceedingId), m));
        }

        const proceedingsWithSummary = await Promise.all(proceedings.map(async (p) => {
            const txns = await Transaction.find({ proceedingId: p._id, status: { $ne: 'cancelled' } }).select('amount');
            const totalUsed = txns.reduce((acc, t) => acc + t.amount, 0);
            const studentCount = await ProceedingStudent.countDocuments({ proceedingId: p._id });
            const pendingTxnCount = await ProceedingStudent.countDocuments({ proceedingId: p._id, txnPending: true });

            let effectiveStatus = p.status;
            if (effectiveStatus === 'Active' || effectiveStatus === 'Completed') {
                effectiveStatus = await syncProceedingCompletionStatus(p._id) || effectiveStatus;
            }

            const base = await enrichProceedingScopeFields({
                ...p.toObject(),
                status: effectiveStatus,
                totalUsed,
                studentCount,
                pendingTxnCount
            });

            if (studentKey) {
                const mapping = studentShareMap.get(String(p._id));
                if (mapping) {
                    const shareAmount = roundMoney(mapping.shareAmount);
                    const shareUtilized = await getStudentProceedingShareUtilized(p._id, studentKey);
                    const shareRemaining = Math.max(0, roundMoney(shareAmount - shareUtilized));
                    base.studentShare = shareAmount;
                    base.shareUtilized = shareUtilized;
                    base.shareRemaining = shareRemaining;
                    base.txnPending = mapping.txnPending || shareRemaining > 0.009;
                    base.txnPendingReason = mapping.txnPendingReason || '';
                } else {
                    // Legacy proceeding with 0 students mapped
                    const shareUtilized = await getStudentProceedingShareUtilized(p._id, studentKey);
                    const procRemaining = Math.max(0, roundMoney((p.amount || 0) - totalUsed));
                    const shareRemaining = Math.max(0, roundMoney(procRemaining - shareUtilized));
                    base.studentShare = null;
                    base.shareUtilized = shareUtilized;
                    base.shareRemaining = shareRemaining;
                    base.txnPending = shareRemaining > 0.009;
                    base.txnPendingReason = '';
                }
            }

            return base;
        }));

        res.json(proceedingsWithSummary);
    } catch (error) {
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

/** Lightweight alert for sidebar: pending auto-txns across all academic years. */
const getPendingAutoTxnAlert = async (req, res) => {
    try {
        let query = { status: { $in: ['Active', 'Completed'] } };

        const allowedColleges = await collegeScope.getUserCollegeNames(req.user);
        if (allowedColleges) {
            query.college = { $in: [...allowedColleges, 'Multiple'] };
        }
        const allowedCourses = req.user.courses?.length > 0 ? req.user.courses : null;
        if (allowedCourses) {
            const pairs = allowedCourses
                .map((ac) => {
                    const p = ac.split('|');
                    return p.length === 2 ? { college: p[0], course: p[1] } : null;
                })
                .filter(Boolean);
            if (pairs.length > 0) {
                query.$or = [
                    ...pairs,
                    { college: 'Multiple' },
                    { course: 'Multiple' }
                ];
            }
        }

        const proceedings = await Proceeding.find(query).select('_id college course').lean();
        const scopedIds = [];
        for (const p of proceedings) {
            if (p.college === 'Multiple' || p.course === 'Multiple') {
                // eslint-disable-next-line no-await-in-loop
                const ok = await validateProceedingAccess(p, req.user);
                if (ok) scopedIds.push(p._id);
            } else {
                scopedIds.push(p._id);
            }
        }

        if (scopedIds.length === 0) {
            return res.json({ hasPending: false, pendingStudentCount: 0, proceedingCount: 0 });
        }

        const pendingRows = await ProceedingStudent.aggregate([
            { $match: { proceedingId: { $in: scopedIds }, txnPending: true } },
            {
                $group: {
                    _id: '$proceedingId',
                    count: { $sum: 1 }
                }
            }
        ]);

        const proceedingCount = pendingRows.length;
        const pendingStudentCount = pendingRows.reduce((sum, r) => sum + (r.count || 0), 0);

        res.json({
            hasPending: pendingStudentCount > 0,
            pendingStudentCount,
            proceedingCount
        });
    } catch (error) {
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// ─── Create proceeding (Step 1: no bank/amount, with student list) ──────
const createProceeding = async (req, res) => {
    try {
        const { proceedingNumber, proceedingDate, amount, bankCreditedAmount, bankAccount, bankCreditedDate, college, course, caste, batch, academicYear, proceedingNature } = req.body;
        const students = parseStudentsBody(req.body.students);

        if (!proceedingNumber || !proceedingDate || !college || !course) {
            return res.status(400).json({ message: 'Please provide proceeding number, date, college and course' });
        }
        if (req.body.students != null && students === null) {
            return res.status(400).json({ message: 'Invalid students data' });
        }
        if (!students || students.length === 0) {
            return res.status(400).json({ message: 'Please select at least one student' });
        }
        const missingShare = students.find(s => !(Number(s.shareAmount) > 0));
        if (missingShare) {
            return res.status(400).json({ message: 'Please enter a share amount for every selected student' });
        }
        const sharesSum = students.reduce((sum, s) => sum + (Number(s.shareAmount) || 0), 0);
        const proceedingAmount = Number(amount) > 0
            ? Math.round(Number(amount) * 100) / 100
            : Math.round(sharesSum * 100) / 100;
        if (Math.abs(sharesSum - proceedingAmount) > 0.05) {
            return res.status(400).json({
                message: `Sum of student shares (₹${sharesSum}) must equal proceeding amount (₹${proceedingAmount})`
            });
        }

        const allowedColleges = await collegeScope.getUserCollegeNames(req.user);
        const allowedCourses = req.user.courses?.length > 0 ? req.user.courses : null;

        // Validate access against each student's own college/course (Excel may mix courses/batches)
        for (const s of students) {
            const studCollege = s.college || college;
            const studCourse = s.course || course;
            if (allowedColleges && !allowedColleges.includes(studCollege)) {
                return res.status(403).json({
                    message: `Forbidden: No permission for college: ${studCollege} (student ${s.admissionNumber || s.studentId || ''})`
                });
            }
            if (allowedCourses && !allowedCourses.includes(`${studCollege}|${studCourse}`)) {
                return res.status(403).json({
                    message: `Forbidden: No permission for course: ${studCollege} / ${studCourse} (student ${s.admissionNumber || s.studentId || ''})`
                });
            }
        }

        // Header college/course: if payload says Multiple, or students span multiple, normalize
        const studentColleges = [...new Set(students.map(s => s.college || college).filter(Boolean))];
        const studentCourses = [...new Set(students.map(s => s.course || course).filter(Boolean))];
        const studentBatches = [...new Set(students.map(s => s.batch || batch).filter(Boolean))];
        const headerCollege = studentColleges.length === 1 ? studentColleges[0] : (college === 'Multiple' || studentColleges.length > 1 ? 'Multiple' : college);
        const headerCourse = studentCourses.length === 1 ? studentCourses[0] : (course === 'Multiple' || studentCourses.length > 1 ? 'Multiple' : course);
        const headerBatch = studentBatches.length === 1
            ? studentBatches[0]
            : (batch === 'Multiple' || studentBatches.length > 1 ? 'Multiple' : (batch || ''));

        if (allowedColleges && headerCollege !== 'Multiple' && !allowedColleges.includes(headerCollege)) {
            return res.status(403).json({ message: `Forbidden: No permission for college: ${headerCollege}` });
        }
        if (allowedCourses && headerCourse !== 'Multiple' && !allowedCourses.includes(`${headerCollege}|${headerCourse}`)) {
            return res.status(403).json({ message: `Forbidden: No permission for course: ${headerCourse}` });
        }

        if (await Proceeding.findOne({ proceedingNumber, course: headerCourse, isActive: { $ne: false } })) {
            return res.status(400).json({ message: `Proceeding number '${proceedingNumber}' already exists for active proceeding in course '${headerCourse}'` });
        }

        // Resolve college/course IDs from the first student or from the payload
        const firstStudent = students[0] || {};
        let collegeId = req.body.collegeId || firstStudent.collegeId || null;
        let courseId = req.body.courseId || firstStudent.courseId || null;
        let branchId = req.body.branchId || firstStudent.branchId || null;

        // If IDs not provided, try to look them up from SQL (skip when Multiple)
        if ((!collegeId || !courseId) && headerCollege !== 'Multiple' && headerCourse !== 'Multiple') {
            try {
                const [idRows] = await db.query(
                    'SELECT college_id, course_id, branch_id FROM students WHERE college = ? AND course = ? LIMIT 1',
                    [headerCollege, headerCourse]
                );
                if (idRows.length > 0) {
                    if (!collegeId) collegeId = idRows[0].college_id || null;
                    if (!courseId) courseId = idRows[0].course_id || null;
                    if (!branchId) branchId = idRows[0].branch_id || null;
                }
            } catch (e) { /* non-fatal */ }
        }
        if (headerCollege === 'Multiple' || headerCourse === 'Multiple') {
            collegeId = null;
            courseId = null;
            branchId = null;
        }

        let attachmentFields = {};
        if (req.file) {
            try {
                attachmentFields = await uploadProceedingAttachment(req.file) || {};
            } catch (s3Error) {
                console.error('Proceeding S3 upload failed:', s3Error);
                return res.status(500).json({
                    message: 'Attachment upload failed. Please verify AWS credentials/configuration.',
                    error: s3Error.message
                });
            }
        }

        const proceeding = await Proceeding.create({
            proceedingNumber, proceedingDate,
            amount: proceedingAmount,
            shareAmount: 0,
            proceedingNature: proceedingNature === 'Student Account' ? 'Student Account' : 'College Account',
            bankCreditedAmount: Number(bankCreditedAmount) || 0,
            bankAccount: bankAccount || '',
            bankCreditedDate: bankCreditedDate || null,
            college: headerCollege,
            collegeId,
            course: headerCourse,
            courseId,
            branchId,
            caste,
            batch: headerBatch,
            academicYear,
            status: 'Pending',
            requestedBy: req.user?.username || '',
            requestedByName: req.user?.name || '',
            ...attachmentFields
        });

        const studentDocs = students.map(s => ({
            proceedingId: proceeding._id,
            studentId: s.studentId || s.admissionNumber,
            studentName: s.studentName || '',
            admissionNumber: s.admissionNumber || s.studentId,
            pinNo: s.pinNo || '',
            college: resolveStudentScopeValue(s.college, headerCollege),
            collegeId: s.collegeId || collegeId,
            course: resolveStudentScopeValue(s.course, headerCourse),
            courseId: s.courseId || courseId,
            branch: s.branch || '',
            branchId: s.branchId || branchId,
            caste: s.caste || '',
            batch: resolveStudentScopeValue(s.batch, headerBatch),
            studentYear: s.studentYear != null && s.studentYear !== '' ? String(s.studentYear) : '',
            proceedingYear: Number(s.proceedingYear) > 0
                ? Number(s.proceedingYear)
                : computeProceedingYear(s.batch, academicYear),
            shareAmount: Math.round(Number(s.shareAmount) * 100) / 100
        }));
        await ProceedingStudent.insertMany(studentDocs, { ordered: false }).catch(() => {});

        res.status(201).json({ ...proceeding.toObject(), studentCount: studentDocs.length });
    } catch (error) {
        if (error?.code === 11000) {
            const existingActive = await Proceeding.findOne({ proceedingNumber: req.body.proceedingNumber, course: req.body.course, isActive: { $ne: false } });
            if (existingActive) {
                return res.status(400).json({ message: `Proceeding number '${req.body.proceedingNumber}' already exists for active proceeding in course '${req.body.course}'` });
            }
        }
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// ─── Get single proceeding with students ────────────────────────────────
const getProceedingById = async (req, res) => {
    try {
        const proceeding = await Proceeding.findById(req.params.id).populate('feeHead', 'name');
        if (!proceeding) return res.status(404).json({ message: 'Proceeding not found' });
        if (!await validateProceedingAccess(proceeding, req.user)) {
            return res.status(403).json({ message: 'Forbidden: Access denied' });
        }
        const students = await ProceedingStudent.find({ proceedingId: proceeding._id }).sort({ studentName: 1 });
        const enriched = await enrichProceedingScopeFields(proceeding);
        res.json({ ...enriched, students });
    } catch (error) {
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// ─── Update proceeding (only Pending, basic fields + students) ──────────
const updateProceeding = async (req, res) => {
    try {
        const proceeding = await Proceeding.findById(req.params.id);
        if (!proceeding) return res.status(404).json({ message: 'Proceeding not found' });
        if (!await validateProceedingAccess(proceeding, req.user)) {
            return res.status(403).json({ message: 'Forbidden: Access denied' });
        }
        if (proceeding.status !== 'Pending') {
            return res.status(400).json({
                message: `Cannot edit: proceeding is ${proceeding.status}. Only Pending proceedings can be edited.`
            });
        }

        const nextCollege = req.body.college || proceeding.college;
        const nextCourse = req.body.course || proceeding.course;
        const allowedColleges = await collegeScope.getUserCollegeNames(req.user);
        const allowedCourses = req.user.courses?.length > 0 ? req.user.courses : null;

        // Multi-scope headers: access is validated via mapped/incoming students, not the "Multiple" sentinel
        if (nextCollege === 'Multiple' || nextCourse === 'Multiple') {
            const incomingStudents = parseStudentsBody(req.body.students);
            const scopeSource = (incomingStudents && incomingStudents.length)
                ? incomingStudents
                : await ProceedingStudent.find({ proceedingId: proceeding._id }).select('college course').lean();
            const denied = (scopeSource || []).find((s) => {
                const studCollege = resolveStudentScopeValue(s.college, nextCollege);
                const studCourse = resolveStudentScopeValue(s.course, nextCourse);
                if (allowedColleges && studCollege && !allowedColleges.includes(studCollege)) return true;
                if (allowedCourses && studCollege && studCourse && !allowedCourses.includes(`${studCollege}|${studCourse}`)) return true;
                return false;
            });
            if (denied) {
                return res.status(403).json({
                    message: `Forbidden: No permission for ${denied.college || nextCollege} / ${denied.course || nextCourse}`
                });
            }
        } else {
            if (allowedColleges && !allowedColleges.includes(nextCollege)) {
                return res.status(403).json({ message: `Forbidden: No permission for college: ${nextCollege}` });
            }
            if (allowedCourses && !allowedCourses.includes(`${nextCollege}|${nextCourse}`)) {
                return res.status(403).json({ message: `Forbidden: No permission for course: ${nextCourse}` });
            }
        }

        const nextProcNum = req.body.proceedingNumber ?? proceeding.proceedingNumber;
        const finalCourse = req.body.course ?? proceeding.course;
        const dup = await Proceeding.findOne({ proceedingNumber: nextProcNum, course: finalCourse, _id: { $ne: proceeding._id }, isActive: { $ne: false } });
        if (dup) return res.status(400).json({ message: `Proceeding number '${nextProcNum}' already exists for active proceeding in course '${finalCourse}'` });

        // Strip status / audit / bank / feeHead — those are set via verify/approve only
        const {
            students: rawStudents,
            status: _status,
            verifiedBy: _vb,
            verifiedByName: _vbn,
            verifiedAt: _va,
            approvedBy: _ab,
            approvedByName: _abn,
            approvedAt: _aa,
            feeHead: _fh,
            transactionsGenerated: _tg,
            bankAccount: _ba,
            bankCreditedDate: _bcd,
            bankCreditedAmount: _bca,
            attachmentUrl: _au,
            attachmentName: _an,
            attachmentKey: _ak,
            ...updatePayload
        } = req.body;

        if (req.file) {
            try {
                const attachmentFields = await uploadProceedingAttachment(req.file);
                if (attachmentFields) Object.assign(updatePayload, attachmentFields);
            } catch (s3Error) {
                console.error('Proceeding S3 upload failed:', s3Error);
                return res.status(500).json({
                    message: 'Attachment upload failed. Please verify AWS credentials/configuration.',
                    error: s3Error.message
                });
            }
        }

        const updated = await Proceeding.findByIdAndUpdate(req.params.id, updatePayload, { new: true });
        const students = parseStudentsBody(rawStudents);

        if (rawStudents != null && students === null) {
            return res.status(400).json({ message: 'Invalid students data' });
        }

        if (students && Array.isArray(students)) {
            const missingShare = students.find(s => !(Number(s.shareAmount) > 0));
            if (missingShare) {
                return res.status(400).json({ message: 'Please enter a share amount for every selected student' });
            }
            const sharesSum = students.reduce((sum, s) => sum + (Number(s.shareAmount) || 0), 0);
            const proceedingAmount = Number(req.body.amount) > 0
                ? Math.round(Number(req.body.amount) * 100) / 100
                : Math.round(sharesSum * 100) / 100;
            if (Math.abs(sharesSum - proceedingAmount) > 0.05) {
                return res.status(400).json({
                    message: `Sum of student shares (₹${sharesSum}) must equal proceeding amount (₹${proceedingAmount})`
                });
            }
            await ProceedingStudent.deleteMany({ proceedingId: proceeding._id });
            const docs = students.map(s => ({
                proceedingId: proceeding._id,
                studentId: s.studentId || s.admissionNumber,
                studentName: s.studentName || '',
                admissionNumber: s.admissionNumber || s.studentId,
                pinNo: s.pinNo || '',
                college: resolveStudentScopeValue(s.college, updated.college),
                collegeId: s.collegeId || updated.collegeId || null,
                course: resolveStudentScopeValue(s.course, updated.course),
                courseId: s.courseId || updated.courseId || null,
                branch: s.branch || '',
                branchId: s.branchId || updated.branchId || null,
                caste: s.caste || '',
                batch: resolveStudentScopeValue(s.batch, updated.batch),
                studentYear: s.studentYear != null && s.studentYear !== '' ? String(s.studentYear) : '',
                proceedingYear: Number(s.proceedingYear) > 0
                    ? Number(s.proceedingYear)
                    : computeProceedingYear(s.batch, updated.academicYear || req.body.academicYear),
                shareAmount: Math.round(Number(s.shareAmount) * 100) / 100
            }));
            if (docs.length > 0) await ProceedingStudent.insertMany(docs, { ordered: false }).catch(() => {});
            const withTotal = await Proceeding.findByIdAndUpdate(
                req.params.id,
                { amount: proceedingAmount, shareAmount: 0 },
                { new: true }
            );
            return res.json(withTotal);
        }

        res.json(updated);
    } catch (error) {
        if (error?.code === 11000) {
            const existingActive = await Proceeding.findOne({ proceedingNumber: req.body.proceedingNumber, course: req.body.course, _id: { $ne: req.params.id }, isActive: { $ne: false } });
            if (existingActive) {
                return res.status(400).json({ message: `Proceeding number '${req.body.proceedingNumber}' already exists for active proceeding in course '${req.body.course}'` });
            }
        }
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

/** Attach / replace supporting file on an existing proceeding (any non-cancelled status). */
const attachProceedingFile = async (req, res) => {
    try {
        const proceeding = await Proceeding.findById(req.params.id);
        if (!proceeding) return res.status(404).json({ message: 'Proceeding not found' });
        if (!await validateProceedingAccess(proceeding, req.user)) {
            return res.status(403).json({ message: 'Forbidden: Access denied' });
        }
        if (proceeding.status === 'Cancelled') {
            return res.status(400).json({ message: 'Cannot attach a file to a cancelled proceeding' });
        }
        if (!req.file) {
            return res.status(400).json({ message: 'Please select a file to attach' });
        }

        let attachmentFields;
        try {
            attachmentFields = await uploadProceedingAttachment(req.file);
        } catch (s3Error) {
            console.error('Proceeding S3 upload failed:', s3Error);
            return res.status(500).json({
                message: 'Attachment upload failed. Please verify AWS credentials/configuration.',
                error: s3Error.message
            });
        }

        Object.assign(proceeding, attachmentFields);
        await proceeding.save();

        res.json({
            message: 'Attachment saved successfully',
            proceeding: {
                _id: proceeding._id,
                attachmentUrl: proceeding.attachmentUrl,
                attachmentName: proceeding.attachmentName,
                attachmentKey: proceeding.attachmentKey
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// ─── Verify proceeding (Step 2: Pending → Verified) ─────────────────────
const verifyProceeding = async (req, res) => {
    try {
        if (!canVerifyProceeding(req.user)) {
            return res.status(403).json({ message: 'Forbidden: proceedings verify permission required' });
        }

        const proceeding = await Proceeding.findById(req.params.id);
        if (!proceeding) return res.status(404).json({ message: 'Proceeding not found' });
        if (!await validateProceedingAccess(proceeding, req.user)) {
            return res.status(403).json({ message: 'Forbidden: Access denied' });
        }
        if (proceeding.status !== 'Pending') {
            return res.status(400).json({ message: `Only Pending proceedings can be verified. Current status: ${proceeding.status}` });
        }

        proceeding.status = 'Verified';
        proceeding.verifiedBy = req.user?.username || '';
        proceeding.verifiedByName = req.user?.name || '';
        proceeding.verifiedAt = new Date();
        await proceeding.save();

        res.json({ message: 'Proceeding verified successfully.', proceeding });
    } catch (error) {
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// ─── Approve proceeding (Step 3: Verified → Active + bank/feeHead) ──────
const approveProceeding = async (req, res) => {
    try {
        if (!canApproveProceeding(req.user)) {
            return res.status(403).json({ message: 'Forbidden: proceedings approve permission required' });
        }

        const proceeding = await Proceeding.findById(req.params.id);
        if (!proceeding) return res.status(404).json({ message: 'Proceeding not found' });
        if (!await validateProceedingAccess(proceeding, req.user)) {
            return res.status(403).json({ message: 'Forbidden: Access denied' });
        }
        if (proceeding.status !== 'Verified') {
            return res.status(400).json({
                message: proceeding.status === 'Pending'
                    ? 'Proceeding must be verified before approval.'
                    : `Proceeding is already ${proceeding.status}`
            });
        }

        // Handle Student Account proceedings (Direct student bank transfer by government)
        if (proceeding.proceedingNature === 'Student Account') {
            const mapped = await ProceedingStudent.find({ proceedingId: proceeding._id });
            proceeding.approvedBy = req.user?.username || '';
            proceeding.approvedByName = req.user?.name || '';
            proceeding.approvedAt = new Date();
            proceeding.status = 'Completed';
            proceeding.transactionsGenerated = true;
            proceeding.transactionsSkipped = true;
            await ProceedingStudent.updateMany(
                { proceedingId: proceeding._id },
                { $set: { txnPending: false, txnPendingReason: '' } }
            );
            await proceeding.save();
            return res.json({
                message: `Proceeding approved and marked Completed (Student Account). ${mapped.length} student(s) remain mapped.`,
                proceeding,
                transactionsCreated: 0,
                transactionsSkipped: true
            });
        }

        const {
            bankAccount,
            bankCreditedDate,
            bankCreditedAmount,
            feeHead,
            generateTransactionsNow,
            skipTransactions
        } = req.body;
        if (!bankAccount || !bankCreditedAmount || !bankCreditedDate || !feeHead) {
            return res.status(400).json({ message: 'Bank Account, Bank Credited Amount, Bank Credited Date, and Fee Head are required for approval' });
        }

        const bankAmount = Math.round(Number(bankCreditedAmount) * 100) / 100;
        const proceedingAmount = Math.round(Number(proceeding.amount) * 100) / 100;

        if (Math.abs(bankAmount - proceedingAmount) > 0.05) {
            return res.status(400).json({
                message: `Bank credited amount (₹${bankAmount}) must exactly match proceeding amount (₹${proceedingAmount}).`
            });
        }

        const mapped = await ProceedingStudent.find({ proceedingId: proceeding._id });
        const sharesSum = Math.round(mapped.reduce((sum, s) => sum + (Number(s.shareAmount) || 0), 0) * 100) / 100;
        if (Math.abs(sharesSum - proceedingAmount) > 0.05) {
            return res.status(400).json({
                message: `Sum of student shares (₹${sharesSum}) must equal proceeding amount (₹${proceedingAmount}). Edit the proceeding while Pending if shares need correction.`
            });
        }

        proceeding.bankAccount = bankAccount;
        proceeding.bankCreditedDate = bankCreditedDate || null;
        proceeding.bankCreditedAmount = bankAmount;
        proceeding.feeHead = feeHead;
        proceeding.approvedBy = req.user?.username || '';
        proceeding.approvedByName = req.user?.name || '';
        proceeding.approvedAt = new Date();

        // Approve without creating RTF transactions — students stay mapped, mark Completed
        if (skipTransactions) {
            proceeding.status = 'Completed';
            proceeding.transactionsGenerated = true; // exclude from nightly auto-txn job
            proceeding.transactionsSkipped = true;
            await ProceedingStudent.updateMany(
                { proceedingId: proceeding._id },
                { $set: { txnPending: false, txnPendingReason: '' } }
            );
            await proceeding.save();
            return res.json({
                message: `Proceeding approved and marked Completed without creating transactions. ${mapped.length} student(s) remain mapped.`,
                proceeding,
                transactionsCreated: 0,
                transactionsSkipped: true
            });
        }

        proceeding.status = 'Active';
        proceeding.transactionsSkipped = false;

        if (generateTransactionsNow) {
            const result = await generateProceedingTransactions(proceeding, req.user);
            proceeding.transactionsGenerated = true;
            await proceeding.save();
            const parts = [`${result.created} Bank/RTF DEBIT transaction(s) created`];
            if (result.skippedDemand > 0) {
                parts.push(`${result.skippedDemand} student(s) pending (share exceeds fee-head demand — collect via Fee Collection)`);
            }
            return res.json({
                message: `Proceeding approved. ${parts.join('; ')}.`,
                proceeding,
                transactionsCreated: result.created,
                pendingStudents: result.skippedDemand
            });
        }

        proceeding.transactionsGenerated = false;
        await proceeding.save();
        res.json({ message: 'Proceeding approved. Bank/RTF transactions will be generated in the nightly run.', proceeding });
    } catch (error) {
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};


// ─── Generate Bank/RTF DEBIT transactions for a proceeding ───────────────
// Mirrors Fee Collection: category Bank + instrument RTF
// Skips students whose share exceeds remaining demand on the approved fee head.
const generateProceedingTransactions = async (proceeding, user) => {
    const PaymentConfig = require('../models/PaymentConfig');
    const students = await ProceedingStudent.find({ proceedingId: proceeding._id });
    if (students.length === 0) return { created: 0, skippedDemand: 0 };

    if (!proceeding.feeHead) {
        return { created: 0, skippedDemand: 0 };
    }

    // Resolve bank account like Fee Collection (paymentConfigId + depositedToAccount + bankName)
    let paymentConfig = null;
    if (proceeding.bankAccount) {
        paymentConfig = await PaymentConfig.findOne({
            account_name: proceeding.bankAccount,
            is_active: true
        });
    }

    // Collector = approver; date = approval time (for reports / collected-by)
    const collectorUsername = proceeding.approvedBy || user?.username || 'system';
    const collectorName = proceeding.approvedByName || user?.name || 'System';
    const txnDate = proceeding.approvedAt
        ? new Date(proceeding.approvedAt)
        : (proceeding.bankCreditedDate ? new Date(proceeding.bankCreditedDate) : new Date());

    const generateSimpleReceipt = () => {
        const ts = Date.now().toString().slice(-8);
        const rand = Math.floor(100 + Math.random() * 900);
        return `PROC${ts}${rand}`;
    };

    const docs = [];
    let skippedDemand = 0;

    for (const stu of students) {
        const studentShare = roundMoney(stu.shareAmount);
        if (!(studentShare > 0)) {
            await ProceedingStudent.updateOne(
                { _id: stu._id },
                { $set: { txnPending: false, txnPendingReason: '' } }
            );
            continue;
        }

        const admissionNo = stu.admissionNumber || stu.studentId;
        const txnYear = Number(stu.proceedingYear) > 0
            ? Number(stu.proceedingYear)
            : (computeProceedingYear(stu.batch, proceeding.academicYear)
                || (Number(stu.studentYear) > 0 ? Number(stu.studentYear) : null)
                || 1);

        const shareUtilized = await getStudentProceedingShareUtilized(proceeding._id, admissionNo);
        const shareRemaining = Math.max(0, roundMoney(studentShare - shareUtilized));
        if (shareRemaining <= 0.009) {
            await syncProceedingStudentTxnStatus(proceeding._id, admissionNo);
            continue;
        }

        const feeHeadDue = await getFeeHeadDueForYear(admissionNo, proceeding.feeHead, txnYear);

        // Share exceeds demand on approved fee head — skip auto txn; collect via Fee Collection (any fee head)
        if (shareRemaining > feeHeadDue + 0.009) {
            skippedDemand += 1;
            await ProceedingStudent.updateOne(
                { _id: stu._id },
                {
                    $set: {
                        txnPending: true,
                        txnPendingReason: feeHeadDue <= 0
                            ? `No demand on approved fee head (share ₹${shareRemaining.toLocaleString('en-IN')})`
                            : `Share ₹${shareRemaining.toLocaleString('en-IN')} exceeds fee-head demand ₹${feeHeadDue.toLocaleString('en-IN')}`
                    }
                }
            );
            continue;
        }

        const txnAmount = roundMoney(Math.min(shareRemaining, feeHeadDue));

        docs.push({
            studentId: stu.studentId,
            studentName: stu.studentName,
            feeHead: proceeding.feeHead,
            amount: txnAmount,
            paymentMode: 'RTF',
            transactionType: 'DEBIT',
            paymentDate: txnDate,
            instrumentDate: txnDate,
            referenceDate: txnDate,
            referenceNo: proceeding.proceedingNumber || '',
            bankName: paymentConfig?.bank_name || '',
            paymentConfigId: paymentConfig?._id || undefined,
            depositedToAccount: proceeding.bankAccount || paymentConfig?.account_name || '',
            remarks: `RTF (Bank) — Auto from Proceeding ${proceeding.proceedingNumber}`,
            studentYear: String(txnYear),
            receiptNumber: generateSimpleReceipt(),
            collectedBy: collectorUsername,
            collectedByName: collectorName,
            proceedingId: proceeding._id,
            status: 'active',
            college: stu.college || proceeding.college,
            course: stu.course || proceeding.course,
            branch: stu.branch || '',
            pinNo: stu.pinNo || '',
            admissionNumber: admissionNo,
            collegeId: stu.collegeId || undefined,
            courseId: stu.courseId || undefined,
            branchId: stu.branchId || undefined,
            createdAt: txnDate,
            updatedAt: txnDate
        });
    }

    if (docs.length > 0) {
        await Transaction.insertMany(docs, { ordered: false, timestamps: false });
        for (const doc of docs) {
            await syncProceedingStudentTxnStatus(proceeding._id, doc.studentId);
        }
    }

    await syncProceedingCompletionStatus(proceeding._id);

    return { created: docs.length, skippedDemand };
};

// ─── Nightly: generate transactions for approved proceedings ────────────
const processNightlyProceedingTransactions = async () => {
    const pending = await Proceeding.find({
        status: 'Active',
        transactionsGenerated: false,
        transactionsSkipped: { $ne: true }
    });
    if (pending.length === 0) {
        console.log('[Proceedings Nightly] No proceedings awaiting transaction generation.');
        return { processed: 0, totalCreated: 0 };
    }

    let totalCreated = 0;
    let totalPending = 0;
    for (const proc of pending) {
        try {
            const result = await generateProceedingTransactions(proc, null);
            proc.transactionsGenerated = true;
            await proc.save();
            totalCreated += result.created;
            totalPending += result.skippedDemand;
            console.log(`[Proceedings Nightly] ${proc.proceedingNumber}: ${result.created} txns, ${result.skippedDemand} pending`);
        } catch (err) {
            console.error(`[Proceedings Nightly] Failed for ${proc.proceedingNumber}:`, err.message);
        }
    }
    return { processed: pending.length, totalCreated, totalPending };
};

// ─── Delete proceeding ──────────────────────────────────────────────────
const deleteProceeding = async (req, res) => {
    try {
        const proceeding = await Proceeding.findById(req.params.id);
        if (!proceeding) return res.status(404).json({ message: 'Proceeding not found' });
        if (!await validateProceedingAccess(proceeding, req.user)) {
            return res.status(403).json({ message: 'Forbidden: Access denied' });
        }

        if (proceeding.status !== 'Pending') {
            return res.status(400).json({
                message: `Cannot delete: proceeding is ${proceeding.status}. Only Pending proceedings can be deleted.`
            });
        }

        const txnCount = await Transaction.countDocuments({ proceedingId: proceeding._id, status: { $ne: 'cancelled' } });
        if (txnCount > 0) {
            return res.status(400).json({ message: `Cannot delete: ${txnCount} active transactions are linked to this proceeding.` });
        }

        await ProceedingStudent.deleteMany({ proceedingId: proceeding._id });
        await proceeding.deleteOne();
        res.json({ message: 'Proceeding removed' });
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
};

// ─── Summary (students + amounts used) ──────────────────────────────────
const getProceedingSummary = async (req, res) => {
    try {
        const proceeding = await Proceeding.findById(req.params.id);
        if (!proceeding) return res.status(404).json({ message: 'Proceeding not found' });
        if (!await validateProceedingAccess(proceeding, req.user)) {
            return res.status(403).json({ message: 'Forbidden: Access denied' });
        }

        const transactions = await Transaction.find({ proceedingId: req.params.id, status: { $ne: 'cancelled' } })
            .populate('feeHead', 'name code')
            .sort({ createdAt: -1 });
        const totalUsed = transactions.reduce((acc, t) => acc + t.amount, 0);

        await syncProceedingCompletionStatus(proceeding._id);
        const freshProceeding = await Proceeding.findById(req.params.id).lean();

        const mappedStudents = await ProceedingStudent.find({ proceedingId: req.params.id }).sort({ studentName: 1 });

        const studentIds = [...new Set([
            ...transactions.map(t => t.studentId),
            ...mappedStudents.map(s => s.studentId)
        ])].filter(Boolean);

        let pinMap = {};
        if (studentIds.length > 0) {
            const [studs] = await db.query(
                `SELECT admission_number, pin_no FROM students WHERE admission_number IN (${studentIds.map(() => '?').join(',')})`,
                studentIds
            );
            studs.forEach(s => { if (s.admission_number) pinMap[s.admission_number] = s.pin_no || '-'; });
        }

        const transactionsWithPin = transactions.map(t => ({
            ...t.toObject(),
            pinNo: pinMap[t.studentId] || '-'
        }));

        const mappedWithShare = await Promise.all(mappedStudents.map(async (s) => {
            const admissionNo = s.admissionNumber || s.studentId;
            const shareAmount = roundMoney(s.shareAmount);
            const shareUtilized = await getStudentProceedingShareUtilized(proceeding._id, admissionNo);
            const shareRemaining = Math.max(0, roundMoney(shareAmount - shareUtilized));
            return {
                ...s.toObject(),
                shareUtilized,
                shareRemaining,
                pinNo: pinMap[admissionNo] || s.pinNo || '-'
            };
        }));

        const pendingTxnCount = mappedWithShare.filter((s) => s.txnPending || s.shareRemaining > 0.009).length;
        const scope = await enrichProceedingScopeFields(freshProceeding || proceeding);

        res.json({
            transactions: transactionsWithPin,
            totalUsed,
            pendingTxnCount,
            proceedingStatus: freshProceeding?.status || proceeding.status,
            isActive: freshProceeding?.isActive !== false && proceeding.isActive !== false,
            inactivatedBy: freshProceeding?.inactivatedBy || proceeding.inactivatedBy || '',
            inactivatedByName: freshProceeding?.inactivatedByName || proceeding.inactivatedByName || '',
            inactivatedAt: freshProceeding?.inactivatedAt || proceeding.inactivatedAt || null,
            cancelledBy: freshProceeding?.cancelledBy || proceeding.cancelledBy || '',
            cancelledByName: freshProceeding?.cancelledByName || proceeding.cancelledByName || '',
            cancelledAt: freshProceeding?.cancelledAt || proceeding.cancelledAt || null,
            mappedStudents: mappedWithShare,
            colleges: scope.colleges || [],
            courses: scope.courses || [],
            batches: scope.batches || []
        });
    } catch (error) {
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// ─── Sync missing college/course IDs on existing proceedings & students ──
const syncProceedingIds = async (req, res) => {
    try {
        let updatedProc = 0;
        let updatedStu = 0;

        // Sync Proceeding documents missing IDs
        const procsToSync = await Proceeding.find({ $or: [{ collegeId: null }, { courseId: null }, { collegeId: { $exists: false } }, { courseId: { $exists: false } }] });
        for (const proc of procsToSync) {
            try {
                const [rows] = await db.query(
                    'SELECT college_id, course_id, branch_id FROM students WHERE college = ? AND course = ? LIMIT 1',
                    [proc.college, proc.course]
                );
                if (rows.length > 0) {
                    const update = {};
                    if (!proc.collegeId && rows[0].college_id) update.collegeId = rows[0].college_id;
                    if (!proc.courseId && rows[0].course_id) update.courseId = rows[0].course_id;
                    if (!proc.branchId && rows[0].branch_id) update.branchId = rows[0].branch_id;
                    if (Object.keys(update).length > 0) {
                        await Proceeding.updateOne({ _id: proc._id }, { $set: update });
                        updatedProc++;
                    }
                }
            } catch (e) { /* skip */ }
        }

        // Sync ProceedingStudent documents missing IDs
        const studentsToSync = await ProceedingStudent.find({ $or: [{ collegeId: null }, { courseId: null }, { collegeId: { $exists: false } }, { courseId: { $exists: false } }] });
        if (studentsToSync.length > 0) {
            const admNos = [...new Set(studentsToSync.map(s => s.studentId || s.admissionNumber).filter(Boolean))];
            if (admNos.length > 0) {
                const [sqlRows] = await db.query(
                    `SELECT admission_number, college_id, course_id, branch_id FROM students WHERE admission_number IN (${admNos.map(() => '?').join(',')})`,
                    admNos
                );
                const idMap = {};
                sqlRows.forEach(r => { idMap[r.admission_number] = r; });

                for (const stu of studentsToSync) {
                    const key = stu.studentId || stu.admissionNumber;
                    const sql = idMap[key];
                    if (!sql) continue;
                    const update = {};
                    if (!stu.collegeId && sql.college_id) update.collegeId = sql.college_id;
                    if (!stu.courseId && sql.course_id) update.courseId = sql.course_id;
                    if (!stu.branchId && sql.branch_id) update.branchId = sql.branch_id;
                    if (Object.keys(update).length > 0) {
                        await ProceedingStudent.updateOne({ _id: stu._id }, { $set: update });
                        updatedStu++;
                    }
                }
            }
        }

        res.json({ message: `Synced IDs: ${updatedProc} proceedings, ${updatedStu} proceeding students updated.` });
    } catch (error) {
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// ─── Scholarship analytics (student_scholarship from SQL + proceeding shares) ─
// GET /api/proceedings/scholarship-analytics?college=&course=&branch=&batch=&academicYear=
const getScholarshipAnalytics = async (req, res) => {
    try {
        const {
            college,
            course,
            branch,
            batch,
            academicYear,
            page = 1,
            limit = 20,
            status = 'all',
            year = 'all',
            search = '',
            sortBy = 'studentName',
            sortDir = 'asc'
        } = req.query;
        if (!academicYear) {
            return res.status(400).json({ message: 'Academic Year is required' });
        }

        const allowedColleges = await collegeScope.getUserCollegeNames(req.user);
        if (college && allowedColleges && !allowedColleges.includes(college)) {
            return res.status(403).json({ message: 'Access denied for this college' });
        }

        const allowedCourses = req.user?.courses?.length > 0 ? req.user.courses : null;
        if (college && course && allowedCourses) {
            const matchString = `${college}|${course}`;
            if (!allowedCourses.includes(matchString)) {
                return res.status(403).json({ message: 'Access denied for this course' });
            }
        }

        // Include students of any status (Regular, Detained, Course Completed, etc.)
        const conditions = [];
        const params = [];

        if (college) {
            conditions.push('college = ?');
            params.push(college);
        }
        if (course) {
            conditions.push('course = ?');
            params.push(course);
        }
        if (batch) {
            conditions.push('batch = ?');
            params.push(batch);
        }
        if (branch) {
            conditions.push('branch = ?');
            params.push(branch);
        }

        const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const [studentRows] = await db.query(
            `SELECT id, admission_number, pin_no, student_name, college, course, branch, batch, current_year, stud_type, caste
             FROM students
             ${whereSql}
             ORDER BY student_name`,
            params
        );

        const sqlIds = studentRows.map(s => s.id).filter(Boolean);
        const scholarshipMap = {};

        if (sqlIds.length > 0) {
            const placeholders = sqlIds.map(() => '?').join(',');
            const [scholarshipRows] = await db.query(
                `SELECT id, student_id, student_year, student_semester, application_id, eligible,
                        sanctioned_amount, from_date, to_date, proceeding, released_amount,
                        paid_amount, fee_paid, created_at, updated_at
                 FROM student_scholarship
                 WHERE student_id IN (${placeholders})
                 ORDER BY student_year ASC, student_semester ASC, application_id ASC`,
                sqlIds
            );
            (scholarshipRows || []).forEach(row => {
                const sId = String(row.student_id);
                if (!scholarshipMap[sId]) scholarshipMap[sId] = [];
                scholarshipMap[sId].push({
                    id: row.id,
                    studentId: row.student_id,
                    studentYear: row.student_year,
                    studentSemester: row.student_semester,
                    applicationId: row.application_id || '',
                    eligible: row.eligible || '',
                    sanctionedAmount: row.sanctioned_amount != null ? Number(row.sanctioned_amount) : null,
                    fromDate: row.from_date || null,
                    toDate: row.to_date || null,
                    proceeding: row.proceeding || '',
                    releasedAmount: row.released_amount != null ? Number(row.released_amount) : null,
                    paidAmount: row.paid_amount != null ? Number(row.paid_amount) : null,
                    feePaid: row.fee_paid != null ? Boolean(row.fee_paid) : false,
                    createdAt: row.created_at || null,
                    updatedAt: row.updated_at || null,
                });
            });
        }

        let withScholarship = 0;
        let totalRecords = 0;
        const applicationIds = new Set();
        let eligibleAmount = 0;
        const eligibleAdmissionKeys = new Set(); // admission / studentId keys for proceeding match
        const eligibleKeyToYear = new Map(); // adm -> student year number
        const yearBuckets = {}; // yearNum -> accumulators
        const mappedKeysByYear = {}; // yearNum -> Set of adm keys

        const ensureYearBucket = (yearNum) => {
            const y = Number(yearNum);
            if (!Number.isFinite(y) || y < 1) return null;
            if (!yearBuckets[y]) {
                yearBuckets[y] = {
                    year: y,
                    eligibleStudents: 0,
                    eligibleAmount: 0,
                    releasedAmount: 0,
                    mappedStudents: 0,
                    pendingAmount: 0,
                    pendingStudents: 0,
                };
                mappedKeysByYear[y] = new Set();
            }
            return yearBuckets[y];
        };

        const sumUniqueSanctioned = (rows = []) => {
            // Semester duplicates share the same sanctioned amount — take max per application, then sum apps
            const byApp = new Map();
            (rows || []).forEach((r) => {
                const app = String(r.applicationId || '').trim() || '_';
                const n = Number(r.sanctionedAmount);
                if (!Number.isFinite(n) || n <= 0) return;
                const prev = byApp.get(app) || 0;
                if (n > prev) byApp.set(app, n);
            });
            return Math.round([...byApp.values()].reduce((a, b) => a + b, 0) * 100) / 100;
        };

        const students = studentRows.map(s => {
            const targetYear = computeProceedingYear(s.batch, academicYear);
            const allScholarships = scholarshipMap[String(s.id)] || [];
            // Eligible for this AY: has application ID for the computed student year
            const scholarships = allScholarships.filter((r) => {
                if (!String(r.applicationId || '').trim()) return false;
                if (targetYear == null) return false;
                return Number(r.studentYear) === Number(targetYear);
            });

            if (scholarships.length > 0) {
                withScholarship += 1;
                const admKey = String(s.admission_number || '').trim();
                if (admKey) {
                    eligibleAdmissionKeys.add(admKey);
                    if (targetYear != null) eligibleKeyToYear.set(admKey, Number(targetYear));
                }
                const bucket = ensureYearBucket(targetYear);
                if (bucket) bucket.eligibleStudents += 1;
                scholarships.forEach((r) => {
                    totalRecords += 1;
                    applicationIds.add(String(r.applicationId));
                });
                const studentEligibleAmt = sumUniqueSanctioned(scholarships);
                eligibleAmount += studentEligibleAmt;
                if (bucket) bucket.eligibleAmount += studentEligibleAmt;
            }

            return {
                sqlId: s.id,
                admissionNumber: s.admission_number || '',
                pinNo: s.pin_no || '',
                studentName: s.student_name || '',
                college: s.college || '',
                course: s.course || '',
                branch: s.branch || '',
                batch: s.batch || '',
                currentYear: s.current_year || '',
                studType: s.stud_type || '',
                caste: s.caste || 'OC',
                targetYear,
                scholarshipCount: scholarships.length,
                scholarships,
                allScholarshipCount: allScholarships.filter(r => String(r.applicationId || '').trim()).length,
            };
        }).filter(s => s.scholarships.length > 0);

        // Released = sum of proceeding share amounts for eligible students on this AY
        // Match via ProceedingStudent college/course (covers multi-college/course proceedings)
        let releasedAmount = 0;
        const mappedEligibleKeys = new Set();
        const releasedByKey = new Map(); // adm -> sum of proceeding shares
        let proceedingCount = 0;

        if (eligibleAdmissionKeys.size > 0) {
            const mapQuery = {};
            if (college) mapQuery.college = college;
            if (course) mapQuery.course = course;
            if (batch) mapQuery.batch = batch;
            if (branch) mapQuery.branch = branch;

            const mappedRows = await ProceedingStudent.find(mapQuery)
                .select('proceedingId studentId admissionNumber shareAmount batch branch proceedingYear')
                .lean();

            const candidateProcIds = [...new Set(mappedRows.map((m) => m.proceedingId).filter(Boolean))];
            const validProcIdSet = new Set();
            if (candidateProcIds.length > 0) {
                const proceedings = await Proceeding.find({
                    _id: { $in: candidateProcIds },
                    academicYear,
                    status: { $nin: ['Cancelled'] },
                    isActive: { $ne: false },
                }).select('_id').lean();
                proceedings.forEach((p) => validProcIdSet.add(String(p._id)));
                proceedingCount = validProcIdSet.size;
            }

            mappedRows.forEach((m) => {
                if (!validProcIdSet.has(String(m.proceedingId))) return;
                const adm = String(m.admissionNumber || m.studentId || '').trim();
                const sid = String(m.studentId || '').trim();
                const isEligible = (adm && eligibleAdmissionKeys.has(adm))
                    || (sid && eligibleAdmissionKeys.has(sid));
                if (!isEligible) return;
                const share = Number(m.shareAmount) || 0;
                releasedAmount += share;

                let mapKey = null;
                if (adm && eligibleAdmissionKeys.has(adm)) mapKey = adm;
                else if (sid && eligibleAdmissionKeys.has(sid)) mapKey = sid;
                else if (adm) mapKey = adm;
                if (mapKey) {
                    releasedByKey.set(mapKey, (releasedByKey.get(mapKey) || 0) + share);
                    if (eligibleAdmissionKeys.has(mapKey)) mappedEligibleKeys.add(mapKey);
                    if (adm && adm !== mapKey) {
                        releasedByKey.set(adm, (releasedByKey.get(adm) || 0) + share);
                        if (eligibleAdmissionKeys.has(adm)) mappedEligibleKeys.add(adm);
                    }
                    if (sid && sid !== mapKey && sid !== adm) {
                        releasedByKey.set(sid, (releasedByKey.get(sid) || 0) + share);
                        if (eligibleAdmissionKeys.has(sid)) mappedEligibleKeys.add(sid);
                    }
                }

                const yearFromEligible = eligibleKeyToYear.get(adm) || eligibleKeyToYear.get(sid)
                    || (Number(m.proceedingYear) > 0 ? Number(m.proceedingYear) : null);
                const bucket = ensureYearBucket(yearFromEligible);
                if (bucket) {
                    bucket.releasedAmount += share;
                    if (mapKey && mappedKeysByYear[bucket.year]) {
                        mappedKeysByYear[bucket.year].add(mapKey);
                    }
                }
            });
        }

        eligibleAmount = Math.round(eligibleAmount * 100) / 100;
        releasedAmount = Math.round(releasedAmount * 100) / 100;
        const pendingAmount = Math.max(0, Math.round((eligibleAmount - releasedAmount) * 100) / 100);
        const eligibleStudents = students.length;
        const mappedStudents = mappedEligibleKeys.size;
        const pendingStudents = Math.max(0, eligibleStudents - mappedStudents);

        // Per-student: full / partial / pending (partial = on proceeding but share < eligible sanctioned)
        let partialStudents = 0;
        let fullStudents = 0;
        const partialKeysByYear = {};
        const fullKeysByYear = {};

        students.forEach((student) => {
            const adm = String(student.admissionNumber || '').trim();
            const eligibleAmt = sumUniqueSanctioned(student.scholarships);
            const releasedAmt = Math.round((releasedByKey.get(adm) || 0) * 100) / 100;
            const pendingAmt = Math.max(0, Math.round((eligibleAmt - releasedAmt) * 100) / 100);
            const isMapped = !!(adm && mappedEligibleKeys.has(adm));

            let releaseStatus = 'pending';
            // Full only when there is real proceeding release AND it covers eligible amount
            if (!isMapped || releasedAmt <= 0.009) {
                releaseStatus = isMapped ? 'partial' : 'pending';
                if (isMapped) partialStudents += 1;
            } else if (pendingAmt > 0.009) {
                releaseStatus = 'partial';
                partialStudents += 1;
            } else {
                releaseStatus = 'full';
                fullStudents += 1;
            }

            student.eligibleAmount = eligibleAmt;
            student.releasedAmount = releasedAmt;
            student.pendingAmount = pendingAmt;
            student.isSanctioned = isMapped;
            student.isMapped = isMapped;
            student.releaseStatus = releaseStatus; // pending | partial | full
            student.sanctionStatus = releaseStatus === 'full'
                ? 'sanctioned'
                : releaseStatus === 'partial'
                    ? 'partial'
                    : 'pending';

            const y = Number(student.targetYear);
            if (Number.isFinite(y) && y >= 1) {
                if (releaseStatus === 'partial') {
                    if (!partialKeysByYear[y]) partialKeysByYear[y] = new Set();
                    if (adm) partialKeysByYear[y].add(adm);
                } else if (releaseStatus === 'full') {
                    if (!fullKeysByYear[y]) fullKeysByYear[y] = new Set();
                    if (adm) fullKeysByYear[y].add(adm);
                }
            }
        });

        const byYear = Object.keys(yearBuckets)
            .map(Number)
            .sort((a, b) => a - b)
            .map((y) => {
                const b = yearBuckets[y];
                const mapped = mappedKeysByYear[y] ? mappedKeysByYear[y].size : 0;
                const eligCount = Number(b.eligibleStudents) || 0;
                const eligAmt = Math.round(b.eligibleAmount * 100) / 100;
                const relAmt = Math.round(b.releasedAmount * 100) / 100;
                const partial = partialKeysByYear[y] ? partialKeysByYear[y].size : 0;
                const full = fullKeysByYear[y] ? fullKeysByYear[y].size : 0;
                const avgSanctioned = eligCount > 0
                    ? Math.round((eligAmt / eligCount) * 100) / 100
                    : 0;
                return {
                    year: y,
                    eligibleStudents: eligCount,
                    eligibleAmount: eligAmt,
                    avgSanctioned,
                    releasedAmount: relAmt,
                    mappedStudents: mapped,
                    fullStudents: full,
                    partialStudents: partial,
                    pendingAmount: Math.max(0, Math.round((eligAmt - relAmt) * 100) / 100),
                    pendingStudents: Math.max(0, eligCount - mapped),
                };
            });

        // ── Dynamic Category Breakdown across ALL students in scope ──
        const categoryMap = {};
        students.forEach(s => {
            const rawCat = String(s.caste || '').trim();
            const cat = rawCat ? rawCat.toUpperCase() : 'OC';
            if (!categoryMap[cat]) {
                categoryMap[cat] = { category: cat, applied: 0, approved: 0, released: 0, rejected: 0, releasedAmount: 0 };
            }
            categoryMap[cat].applied += 1;
            const hasApp = s.scholarships?.some(sc => sc.applicationId);
            const isApproved = s.scholarships?.some(sc => {
                const el = String(sc.eligible || '').trim().toLowerCase();
                return el === 'eligible' || el === 'yes' || el === 'approved' || (Number(sc.sanctionedAmount) > 0);
            });
            const hasRelease = s.releaseStatus === 'full' || s.releaseStatus === 'partial' || (Number(s.releasedAmount) > 0.009);
            const isRejected = s.scholarships?.some(sc => {
                const el = String(sc.eligible || '').trim().toLowerCase();
                return el === 'rejected' || el === 'not eligible' || el === 'no';
            });

            if (isApproved || hasApp) categoryMap[cat].approved += 1;
            if (hasRelease) {
                categoryMap[cat].released += 1;
                categoryMap[cat].releasedAmount += Math.round((Number(s.releasedAmount) || 0) * 100) / 100;
            }
            if (isRejected) categoryMap[cat].rejected += 1;
        });
        const byCategory = Object.values(categoryMap).sort((a, b) => b.applied - a.applied);

        // ── Dynamic Course Breakdown across ALL students in scope ──
        const courseMap = {};
        students.forEach(s => {
            const crs = (s.course || 'Other').trim();
            if (!courseMap[crs]) {
                courseMap[crs] = { course: crs, releasedAmount: 0, studentCount: 0 };
            }
            courseMap[crs].releasedAmount += Math.round((Number(s.releasedAmount) || 0) * 100) / 100;
            courseMap[crs].studentCount += 1;
        });
        const totalCourseRel = Object.values(courseMap).reduce((sum, c) => sum + c.releasedAmount, 0);
        const byCourse = Object.values(courseMap)
            .map(c => ({
                ...c,
                pct: totalCourseRel > 0 ? ((c.releasedAmount / totalCourseRel) * 100).toFixed(1) : '0.0'
            }))
            .sort((a, b) => b.releasedAmount - a.releasedAmount);

        // ── Apply Server-Side Filtering & Sorting on students array ──
        let filteredStudents = [...students];

        // 1. Status Filter
        if (status === 'sanctioned') {
            filteredStudents = filteredStudents.filter(s => s.releaseStatus === 'full');
        } else if (status === 'partial') {
            filteredStudents = filteredStudents.filter(s => s.releaseStatus === 'partial');
        } else if (status === 'pending') {
            filteredStudents = filteredStudents.filter(s => s.releaseStatus === 'pending' || (!s.releaseStatus && !s.isMapped));
        }

        // 2. Year Filter
        if (year !== 'all' && year !== '' && year != null) {
            const yNum = Number(year);
            if (Number.isFinite(yNum)) {
                filteredStudents = filteredStudents.filter(s => Number(s.targetYear) === yNum);
            }
        }

        // 3. Search Filter
        const q = String(search || '').trim().toLowerCase();
        if (q) {
            filteredStudents = filteredStudents.filter(s =>
                String(s.studentName || '').toLowerCase().includes(q)
                || String(s.admissionNumber || '').toLowerCase().includes(q)
                || String(s.pinNo || '').toLowerCase().includes(q)
            );
        }

        // 4. Sort
        const mul = sortDir === 'desc' ? -1 : 1;
        const getSortVal = (s) => {
            if (sortBy === 'admissionNumber') return String(s.admissionNumber || '').toLowerCase();
            if (sortBy === 'pinNo') return String(s.pinNo || '').toLowerCase();
            if (sortBy === 'branch') return String(s.branch || '').toLowerCase();
            if (sortBy === 'batch') return String(s.batch || '').toLowerCase();
            return String(s.studentName || '').toLowerCase();
        };

        filteredStudents.sort((a, b) => {
            const av = getSortVal(a);
            const bv = getSortVal(b);
            if (av < bv) return -1 * mul;
            if (av > bv) return 1 * mul;
            return 0;
        });

        // 5. Pagination calculation
        const totalFilteredStudents = filteredStudents.length;
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.max(1, Math.min(500, parseInt(limit, 10) || 20));
        const totalPages = Math.ceil(totalFilteredStudents / limitNum) || 1;
        const startIndex = (pageNum - 1) * limitNum;
        const paginatedStudents = filteredStudents.slice(startIndex, startIndex + limitNum);

        // 6. Fee Structure lookup executed ONLY on paginated slice of students
        if (paginatedStudents.length > 0) {
            try {
                const colleges = [...new Set(paginatedStudents.map(s => s.college).filter(Boolean))];
                const courses = [...new Set(paginatedStudents.map(s => s.course).filter(Boolean))];
                const branches = [...new Set(paginatedStudents.map(s => s.branch).filter(Boolean))];
                const batches = [...new Set(paginatedStudents.map(s => s.batch).filter(Boolean))];
                const categories = [...new Set(paginatedStudents.map(s => s.studType).filter(Boolean))];

                const [applicableStructures, feeHeads] = await Promise.all([
                    FeeStructure.find({
                        college: { $in: colleges },
                        course: { $in: courses },
                        branch: { $in: branches },
                        batch: { $in: batches },
                        category: { $in: categories },
                    }).lean(),
                    FeeHead.find().lean(),
                ]);

                const feeHeadMap = {};
                (feeHeads || []).forEach(fh => { feeHeadMap[String(fh._id)] = fh; });

                paginatedStudents.forEach(student => {
                    const years = [...new Set(student.scholarships.map(r => r.studentYear))];
                    student.scholarshipFeeByYear = {};
                    years.forEach(yr => {
                        student.scholarshipFeeByYear[String(yr)] = resolveScholarshipApplicableFeeForYear(
                            applicableStructures,
                            feeHeadMap,
                            student,
                            yr
                        );
                    });
                });
            } catch (feeErr) {
                console.error('Scholarship fee structure lookup failed:', feeErr);
                paginatedStudents.forEach(student => {
                    const years = [...new Set(student.scholarships.map(r => r.studentYear))];
                    student.scholarshipFeeByYear = {};
                    years.forEach(yr => {
                        student.scholarshipFeeByYear[String(yr)] = {
                            amount: null,
                            note: 'Fee structure lookup unavailable',
                        };
                    });
                });
            }
        }

        res.json({
            academicYear,
            overview: {
                eligibleStudents,
                eligibleAmount,
                releasedAmount,
                mappedStudents,
                fullStudents,
                partialStudents,
                pendingAmount,
                pendingStudents,
                proceedingCount,
                byYear,
                byCategory,
                byCourse,
            },
            stats: {
                totalStudents: students.length,
                withScholarship,
                withoutScholarship: Math.max(0, studentRows.length - withScholarship),
                totalRecords,
                uniqueApplications: applicationIds.size,
            },
            pagination: {
                page: pageNum,
                limit: limitNum,
                totalStudents: totalFilteredStudents,
                totalPages,
            },
            students: paginatedStudents,
        });
    } catch (error) {
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// ─── Cancel proceeding (Pending or Verified or Active → Cancelled) ──────
const cancelProceeding = async (req, res) => {
    try {
        const proceeding = await Proceeding.findById(req.params.id);
        if (!proceeding) return res.status(404).json({ message: 'Proceeding not found' });
        if (!await validateProceedingAccess(proceeding, req.user)) {
            return res.status(403).json({ message: 'Forbidden: Access denied' });
        }
        if (proceeding.status === 'Cancelled') {
            return res.status(400).json({ message: 'Proceeding is already cancelled' });
        }

        const txnCount = await Transaction.countDocuments({ proceedingId: proceeding._id, status: { $ne: 'cancelled' } });
        if (txnCount > 0) {
            return res.status(400).json({
                message: `Cannot cancel: ${txnCount} active transaction(s) are linked to this proceeding. Cancel linked transactions first.`
            });
        }

        proceeding.status = 'Cancelled';
        proceeding.cancelledBy = req.user?.username || '';
        proceeding.cancelledByName = req.user?.name || '';
        proceeding.cancelledAt = new Date();
        await proceeding.save();

        await ProceedingStudent.updateMany(
            { proceedingId: proceeding._id },
            { $set: { txnPending: false, txnPendingReason: 'Proceeding Cancelled' } }
        );

        res.json({ message: 'Proceeding cancelled successfully.', proceeding });
    } catch (error) {
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// ─── Toggle active status (Active / Inactive) ───────────────────────────
const toggleProceedingActive = async (req, res) => {
    try {
        const proceeding = await Proceeding.findById(req.params.id);
        if (!proceeding) return res.status(404).json({ message: 'Proceeding not found' });
        if (!await validateProceedingAccess(proceeding, req.user)) {
            return res.status(403).json({ message: 'Forbidden: Access denied' });
        }

        const nextActiveState = req.body?.isActive !== undefined
            ? Boolean(req.body.isActive)
            : (proceeding.isActive === false);

        proceeding.isActive = nextActiveState;
        if (!nextActiveState) {
            proceeding.inactivatedBy = req.user?.username || '';
            proceeding.inactivatedByName = req.user?.name || '';
            proceeding.inactivatedAt = new Date();
        } else {
            proceeding.inactivatedBy = '';
            proceeding.inactivatedByName = '';
            proceeding.inactivatedAt = null;
        }

        await proceeding.save();
        res.json({
            message: `Proceeding marked as ${nextActiveState ? 'Active' : 'Inactive'} successfully.`,
            proceeding
        });
    } catch (error) {
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// ─── Check duplicate proceeding (same academic year + same student shares) ──
const checkDuplicateProceeding = async (req, res) => {
    try {
        const { academicYear, students, currentProceedingId, proceedingNumber } = req.body;
        if (!academicYear || !Array.isArray(students) || students.length === 0) {
            return res.json({ isDuplicate: false });
        }

        const parsedStudents = parseStudentsBody(students) || [];
        if (parsedStudents.length === 0) return res.json({ isDuplicate: false });

        const procQuery = {
            academicYear,
            status: { $nin: ['Cancelled'] },
            isActive: { $ne: false }
        };
        if (currentProceedingId) {
            procQuery._id = { $ne: currentProceedingId };
        }

        const existingProceedings = await Proceeding.find(procQuery).select('_id proceedingNumber amount status createdAt').lean();
        if (existingProceedings.length === 0) {
            return res.json({ isDuplicate: false });
        }

        const incomingMap = new Map();
        parsedStudents.forEach(s => {
            const key = String(s.admissionNumber || s.studentId || '').trim();
            const share = roundMoney(Number(s.shareAmount) || 0);
            if (key && share > 0) {
                incomingMap.set(key, share);
            }
        });

        if (incomingMap.size === 0) return res.json({ isDuplicate: false });

        for (const proc of existingProceedings) {
            const mappedStudents = await ProceedingStudent.find({ proceedingId: proc._id }).select('admissionNumber studentId shareAmount').lean();
            if (mappedStudents.length === 0) continue;

            const existingMap = new Map();
            mappedStudents.forEach(m => {
                const key = String(m.admissionNumber || m.studentId || '').trim();
                const share = roundMoney(Number(m.shareAmount) || 0);
                if (key && share > 0) {
                    existingMap.set(key, share);
                }
            });

            if (incomingMap.size === existingMap.size) {
                let match = true;
                for (const [key, share] of incomingMap.entries()) {
                    const exShare = existingMap.get(key);
                    if (exShare === undefined || Math.abs(exShare - share) > 0.05) {
                        match = false;
                        break;
                    }
                }
                if (match) {
                    const isDiffNum = String(proceedingNumber || '').trim().toLowerCase() !== String(proc.proceedingNumber || '').trim().toLowerCase();
                    return res.json({
                        isDuplicate: true,
                        isDifferentNumber: isDiffNum,
                        existingProceeding: proc,
                        message: `Potential duplicate detected! Proceeding '${proc.proceedingNumber}' (Status: ${proc.status}, Amount: ₹${proc.amount.toLocaleString('en-IN')}) for Academic Year ${academicYear} has identical student list and share amounts.`
                    });
                }
            }
        }

        res.json({ isDuplicate: false });
    } catch (error) {
        console.error('Check duplicate error:', error);
        res.json({ isDuplicate: false });
    }
};

module.exports = {
    getProceedings,
    getPendingAutoTxnAlert,
    createProceeding,
    getProceedingById,
    updateProceeding,
    attachProceedingFile,
    verifyProceeding,
    approveProceeding,
    cancelProceeding,
    toggleProceedingActive,
    checkDuplicateProceeding,
    deleteProceeding,
    getProceedingSummary,
    loadStudentsForProceeding,
    processNightlyProceedingTransactions,
    generateProceedingTransactions,
    syncProceedingStudentTxnStatus,
    syncProceedingIds,
    getScholarshipAnalytics
};
