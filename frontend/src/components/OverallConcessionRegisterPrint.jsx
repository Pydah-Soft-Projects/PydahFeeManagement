import React from 'react';

// ─── shared helpers ────────────────────────────────────────────────────────
const fmt  = n => Number(n ?? 0).toLocaleString('en-IN');
const yrSfx = yr => yr === 1 ? '1st' : yr === 2 ? '2nd' : yr === 3 ? '3rd' : `${yr}th`;

const th = (align = 'left', extra = {}) => ({
    border: '1.5px solid #000', padding: '6px 10px',
    textAlign: align, fontWeight: '900', fontSize: '10px',
    textTransform: 'uppercase', background: '#f0f0f0', ...extra
});
const td = (align = 'left', extra = {}) => ({
    border: '1.5px solid #ccc', padding: '5px 10px',
    textAlign: align, ...extra
});

// ─── CollegeHeader — shared header block ──────────────────────────────────
const Header = ({ subtitle }) => (
    <div style={{ textAlign: 'center', borderBottom: '2.5px solid #000', paddingBottom: '10px', marginBottom: '18px' }}>
        <h1 style={{ fontSize: '18px', fontWeight: '900', textTransform: 'uppercase', letterSpacing: '1.5px', margin: 0 }}>
            Pydah Group of Colleges
        </h1>
        <p style={{ fontSize: '11px', fontWeight: '700', color: '#444', marginTop: '4px', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
            {subtitle}
        </p>
    </div>
);

// ─── SINGLE STUDENT VIEW ──────────────────────────────────────────────────
const SingleStudentPrint = ({ request }) => {
    const concessions = request.concessions || [];

    // All distinct years across all fee heads
    const years = [...new Set(concessions.map(c => Number(c.studentYear)))].sort((a, b) => a - b);

    // Group concessions by fee head and collect remarks
    const byHead = {};
    const remarksByYear = {};
    concessions.forEach(c => {
        const key = c.feeHeadId;
        if (!byHead[key]) {
            byHead[key] = {
                name: c.feeHeadName || c.feeHeadCode || key,
                code: c.feeHeadCode || '',
                type: c.concessionType,
                years: {}
            };
        }
        byHead[key].years[Number(c.studentYear)] = {
            amount: Number(c.amount ?? 0),
            type: c.concessionType || 'REVISED'
        };
        byHead[key].type = c.concessionType || byHead[key].type;
        if (c.feeHeadName) byHead[key].name = c.feeHeadName;
        if (c.remarks) {
            remarksByYear[Number(c.studentYear)] = c.remarks;
        }
    });

    // Fee components become columns; academic years become rows
    const feeHeadEntries = Object.entries(byHead);

    const grandTotal = concessions.reduce((s, c) => s + Number(c.amount ?? 0), 0);

    const approvedDate = request.updatedAt
        ? new Date(request.updatedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })
        : '—';

    return (
        <div style={{ fontFamily: 'Arial, sans-serif', padding: '20px 30px', color: '#111', background: '#fff', minHeight: '297mm' }}>
            <Header subtitle="Overall Concession (Revised Fees) — Student Register" />

            {/* Student info grid */}
            <div style={{ border: '1.5px solid #ddd', borderRadius: '6px', padding: '12px 16px', marginBottom: '18px', background: '#fafafa' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', fontSize: '11px' }}>
                    {[
                        ['Student Name',   request.studentName,                                        true],
                        ['PIN Number',     request.pinNo || '—',                                      false],
                        ['Admission No.',  request.admissionNumber,                                   false],
                        ['College',        request.college,                                           false],
                        ['Course / Branch',`${request.course} — ${request.branch}`,                  false],
                        ['Batch',          request.batch,                                             false],
                        ['Student Quota',  (request.category || request.studentQuota || '—').toUpperCase(), false],
                        ['Approved By',    request.approvedByName || request.approvedBy || '—',       false],
                        ['Approved On',    approvedDate,                                              false],
                    ].map(([label, value, large]) => (
                        <div key={label}>
                            <div style={{ color: '#777', fontWeight: '700', textTransform: 'uppercase', fontSize: '9px', letterSpacing: '0.5px' }}>{label}</div>
                            <div style={{ fontWeight: large ? '900' : '700', fontSize: large ? '13px' : '11px', marginTop: '2px' }}>{value}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Years (rows) × Fee heads (columns) */}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', border: '2px solid #000', marginBottom: '18px' }}>
                <thead>
                    <tr style={{ backgroundColor: '#f0f0f0' }}>
                        <th style={th('left', { width: '90px' })}>Year</th>
                        {feeHeadEntries.map(([fhId, row]) => (
                            <th
                                key={fhId}
                                style={th('left', {
                                    fontSize: '9px',
                                    textTransform: 'none',
                                    wordBreak: 'break-word',
                                    whiteSpace: 'normal'
                                })}
                            >
                                {row.name}
                            </th>
                        ))}
                        <th style={th('left', { width: '140px' })}>Remarks</th>
                    </tr>
                </thead>
                <tbody>
                    {years.map((yr, rowIdx) => (
                        <tr key={yr} style={{ backgroundColor: rowIdx % 2 === 0 ? '#fff' : '#f9f9f9' }}>
                            <td style={{ ...td('left'), fontWeight: '900' }}>{yrSfx(yr)} Yr</td>
                            {feeHeadEntries.map(([fhId, row]) => {
                                const cell = row.years[yr];
                                if (!cell) {
                                    return <td key={`${yr}-${fhId}`} style={{ ...td('right'), color: '#888' }}>—</td>;
                                }
                                const amt = Number(cell.amount ?? 0);
                                const isConc = String(cell.type || '').toUpperCase() === 'CONCESSION';
                                const tagText = isConc ? 'Conc.' : 'Rev.';
                                const tagBg = isConc ? '#fffbe6' : '#e6f4ea';
                                const tagColor = isConc ? '#d97706' : '#166534';
                                const tagBorder = isConc ? '#fef3c7' : '#bbf7d0';

                                return (
                                    <td key={`${yr}-${fhId}`} style={{ ...td('right'), fontWeight: '700' }}>
                                        <span style={{ color: isConc ? '#b45309' : '#047857' }}>
                                            {isConc ? '-' : ''}₹{fmt(amt)}
                                        </span>
                                        <span style={{
                                            marginLeft: '4px',
                                            padding: '1px 3px',
                                            borderRadius: '3px',
                                            fontSize: '8px',
                                            fontWeight: '800',
                                            background: tagBg,
                                            color: tagColor,
                                            border: `1px solid ${tagBorder}`,
                                            display: 'inline-block',
                                            verticalAlign: 'middle'
                                        }}>
                                            {tagText}
                                        </span>
                                    </td>
                                );
                            })}
                            <td style={td('left')}>{remarksByYear[yr] || '—'}</td>
                        </tr>
                    ))}
                </tbody>
            </table>

            {/* Footer strip */}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#555', borderTop: '1px solid #ddd', paddingTop: '8px', marginBottom: '24px' }}>
                <span>Requested by: <strong>{request.requestedByName || request.requestedBy}</strong></span>
                <span>Status: <strong style={{ color: '#166534', textTransform: 'uppercase' }}>{request.status}</strong></span>
            </div>

            {/* Signatures */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '40px', fontSize: '10px' }}>
                {['Prepared By', 'Verified By', 'Principal / HOD'].map(label => (
                    <div key={label} style={{ textAlign: 'center', width: '160px', borderTop: '1.5px solid #000', paddingTop: '4px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#555' }}>
                        {label}
                    </div>
                ))}
            </div>

            <style dangerouslySetInnerHTML={{ __html: `@media print { @page { size: A4; margin: 10mm; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }` }} />
        </div>
    );
};

// ══════════════════════════════════════════════════════════════════════════
// ALL STUDENTS PRINT — Bulk Load style grid
// Columns: S.No | Student Name | Adm No | Year | FeeHead1 | FeeHead2 | ...
// Rows: one row per student × year (student cells use rowSpan)
// ══════════════════════════════════════════════════════════════════════════
const AllStudentsPrint = ({ requests, filters }) => {
    const sortedReqs = [...requests].sort((a, b) => {
        const nameCmp = String(a.studentName || '').localeCompare(String(b.studentName || ''));
        if (nameCmp !== 0) return nameCmp;
        return String(a.admissionNumber || '').localeCompare(String(b.admissionNumber || ''));
    });

    // Union of fee heads across all students (same columns for everyone)
    const feeHeadMap = new Map();
    const yearsSet = new Set();
    sortedReqs.forEach((req) => {
        (req.concessions || []).forEach((c) => {
            const yr = Number(c.studentYear);
            if (Number.isFinite(yr) && yr > 0) yearsSet.add(yr);

            const hid = String(c.feeHeadId);
            if (!feeHeadMap.has(hid)) {
                feeHeadMap.set(hid, {
                    name: c.feeHeadName || c.feeHeadCode || hid,
                    code: c.feeHeadCode || ''
                });
            }
        });
    });

    // Calculate global popularity of fee heads across printed students
    const feeHeadPopularity = {};
    sortedReqs.forEach((req) => {
        (req.concessions || []).forEach((c) => {
            const hid = String(c.feeHeadId);
            if (hid) {
                feeHeadPopularity[hid] = (feeHeadPopularity[hid] || 0) + 1;
            }
        });
    });

    const feeHeadEntries = [...feeHeadMap.entries()].sort((a, b) => {
        const countA = feeHeadPopularity[a[0]] || 0;
        const countB = feeHeadPopularity[b[0]] || 0;
        if (countA !== countB) {
            return countB - countA;
        }
        return String(a[1].name || '').localeCompare(String(b[1].name || ''));
    });

    // Prefer courseYears from filters if provided; otherwise use concession years
    const courseYearsHint = Number(filters?.courseYears);
    let years = [...yearsSet].sort((a, b) => a - b);
    if (Number.isFinite(courseYearsHint) && courseYearsHint > 0) {
        years = Array.from({ length: courseYearsHint }, (_, i) => i + 1);
    } else if (years.length === 0) {
        years = [1, 2, 3, 4];
    }

    // Per-student lookup: admissionNumber → feeHeadId → year → cell object, and student remarks
    const amountLookup = {};
    const remarksLookup = {};
    sortedReqs.forEach((req) => {
        const adm = String(req.admissionNumber || '');
        if (!amountLookup[adm]) amountLookup[adm] = {};
        if (!remarksLookup[adm]) remarksLookup[adm] = {};
        (req.concessions || []).forEach((c) => {
            const hid = String(c.feeHeadId);
            const yr = Number(c.studentYear);
            if (!amountLookup[adm][hid]) amountLookup[adm][hid] = {};
            amountLookup[adm][hid][yr] = {
                amount: Number(c.amount ?? 0),
                type: c.concessionType || 'REVISED'
            };
            if (c.remarks) {
                remarksLookup[adm][yr] = c.remarks;
            }
        });
    });

    const filterParts = [];
    if (filters.college) filterParts.push(filters.college);
    if (filters.course)  filterParts.push(filters.course);
    if (filters.branch)  filterParts.push(filters.branch);
    if (filters.batch)   filterParts.push(`Batch ${filters.batch}`);
    const filterLabel = filterParts.length ? filterParts.join(' · ') : 'All Colleges / Courses / Branches';

    const cellBorder = { border: '1.5px solid #000', padding: '4px 6px', textAlign: 'center', fontSize: '9px' };
    const headBorder = {
        border: '1.5px solid #000',
        padding: '5px 6px',
        textAlign: 'center',
        fontWeight: '700',
        fontSize: '9px',
        textTransform: 'uppercase',
        background: '#f0f0f0'
    };

    return (
        <div style={{ fontFamily: 'Arial, sans-serif', padding: '16px 20px', color: '#111', background: '#fff', minHeight: '297mm' }}>
            <Header subtitle="Overall Concession (Revised Fees) — Overview" />

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', fontWeight: '700', marginBottom: '12px', borderBottom: '1px solid #ccc', paddingBottom: '6px' }}>
                <span>Filter: <span style={{ fontWeight: '700' }}>{filterLabel}</span></span>
                <span>Total Students: <span style={{ fontWeight: '700' }}>{sortedReqs.length}</span></span>
            </div>

            {feeHeadEntries.length === 0 ? (
                <div style={{ fontSize: '11px', color: '#666', padding: '20px 0', textAlign: 'center' }}>
                    No revised fee entries to display for the selected students.
                </div>
            ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9px', border: '1.5px solid #000', tableLayout: 'fixed' }}>
                    <thead>
                        <tr>
                            <th style={{ ...headBorder, width: '36px' }}>S.No</th>
                            <th style={{ ...headBorder, width: '140px', textAlign: 'left' }}>Student Name</th>
                            <th style={{ ...headBorder, width: '80px' }}>Adm No</th>
                            <th style={{ ...headBorder, width: '56px' }}>Year</th>
                            {feeHeadEntries.map(([fhId, row]) => (
                                <th key={fhId} style={{ ...headBorder, textTransform: 'none', fontSize: '8px', wordBreak: 'break-word', whiteSpace: 'normal' }}>
                                    {row.name}
                                </th>
                            ))}
                            <th style={{ ...headBorder, width: '120px', textAlign: 'left' }}>Remarks</th>
                        </tr>
                    </thead>
                    <tbody>
                        {sortedReqs.map((req, sIdx) => {
                            const adm = String(req.admissionNumber || '');
                            const studentAmounts = amountLookup[adm] || {};
                            return years.map((yr, yrIdx) => (
                                <tr key={`${adm}_${yr}`} style={{ backgroundColor: sIdx % 2 === 0 ? '#fff' : '#f9f9f9' }}>
                                    {yrIdx === 0 && (
                                        <>
                                            <td style={{ ...cellBorder, fontWeight: '700' }} rowSpan={years.length}>{sIdx + 1}</td>
                                            <td style={{ ...cellBorder, textAlign: 'left', fontWeight: '700' }} rowSpan={years.length}>
                                                {req.studentName || '—'}
                                            </td>
                                            <td style={{ ...cellBorder, fontFamily: 'monospace', fontSize: '8px' }} rowSpan={years.length}>
                                                {req.admissionNumber || '—'}
                                            </td>
                                        </>
                                    )}
                                    <td style={{ ...cellBorder, fontWeight: '700' }}>{yrSfx(yr)} Yr</td>
                                    {feeHeadEntries.map(([fhId]) => {
                                        const cell = studentAmounts[fhId]?.[yr];
                                        if (!cell) {
                                            return (
                                                <td key={`${adm}_${yr}_${fhId}`} style={{ ...cellBorder, color: '#888', fontWeight: '400' }}>
                                                    —
                                                </td>
                                            );
                                        }
                                        const amt = Number(cell.amount ?? 0);
                                        const isConc = String(cell.type || '').toUpperCase() === 'CONCESSION';
                                        const tagText = isConc ? 'Conc.' : 'Rev.';
                                        const tagBg = isConc ? '#fffbe6' : '#e6f4ea';
                                        const tagColor = isConc ? '#d97706' : '#166534';
                                        const tagBorder = isConc ? '#fef3c7' : '#bbf7d0';

                                        return (
                                            <td key={`${adm}_${yr}_${fhId}`} style={{ ...cellBorder, fontWeight: '700' }}>
                                                <span style={{ color: isConc ? '#b45309' : '#047857' }}>
                                                    {isConc ? '-' : ''}₹{fmt(amt)}
                                                </span>
                                                <span style={{
                                                    marginLeft: '2px',
                                                    padding: '0px 2px',
                                                    borderRadius: '2px',
                                                    fontSize: '7px',
                                                    fontWeight: '800',
                                                    background: tagBg,
                                                    color: tagColor,
                                                    border: `1px solid ${tagBorder}`,
                                                    display: 'inline-block',
                                                    verticalAlign: 'middle'
                                                }}>
                                                    {tagText}
                                                </span>
                                            </td>
                                        );
                                    })}
                                    <td style={{ ...cellBorder, textAlign: 'left' }}>
                                        {remarksLookup[adm]?.[yr] || '—'}
                                    </td>
                                </tr>
                            ));
                        })}
                    </tbody>
                </table>
            )}

            <div style={{ marginTop: '14px', paddingTop: '8px', borderTop: '1px solid #ddd', fontSize: '9px', color: '#888', textAlign: 'center', fontStyle: 'italic' }}>
                This is a computer-generated Overall Concession Report for internal records only.
            </div>

            <style dangerouslySetInnerHTML={{ __html: `@media print { @page { size: A4 landscape; margin: 8mm; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }` }} />
        </div>
    );
};

// ─── Single export — handles both modes ───────────────────────────────────
// Props:
//   Single student:  { request, generatedOn }
//   All students:    { requests, filters, generatedOn }
const OverallConcessionRegisterPrint = (props) => {
    if (props.request) {
        return <SingleStudentPrint request={props.request} />;
    }
    return <AllStudentsPrint requests={props.requests || []} filters={props.filters || {}} />;
};

export default OverallConcessionRegisterPrint;
