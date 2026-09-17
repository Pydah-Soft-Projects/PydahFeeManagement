const db = require('../config/sqlDb');
const { syncStudentFeesByAdmissionNumber } = require('../services/studentFeeSyncService');
const collegeScope = require('../utils/collegeScope');

// @desc    Get all students
// @route   GET /api/students
const getStudents = async (req, res) => {
  try {
    let { college, course, branch, batch, campusId } = req.query;

    const allowedColleges = await collegeScope.getEffectiveCollegeNames(req.user, campusId);
    if (allowedColleges) {
      if (college) {
        const requested = college.split(',').map((c) => c.trim()).filter(Boolean);
        const scoped = collegeScope.intersectCollegeNames(requested, allowedColleges);
        college = scoped.join(',');
        if (!college) return res.json([]);
      } else {
        college = allowedColleges.join(',');
      }
    }

    console.log('Attempting to fetch students from SQL...', { college, course, branch, batch, campusId });

    let query = `
      SELECT 
        id, admission_number, student_name, father_name, caste, 
        college, course, branch, student_mobile, parent_mobile1, parent_mobile2,
        student_status, current_year, current_semester, pin_no, stud_type, batch, email,
        college_id, course_id, branch_id, category_id
      FROM students
    `;

    const conditions = [];
    const params = [];
    if (college) {
      const collegeList = college.split(',').map(c => c.trim()).filter(Boolean);
      if (collegeList.length > 0) {
        conditions.push(`college IN (${collegeList.map(() => '?').join(',')})`);
        params.push(...collegeList);
      }
    }
    if (course) {
      const courseList = course.split(',').map(c => c.trim()).filter(Boolean);
      if (courseList.length > 0) {
        conditions.push(`course IN (${courseList.map(() => '?').join(',')})`);
        params.push(...courseList);
      }
    }
    if (branch) {
      conditions.push('branch = ?');
      params.push(branch);
    }
    if (batch) {
      conditions.push('batch = ?');
      params.push(batch);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    // Optimize query: Select only necessary columns
    // Including 'current_year' to map to Fee Structure's studentYear
    const [rows] = await db.query(query, params);
    console.log(`Successfully fetched ${rows.length} students.`);
    res.json(rows);
  } catch (error) {
    console.error('Error fetching students:', error);
    res.status(500).json({ message: 'Error fetching students form SQL Database', error: error.message });
  }
};

// @desc    Get Institutional Metadata (Colleges -> Courses -> Branches + Duration)
// @route   GET /api/students/metadata
const getStudentMetadata = async (req, res) => {
  try {
    const { campusId } = req.query;
    const allowedColleges = await collegeScope.getEffectiveCollegeNames(req.user, campusId);

    // Join tables to get valid hierarchy including total_years from courses table
    let collegeFilterSql = '';
    const collegeFilterParams = [];
    if (allowedColleges && allowedColleges.length > 0) {
      collegeFilterSql = ` AND cl.name IN (${allowedColleges.map(() => '?').join(',')})`;
      collegeFilterParams.push(...allowedColleges);
    }

    const [rows] = await db.query(`
      SELECT 
        cl.name as college, 
        cl.code as collegeCode,
        c.name as course, 
        c.total_years,
        cb.name as branch 
      FROM colleges cl 
      JOIN courses c ON cl.id = c.college_id 
      JOIN course_branches cb ON c.id = cb.course_id
      WHERE cl.is_active = 1 AND c.is_active = 1 AND cb.is_active = 1
      ${collegeFilterSql}
      ORDER BY cl.name, c.name, cb.name
    `, collegeFilterParams);

    // Transform into hierarchical structure
    // { "College A": { "Course X": { branches: ["Branch 1"], total_years: 4 } } }

    // Also fetch distinct batches and categories (stud_type)
    const [batches] = await db.query(`SELECT DISTINCT batch FROM students WHERE batch IS NOT NULL AND batch != '' ORDER BY batch DESC`);
    const batchList = batches.map(b => b.batch);

    const [types] = await db.query(`SELECT code FROM student_quotas WHERE is_active = 1 ORDER BY sort_order ASC`);
    const categoryList = types.map(t => t.code);

    const [castes] = await db.query(`SELECT DISTINCT caste FROM students WHERE caste IS NOT NULL AND caste != '' ORDER BY caste`);
    const casteList = castes.map(c => c.caste);

    const [statusRows] = await db.query(`SELECT DISTINCT student_status FROM students WHERE student_status IS NOT NULL AND student_status != '' ORDER BY student_status`);
    const statusList = statusRows.map(s => s.student_status);

    const hierarchy = {};
    const collegeCodes = {};
    
    // Scoping down course mapping by courses array if user profile has restricted courses (e.g. Diploma user)
    const userCourses = (req.user.courses || []).map(c => c.includes('|') ? c.split('|')[1] : c);
    rows.forEach(row => {
      if (userCourses.length > 0 && !userCourses.includes(row.course)) {
        return;
      }
      if (row.college && row.collegeCode) {
        collegeCodes[row.college] = row.collegeCode.toUpperCase().trim();
      }
      if (!hierarchy[row.college]) {
        hierarchy[row.college] = {};
      }
      if (!hierarchy[row.college][row.course]) {
        hierarchy[row.college][row.course] = {
          branches: [],
          total_years: row.total_years || 4 // Fallback if null
        };
      }
      if (!hierarchy[row.college][row.course].branches.includes(row.branch)) {
        hierarchy[row.college][row.course].branches.push(row.branch);
      }
    });

    // Course → total_years from courses table (SQL schema: courses.total_years) – dynamic per course (scoped to allowed colleges)
    let courseQuery = `
      SELECT c.name, c.total_years 
      FROM courses c
      JOIN colleges cl ON c.college_id = cl.id
      WHERE c.is_active = 1 AND cl.is_active = 1 AND c.name IS NOT NULL AND c.name != ""
    `;
    const courseParams = [];
    if (allowedColleges && allowedColleges.length > 0) {
      courseQuery += ` AND cl.name IN (${allowedColleges.map(() => '?').join(',')})`;
      courseParams.push(...allowedColleges);
    }
    const [courseRows] = await db.query(courseQuery, courseParams);
    const courseYears = {};
    courseRows.forEach((r) => {
      if (userCourses.length > 0 && !userCourses.includes(r.name)) {
        return;
      }
      const years = r.total_years != null ? Number(r.total_years) : 4;
      if (r.name && !(r.name in courseYears)) courseYears[r.name] = Math.max(1, Math.min(years, 10));
    });

    // Fetch mapping of Categories per College, Course, Batch
    const [categoryRows] = await db.query(`
      SELECT DISTINCT 
         TRIM(college) as college, 
         TRIM(course) as course, 
         TRIM(batch) as batch, 
         stud_type as category 
       FROM students 
       WHERE stud_type IS NOT NULL AND stud_type != '' AND student_status = 'Regular'
     `);
     
     const categoryMapping = {};
     categoryRows.forEach(row => {
       if (userCourses.length > 0 && !userCourses.includes(row.course)) {
         return;
       }
       // Normalize values for key matching (lowercase and trimmed)
       const college = String(row.college || '').trim().toLowerCase();
       const course = String(row.course || '').trim().toLowerCase();
       const batch = String(row.batch || '').trim().toLowerCase();
       const key = `${college}|${course}|${batch}`;
       
       if (!categoryMapping[key]) categoryMapping[key] = [];
       if (!categoryMapping[key].includes(row.category)) {
         categoryMapping[key].push(row.category);
       }
     });
 
     res.json({
       hierarchy,
       batches: batchList,
       categories: categoryList,
       castes: casteList,
       statuses: statusList,
       categoryMapping,
       courseYears,
       collegeCodes,
       scopedColleges: allowedColleges,
     });
  } catch (error) {
    console.error('Error fetching metadata:', error);
    res.status(500).json({ message: 'Failed to fetch metadata' });
  }
};

// @desc    Get Single Student by Admission Number
// @route   GET /api/students/:id
// @query   includePhoto=1  — include student_photo longtext (slow; avoid on fee-collection open)
// @query   photoOnly=1     — return only { student_photo } for deferred photo load
const getStudentByAdmissionNumber = async (req, res) => {
  try {
    const { id } = req.params;
    const includePhoto = req.query.includePhoto === '1' || req.query.includePhoto === 'true';
    const photoOnly = req.query.photoOnly === '1' || req.query.photoOnly === 'true';

    if (photoOnly) {
      const [rows] = await db.query(
        `SELECT college, student_photo FROM students WHERE admission_number = ?`,
        [id]
      );
      if (rows.length === 0) {
        return res.status(404).json({ message: 'Student not found' });
      }
      const allowedColleges = await collegeScope.getUserCollegeNames(req.user);
      if (allowedColleges && !allowedColleges.includes(rows[0].college)) {
        return res.status(403).json({ message: 'Access denied for this student' });
      }
      return res.json({ student_photo: rows[0].student_photo || null });
    }

    // student_photo is LONGTEXT (base64) — exclude by default so Fee Collection opens fast
    const sql = includePhoto
      ? `SELECT * FROM students WHERE admission_number = ?`
      : `SELECT id, admission_number, pin_no, student_name, student_mobile, father_name,
                email, gender, caste, college, course, branch, batch, stud_type, scholar_status,
                current_year, current_semester, student_status, fee_status, registration_status,
                parent_mobile1, parent_mobile2, student_address, dob, adhar_no,
                college_id, course_id, branch_id, category_id
         FROM students WHERE admission_number = ?`;

    const [rows] = await db.query(sql, [id]);

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Student not found' });
    }

    const allowedColleges = await collegeScope.getUserCollegeNames(req.user);
    if (allowedColleges && !allowedColleges.includes(rows[0].college)) {
      return res.status(403).json({ message: 'Access denied for this student' });
    }

    // Fetch scholarship records for this student
    const [scholarships] = await db.query(
      `SELECT student_year, student_semester, eligible, sanctioned_amount, released_amount, application_id, proceeding 
       FROM student_scholarship 
       WHERE student_id = ? 
       ORDER BY student_year ASC, student_semester ASC`,
      [rows[0].id]
    );
    rows[0].scholarships = scholarships || [];

    // Fetch merit status records for this student
    try {
      const [meritRecords] = await db.query(
        `SELECT id, student_id, student_year, merit_status, remarks, created_at, updated_at
         FROM student_merit_status
         WHERE student_id = ? OR CAST(student_id AS CHAR) = ?
         ORDER BY student_year ASC`,
        [rows[0].id, String(rows[0].admission_number || '')]
      );
      rows[0].meritStatusRecords = meritRecords || [];
      rows[0].merit_status = meritRecords || [];
    } catch (meritErr) {
      rows[0].meritStatusRecords = [];
      rows[0].merit_status = [];
    }

    res.json(rows[0]);
  } catch (error) {
    console.error('Error fetching student details:', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// @desc    Search students by Name, Pin, or Admission No
// @route   GET /api/students/search
const searchStudents = async (req, res) => {
    try {
        const { q, campusId } = req.query;
        if (!q || q.length < 1) return res.json([]);

        const allowedColleges = await collegeScope.getEffectiveCollegeNames(req.user, campusId);
        const cleanQ = q.replace(/[^a-zA-Z0-9]/g, '');
        const searchTerm = `%${q}%`;
        const cleanSearchTerm = `%${cleanQ}%`;

        let query = `
            SELECT admission_number, student_name, pin_no, caste, college, course, branch, batch, current_year, current_semester, student_photo, student_mobile,
                   college_id, course_id, branch_id, category_id
            FROM students 
            WHERE (
                admission_number LIKE ? 
                OR student_name LIKE ? 
                OR pin_no LIKE ? 
                OR student_mobile LIKE ?
                ${cleanQ.length > 0 ? `
                OR REPLACE(REPLACE(REPLACE(admission_number, '-', ''), '/', ''), ' ', '') LIKE ?
                OR REPLACE(REPLACE(REPLACE(pin_no, '-', ''), '/', ''), ' ', '') LIKE ?
                ` : ''}
            )
        `;
        const params = [searchTerm, searchTerm, searchTerm, searchTerm];
        if (cleanQ.length > 0) {
            params.push(cleanSearchTerm, cleanSearchTerm);
        }

        if (allowedColleges && allowedColleges.length > 0) {
            query += ` AND college IN (${allowedColleges.map(() => '?').join(',')})`;
            params.push(...allowedColleges);
        }

        query += ' LIMIT 20';
        const [rows] = await db.query(query, params);

        res.json(rows);
    } catch (error) {
        console.error('Error searching students:', error);
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc    Create a new student
// @route   POST /api/students
const createStudent = async (req, res) => {
  try {
    const {
      admission_number,
      pin_no,
      student_name,
      father_name,
      student_mobile,
      email,
      college,
      course,
      branch,
      batch,
      student_status = 'Active',
      stud_type = 'Regular',
      caste = null,
      current_year = 1,
      current_semester = 1
    } = req.body;

    if (!admission_number || !student_name || !college || !course || !branch || !batch || !pin_no) {
      return res.status(400).json({ message: 'Please provide all required fields (Admission Number, Pin Number, Name, College, Course, Branch, Batch).' });
    }

    // Check if admission number already exists
    const [existingAdm] = await db.query('SELECT id FROM students WHERE admission_number = ?', [admission_number]);
    if (existingAdm && existingAdm.length > 0) {
      return res.status(400).json({ message: `Student with Admission Number ${admission_number} already exists.` });
    }

    // Check if PIN number already exists
    const [existingPin] = await db.query('SELECT id FROM students WHERE pin_no = ?', [pin_no]);
    if (existingPin && existingPin.length > 0) {
      return res.status(400).json({ message: `Student with Pin Number ${pin_no} already exists.` });
    }

    // Insert student
    const insertQuery = `
      INSERT INTO students (
        admission_number, pin_no, student_name, father_name, student_mobile, email,
        college, course, branch, batch, student_status, stud_type, caste,
        current_year, current_semester
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const [result] = await db.query(insertQuery, [
      admission_number.trim(),
      pin_no.trim(),
      student_name.trim(),
      father_name ? father_name.trim() : null,
      student_mobile ? student_mobile.trim() : null,
      email ? email.trim() : null,
      college.trim(),
      course.trim(),
      branch.trim(),
      String(batch).trim(),
      student_status,
      stud_type && String(stud_type).trim() !== '' ? String(stud_type).trim() : 'Regular',
      caste && String(caste).trim() !== '' ? String(caste).trim() : null,
      Number(current_year),
      Number(current_semester)
    ]);

    res.status(201).json({
      message: 'Student created successfully',
      studentId: result.insertId,
      student: {
        id: result.insertId,
        admission_number,
        pin_no,
        student_name,
        college,
        course,
        branch,
        batch
      }
    });

  } catch (error) {
    console.error('Error creating student:', error);
    res.status(500).json({ message: 'Error creating student in SQL database', error: error.message });
  }
};

// @desc    Sync student fee demands from matching fee structures (create missing, update amounts)
// @route   POST /api/students/:id/sync-fees
const syncStudentFeesForCollection = async (req, res) => {
  try {
    const admissionNo = String(req.params.id || '').trim();
    if (!admissionNo) {
      return res.status(400).json({ message: 'Admission number is required' });
    }

    const [rows] = await db.query(
      'SELECT admission_number, college FROM students WHERE admission_number = ?',
      [admissionNo]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Student not found' });
    }

    const allowedColleges = await collegeScope.getUserCollegeNames(req.user);
    if (allowedColleges && !allowedColleges.includes(rows[0].college)) {
      return res.status(403).json({ message: 'Access denied for this student' });
    }

    const result = await syncStudentFeesByAdmissionNumber(admissionNo);
    res.json({
      message: 'Student fees synced successfully',
      ...result
    });
  } catch (error) {
    console.error('Error syncing student fees:', error);
    const status = error.statusCode || 500;
    res.status(status).json({ message: error.message || 'Failed to sync student fees' });
  }
};

module.exports = {
  getStudents,
  getStudentMetadata,
  getStudentByAdmissionNumber,
  searchStudents,
  createStudent,
  syncStudentFeesForCollection
};