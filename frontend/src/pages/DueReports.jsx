import React, { useState, useEffect } from 'react';
import Sidebar from './Sidebar';
import api from '../lib/api';
import { Filter, Download, ArrowRight, DollarSign, Search, ChevronLeft, ChevronRight, FileText, Printer, X, Users, BookOpen, Percent, Wallet, AlertCircle, Clock } from 'lucide-react';
import * as XLSX from 'xlsx';
import { useCampuses, getCollegeNamesForCampuses } from '../hooks/useCampuses';
import { printHtmlDocument } from '../utils/printService';

const MultiSelectDropdown = ({ label, options, selectedValues, onChange, disabled }) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = React.useRef(null);

    const normalizedOptions = React.useMemo(() => (
        (options || []).map(opt => (
            typeof opt === 'string'
                ? { value: opt, label: opt }
                : { value: String(opt.value), label: opt.label || String(opt.value) }
        ))
    ), [options]);

    const optionValues = normalizedOptions.map(o => o.value);

    React.useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const toggleOption = (val) => {
        if (selectedValues.includes(val)) {
            onChange(selectedValues.filter(x => x !== val));
        } else {
            onChange([...selectedValues, val]);
        }
    };

    const toggleAll = () => {
        if (selectedValues.length === optionValues.length) {
            onChange([]);
        } else {
            onChange([...optionValues]);
        }
    };

    return (
        <div className="relative w-full text-left" ref={dropdownRef}>
            <label className="text-[11px] font-bold text-gray-600 block mb-1 uppercase tracking-wider">{label}</label>
            <button
                type="button"
                disabled={disabled}
                onClick={() => setIsOpen(!isOpen)}
                className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-xs rounded focus:ring-1 focus:ring-blue-500 focus:border-blue-500 block p-2.5 font-semibold flex justify-between items-center disabled:opacity-50 disabled:cursor-not-allowed"
            >
                <span className="truncate">
                    {selectedValues.length === 0 
                        ? `Select ${label}` 
                        : selectedValues.length === optionValues.length && optionValues.length > 0
                        ? `All ${label}s` 
                        : `${selectedValues.length} Selected`}
                </span>
                <span className="ml-2 text-gray-500 text-[10px]">▼</span>
            </button>

            {isOpen && (
                <div className="absolute z-30 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto p-2 space-y-1">
                    {normalizedOptions.length > 0 ? (
                        <>
                            <label className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-100 rounded cursor-pointer select-none font-bold text-[11px] border-b border-gray-100 pb-2">
                                <input
                                    type="checkbox"
                                    checked={selectedValues.length === optionValues.length && optionValues.length > 0}
                                    onChange={toggleAll}
                                    className="w-3.5 h-3.5 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                                />
                                <span>Select All</span>
                            </label>
                            {normalizedOptions.map(opt => {
                                const isChecked = selectedValues.includes(opt.value);
                                return (
                                    <label key={opt.value} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-100 rounded cursor-pointer select-none text-[11px] font-medium text-gray-700">
                                        <input
                                            type="checkbox"
                                            checked={isChecked}
                                            onChange={() => toggleOption(opt.value)}
                                            className="w-3.5 h-3.5 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                                        />
                                        <span>{opt.label}</span>
                                    </label>
                                );
                            })}
                        </>
                    ) : (
                        <div className="text-[11px] text-gray-400 p-2 italic text-center">No options available</div>
                    )}
                </div>
            )}
        </div>
    );
};

const DueReports = () => {
    const [metadata, setMetadata] = useState({});
    const [colleges, setColleges] = useState([]);
    const [courses, setCourses] = useState([]);
    const [branches, setBranches] = useState([]);
    const [batches, setBatches] = useState([]);
    const [quotas, setQuotas] = useState([]);
    const [academicYears, setAcademicYears] = useState([]);
    const [currentAcademicYear, setCurrentAcademicYear] = useState('');
    const [studentStatuses, setStudentStatuses] = useState([]);
    const [feeHeads, setFeeHeads] = useState([]);
    const [selectedFeeHeadIds, setSelectedFeeHeadIds] = useState([]);

    // Generate Academic Years (current year ± 6 years)
    const generateAcademicYears = () => {
        const currentYear = new Date().getFullYear();
        const years = [];
        
        // Start from 6 years before current year
        for (let i = currentYear - 6; i <= currentYear + 6; i++) {
            years.push(`${i}-${i + 1}`);
        }
        
        return years.sort((a, b) => {
            const yearA = parseInt(a.split('-')[0]);
            const yearB = parseInt(b.split('-')[0]);
            return yearB - yearA; // Descending order (latest first)
        });
    };

    // Get current academic year
    const getCurrentAcademicYear = () => {
        const now = new Date();
        const currentYear = now.getFullYear();
        const month = now.getMonth(); // 0-11
        
        // If current month is June or later, the academic year started this year
        // If current month is May or earlier, the academic year started last year
        if (month >= 5) { // June onwards (month 5 onwards)
            return `${currentYear}-${currentYear + 1}`;
        } else {
            return `${currentYear - 1}-${currentYear}`;
        }
    };

    // Filters
    const [filters, setFilters] = useState({
        campusId: 'all',
        college: '',
        course: '',
        branch: [],
        batch: '',
        quota: [],
        year: '',
        studentStatus: 'Regular'
    });
    const [sortField, setSortField] = useState('');
    const [sortDir, setSortDir] = useState('asc');
    
    const [courseYears, setCourseYears] = useState({});
    const [availableYears, setAvailableYears] = useState([]);

    // Top filters
    const [topFilters, setTopFilters] = useState({
        campusId: 'all',
        batch: ''
    });

    const { campuses } = useCampuses();

    const [reportData, setReportData] = useState([]);
    const [loading, setLoading] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);

    const [searchTerm, setSearchTerm] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(20);
    const [expandedRow, setExpandedRow] = useState(null);
    const [activeTab, setActiveTab] = useState('report');
    const [excludeScholarship, setExcludeScholarship] = useState(true);



    // Print Options Modal State
    const [showPrintModal, setShowPrintModal] = useState(false);
    const [includePrintDetails, setIncludePrintDetails] = useState(false);
    const [printGenerating, setPrintGenerating] = useState(false);

    const toggleRow = (admissionNumber) => {
        setExpandedRow(prev => prev === admissionNumber ? null : admissionNumber);
    };

    // Fetch Metadata on Load
    useEffect(() => {
        const fetchMetadata = async () => {
            try {
                const [metaRes, headsRes] = await Promise.all([
                    api.get('/students/metadata'),
                    api.get('/fee-heads?all=true')
                ]);
                const response = metaRes;
                const meta = response.data.hierarchy || response.data;
                const batchList = response.data.batches || [];
                const quotaList = response.data.quotas || response.data.categories || [];
                const courseYearsData = response.data.courseYears || {};
                const statusList = response.data.statuses || ['Regular', 'Detached', 'Discontinued', 'Detained', 'Completed'];
                
                setMetadata(meta);
                setBatches(batchList);
                setQuotas(quotaList || []);
                setCourseYears(courseYearsData);
                setColleges(Object.keys(meta));
                setStudentStatuses(statusList);
                setFeeHeads(Array.isArray(headsRes.data) ? headsRes.data : []);
                
                // Generate academic years on load
                const years = generateAcademicYears();
                setAcademicYears(years);
                
                // Set current academic year by default
                const currentYear = getCurrentAcademicYear();
                setCurrentAcademicYear(currentYear);
                setTopFilters(prev => ({ ...prev, batch: currentYear }));
                setFilters(prev => ({ ...prev, batch: currentYear }));
                
                console.log('Metadata loaded:', { batches: batchList, quotas: quotaList, courseYears: courseYearsData, currentAcademicYear: currentYear });
            } catch (error) {
                console.error('Error fetching metadata', error);
                // Generate academic years even if metadata fails
                const years = generateAcademicYears();
                setAcademicYears(years);
                const currentYear = getCurrentAcademicYear();
                setCurrentAcademicYear(currentYear);
                setTopFilters(prev => ({ ...prev, batch: currentYear }));
                setFilters(prev => ({ ...prev, batch: currentYear }));
            }
        };
        fetchMetadata();
    }, []);

    // Handle Dependable Dropdowns
    const handleTopCampusChange = (e) => {
        const campusId = e.target.value;
        setTopFilters({ campusId, batch: '' });
        setFilters({ campusId, college: '', course: '', branch: [], batch: topFilters.batch, quota: [], year: '', studentStatus: 'Regular' });
        if (campusId === 'all') {
            setColleges(Object.keys(metadata));
        } else {
            const campusCollegeNames = getCollegeNamesForCampuses(campuses, [Number(campusId)]);
            setColleges(campusCollegeNames.filter((c) => metadata[c]));
        }
        setCourses([]);
        setBranches([]);
        setAvailableYears([]);
    };

    const handleTopBatchChange = (e) => {
        const batch = e.target.value;
        setTopFilters({ ...topFilters, batch });
        setFilters({ ...filters, batch });
    };

    const handleCampusChange = (e) => {
        const campusId = e.target.value;
        setFilters({ campusId, college: '', course: '', branch: [], batch: topFilters.batch, quota: [], year: '', studentStatus: 'Regular' });
        if (campusId === 'all') {
            setColleges(Object.keys(metadata));
        } else {
            const campusCollegeNames = getCollegeNamesForCampuses(campuses, [Number(campusId)]);
            setColleges(campusCollegeNames.filter((c) => metadata[c]));
        }
        setCourses([]);
        setBranches([]);
        setAvailableYears([]);
    };

    const handleCollegeChange = (e) => {
        const college = e.target.value;
        setFilters({ ...filters, college, course: '', branch: [], quota: [], year: '' });
        setCourses(college ? Object.keys(metadata[college] || {}) : []);
        setBranches([]);
        setAvailableYears([]);
    };

    const handleCourseChange = (e) => {
        const course = e.target.value;
        const newFilters = { ...filters, course, branch: [], quota: [], year: '' };

        if (course && filters.college) {
            const courseData = metadata[filters.college][course];
            setBranches(courseData?.branches || []);
            
            // Populate available years from courseYears metadata
            if (courseYears[course]) {
                const duration = courseYears[course];
                // Convert number to array of years: e.g., 4 -> ['1st Year', '2nd Year', '3rd Year', '4th Year']
                const years = [];
                if (typeof duration === 'number') {
                    for (let i = 1; i <= duration; i++) {
                        const suffix = i === 1 ? 'st' : i === 2 ? 'nd' : i === 3 ? 'rd' : 'th';
                        years.push(`${i}${suffix} Year`);
                    }
                }
                setAvailableYears(years);
            } else {
                setAvailableYears([]);
            }
        } else {
            setBranches([]);
            setAvailableYears([]);
        }
        setFilters(newFilters);
    };

    const fetchReport = async () => {
        // Validation: Must have core filters OR a search term
        // Required: college, course
        // Optional: branch, batch, year, quota
        const hasFilters = filters.college && filters.course;
        const hasSearch = searchTerm.trim().length > 0;

        if (!hasFilters && !hasSearch) {
            alert('Please select filters (College, Course) or enter a search term.');
            return;
        }

        setLoading(true);
        setHasSearched(true);
        setCurrentPage(1); // Reset page on new fetch
        try {
            const params = {
                college: filters.college,
                course: filters.course,
                branch: filters.branch.join(','),
                batch: filters.batch,
                year: Array.isArray(filters.year) ? filters.year.join(',') : (filters.year || ''),
                search: searchTerm,
                studentStatus: filters.studentStatus,
                ...(filters.campusId !== 'all' ? { campusId: filters.campusId } : {}),
                // Only add quota if it's selected (not empty)
                ...(filters.quota.length > 0 ? { quota: filters.quota.join(',') } : {})
            };
            
            const response = await api.get(`/reports/dues`, { params });
            setReportData(response.data);
        } catch (error) {
            console.error('Error fetching due report:', error);
            alert('Failed to fetch report');
        } finally {
            setLoading(false);
        }
    };

    const handleOverallPrint = async (includeDetails = false) => {
        if (!filteredData || filteredData.length === 0) return;
        setPrintGenerating(true);
        try {
            const feeHeadLabels = selectedFeeHeadIds.length > 0
                ? feeHeadFilterOptions
                    .filter((fh) => selectedFeeHeadIds.includes(fh.value))
                    .map((fh) => fh.label)
                    .join(', ')
                : 'All Fee Heads';

            // Lean rows with already-filtered amounts (fee-head / scholarship) so print matches the grid
            const printReportData = filteredData.map((s) => ({
                pin_no: s.pin_no,
                admission_number: s.admission_number,
                student_name: s.student_name,
                current_year: s.current_year,
                year: s.year,
                studentYear: s.studentYear,
                college: s.college,
                course: s.course,
                branch: s.branch,
                totalFee: Number(s.totalFee || 0),
                paidAmount: Number(s.paidAmount || 0),
                dueAmount: Number(s.dueAmount || 0),
                activeDue: Number(s.activeDue || 0),
                concessionAmount: Number(s.concessionAmount || 0),
                termDues: Array.isArray(s.termDues) ? s.termDues.map((v) => Number(v || 0)) : [],
                termDueDates: Array.isArray(s.termDueDates) ? s.termDueDates : [],
                scholarshipStatus: s.scholarshipStatus,
                ...(includeDetails ? { groupedFeeDetails: s.groupedFeeDetails || null } : {})
            }));

            const printedOn = `${new Date().toLocaleString('en-IN', {
                timeZone: 'Asia/Kolkata',
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: true
            })} IST`;

            const response = await api.post('/print', {
                template: 'due-report',
                data: {
                    type: 'overall',
                    reportData: printReportData,
                    includeDetails,
                    printedOn,
                    filters: {
                        college: filters.college,
                        course: filters.course,
                        branch: filters.branch.join(','),
                        year: Array.isArray(filters.year) ? filters.year.join(',') : (filters.year || ''),
                        quota: filters.quota.join(','),
                        batch: filters.batch || topFilters.batch,
                        campusId: filters.campusId !== 'all' ? filters.campusId : topFilters.campusId,
                        studentStatus: filters.studentStatus,
                        feeHeads: feeHeadLabels,
                        scholarshipMode: excludeScholarship ? 'Without Sch' : 'With Sch',
                        search: searchTerm.trim() || ''
                    },
                    summary: {
                        totalStudents: printReportData.length,
                        totalFee: printReportData.reduce((sum, s) => sum + Number(s.totalFee || 0), 0),
                        totalCollected: printReportData.reduce((sum, s) => sum + Number(s.paidAmount || 0), 0),
                        totalDue: printReportData.reduce((sum, s) => sum + Number(s.dueAmount || 0), 0),
                        totalActiveDue: printReportData.reduce((sum, s) => sum + Number(s.activeDue || 0), 0),
                    }
                }
            });
            printHtmlDocument(response.data);
            setShowPrintModal(false);
        } catch (err) {
            console.error('Failed to print overall due report:', err);
            alert('Failed to print report.');
        } finally {
            setPrintGenerating(false);
        }
    };

    const handlePrintIndividual = async (student) => {
        try {
            const response = await api.post('/print', {
                template: 'due-report',
                data: {
                    type: 'individual',
                    student: {
                        ...student,
                        college: student.college || filters.college || '',
                        course: student.course || filters.course || '',
                        branch: student.branch || filters.branch || '',
                        year: student.year || filters.year || '',
                    }
                }
            });
            printHtmlDocument(response.data);
        } catch (err) {
            console.error('Failed to print individual due report:', err);
            alert('Failed to print statement.');
        }
    };

    const exportToExcel = () => {
        if (!filteredData || filteredData.length === 0) return;

        // 1. Identify all Unique Fee Heads dynamically
        const allFeeHeads = new Set();
        filteredData.forEach(r => {
            if (r.feeDetailsArray) {
                r.feeDetailsArray.forEach(d => allFeeHeads.add(d.headName));
            }
        });
        const feeHeadsList = Array.from(allFeeHeads).sort();

        // 2. Define Static Columns
        const staticHeaders = [
            "Admission No", "Pin No", "Student Name", "Course", "Branch", "Year", "Phone",
            "Overall Total", "Overall Paid", "Overall Due"
        ];

        // 3. Build Header Rows (Row 1: Main Headers, Row 2: Sub Headers)
        const headerRow1 = [...staticHeaders];
        const headerRow2 = staticHeaders.map(() => ""); // Placeholders for static columns

        // Appending Fee Head Headers
        feeHeadsList.forEach(head => {
            headerRow1.push(head, "", ""); // Push head name and 2 empty slots for merge
            headerRow2.push("Total", "Paid", "Due");
        });

        // 4. Build Data Rows
        const dataRows = filteredData.map(r => {
            const row = [
                r.admission_number,
                r.pin_no,
                r.student_name,
                r.course,
                r.branch,
                r.current_year,
                r.student_mobile,
                r.totalFee,
                r.paidAmount,
                r.dueAmount
            ];

            // Fill dynamic columns matching the sorted feeHeadsList
            feeHeadsList.forEach(head => {
                const detail = r.feeDetailsArray?.find(d => d.headName === head);
                if (detail) {
                    row.push(detail.total || 0, detail.paid || 0, detail.due || 0);
                } else {
                    row.push(0, 0, 0); // No record for this fee head
                }
            });
            return row;
        });

        // 5. Construct Worksheet Data
        const wsData = [headerRow1, headerRow2, ...dataRows];
        const ws = XLSX.utils.aoa_to_sheet(wsData);

        // 6. Apply Cell Merges
        const merges = [];

        // Vertical merges for static columns (spanning Row 0 and Row 1)
        for (let i = 0; i < staticHeaders.length; i++) {
            merges.push({ s: { r: 0, c: i }, e: { r: 1, c: i } });
        }

        // Horizontal merges for Fee Head groupings (Row 0)
        let colIdx = staticHeaders.length;
        feeHeadsList.forEach(() => {
            merges.push({ s: { r: 0, c: colIdx }, e: { r: 0, c: colIdx + 2 } });
            colIdx += 3;
        });

        ws['!merges'] = merges;

        // 7. Write File
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "DueReport");
        XLSX.writeFile(wb, `DueReport_${filters.college || 'Search'}_${filters.batch || 'All'}.xlsx`);
    };

    // Sorting logic
    const sortedData = React.useMemo(() => {
        if (!sortField) return reportData;
        return [...reportData].sort((a, b) => {
            let valA = (sortField === 'dueAmount' || sortField === 'activeDue' || sortField === 'totalFee' || sortField === 'paidAmount') ? (a[sortField] || 0) : (a[sortField] || '');
            let valB = (sortField === 'dueAmount' || sortField === 'activeDue' || sortField === 'totalFee' || sortField === 'paidAmount') ? (b[sortField] || 0) : (b[sortField] || '');

            if (typeof valA === 'string' && sortField !== 'totalFee' && sortField !== 'paidAmount' && sortField !== 'dueAmount' && sortField !== 'activeDue') {
                return sortDir === 'asc'
                    ? String(valA).localeCompare(String(valB))
                    : String(valB).localeCompare(String(valA));
            }
            return sortDir === 'asc'
                ? (Number(valA) > Number(valB) ? 1 : -1)
                : (Number(valB) > Number(valA) ? 1 : -1);
        });
    }, [reportData, sortField, sortDir]);

    // Recalculate student amounts based on scholarship toggle and/or fee-head filter
    const processedData = React.useMemo(() => {
        const hasFeeHeadFilter = selectedFeeHeadIds.length > 0;
        if (!excludeScholarship && !hasFeeHeadFilter) {
            return sortedData;
        }

        const selectedIdSet = new Set(selectedFeeHeadIds.map((id) => String(id)));
        const selectedCodeSet = new Set(
            feeHeads
                .filter((fh) => selectedIdSet.has(String(fh._id)))
                .map((fh) => String(fh.code || '').toUpperCase())
                .filter(Boolean)
        );

        const normalizeFeeHeadId = (id) => {
            if (id == null) return '';
            if (typeof id === 'object') return String(id._id || id.id || '');
            return String(id);
        };

        const itemMatchesFeeHeadFilter = (item) => {
            if (!hasFeeHeadFilter) return true;
            const itemId = normalizeFeeHeadId(item.feeHeadId);
            if (itemId && selectedIdSet.has(itemId)) return true;
            const code = String(item.feeHeadCode || '').toUpperCase();
            if (code && selectedCodeSet.has(code)) return true;
            return false;
        };

        const runClientTermAllocation = (totalAmount, paidAmount, concessionAmount, terms) => {
            const list = Array.isArray(terms) && terms.length > 0
                ? terms
                : [{ termNumber: 1, percentage: 100, amount: totalAmount }];

            let allocated = 0;
            const targets = list.map((t, idx) => {
                const isLast = idx === list.length - 1;
                let target;
                if (isLast) {
                    target = Math.max(0, Math.round(totalAmount) - allocated);
                } else if (t.amount != null && Number(t.amount) > 0) {
                    target = Math.round(Number(t.amount));
                } else if (t.percentage != null && Number(t.percentage) > 0) {
                    target = Math.round((totalAmount * Number(t.percentage)) / 100);
                } else {
                    target = Math.round(totalAmount / list.length);
                }
                allocated += target;
                return {
                    termNumber: Number(t.termNumber) || idx + 1,
                    target,
                    dueDate: t.dueDate || null,
                    isActiveTerm: t.isActiveTerm !== undefined ? !!t.isActiveTerm : true
                };
            });

            let remainingPaid = Math.max(0, paidAmount);
            let remainingConc = Math.max(0, concessionAmount);

            return targets.map(t => {
                let bal = t.target;

                const concTake = Math.min(remainingConc, bal);
                bal -= concTake;
                remainingConc -= concTake;

                const paidTake = Math.min(remainingPaid, bal);
                bal -= paidTake;
                remainingPaid -= paidTake;

                return {
                    termNumber: t.termNumber,
                    balance: Math.max(0, bal),
                    dueDate: t.dueDate,
                    isActiveTerm: t.isActiveTerm
                };
            });
        };

        return sortedData.map(student => {
            const isStudentScholarEligible = String(student.scholarshipStatus || '').toLowerCase() === 'eligible';
            // Without Sch does not change non-eligible students — keep backend term columns (T1/T3 etc.)
            if (excludeScholarship && !hasFeeHeadFilter && !isStudentScholarEligible) {
                return student;
            }

            let totalFee = 0;
            let paidAmount = 0;
            let concessionAmount = 0;
            const studentTermDues = {};
            const feeDetailsMap = {};
            const catSums = {
                academic: { total: 0, paid: 0, concession: 0, due: 0, termsMap: {} },
                hostel: { total: 0, paid: 0, concession: 0, due: 0, termsMap: {} },
                transport: { total: 0, paid: 0, concession: 0, due: 0, termsMap: {} }
            };

            const getCategoryKey = (item) => {
                const code = String(item.feeHeadCode || '').toUpperCase();
                if (code === 'HST01') return 'hostel';
                if (code === 'TRN' || code === 'TRN01') return 'transport';
                return 'academic';
            };

            (student.rawGroupedData || []).forEach(item => {
                if (!itemMatchesFeeHeadFilter(item)) {
                    return;
                }

                const feeCode = String(item.feeHeadCode || '').toUpperCase();
                const isServiceFee = feeCode === 'HST01' || feeCode === 'TRN' || feeCode === 'TRN01';
                const shouldExclude = excludeScholarship && isStudentScholarEligible && item.isScholarshipApplicable && !isServiceFee;

                if (!shouldExclude) {
                    totalFee += (item.totalAmount || 0);
                    paidAmount += (item.paidAmount || 0);
                    concessionAmount += (item.concessionAmount || 0);

                    const itemBalance = Math.max(0, (item.totalAmount || 0) - (item.paidAmount || 0) - (item.concessionAmount || 0));

                    const termAllocations = runClientTermAllocation(
                        item.totalAmount || 0,
                        item.paidAmount || 0,
                        item.concessionAmount || 0,
                        item.terms
                    );

                    termAllocations.forEach(tAlloc => {
                        const termNum = tAlloc.termNumber;
                        if (!studentTermDues[termNum]) studentTermDues[termNum] = 0;
                        studentTermDues[termNum] += tAlloc.balance;

                        const catKey = getCategoryKey(item);
                        const catSum = catSums[catKey];

                        if (!catSum.termsMap[termNum]) {
                            catSum.termsMap[termNum] = {
                                termNumber: termNum,
                                termTarget: 0,
                                balance: 0,
                                dueDate: null,
                                isActiveTerm: false
                            };
                        }

                        catSum.termsMap[termNum].balance += tAlloc.balance;
                        if (tAlloc.dueDate) {
                            catSum.termsMap[termNum].dueDate = tAlloc.dueDate;
                        }
                        if (tAlloc.isActiveTerm) {
                            catSum.termsMap[termNum].isActiveTerm = true;
                        }
                    });

                    const headIdStr = normalizeFeeHeadId(item.feeHeadId) || 'unknown';
                    if (!feeDetailsMap[headIdStr]) {
                        feeDetailsMap[headIdStr] = { total: 0, paid: 0, due: 0, headName: item.feeHeadName || 'Unknown', headCode: item.feeHeadCode || '' };
                    }
                    feeDetailsMap[headIdStr].total += (item.totalAmount || 0);
                    feeDetailsMap[headIdStr].paid += (item.paidAmount || 0);
                    feeDetailsMap[headIdStr].due += itemBalance;

                    const catKey = getCategoryKey(item);
                    const catSum = catSums[catKey];

                    catSum.total += (item.totalAmount || 0);
                    catSum.paid += (item.paidAmount || 0);
                    catSum.concession += (item.concessionAmount || 0);
                    catSum.due += itemBalance;
                }
            });

            // Keep the same number of term columns as the backend row (so T2 can stay empty when due is on T3)
            const maxTermNum = Math.max(
                student.termDues?.length || 0,
                student.termDueDates?.length || 0,
                1,
                ...Object.keys(studentTermDues).map(Number)
            );
            const termDues = [];
            for (let i = 1; i <= maxTermNum; i++) {
                termDues.push(studentTermDues[i] || 0);
            }

            const effectiveTotalFee = hasFeeHeadFilter ? totalFee : student.totalFee;
            const dueAmount = Math.max(0, effectiveTotalFee - paidAmount - concessionAmount);

            let activeDue = 0;
            [catSums.academic, catSums.hostel, catSums.transport].forEach(catSum => {
                Object.values(catSum.termsMap).forEach(term => {
                    if (term.isActiveTerm) {
                        activeDue += (term.balance || 0);
                    }
                });
            });

            const finalizeCategoryClient = (summary) => {
                if (summary.total === 0 && summary.paid === 0 && summary.concession === 0 && summary.due === 0) {
                    return null;
                }
                const terms = Object.values(summary.termsMap).sort((a, b) => a.termNumber - b.termNumber);
                return {
                    total: summary.total,
                    paid: summary.paid,
                    concession: summary.concession,
                    due: summary.due,
                    terms
                };
            };

            const rebuiltGroupedFeeDetails = {
                academic: finalizeCategoryClient(catSums.academic),
                hostel: finalizeCategoryClient(catSums.hostel),
                transport: finalizeCategoryClient(catSums.transport)
            };

            const feeDetailsArray = hasFeeHeadFilter
                ? Object.entries(feeDetailsMap).map(([headId, detail]) => ({
                    headId,
                    headName: detail.headName || 'Unknown',
                    headCode: detail.headCode || '',
                    total: detail.total || 0,
                    paid: detail.paid || 0,
                    due: detail.due || 0
                }))
                : student.feeDetailsArray;

            return {
                ...student,
                totalFee: hasFeeHeadFilter ? totalFee : student.totalFee,
                paidAmount,
                concessionAmount,
                dueAmount,
                activeDue,
                termDues,
                groupedFeeDetails: rebuiltGroupedFeeDetails,
                ...(hasFeeHeadFilter ? { feeDetailsArray } : {})
            };
        });
    }, [sortedData, excludeScholarship, selectedFeeHeadIds, feeHeads]);

    const feeHeadFilterOptions = React.useMemo(() => (
        [...feeHeads]
            .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
            .map(fh => ({
                value: String(fh._id),
                label: fh.code ? `${fh.name} (${fh.code})` : fh.name
            }))
    ), [feeHeads]);

    // Filter Logic - exclude students who have no demands (totalFee === 0)
    const filteredData = React.useMemo(() => {
        return processedData.filter(student => Number(student.totalFee || 0) > 0);
    }, [processedData]);

    const maxTerms = React.useMemo(() => {
        if (!filteredData || filteredData.length === 0) return 1;
        const counts = filteredData.map(st => st.termDues?.length || 0);
        return Math.max(1, ...counts);
    }, [filteredData]);

    const termHeaderDates = React.useMemo(() => {
        if (!filteredData || filteredData.length === 0) return [];
        const dateCounts = {};
        filteredData.forEach(st => {
            (st.termDueDates || []).forEach((d, i) => {
                if (!d) return;
                const termIdx = i + 1;
                if (!dateCounts[termIdx]) dateCounts[termIdx] = {};
                const key = new Date(d).toISOString().slice(0, 10);
                dateCounts[termIdx][key] = (dateCounts[termIdx][key] || 0) + 1;
            });
        });
        const result = [];
        for (let i = 1; i <= maxTerms; i++) {
            if (dateCounts[i]) {
                const best = Object.entries(dateCounts[i]).sort((a, b) => b[1] - a[1])[0];
                const dt = new Date(best[0]);
                result.push(!isNaN(dt.getTime()) ? dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : null);
            } else {
                result.push(null);
            }
        }
        return result;
    }, [filteredData, maxTerms]);

    const printFilterSummary = React.useMemo(() => {
        const campusId = filters.campusId !== 'all' ? filters.campusId : topFilters.campusId;
        const campusName = campusId && campusId !== 'all'
            ? (campuses.find((c) => String(c.id) === String(campusId))?.name || campusId)
            : 'All Campuses';
        const academicYear = filters.batch || topFilters.batch || 'All Academic Years';
        const feeHeadLabels = selectedFeeHeadIds.length > 0
            ? feeHeads
                .filter((fh) => selectedFeeHeadIds.includes(String(fh._id)))
                .map((fh) => (fh.code ? `${fh.name} (${fh.code})` : fh.name))
                .join(', ')
            : 'All Fee Heads';

        return [
            { label: 'Campus', value: campusName },
            { label: 'Academic Year', value: academicYear },
            { label: 'College', value: filters.college || 'All' },
            { label: 'Course', value: filters.course || 'All' },
            { label: 'Branch', value: filters.branch?.length ? filters.branch.join(', ') : 'All' },
            { label: 'Year', value: (Array.isArray(filters.year) ? filters.year.join(', ') : filters.year) || 'All Years' },
            { label: 'Quota', value: filters.quota?.length ? filters.quota.join(', ') : 'All' },
            { label: 'Student Status', value: filters.studentStatus || 'All' },
            { label: 'Fee Heads', value: feeHeadLabels },
            { label: 'Scholarship Mode', value: excludeScholarship ? 'Without Sch' : 'With Sch' },
            { label: 'Search', value: searchTerm.trim() || '—' },
            { label: 'Students in Report', value: String(filteredData?.length || 0) },
        ];
    }, [
        filters,
        topFilters,
        campuses,
        selectedFeeHeadIds,
        feeHeads,
        excludeScholarship,
        searchTerm,
        filteredData,
    ]);

    // Pagination Logic
    const totalPages = Math.ceil(filteredData.length / itemsPerPage);
    const paginatedData = filteredData.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );

    const totalDue = filteredData.reduce((acc, curr) => acc + (curr.dueAmount || 0), 0);
    const totalCollected = filteredData.reduce((acc, curr) => acc + (curr.paidAmount || 0), 0);
    const totalActiveDue = filteredData.reduce((acc, curr) => acc + (curr.activeDue || 0), 0);
    const totalFee = filteredData.reduce((acc, curr) => acc + (curr.totalFee || 0), 0);
    const totalConcession = filteredData.reduce((acc, curr) => acc + (curr.concessionAmount || 0), 0);
    const totalStudents = filteredData.length;

    // Scholarship breakdowns for Fee & Collected amounts
    const totalFeeSch = filteredData.reduce((acc, curr) => {
        const isSch = String(curr.scholarshipStatus).toLowerCase() === 'eligible';
        return acc + (isSch ? (curr.totalFee || 0) : 0);
    }, 0);
    const totalFeeNonSch = totalFee - totalFeeSch;

    const totalCollectedSch = filteredData.reduce((acc, curr) => {
        const isSch = String(curr.scholarshipStatus).toLowerCase() === 'eligible';
        return acc + (isSch ? (curr.paidAmount || 0) : 0);
    }, 0);
    const totalCollectedNonSch = totalCollected - totalCollectedSch;

    // Scholarship counts for the selected year dataset
    const scholarshipEligibleCount = filteredData.filter(s => String(s.scholarshipStatus).toLowerCase() === 'eligible').length;
    const scholarshipIneligibleCount = totalStudents - scholarshipEligibleCount;

    const termBalances = React.useMemo(() => {
        const totals = Array.from({ length: maxTerms }, () => 0);
        filteredData.forEach(student => {
            (student.termDues || []).forEach((due, idx) => {
                if (idx < maxTerms) {
                    totals[idx] += (due || 0);
                }
            });
        });
        return totals;
    }, [filteredData, maxTerms]);

    return (
        <div className="flex h-screen bg-gray-50 font-sans overflow-hidden">
            <Sidebar />

            <div className="flex-1 flex flex-col h-full overflow-hidden">
                <main className="flex-1 overflow-y-auto p-6 scrollbar-thin">
                    <header className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                                <FileText className="text-gray-800" size={24} /> Student Due Reports
                            </h1>
                            <p className="text-sm text-gray-500 mt-1">View pending fees and generate reports.</p>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto items-center">
                            {/* Top Right Filters */}
                            <select
                                className="bg-white border border-gray-200 text-gray-900 text-xs rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent block px-3 py-2 shadow-sm font-semibold"
                                value={topFilters.campusId}
                                onChange={handleTopCampusChange}
                            >
                                <option value="all">All Campuses</option>
                                {campuses.map((campus) => (
                                    <option key={campus.id} value={campus.id}>{campus.name}</option>
                                ))}
                            </select>
                            <select
                                className="bg-white border border-gray-200 text-gray-900 text-xs rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent block px-3 py-2 shadow-sm font-semibold"
                                value={topFilters.batch}
                                onChange={handleTopBatchChange}
                            >
                                <option value="">All Academic Years</option>
                                {academicYears.map(year => (
                                    <option key={year} value={year}>
                                        {year} {currentAcademicYear === year ? '(Current)' : ''}
                                    </option>
                                ))}
                            </select>
                            <button
                                onClick={() => setShowPrintModal(true)}
                                disabled={reportData.length === 0 || loading}
                                className="bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded text-xs px-4 py-2 shadow-sm transition flex items-center justify-center gap-2 disabled:opacity-50 whitespace-nowrap h-full sm:h-9"
                                title="Print Overall Report"
                            >
                                <Printer size={14} /> Print Report
                            </button>
                        </div>
                    </header>
                    {/* Tabs Switcher */}
                    <div className="flex border-b border-gray-200 mb-6 shrink-0 bg-white p-1 rounded-lg">
                        <button
                            onClick={() => setActiveTab('report')}
                            className={`pb-2.5 pt-2 px-4 font-bold text-xs border-b-2 transition ${activeTab === 'report' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
                        >
                            Dues Report Grid
                        </button>
                        <button
                            onClick={() => setActiveTab('guide')}
                            className={`pb-2.5 pt-2 px-4 font-bold text-xs border-b-2 transition ${activeTab === 'guide' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
                        >
                            Dues Calculation Guide
                        </button>
                    </div>

                    {activeTab === 'report' ? (
                        <div className="max-w-[1600px] mx-auto space-y-4">

                         {/* Stats Cards */}
                         <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
                             <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-4 hover:shadow-md transition">
                                 <div>
                                     <div className="flex items-center gap-1.5">
                                         <Users className="text-blue-600" size={14} />
                                         <p className="text-xs text-gray-600 uppercase font-semibold">Total Students</p>
                                     </div>
                                     <p className="text-2xl font-bold text-gray-900 mt-1">{totalStudents}</p>
                                     <p className="text-[10px] text-gray-500 mt-1 font-semibold">
                                          Sch: <span className="text-blue-600 font-bold">{scholarshipEligibleCount}</span> | Non-Sch: <span className="text-gray-700 font-bold">{scholarshipIneligibleCount}</span>
                                      </p>
                                 </div>
                             </div>

                             <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-4 hover:shadow-md transition">
                                 <div>
                                     <div className="flex items-center gap-1.5">
                                         <BookOpen className="text-purple-600" size={14} />
                                         <p className="text-xs text-gray-600 uppercase font-semibold">Total Fee</p>
                                     </div>
                                     <p className="text-2xl font-bold text-gray-900 mt-1">₹{totalFee.toLocaleString('en-IN')}</p>
                                     <p className="text-[10px] text-gray-500 mt-1 font-semibold">
                                         Sch: <span className="text-purple-600 font-bold">₹{totalFeeSch.toLocaleString('en-IN')}</span> | Non: <span className="text-gray-700 font-bold">₹{totalFeeNonSch.toLocaleString('en-IN')}</span>
                                     </p>
                                 </div>
                              </div>

                             <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-4 hover:shadow-md transition">
                                 <div>
                                     <div className="flex items-center gap-1.5">
                                         <Percent className="text-amber-600" size={14} />
                                         <p className="text-xs text-gray-600 uppercase font-semibold">Concessions</p>
                                     </div>
                                     <p className="text-2xl font-bold text-gray-900 mt-1">
                                         ₹{totalConcession.toLocaleString('en-IN')}
                                     </p>
                                 </div>
                             </div>

                             <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-4 hover:shadow-md transition">
                                 <div>
                                     <div className="flex items-center gap-1.5">
                                         <Wallet className="text-green-600" size={14} />
                                         <p className="text-xs text-gray-600 uppercase font-semibold">Total Collected</p>
                                     </div>
                                     <p className="text-2xl font-bold text-gray-900 mt-1">
                                         ₹{totalCollected.toLocaleString('en-IN')}
                                     </p>
                                     <p className="text-[10px] text-gray-500 mt-1 font-semibold">
                                         Sch: <span className="text-green-600 font-bold">₹{totalCollectedSch.toLocaleString('en-IN')}</span> | Non: <span className="text-gray-700 font-bold">₹{totalCollectedNonSch.toLocaleString('en-IN')}</span>
                                     </p>
                                 </div>
                              </div>

                             <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-4 hover:shadow-md transition">
                                 <div>
                                     <div className="flex items-center gap-1.5">
                                         <Clock className="text-amber-600" size={14} />
                                         <p className="text-xs text-gray-600 uppercase font-semibold">Active Due</p>
                                     </div>
                                     <p className="text-2xl font-bold text-amber-600 mt-1">₹{totalActiveDue.toLocaleString('en-IN')}</p>
                                 </div>
                             </div>

                             <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-4 hover:shadow-md transition">
                                 <div>
                                     <div className="flex items-center gap-1.5">
                                         <AlertCircle className="text-red-600" size={14} />
                                         <p className="text-xs text-gray-600 uppercase font-semibold">Total Due</p>
                                     </div>
                                     <p className="text-2xl font-bold text-red-600 mt-1">₹{totalDue.toLocaleString('en-IN')}</p>
                                 </div>
                             </div>
                         </div>

                        {/* Term-wise Outstanding Balances Stats Bar */}
                        {maxTerms > 0 && (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                {termBalances.map((bal, idx) => (
                                    <div key={idx} className="bg-white border border-gray-200 rounded-lg shadow-sm p-4 hover:shadow-md transition">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className="text-xs text-gray-600 uppercase font-semibold">Term {idx + 1} Balance</p>
                                                <p className="text-2xl font-bold text-gray-900 mt-1">₹{bal.toLocaleString('en-IN')}</p>
                                            </div>
                                            <div className="bg-indigo-100 p-3 rounded-lg">
                                                <DollarSign className="text-indigo-600" size={24} />
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Control Bar: Filters & Search */}
                        <div className="bg-white border border-gray-200 rounded shadow-sm p-4 space-y-3">
                            {/* Row 1: Filters */}
                            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
                                <div className="w-full text-left">
                                    <label className="text-[11px] font-bold text-gray-600 block mb-1 uppercase tracking-wider">College</label>
                                    <select
                                        className="bg-gray-50 border border-gray-300 text-gray-900 text-xs rounded focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5 font-semibold"
                                        value={filters.college}
                                        onChange={handleCollegeChange}
                                    >
                                        <option value="">Select College</option>
                                        {colleges.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                                <div className="w-full text-left">
                                    <label className="text-[11px] font-bold text-gray-600 block mb-1 uppercase tracking-wider">Course</label>
                                    <select
                                        className="bg-gray-50 border border-gray-300 text-gray-900 text-xs rounded focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                                        value={filters.course}
                                        onChange={handleCourseChange}
                                        disabled={!filters.college}
                                    >
                                        <option value="">Select Course</option>
                                        {courses.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                                <MultiSelectDropdown
                                    label="Branch"
                                    options={branches}
                                    selectedValues={filters.branch}
                                    onChange={val => setFilters({ ...filters, branch: val })}
                                    disabled={!filters.course}
                                />
                                <div className="min-w-[120px] flex-1">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Year</label>
                                    <select
                                        className="bg-slate-50 border border-slate-300 text-slate-800 text-xs rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                                        value={filters.year}
                                        onChange={e => setFilters({ ...filters, year: e.target.value })}
                                        disabled={!filters.course || availableYears.length === 0}
                                    >
                                        <option value="">All Years</option>
                                        {availableYears.map(y => (
                                            <option key={y} value={y}>{y}</option>
                                        ))}
                                    </select>
                                </div>
                                <MultiSelectDropdown
                                    label="Quota"
                                    options={quotas || []}
                                    selectedValues={filters.quota}
                                    onChange={val => setFilters({ ...filters, quota: val })}
                                    disabled={!filters.course}
                                />
                                <MultiSelectDropdown
                                    label="Fee Head"
                                    options={feeHeadFilterOptions}
                                    selectedValues={selectedFeeHeadIds}
                                    onChange={setSelectedFeeHeadIds}
                                    disabled={feeHeadFilterOptions.length === 0}
                                />
                                <div className="w-full text-left">
                                    <label className="text-[11px] font-bold text-gray-600 block mb-1 uppercase tracking-wider">Student Status</label>
                                    <select
                                        className="bg-gray-50 border border-gray-300 text-gray-900 text-xs rounded focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5 font-semibold"
                                        value={filters.studentStatus}
                                        onChange={e => setFilters({ ...filters, studentStatus: e.target.value })}
                                    >
                                        <option value="all">All Statuses</option>
                                        {studentStatuses.map(s => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                </div>
                            </div>

                            {/* Row 2: Actions */}
                            <div className="flex flex-wrap items-end gap-2 pt-1 border-t border-gray-100">
                                <button
                                    onClick={fetchReport}
                                    disabled={loading}
                                    className="text-white bg-blue-600 hover:bg-blue-700 font-medium rounded text-xs px-4 py-2.5 transition flex items-center justify-center gap-2 whitespace-nowrap disabled:opacity-50"
                                >
                                    {loading ? '...' : 'Get Data'}
                                </button>

                                <div className="w-px h-8 bg-gray-200 mx-1 hidden sm:block"></div>

                                <div className="flex items-center gap-2 px-2.5 py-1 bg-gray-50 border border-gray-300 rounded shrink-0 select-none">
                                    <span className={`text-[10px] font-bold whitespace-nowrap transition-colors ${!excludeScholarship ? 'text-blue-700' : 'text-gray-400'}`}>With Sch</span>
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={excludeScholarship}
                                        onClick={() => setExcludeScholarship(prev => !prev)}
                                        className={`relative inline-flex h-4 w-8 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-1 ${excludeScholarship ? 'bg-blue-600' : 'bg-gray-300'}`}
                                    >
                                        <span className={`inline-block h-3 w-3 rounded-full bg-white shadow transform transition-transform ${excludeScholarship ? 'translate-x-4' : 'translate-x-0.5'}`} />
                                    </button>
                                    <span className={`text-[10px] font-bold whitespace-nowrap transition-colors ${excludeScholarship ? 'text-blue-700' : 'text-gray-400'}`}>Without Sch</span>
                                </div>

                                <select
                                    className="bg-gray-50 border border-gray-300 text-gray-900 text-xs rounded focus:ring-blue-500 focus:border-blue-500 block w-16 p-2"
                                    value={itemsPerPage}
                                    onChange={(e) => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }}
                                    title="Rows per page"
                                >
                                    <option value={10}>10</option>
                                    <option value={20}>20</option>
                                    <option value={50}>50</option>
                                    <option value={100}>100</option>
                                </select>

                                <div className="relative flex-1 min-w-[180px] max-w-sm">
                                    <div className="absolute inset-y-0 left-0 flex items-center pl-2 pointer-events-none">
                                        <Search size={14} className="text-gray-400" />
                                    </div>
                                    <input
                                        type="text"
                                        className="bg-gray-50 border border-gray-300 text-gray-900 text-xs rounded focus:ring-blue-500 focus:border-blue-500 block w-full pl-8 p-2"
                                        placeholder="Quick Search (Enter to fetch)..."
                                        value={searchTerm}
                                        onChange={e => { setSearchTerm(e.target.value); }}
                                        onKeyDown={(e) => e.key === 'Enter' && fetchReport()}
                                    />
                                </div>

                                <button
                                    onClick={exportToExcel}
                                    disabled={reportData.length === 0}
                                    className="text-gray-700 bg-gray-100 hover:bg-gray-200 border border-gray-300 font-medium rounded text-xs px-3 py-2 transition flex items-center justify-center gap-1 whitespace-nowrap disabled:opacity-50 shrink-0"
                                    title="Export to Excel"
                                >
                                    <Download size={14} />
                                </button>
                            </div>
                        </div>

                        {/* Results Table */}
                        <div className="bg-white border border-gray-200 rounded shadow-sm overflow-hidden flex flex-col min-h-[500px]">
                            <div className="overflow-x-auto flex-1">
                                <table className="w-full text-left border-collapse text-xs">
                                    <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10 text-gray-600 font-semibold">
                                        <tr>
                                            <th className="p-2 w-10 text-center">#</th>
                                            <th 
                                                className="p-2 w-20 cursor-pointer select-none hover:bg-gray-100 transition"
                                                onClick={() => {
                                                    const dir = (sortField === 'pin_no' && sortDir === 'asc') ? 'desc' : 'asc';
                                                    setSortField('pin_no');
                                                    setSortDir(dir);
                                                }}
                                            >
                                                <div className="flex items-center gap-1">
                                                    Pin No {sortField === 'pin_no' && (sortDir === 'asc' ? '▲' : '▼')}
                                                </div>
                                            </th>
                                            <th 
                                                className="p-2 w-20 cursor-pointer select-none hover:bg-gray-100 transition"
                                                onClick={() => {
                                                    const dir = (sortField === 'admission_number' && sortDir === 'asc') ? 'desc' : 'asc';
                                                    setSortField('admission_number');
                                                    setSortDir(dir);
                                                }}
                                            >
                                                <div className="flex items-center gap-1">
                                                    Adm No {sortField === 'admission_number' && (sortDir === 'asc' ? '▲' : '▼')}
                                                </div>
                                            </th>
                                            <th 
                                                className="p-2 cursor-pointer select-none hover:bg-gray-100 transition min-w-[200px]"
                                                onClick={() => {
                                                    const dir = (sortField === 'student_name' && sortDir === 'asc') ? 'desc' : 'asc';
                                                    setSortField('student_name');
                                                    setSortDir(dir);
                                                }}
                                            >
                                                <div className="flex items-center gap-1">
                                                    Name {sortField === 'student_name' && (sortDir === 'asc' ? '▲' : '▼')}
                                                </div>
                                            </th>
                                            <th 
                                                className="p-2 text-right cursor-pointer select-none hover:bg-gray-100 transition"
                                                onClick={() => {
                                                    const dir = (sortField === 'totalFee' && sortDir === 'asc') ? 'desc' : 'asc';
                                                    setSortField('totalFee');
                                                    setSortDir(dir);
                                                }}
                                            >
                                                <div className="flex items-center justify-end gap-1">
                                                    Total Fee {sortField === 'totalFee' && (sortDir === 'asc' ? '▲' : '▼')}
                                                </div>
                                            </th>
                                            <th 
                                                className="p-2 text-right cursor-pointer select-none hover:bg-gray-100 transition"
                                                onClick={() => {
                                                    const dir = (sortField === 'paidAmount' && sortDir === 'asc') ? 'desc' : 'asc';
                                                    setSortField('paidAmount');
                                                    setSortDir(dir);
                                                }}
                                            >
                                                <div className="flex items-center justify-end gap-1">
                                                    Total Paid {sortField === 'paidAmount' && (sortDir === 'asc' ? '▲' : '▼')}
                                                </div>
                                            </th>
                                            {/* Dynamic Term Headers */}
                                            {Array.from({ length: maxTerms }).map((_, i) => (
                                                <th key={i} className="p-2 text-right text-gray-500 font-semibold bg-blue-50/15 w-28">
                                                    <div>T{i + 1} Due</div>
                                                    {termHeaderDates[i] && (
                                                        <div className="text-[9px] font-normal text-gray-400 mt-0.5">{termHeaderDates[i]}</div>
                                                    )}
                                                </th>
                                            ))}
                                            <th 
                                                className="p-2 text-right cursor-pointer select-none hover:bg-gray-100 transition"
                                                onClick={() => {
                                                    const dir = (sortField === 'activeDue' && sortDir === 'asc') ? 'desc' : 'asc';
                                                    setSortField('activeDue');
                                                    setSortDir(dir);
                                                }}
                                            >
                                                <div className="flex items-center justify-end gap-1">
                                                    Active Due {sortField === 'activeDue' && (sortDir === 'asc' ? '▲' : '▼')}
                                                </div>
                                            </th>
                                            <th 
                                                className="p-2 text-right cursor-pointer select-none hover:bg-gray-100 transition"
                                                onClick={() => {
                                                    const dir = (sortField === 'dueAmount' && sortDir === 'asc') ? 'desc' : 'asc';
                                                    setSortField('dueAmount');
                                                    setSortDir(dir);
                                                }}
                                            >
                                                <div className="flex items-center justify-end gap-1">
                                                    Due {sortField === 'dueAmount' && (sortDir === 'asc' ? '▲' : '▼')}
                                                </div>
                                            </th>
                                            <th className="p-2 text-center w-24">Status</th>
                                            <th className="p-2 text-center w-16">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {loading ? (
                                            Array.from({ length: 7 }).map((_, rIdx) => (
                                                <tr key={rIdx} className="animate-pulse border-b border-gray-100 bg-white">
                                                    <td className="p-3 text-center">
                                                        <div className="h-3.5 w-4 bg-slate-200 rounded mx-auto" />
                                                    </td>
                                                    <td className="p-3">
                                                        <div className="h-3.5 w-16 bg-slate-200 rounded" />
                                                    </td>
                                                    <td className="p-3">
                                                        <div className="h-3.5 w-20 bg-slate-200 rounded" />
                                                    </td>
                                                    <td className="p-3">
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-5 h-5 rounded-full bg-slate-200 shrink-0" />
                                                            <div className="h-3.5 w-40 bg-slate-200 rounded" />
                                                        </div>
                                                    </td>
                                                    <td className="p-3 text-right">
                                                        <div className="h-3.5 w-16 bg-slate-200 rounded ml-auto" />
                                                    </td>
                                                    <td className="p-3 text-right">
                                                        <div className="h-3.5 w-16 bg-emerald-100/60 rounded ml-auto" />
                                                    </td>
                                                    {Array.from({ length: maxTerms }).map((_, tIdx) => (
                                                        <td key={tIdx} className="p-3 text-right bg-blue-50/10">
                                                            <div className="h-3.5 w-14 bg-slate-200 rounded ml-auto" />
                                                        </td>
                                                    ))}
                                                    <td className="p-3 text-right">
                                                        <div className="h-3.5 w-16 bg-amber-100/60 rounded ml-auto" />
                                                    </td>
                                                    <td className="p-3 text-right">
                                                        <div className="h-3.5 w-16 bg-rose-100/60 rounded ml-auto" />
                                                    </td>
                                                    <td className="p-3 text-center">
                                                        <div className="h-4 w-14 bg-slate-200 rounded-full mx-auto" />
                                                    </td>
                                                    <td className="p-3 text-center">
                                                        <div className="h-5 w-5 bg-slate-200 rounded-lg mx-auto" />
                                                    </td>
                                                </tr>
                                            ))
                                        ) : filteredData.length === 0 ? (
                                            <tr>
                                                <td colSpan={10 + maxTerms} className="text-center py-32">
                                                    {hasSearched ? (
                                                        <div className="text-gray-500">No records match your search.</div>
                                                    ) : (
                                                        <div className="flex flex-col items-center justify-center text-gray-400">
                                                            <Filter size={48} className="text-gray-200 mb-3" />
                                                            <p className="text-lg font-bold text-gray-500">No Data to Display</p>
                                                            <p className="text-sm mt-1">Please select filters or search above to view the report.</p>
                                                        </div>
                                                    )}
                                                </td>
                                            </tr>
                                        ) : (
                                            paginatedData.map((student, idx) => {
                                                const due = student.dueAmount || 0;
                                                const status = due <= 0 ? 'CLEARED' : 'PENDING';
                                                const isExpanded = expandedRow === student.admission_number;

                                                return (
                                                    <React.Fragment key={student.admission_number}>
                                                        <tr
                                                            className={`hover:bg-blue-50 transition cursor-pointer ${isExpanded ? 'bg-blue-50' : ''}`}
                                                            onClick={() => toggleRow(student.admission_number)}
                                                        >
                                                            <td className="p-2 text-center text-gray-400">{(currentPage - 1) * itemsPerPage + idx + 1}</td>
                                                            <td className="p-2 font-mono font-medium text-gray-600">{student.pin_no || '-'}</td>
                                                            <td className="p-2 font-mono text-gray-600">{student.admission_number || '-'}</td>
                                                            <td className="p-2 font-medium text-gray-900">
                                                                <div className="flex items-center gap-1.5">
                                                                    <span>{student.student_name}</span>
                                                                    {String(student.scholarshipStatus).toLowerCase() === 'eligible' && (
                                                                        <span className="bg-blue-100 text-blue-800 text-[9px] font-bold px-1.5 py-0.5 rounded tracking-wide shrink-0" title="Scholarship Eligible">
                                                                            Sch
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </td>
                                                            <td className="p-2 text-right text-gray-600">₹{(student.totalFee || 0).toLocaleString('en-IN')}</td>
                                                            <td className="p-2 text-right text-green-600 font-semibold">₹{(student.paidAmount || 0).toLocaleString('en-IN')}</td>
                                                            {/* Dynamic Term Dues */}
                                                            {Array.from({ length: maxTerms }).map((_, i) => {
                                                                const dueVal = student.termDues?.[i] || 0;
                                                                return (
                                                                    <td key={i} className="p-2 text-right text-gray-700 font-medium bg-blue-50/5">
                                                                        <div className={dueVal > 0 ? "font-bold text-red-600" : "text-gray-400"}>
                                                                            ₹{dueVal.toLocaleString('en-IN')}
                                                                        </div>
                                                                    </td>
                                                                );
                                                            })}
                                                            <td className="p-2 text-right text-amber-600 font-bold">₹{(student.activeDue || 0).toLocaleString('en-IN')}</td>
                                                            <td className="p-2 text-right font-bold text-red-600">₹{due.toLocaleString('en-IN')}</td>
                                                            <td className="p-2 text-center">
                                                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${status === 'CLEARED' ? 'bg-green-100 text-green-800' : 'bg-red-50 text-red-800'}`}>
                                                                    {status}
                                                                </span>
                                                            </td>
                                                            <td className="p-2 text-center" onClick={e => e.stopPropagation()}>
                                                                <button
                                                                    onClick={() => handlePrintIndividual(student)}
                                                                    className="p-1 rounded text-gray-500 hover:text-blue-600 hover:bg-gray-100 transition"
                                                                    title="Print Dues Statement"
                                                                >
                                                                    <Printer size={14} />
                                                                </button>
                                                            </td>
                                                        </tr>
                                                        {isExpanded && (
                                                            <tr className="bg-gray-50">
                                                                <td colSpan={10 + maxTerms} className="p-4 border-b border-gray-200">
                                                                    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                                                                        <table className="w-full text-xs text-left border-collapse">
                                                                            <thead>
                                                                                <tr className="text-gray-500 border-b border-gray-200 text-[10px] uppercase font-bold">
                                                                                    <th className="pb-2">Fee Category</th>
                                                                                    <th className="pb-2 text-right">Total</th>
                                                                                    <th className="pb-2 text-right">Paid</th>
                                                                                    {Array.from({ length: maxTerms }).map((_, i) => (
                                                                                        <th key={i} className="pb-2 text-right text-gray-500 bg-blue-50/15 w-28">
                                                                                            <div>T{i + 1} Due</div>
                                                                                            {termHeaderDates[i] && (
                                                                                                <div className="text-[9px] font-normal text-gray-400 mt-0.5">{termHeaderDates[i]}</div>
                                                                                            )}
                                                                                        </th>
                                                                                    ))}
                                                                                    <th className="pb-2 text-right">Active Due</th>
                                                                                    <th className="pb-2 text-right">Concession</th>
                                                                                    <th className="pb-2 text-right">Due</th>
                                                                                </tr>
                                                                            </thead>
                                                                            <tbody className="divide-y divide-gray-100">
                                                                                {(() => {
                                                                                    const categories = [
                                                                                        { key: 'academic', label: 'Academic Fees' },
                                                                                        { key: 'hostel', label: 'Hostel Fee' },
                                                                                        { key: 'transport', label: 'Transport Fee' }
                                                                                    ].filter(c => student.groupedFeeDetails?.[c.key]);
 
                                                                                    if (categories.length === 0) {
                                                                                        return <tr><td colSpan={7 + maxTerms} className="text-center py-4 text-gray-400 italic">No breakdown details found.</td></tr>;
                                                                                    }
 
                                                                                    return categories.map(cat => {
                                                                                        const catData = student.groupedFeeDetails[cat.key];
                                                                                        const catActiveDue = (catData.terms || []).reduce((acc, t) => acc + (t.isActiveTerm ? (t.balance || 0) : 0), 0);
                                                                                        return (
                                                                                            <tr key={cat.key} className="hover:bg-gray-50/50">
                                                                                                <td className="py-2.5 font-bold text-gray-700">{cat.label}</td>
                                                                                                <td className="py-2.5 text-right text-gray-600">₹{catData.total.toLocaleString('en-IN')}</td>
                                                                                                <td className="py-2.5 text-right text-green-600 font-semibold">₹{(catData.paid || 0).toLocaleString('en-IN')}</td>
                                                                                                {Array.from({ length: maxTerms }).map((_, i) => {
                                                                                                    const termObj = (catData.terms || []).find(t => Number(t.termNumber) === (i + 1));
                                                                                                    const termBalance = termObj ? (termObj.balance || 0) : 0;
                                                                                                    const termTarget = termObj ? (termObj.termTarget || 0) : 0;
                                                                                                    const termConc = termObj ? (termObj.concessionShare || 0) : 0;
                                                                                                    
                                                                                                    const tDate = termObj?.dueDate ? new Date(termObj.dueDate) : null;
                                                                                                    const fTermDate = tDate && !isNaN(tDate.getTime())
                                                                                                        ? tDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
                                                                                                        : null;

                                                                                                    return (
                                                                                                        <td key={i} className="py-2.5 text-right text-gray-700 bg-blue-50/5">
                                                                                                            <div className={termBalance > 0 ? "font-bold text-red-600" : "text-gray-400"}>
                                                                                                                ₹{termBalance.toLocaleString('en-IN')}
                                                                                                            </div>
                                                                                                            {termTarget > 0 && (
                                                                                                                <div className="text-[9px] text-gray-400 font-normal mt-0.5">
                                                                                                                    Target: ₹{termTarget.toLocaleString('en-IN')}
                                                                                                                    {termConc > 0 && ` (Conc: ₹${termConc.toLocaleString('en-IN')})`}
                                                                                                                </div>
                                                                                                            )}
                                                                                                            {termBalance > 0 && fTermDate && (
                                                                                                                <div className="text-[9px] text-gray-400 font-normal font-mono mt-0.5">{fTermDate}</div>
                                                                                                            )}
                                                                                                        </td>
                                                                                                    );
                                                                                                })}
                                                                                                <td className="py-2.5 text-right text-amber-600 font-bold">₹{catActiveDue.toLocaleString('en-IN')}</td>
                                                                                                <td className="py-2.5 text-right text-purple-600">₹{catData.concession.toLocaleString('en-IN')}</td>
                                                                                                <td className="py-2.5 text-right font-bold text-red-600">₹{catData.due.toLocaleString('en-IN')}</td>
                                                                                            </tr>
                                                                                        );
                                                                                    });
                                                                                })()}
                                                                            </tbody>
                                                                        </table>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        )}
                                                    </React.Fragment>
                                                );
                                            })
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            {/* Pagination Footer */}
                            {!loading && filteredData.length > 0 && (
                                <div className="bg-gray-50 border-t border-gray-200 p-2 flex items-center justify-between text-xs">
                                    <span className="text-gray-500">
                                        {((currentPage - 1) * itemsPerPage) + 1}-{Math.min(currentPage * itemsPerPage, filteredData.length)} of {filteredData.length}
                                    </span>
                                    <div className="flex gap-1">
                                        <button
                                            onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                                            disabled={currentPage === 1}
                                            className="px-2 py-1 border rounded bg-white hover:bg-gray-100 disabled:opacity-50"
                                        >
                                            Prev
                                        </button>
                                        <button
                                            onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                                            disabled={currentPage === totalPages}
                                            className="px-2 py-1 border rounded bg-white hover:bg-gray-100 disabled:opacity-50"
                                        >
                                            Next
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                    ) : (
                        <DueCalculationGuide />
                    )}

                    {/* Print Options Modal */}
                    {showPrintModal && (
                        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
                            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg border border-gray-200 overflow-hidden animate-in zoom-in-95 duration-200 relative">
                                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                                    <div className="flex items-center gap-2 text-gray-800">
                                        <Printer size={20} className="text-blue-600" />
                                        <h3 className="text-base font-bold">Print Active Due Report</h3>
                                    </div>
                                    <button
                                        onClick={() => !printGenerating && setShowPrintModal(false)}
                                        disabled={printGenerating}
                                        className="p-1 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition disabled:opacity-50"
                                    >
                                        <X size={18} />
                                    </button>
                                </div>

                                <div className="px-6 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
                                    <div>
                                        <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">
                                            Selected Filters
                                        </p>
                                        <div className="rounded-xl border border-gray-200 bg-gray-50 overflow-hidden">
                                            <dl className="divide-y divide-gray-100">
                                                {printFilterSummary.map((row) => (
                                                    <div key={row.label} className="grid grid-cols-[140px_1fr] gap-2 px-3 py-2">
                                                        <dt className="text-[11px] font-semibold text-gray-500">{row.label}</dt>
                                                        <dd className="text-[11px] font-bold text-gray-900 break-words">{row.value}</dd>
                                                    </div>
                                                ))}
                                            </dl>
                                        </div>
                                    </div>

                                    <div className="p-4 bg-blue-50/50 rounded-xl border border-blue-100">
                                        <label className="flex items-start gap-3 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={includePrintDetails}
                                                onChange={e => setIncludePrintDetails(e.target.checked)}
                                                disabled={printGenerating}
                                                className="mt-1 w-4 h-4 text-blue-600 rounded focus:ring-blue-500 cursor-pointer"
                                            />
                                            <div>
                                                <span className="text-xs font-bold text-gray-900 block">Include Detailed Fee Breakdown</span>
                                                <span className="text-[11px] text-gray-500 block mt-0.5">
                                                    Adds a column displaying fee head breakdowns (e.g. TUT:5000, LAB:2000...) for each student.
                                                </span>
                                            </div>
                                        </label>
                                    </div>

                                    {!filters.year && (
                                        <div className="text-[11px] text-amber-700 bg-amber-50 p-2.5 rounded-lg border border-amber-200 font-medium">
                                            Note: Since no specific year filter is selected, records in the print report will be automatically divided by student year.
                                        </div>
                                    )}
                                </div>

                                <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-white">
                                    <button
                                        onClick={() => setShowPrintModal(false)}
                                        disabled={printGenerating}
                                        className="px-4 py-2 text-xs font-bold text-gray-600 hover:bg-gray-100 rounded-lg transition disabled:opacity-50"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={() => handleOverallPrint(includePrintDetails)}
                                        disabled={printGenerating || !filteredData?.length}
                                        className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow transition flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <Printer size={14} />
                                        {printGenerating ? 'Preparing…' : 'Print Report'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
};

const DueCalculationGuide = () => {
    return (
        <div className="max-w-[1200px] mx-auto bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden font-sans p-8 space-y-8 animate-in fade-in duration-200">
            <div>
                <h2 className="text-xl font-bold text-gray-800">Complete Guide: Dues & Semester-Reference Term Calculations</h2>
                <p className="text-xs text-gray-500 mt-1 font-medium">Understand the logic, configuration, and calculations that drive outstanding balances and term schedules.</p>
            </div>

            {/* Grid 1: Total Due vs Active Due */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* Total Due Info Card */}
                <div className="bg-red-50/20 border border-red-100 rounded-xl p-5 space-y-3">
                    <div className="flex items-center gap-2">
                        <span className="p-2 bg-red-100 text-red-700 rounded-lg font-bold text-sm">₹</span>
                        <h3 className="font-bold text-gray-855 text-sm">Total Due</h3>
                    </div>
                    <p className="text-xs text-gray-600 leading-relaxed font-medium">
                        <strong>Definition:</strong> The overall outstanding balance accumulated by the student across all assigned fees (Academic, Hostel, Transport).
                    </p>
                    <p className="text-xs text-gray-600 leading-relaxed font-medium">
                        <strong>Formula:</strong> <code>Total Fee - Paid Amount</code> (cannot go below 0).
                    </p>
                    <div className="text-[11px] text-red-700 bg-red-50 p-2.5 rounded-lg border border-red-200/50 font-medium">
                        <strong>Note:</strong> Total Due is completely independent of dates or payment term schedules. It simply shows the absolute remainder of unpaid balance for the academic year.
                    </div>
                </div>

                {/* Active Due Info Card */}
                <div className="bg-amber-50/20 border border-amber-100 rounded-xl p-5 space-y-3">
                    <div className="flex items-center gap-2">
                        <span className="p-2 bg-amber-100 text-amber-700 rounded-lg font-bold text-sm">⏰</span>
                        <h3 className="font-bold text-gray-855 text-sm">Active Due</h3>
                    </div>
                    <p className="text-xs text-gray-600 leading-relaxed font-medium">
                        <strong>Definition:</strong> The amount that is <strong>currently due or overdue</strong> as of today's date.
                    </p>
                    <p className="text-xs text-gray-600 leading-relaxed font-medium">
                        <strong>Formula:</strong> The sum of unpaid balances for all terms whose active date trigger has been reached.
                    </p>
                    <div className="text-[11px] text-amber-700 bg-amber-50 p-2.5 rounded-lg border border-amber-200/50 font-medium">
                        <strong>Due Date Trigger:</strong> A term's balance becomes "active" (due) only <strong>on or after</strong> its resolved due date.
                    </div>
                </div>

            </div>

            {/* Section 2: Semester-Reference Term Columns Alignment */}
            <div className="space-y-4">
                <h3 className="font-bold text-gray-800 text-sm flex items-center gap-1.5">
                    <span>📊</span> Semester-Reference Term Columns Alignment (T1, T2, T3)
                </h3>
                <p className="text-xs text-gray-600 leading-relaxed font-medium">
                    To keep all fee categories aligned in a unified report grid, term balances are dynamically mapped to columns based on their **Semester Reference** instead of raw sequential indices. This ensures columns represent standard semester-based payment windows (T1 & T2 for Semester 1, T3 for Semester 2).
                </p>

                <div className="overflow-x-auto border border-gray-200 rounded-lg">
                    <table className="w-full text-left text-xs border-collapse">
                        <thead className="bg-gray-50 border-b border-gray-200 font-semibold text-gray-600">
                            <tr>
                                <th className="p-3 w-1/4">Category</th>
                                <th className="p-3 w-1/4">T1 Column (Sem 1)</th>
                                <th className="p-3 w-1/4">T2 Column (Sem 1)</th>
                                <th className="p-3 w-1/4">T3 Column (Sem 2)</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 text-gray-700">
                            <tr>
                                <td className="p-3 font-semibold text-gray-900 bg-gray-50/50">Academic Fees</td>
                                <td className="p-3 font-medium">Term 1 (Semester 1 Reference)</td>
                                <td className="p-3 font-medium">Term 2 (Semester 1 Reference)</td>
                                <td className="p-3 font-medium">Term 3 (Semester 2 Reference)</td>
                            </tr>
                            <tr>
                                <td className="p-3 font-semibold text-gray-900 bg-gray-50/50">Transport Fees</td>
                                <td className="p-3 font-medium">Term 1 (Semester 1 Reference)</td>
                                <td className="p-3 font-medium text-gray-400 bg-gray-50/20">₹0 (No second Semester 1 term)</td>
                                <td className="p-3 font-medium">Term 2 (Semester 2 Reference)</td>
                            </tr>
                            <tr>
                                <td className="p-3 font-semibold text-gray-900 bg-gray-50/50">Hostel Fees</td>
                                <td className="p-3 font-medium">Term 1 (Semester 1 Reference)</td>
                                <td className="p-3 font-medium text-gray-400 bg-gray-50/20">₹0 (No second Semester 1 term)</td>
                                <td className="p-3 font-medium">Term 2 (Semester 2 Reference)</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Section 3: Due Dates Calculation Logic */}
            <div className="space-y-4">
                <h3 className="font-bold text-gray-800 text-sm flex items-center gap-1.5">
                    <span>⚙️</span> How Due Dates Are Resolved
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs text-gray-600 leading-relaxed font-medium">
                    <div className="p-4 bg-gray-50 border border-gray-100 rounded-xl space-y-2">
                        <strong className="text-gray-800 block text-xs">1. Fixed Due Dates</strong>
                        <p>
                            If a term's mode is set to <strong>Fixed</strong>, the system uses the exact date entered in the fee structure (e.g., <code>2024-10-15</code>).
                        </p>
                    </div>
                    <div className="p-4 bg-gray-50 border border-gray-100 rounded-xl space-y-2">
                        <strong className="text-gray-800 block text-xs">2. Offset-Based Due Dates</strong>
                        <p>
                            If a term's mode is set to <strong>Offset</strong>, the due date is calculated dynamically:
                            <br />
                            <code>Semester Start Date + Due Offset Days</code>.
                        </p>
                        <p className="text-[10px] text-gray-500 font-medium">
                            *Semester calendar start dates are defined under the Academic Calendar setup for each batch, course, branch, and college.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DueReports;
