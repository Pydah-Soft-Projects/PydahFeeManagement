import React, { forwardRef, Fragment } from 'react';
import { isRtfTransaction, isBankCollectionTx, isCashCollectionTx } from '../utils/reportTxHelpers';

const paymentVisibility = (options = {}) => {
    const { mode = 'all', includeCash, includeBank } = options;
    const showCash = includeCash !== undefined ? !!includeCash : (mode === 'all' || mode === 'Cash');
    const showBank = includeBank !== undefined ? !!includeBank : (mode === 'all' || mode === 'Online');
    return { showCash, showBank };
};

const SingleAccountReport = ({ data, dateRange, options = {}, hideGeneratedInfo = false }) => {
    if (!data) return null;
    const { mode = 'all', showSummary = true, showDetails = true, allowedFeeHeads } = options || {};
    const { showCash, showBank } = paymentVisibility(options);

    const rawTransactions = data.transactions || [];
    const filteredTransactions = rawTransactions.filter(tx => {
        // Payment Mode Filter
        if (mode === 'none') return false;
        if (mode === 'Cash' && tx.paymentMode !== 'Cash') return false;
        if (mode === 'Online' && tx.paymentMode === 'Cash') return false;

        // Fee Head Group Filter
        if (allowedFeeHeads && allowedFeeHeads.length > 0) {
            const fhName = (tx.feeHead || '').trim().toLowerCase();
            if (!allowedFeeHeads.includes(fhName)) return false;
        }

        return true;
    });

    const activeTransactions = filteredTransactions.filter(tx => tx.status !== 'cancelled');
    const cancelledTransactions = filteredTransactions.filter(tx => tx.status === 'cancelled');
    const collectionDebits = activeTransactions.filter(tx => tx.transactionType === 'DEBIT' && !isRtfTransaction(tx));

    // Recompute fee head summary based on active transactions for this account
    const feeHeadData = {};
    collectionDebits.forEach(tx => {
            const fhName = tx.feeHead || 'Unknown';
            const amount = tx.amount || 0;
            const isCash = isCashCollectionTx(tx);

            if (!feeHeadData[fhName]) {
                feeHeadData[fhName] = {
                    name: fhName,
                    cashAmt: 0,
                    bankAmt: 0,
                    netTotal: 0
                };
            }
            const entry = feeHeadData[fhName];
            entry.netTotal += amount;
            if (isCash) entry.cashAmt += amount;
            else if (isBankCollectionTx(tx)) entry.bankAmt += amount;
    });
    const sortedFeeHeads = Object.values(feeHeadData).sort((a, b) => b.netTotal - a.netTotal);

    // Treat as global when flagged OR when no specific college is bound (e.g. "All Courses")
    const isGlobalAccount = Boolean(
        data.is_global ||
        !data.college ||
        ['n/a', 'na', 'all', 'all colleges', 'any', 'general', 'general / direct', 'unassigned/direct cash', 'null', 'undefined', ''].includes(String(data.college).trim().toLowerCase())
    );
    const effectiveShowCash = isGlobalAccount ? false : showCash;
    const effectiveShowBank = isGlobalAccount ? false : showBank;

    // College → Course → Fee Head hierarchy for global accounts
    const collegeHierarchy = {};
    if (isGlobalAccount) {
        collectionDebits.forEach(tx => {
            const collegeName = tx.college || 'Unknown College';
            const courseName = tx.course || 'Unknown Course';
            const fhName = tx.feeHead || 'Unknown';
            const amount = tx.amount || 0;
            const isCash = isCashCollectionTx(tx);
            const isBank = isBankCollectionTx(tx);

            if (!collegeHierarchy[collegeName]) {
                collegeHierarchy[collegeName] = {
                    collegeName,
                    receiptsCount: 0,
                    cashAmt: 0,
                    bankAmt: 0,
                    netTotal: 0,
                    courses: {}
                };
            }
            const collegeEntry = collegeHierarchy[collegeName];
            collegeEntry.receiptsCount += 1;
            collegeEntry.netTotal += amount;
            if (isCash) collegeEntry.cashAmt += amount;
            else if (isBank) collegeEntry.bankAmt += amount;

            if (!collegeEntry.courses[courseName]) {
                collegeEntry.courses[courseName] = {
                    courseName,
                    receiptsCount: 0,
                    cashAmt: 0,
                    bankAmt: 0,
                    netTotal: 0,
                    feeHeads: {}
                };
            }
            const courseEntry = collegeEntry.courses[courseName];
            courseEntry.receiptsCount += 1;
            courseEntry.netTotal += amount;
            if (isCash) courseEntry.cashAmt += amount;
            else if (isBank) courseEntry.bankAmt += amount;

            if (!courseEntry.feeHeads[fhName]) {
                courseEntry.feeHeads[fhName] = {
                    name: fhName,
                    cashAmt: 0,
                    bankAmt: 0,
                    netTotal: 0
                };
            }
            const fhEntry = courseEntry.feeHeads[fhName];
            fhEntry.netTotal += amount;
            if (isCash) fhEntry.cashAmt += amount;
            else if (isBank) fhEntry.bankAmt += amount;
        });
    }

    const sortedColleges = Object.values(collegeHierarchy)
        .map(college => ({
            ...college,
            courses: Object.values(college.courses)
                .map(course => ({
                    ...course,
                    feeHeads: Object.values(course.feeHeads).sort((a, b) => b.netTotal - a.netTotal)
                }))
                .sort((a, b) => b.netTotal - a.netTotal)
        }))
        .sort((a, b) => b.netTotal - a.netTotal);

    // Course-wise hierarchy for global accounts
    const courseHierarchy = {};
    if (isGlobalAccount) {
        collectionDebits.forEach(tx => {
            const collegeName = tx.college || 'Unknown College';
            const courseName = tx.course || 'Unknown Course';
            const amount = tx.amount || 0;
            const isCash = isCashCollectionTx(tx);
            const isBank = isBankCollectionTx(tx);
            const key = `${collegeName}||${courseName}`;

            if (!courseHierarchy[key]) {
                courseHierarchy[key] = {
                    collegeName,
                    courseName,
                    receiptsCount: 0,
                    cashAmt: 0,
                    bankAmt: 0,
                    netTotal: 0
                };
            }
            const courseEntry = courseHierarchy[key];
            courseEntry.receiptsCount += 1;
            courseEntry.netTotal += amount;
            if (isCash) courseEntry.cashAmt += amount;
            else if (isBank) courseEntry.bankAmt += amount;
        });
    }
    const sortedCourses = [];
    sortedColleges.forEach(college => {
        college.courses.forEach(course => {
            sortedCourses.push({
                collegeName: college.collegeName,
                courseName: course.courseName,
                receiptsCount: course.receiptsCount,
                cashAmt: course.cashAmt,
                bankAmt: course.bankAmt,
                netTotal: course.netTotal
            });
        });
    });

    // User-wise / Cashier-wise hierarchy for global accounts
    const userHierarchy = {};
    if (isGlobalAccount) {
        collectionDebits.forEach(tx => {
            const cashierUsername = tx.collectedBy || 'Unknown';
            const cashierName = tx.collectedByName || tx.collectedBy || 'Unknown';
            const empNo = tx.empNo || '';
            const key = cashierUsername || cashierName;
            const amount = tx.amount || 0;
            const isCash = isCashCollectionTx(tx);
            const isBank = isBankCollectionTx(tx);

            if (!userHierarchy[key]) {
                userHierarchy[key] = {
                    username: cashierUsername,
                    cashierName: cashierName,
                    empNo: empNo,
                    receiptsCount: 0,
                    cashAmt: 0,
                    bankAmt: 0,
                    netTotal: 0
                };
            }
            const uEntry = userHierarchy[key];
            uEntry.receiptsCount += 1;
            uEntry.netTotal += amount;
            if (isCash) uEntry.cashAmt += amount;
            else if (isBank) uEntry.bankAmt += amount;
        });
    }
    const sortedUsers = Object.values(userHierarchy).sort((a, b) => b.netTotal - a.netTotal);

    // Totals for this account (RTF excluded from collection)
    const displayData = {
        totalCount: activeTransactions.length,
        debitAmount: collectionDebits.reduce((acc, tx) => acc + (tx.amount || 0), 0),
        creditAmount: activeTransactions.filter(tx => tx.transactionType === 'CREDIT').reduce((acc, tx) => acc + (tx.amount || 0), 0),
        cashAmount: collectionDebits.filter(tx => isCashCollectionTx(tx)).reduce((acc, tx) => acc + (tx.amount || 0), 0),
        bankAmount: collectionDebits.filter(tx => isBankCollectionTx(tx)).reduce((acc, tx) => acc + (tx.amount || 0), 0),
    };

    return (
        <div className="p-8 font-sans text-black bg-white" style={{ fontFamily: 'Arial, sans-serif' }}>
            <style type="text/css" media="print">
                {`
                    @page { size: A4; margin: 10mm; }
                    body { -webkit-print-color-adjust: exact; }
                    .print-table { width: 100%; border-collapse: collapse; font-size: 11px; border: 2px solid #000; }
                    .print-table th, .print-table td { border: 1.5px solid #000; padding: 4px 8px; }
                    .print-table th { background-color: #f0f0f0; font-weight: bold; text-align: left; }
                    .print-header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 15px; }
                    .compact-row { line-height: 1.2; }
                `}
            </style>

            {/* Header */}
            <div className="print-header">
                <h1 style={{ fontSize: '20px', fontWeight: 'bold', margin: 0, textTransform: 'uppercase' }}>Pydah Group of Colleges</h1>
                <p style={{ margin: '4px 0', fontSize: '12px', fontWeight: 'bold' }}>ACCOUNT COLLECTION SUMMARY REPORT {options.selectedGroupName ? `[${options.selectedGroupName.toUpperCase()}]` : ''} {!isGlobalAccount && mode !== 'all' && mode !== 'none' && `(${mode === 'Online' ? 'BANK / ONLINE' : mode.toUpperCase()})`}</p>
            </div>

            {/* Info Row */}
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: '15px', fontSize: '11px', borderBottom: '1px solid #ccc', paddingBottom: '8px', gap: '10px' }}>
                <div>
                    <strong>Account Name:</strong> <span style={{ textTransform: 'uppercase' }}>{data.account_name}</span>
                </div>
                <div>
                    <strong>Bank/Branch:</strong> {data.bank_name} {data.account_number !== 'N/A' && `(${data.account_number})`}
                </div>
                <div>
                    <strong>Scope:</strong>{' '}
                    {isGlobalAccount
                        ? 'Global / All Courses'
                        : `${data.college} (${data.course || 'All Courses'})`}
                </div>
                <div>
                    <strong>Date Range:</strong> {dateRange.start.split('-').reverse().join('/')} - {dateRange.end.split('-').reverse().join('/')}
                </div>
                {!hideGeneratedInfo && (
                    <div style={{ color: '#4b5563' }}>
                        <strong>Generated On:</strong> {new Date().toLocaleString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })}
                    </div>
                )}
            </div>

            {/* Account Collection Summary Card (Non-Global accounts only) */}
            {showSummary && !isGlobalAccount && (
                <div style={{ marginBottom: '20px' }}>
                    <h3 style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: '8px', textTransform: 'uppercase', borderLeft: '4px solid #000', paddingLeft: '8px' }}>
                        Account Collection Abstract {mode !== 'all' && `[${mode}]`}
                    </h3>
                    <table className="print-table">
                        <thead>
                            <tr>
                                <th style={{ textAlign: 'center', width: '20%' }}>Total Receipts</th>
                                {effectiveShowCash && <th style={{ textAlign: 'right', width: '20%' }}>Cash</th>}
                                {effectiveShowBank && <th style={{ textAlign: 'right', width: '20%' }}>Bank (Online)</th>}
                                <th style={{ textAlign: 'right', width: '20%' }}>Concessions</th>
                                <th style={{ textAlign: 'right', width: '20%', fontWeight: 'bold' }}>Net Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td style={{ textAlign: 'center' }}>{displayData.totalCount}</td>
                                {effectiveShowCash && <td style={{ textAlign: 'right' }}>₹{Number(displayData.cashAmount || 0).toLocaleString('en-IN')}</td>}
                                {effectiveShowBank && <td style={{ textAlign: 'right' }}>₹{Number(displayData.bankAmount || 0).toLocaleString('en-IN')}</td>}
                                <td style={{ textAlign: 'right' }}>₹{Number(displayData.creditAmount || 0).toLocaleString('en-IN')}</td>
                                <td style={{ textAlign: 'right', fontWeight: 'bold', backgroundColor: '#e0e0e0' }}>₹{Number(displayData.debitAmount || 0).toLocaleString('en-IN')}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            )}

            {/* College → Course → Fee Head (Global accounts only) */}
            {showSummary && isGlobalAccount && sortedColleges.length > 0 && (
                <div style={{ marginBottom: '20px' }}>
                    <h3 style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: '8px', textTransform: 'uppercase', borderLeft: '4px solid #000', paddingLeft: '8px' }}>
                        College-wise Consolidated Collections
                    </h3>
                    <table className="print-table">
                        <thead>
                            <tr>
                                <th style={{ width: '5%' }}>S.No</th>
                                <th style={{ width: '60%' }}>College / Course / Fee Head</th>
                                <th style={{ textAlign: 'center', width: '15%' }}>Receipts</th>
                                <th style={{ textAlign: 'right', width: '20%', fontWeight: 'bold' }}>Collection</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sortedColleges.map((college, cIdx) => (
                                <Fragment key={`college-${cIdx}`}>
                                    <tr className="compact-row" style={{ backgroundColor: '#e8e8e8', fontWeight: 'bold' }}>
                                        <td style={{ textAlign: 'center' }}>{cIdx + 1}</td>
                                        <td style={{ textTransform: 'uppercase' }}>{college.collegeName}</td>
                                        <td style={{ textAlign: 'center' }}>{college.receiptsCount}</td>
                                        <td style={{ textAlign: 'right', fontWeight: 'bold' }}>₹{Number(college.netTotal).toLocaleString('en-IN')}</td>
                                    </tr>
                                    {college.courses.map((course, courseIdx) => (
                                        <Fragment key={`course-${cIdx}-${courseIdx}`}>
                                            <tr className="compact-row" style={{ backgroundColor: '#f5f5f5', fontWeight: 'bold' }}>
                                                <td></td>
                                                <td style={{ paddingLeft: '14px', textTransform: 'uppercase', fontSize: '10px' }}>
                                                    - {course.courseName}
                                                </td>
                                                <td style={{ textAlign: 'center', fontSize: '10px' }}>{course.receiptsCount}</td>
                                                <td style={{ textAlign: 'right', fontWeight: 'bold', fontSize: '10px' }}>₹{Number(course.netTotal).toLocaleString('en-IN')}</td>
                                            </tr>
                                            {course.feeHeads.map((fh, fhIdx) => (
                                                <tr key={`fh-${cIdx}-${courseIdx}-${fhIdx}`} className="compact-row">
                                                    <td></td>
                                                    <td style={{ paddingLeft: '28px', fontSize: '9px', color: '#333' }}>
                                                        - {fh.name}
                                                    </td>
                                                    <td></td>
                                                    <td style={{ textAlign: 'right', fontWeight: 'bold', fontSize: '9px' }}>₹{Number(fh.netTotal).toLocaleString('en-IN')}</td>
                                                </tr>
                                            ))}
                                        </Fragment>
                                    ))}
                                </Fragment>
                            ))}
                            <tr style={{ backgroundColor: '#d0d0d0', fontWeight: 'bold' }}>
                                <td colSpan={2}>TOTAL</td>
                                <td style={{ textAlign: 'center' }}>{sortedColleges.reduce((s, c) => s + c.receiptsCount, 0)}</td>
                                <td style={{ textAlign: 'right' }}>₹{Number(displayData.debitAmount || 0).toLocaleString('en-IN')}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            )}

            {/* Course-wise Consolidated Collections (Global accounts only) */}
            {showSummary && isGlobalAccount && sortedCourses.length > 0 && (
                <div style={{ marginBottom: '20px' }}>
                    <h3 style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: '8px', textTransform: 'uppercase', borderLeft: '4px solid #000', paddingLeft: '8px' }}>
                        Course-wise Consolidated Collections
                    </h3>
                    <table className="print-table">
                        <thead>
                            <tr>
                                <th style={{ width: '5%' }}>S.No</th>
                                <th style={{ width: '55%' }}>Course</th>
                                <th style={{ textAlign: 'center', width: '10%' }}>Receipts</th>
                                <th style={{ textAlign: 'right', width: '30%', fontWeight: 'bold' }}>Collection</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sortedCourses.map((course, idx) => (
                                <tr key={idx} className="compact-row">
                                    <td style={{ textAlign: 'center' }}>{idx + 1}</td>
                                    <td style={{ textTransform: 'uppercase' }}>{course.courseName}</td>
                                    <td style={{ textAlign: 'center' }}>{course.receiptsCount}</td>
                                    <td style={{ textAlign: 'right', fontWeight: 'bold' }}>₹{Number(course.netTotal).toLocaleString('en-IN')}</td>
                                </tr>
                            ))}
                            <tr style={{ backgroundColor: '#e0e0e0', fontWeight: 'bold' }}>
                                <td colSpan={2}>TOTAL</td>
                                <td style={{ textAlign: 'center' }}>{sortedCourses.reduce((s, course) => s + course.receiptsCount, 0)}</td>
                                <td style={{ textAlign: 'right' }}>₹{Number(displayData.debitAmount || 0).toLocaleString('en-IN')}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            )}

            {/* User-wise Consolidated Collections (Global accounts only) */}
            {showSummary && isGlobalAccount && sortedUsers.length > 0 && (
                <div style={{ marginBottom: '20px' }}>
                    <h3 style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: '8px', textTransform: 'uppercase', borderLeft: '4px solid #000', paddingLeft: '8px' }}>
                        User-wise Consolidated Collections
                    </h3>
                    <table className="print-table">
                        <thead>
                            <tr>
                                <th style={{ width: '5%' }}>S.No</th>
                                <th style={{ width: '25%' }}>User ID</th>
                                <th style={{ width: '35%' }}>Cashier Name</th>
                                <th style={{ textAlign: 'center', width: '15%' }}>Receipts</th>
                                <th style={{ textAlign: 'right', width: '20%', fontWeight: 'bold' }}>Collection</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sortedUsers.map((u, idx) => (
                                <tr key={idx} className="compact-row">
                                    <td style={{ textAlign: 'center' }}>{idx + 1}</td>
                                    <td>{u.empNo || u.username || 'N/A'}</td>
                                    <td style={{ textTransform: 'uppercase' }}>{u.cashierName}</td>
                                    <td style={{ textAlign: 'center' }}>{u.receiptsCount}</td>
                                    <td style={{ textAlign: 'right', fontWeight: 'bold' }}>₹{Number(u.netTotal).toLocaleString('en-IN')}</td>
                                </tr>
                            ))}
                            <tr style={{ backgroundColor: '#e0e0e0', fontWeight: 'bold' }}>
                                <td colSpan={3}>TOTAL</td>
                                <td style={{ textAlign: 'center' }}>{sortedUsers.reduce((s, u) => s + u.receiptsCount, 0)}</td>
                                <td style={{ textAlign: 'right' }}>₹{Number(displayData.debitAmount || 0).toLocaleString('en-IN')}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            )}

            {/* Fee Head-wise Breakdown (Non-Global accounts only) */}
            {showSummary && !isGlobalAccount && sortedFeeHeads.length > 0 && (
                <div style={{ marginBottom: '20px' }}>
                    <h3 style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: '8px', textTransform: 'uppercase', borderLeft: '4px solid #000', paddingLeft: '8px' }}>
                        Fee Head-wise Collections
                    </h3>
                    <table className="print-table">
                        <thead>
                            <tr>
                                <th style={{ width: '5%' }}>S.No</th>
                                <th style={{ width: '50%' }}>Fee Head Name</th>
                                {effectiveShowCash && <th style={{ textAlign: 'right', width: '15%' }}>Cash</th>}
                                {effectiveShowBank && <th style={{ textAlign: 'right', width: '15%' }}>Bank</th>}
                                <th style={{ textAlign: 'right', width: '15%', fontWeight: 'bold' }}>Collection</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sortedFeeHeads.map((fh, idx) => (
                                <tr key={idx} className="compact-row">
                                    <td style={{ textAlign: 'center' }}>{idx + 1}</td>
                                    <td>{fh.name}</td>
                                    {effectiveShowCash && <td style={{ textAlign: 'right' }}>₹{Number(fh.cashAmt).toLocaleString('en-IN')}</td>}
                                    {effectiveShowBank && <td style={{ textAlign: 'right' }}>₹{Number(fh.bankAmt).toLocaleString('en-IN')}</td>}
                                    <td style={{ textAlign: 'right', fontWeight: 'bold' }}>₹{Number(fh.netTotal).toLocaleString('en-IN')}</td>
                                </tr>
                            ))}
                            <tr style={{ backgroundColor: '#e0e0e0', fontWeight: 'bold' }}>
                                <td colSpan={2}>TOTAL</td>
                                {effectiveShowCash && <td style={{ textAlign: 'right' }}>₹{Number(displayData.cashAmount || 0).toLocaleString('en-IN')}</td>}
                                {effectiveShowBank && <td style={{ textAlign: 'right' }}>₹{Number(displayData.bankAmount || 0).toLocaleString('en-IN')}</td>}
                                <td style={{ textAlign: 'right' }}>₹{Number(displayData.debitAmount || 0).toLocaleString('en-IN')}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            )}

            {/* Detailed Transaction Listing */}
            {showDetails && activeTransactions.length > 0 && (() => {
                const cashTxs = activeTransactions.filter(tx => tx.paymentMode === 'Cash');
                const rtfTxs = activeTransactions.filter(tx => isRtfTransaction(tx));
                const bankTxs = activeTransactions.filter(tx => isBankCollectionTx(tx));
                const txTableHead = (
                    <thead>
                        <tr>
                            <th>S.No</th>
                            <th>Receipt #</th>
                            <th>Student Name</th>
                            <th>Pin No</th>
                            <th>Admission No</th>
                            <th>Course/Branch</th>
                            <th>Year</th>
                            <th>Fee Head</th>
                            <th>Cashier</th>
                            <th>Remarks</th>
                            <th style={{ textAlign: 'right' }}>Amount</th>
                        </tr>
                    </thead>
                );
                const txRow = (tx, idx) => (
                    <tr key={idx} className="compact-row">
                        <td style={{ textAlign: 'center' }}>{idx + 1}</td>
                        <td>{tx.receiptNo}</td>
                        <td>{tx.studentName}</td>
                        <td>{(!tx.pinNo || tx.pinNo === '-' || tx.pinNo === 'null') ? '-' : tx.pinNo}</td>
                        <td>{tx.admissionNumber || tx.studentId || '-'}</td>
                        <td>{tx.course} - {tx.branch}</td>
                        <td>{tx.studentYear}</td>
                        <td>{tx.feeHead}</td>
                        <td style={{ textTransform: 'uppercase' }}>{tx.collectedByName || tx.collectedBy} {tx.empNo && `(${tx.empNo})`}</td>
                        <td>{tx.remarks || tx.transferRemarks || '-'}</td>
                        <td style={{ textAlign: 'right', fontWeight: 'bold' }}>
                            {tx.transactionType === 'CREDIT' ? '-' : ''}₹{Number(tx.amount).toLocaleString('en-IN')}
                        </td>
                    </tr>
                );
                const rtfTableHead = (
                    <thead>
                        <tr>
                            <th>S.No</th>
                            <th>Proceeding #</th>
                            <th>Receipt #</th>
                            <th>Student Name</th>
                            <th>Pin No</th>
                            <th>Admission No</th>
                            <th>Course/Branch</th>
                            <th>Year</th>
                            <th>Fee Head</th>
                            <th>Approved By</th>
                            <th>Remarks</th>
                            <th style={{ textAlign: 'right' }}>Amount</th>
                        </tr>
                    </thead>
                );
                const rtfRow = (tx, idx) => (
                    <tr key={idx} className="compact-row">
                        <td style={{ textAlign: 'center' }}>{idx + 1}</td>
                        <td style={{ fontWeight: 'bold' }}>{tx.proceedingNumber || tx.referenceNo || '-'}</td>
                        <td>{tx.receiptNo}</td>
                        <td>{tx.studentName}</td>
                        <td>{(!tx.pinNo || tx.pinNo === '-' || tx.pinNo === 'null') ? '-' : tx.pinNo}</td>
                        <td>{tx.admissionNumber || tx.studentId || '-'}</td>
                        <td>{tx.course} - {tx.branch}</td>
                        <td>{tx.studentYear}</td>
                        <td>{tx.feeHead}</td>
                        <td style={{ textTransform: 'uppercase' }}>{tx.collectedByName || tx.collectedBy} {tx.empNo && `(${tx.empNo})`}</td>
                        <td>{tx.remarks || tx.transferRemarks || '-'}</td>
                        <td style={{ textAlign: 'right', fontWeight: 'bold' }}>₹{Number(tx.amount).toLocaleString('en-IN')}</td>
                    </tr>
                );
                return (
                    <div style={{ marginTop: '20px' }}>
                        {isGlobalAccount ? (
                            <div style={{ marginBottom: '16px' }}>
                                <h3 style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: '6px', textTransform: 'uppercase', borderLeft: '4px solid #000', paddingLeft: '8px' }}>
                                    Transactions ({activeTransactions.length}) — ₹{activeTransactions.reduce((s, t) => s + (t.amount || 0), 0).toLocaleString('en-IN')}
                                </h3>
                                <table className="print-table" style={{ fontSize: '8px' }}>
                                    {txTableHead}
                                    <tbody>{activeTransactions.map(txRow)}</tbody>
                                </table>
                            </div>
                        ) : (
                            <>
                                {effectiveShowCash && cashTxs.length > 0 && (
                                    <div style={{ marginBottom: '16px' }}>
                                        <h3 style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: '6px', textTransform: 'uppercase', borderLeft: '4px solid #000', paddingLeft: '8px' }}>
                                            Cash Transactions ({cashTxs.length}) — ₹{cashTxs.reduce((s, t) => s + (t.amount || 0), 0).toLocaleString('en-IN')}
                                        </h3>
                                        <table className="print-table" style={{ fontSize: '8px' }}>
                                            {txTableHead}
                                            <tbody>{cashTxs.map(txRow)}</tbody>
                                        </table>
                                    </div>
                                )}
                                {effectiveShowBank && bankTxs.length > 0 && (
                                    <div style={{ marginBottom: '16px' }}>
                                        <h3 style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: '6px', textTransform: 'uppercase', borderLeft: '4px solid #000', paddingLeft: '8px' }}>
                                            Bank / Online Transactions ({bankTxs.length}) — ₹{bankTxs.reduce((s, t) => s + (t.amount || 0), 0).toLocaleString('en-IN')}
                                        </h3>
                                        <table className="print-table" style={{ fontSize: '8px' }}>
                                            {txTableHead}
                                            <tbody>{bankTxs.map(txRow)}</tbody>
                                        </table>
                                    </div>
                                )}
                                {effectiveShowBank && rtfTxs.length > 0 && (
                                    <div style={{ marginBottom: '16px' }}>
                                        <h3 style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: '6px', textTransform: 'uppercase', borderLeft: '4px solid #000', paddingLeft: '8px' }}>
                                            RTF / Proceeding Transactions ({rtfTxs.length}) — ₹{rtfTxs.reduce((s, t) => s + (t.amount || 0), 0).toLocaleString('en-IN')}
                                        </h3>
                                        <table className="print-table" style={{ fontSize: '8px' }}>
                                            {rtfTableHead}
                                            <tbody>{rtfTxs.map(rtfRow)}</tbody>
                                        </table>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                );
            })()}

            {/* Cancelled Transactions */}
            {showDetails && cancelledTransactions.length > 0 && (
                <div style={{ marginTop: '20px', pageBreakInside: 'avoid' }}>
                    <h3 style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: '8px', textTransform: 'uppercase', borderLeft: '4px solid #000', paddingLeft: '8px' }}>
                        Cancelled Transactions
                    </h3>
                    <table className="print-table" style={{ fontSize: '8px' }}>
                        <thead>
                            <tr>
                                <th>S.No</th>
                                <th>Receipt #</th>
                                <th>Student Name</th>
                                <th>Pin No</th>
                                <th>Admission No</th>
                                <th>Course/Branch</th>
                                <th>Fee Head</th>
                                <th>Cancelled By</th>
                                <th>Cancellation Reason</th>
                                <th>Remarks</th>
                                <th style={{ textAlign: 'right' }}>Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            {cancelledTransactions.map((tx, idx) => (
                                <tr key={idx} className="compact-row" style={{ color: 'red', textDecoration: 'line-through' }}>
                                    <td style={{ textAlign: 'center' }}>{idx + 1}</td>
                                    <td>{tx.receiptNo}</td>
                                    <td>{tx.studentName}</td>
                                    <td>{(!tx.pinNo || tx.pinNo === '-' || tx.pinNo === 'null') ? '-' : tx.pinNo}</td>
                                    <td>{tx.admissionNumber || tx.studentId || '-'}</td>
                                    <td>{tx.course} - {tx.branch}</td>
                                    <td>{tx.feeHead}</td>
                                    <td style={{ textTransform: 'uppercase' }}>{tx.cancelledByName || tx.cancelledBy}</td>
                                    <td>{tx.cancellationReason || '-'}</td>
                                    <td>{tx.remarks || '-'}</td>
                                    <td style={{ textAlign: 'right', fontWeight: 'bold' }}>
                                        ₹{Number(tx.amount).toLocaleString('en-IN')}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Signatures */}
            {!hideGeneratedInfo && (
                <div style={{ marginTop: '50px', display: 'flex', justifyContent: 'space-around', fontSize: '12px', pageBreakInside: 'avoid' }}>
                    <div style={{ textAlign: 'center' }}>
                        <p style={{ borderTop: '1px solid #000', width: '150px', paddingTop: '5px' }}>AO / Manager Signature</p>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                        <p style={{ borderTop: '1px solid #000', width: '150px', paddingTop: '5px' }}>Authorized Signature</p>
                    </div>
                </div>
            )}
        </div>
    );
};

const AccountGlobalSummaryPage = ({ data, dateRange, options = {} }) => {
    const { mode = 'all' } = options || {};
    const activeRows = data.filter(Boolean);

    const isAllGlobal = activeRows.length > 0 && activeRows.every(r => 
        r.is_global || !r.college || ['n/a', 'na', 'all', 'all colleges', 'any', 'general', 'general / direct', 'unassigned/direct cash', 'null', 'undefined', ''].includes(String(r.college).trim().toLowerCase())
    );

    const { showCash, showBank } = paymentVisibility(options);
    const effectiveShowCash = isAllGlobal ? false : showCash;
    const effectiveShowBank = isAllGlobal ? false : showBank;

    // Calculate totals across all active rows
    const globalTotals = activeRows.reduce((acc, curr) => {
        acc.receiptsCount += curr.count || 0;
        acc.cashAmt += curr.cashAmount || 0;
        acc.bankAmt += curr.bankAmount || 0;
        acc.netTotal += curr.debitAmount || 0;
        return acc;
    }, { receiptsCount: 0, cashAmt: 0, bankAmt: 0, netTotal: 0 });

    return (
        <div className="p-8 font-sans text-black bg-white" style={{ fontFamily: 'Arial, sans-serif' }}>
            <style type="text/css" media="print">
                {`
                    @page { size: A4; margin: 10mm; }
                    body { -webkit-print-color-adjust: exact; }
                    .print-table { width: 100%; border-collapse: collapse; font-size: 11px; border: 2px solid #000; }
                    .print-table th, .print-table td { border: 1.5px solid #000; padding: 6px 8px; }
                    .print-table th { background-color: #f0f0f0; font-weight: bold; text-align: left; }
                    .print-header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 15px; }
                    .compact-row { line-height: 1.2; }
                `}
            </style>

            <div className="print-header">
                <h1 style={{ fontSize: '20px', fontWeight: 'bold', margin: 0, textTransform: 'uppercase' }}>Pydah Group of Colleges</h1>
                <p style={{ margin: '4px 0', fontSize: '12px', fontWeight: 'bold' }}>CONSOLIDATED ACCOUNT COLLECTION REPORT {!isAllGlobal && mode !== 'all' && `(${mode === 'Online' ? 'BANK / ONLINE' : mode.toUpperCase()})`}</p>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px', fontSize: '12px' }}>
                <div>
                    <strong>Report Type:</strong> Account-wise Collection Summary
                </div>
                <div>
                    <strong>Date Range:</strong> {dateRange.start.split('-').reverse().join('/')} - {dateRange.end.split('-').reverse().join('/')}
                </div>
                <div style={{ color: '#4b5563' }}>
                    <strong>Generated On:</strong> {new Date().toLocaleString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })}
                </div>
            </div>

            <div style={{ marginBottom: '25px' }}>
                <h3 style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: '10px', textTransform: 'uppercase', borderLeft: '4px solid #000', paddingLeft: '8px' }}>
                    Account Summary Listing
                </h3>
                <table className="print-table">
                    <thead>
                        <tr>
                            <th style={{ width: '5%' }}>S.No</th>
                            <th style={{ width: '25%' }}>Account Name</th>
                            <th style={{ width: '25%' }}>Bank & Number</th>
                            <th style={{ width: '15%' }}>College / Course</th>
                            <th style={{ textAlign: 'center', width: '10%' }}>Receipts</th>
                            {effectiveShowCash && <th style={{ textAlign: 'right', width: '10%' }}>Cash</th>}
                            {effectiveShowBank && <th style={{ textAlign: 'right', width: '10%' }}>Bank (Online)</th>}
                            <th style={{ textAlign: 'right', width: '10%', fontWeight: 'bold' }}>Collection</th>
                        </tr>
                    </thead>
                    <tbody>
                        {activeRows.map((row, idx) => (
                            <tr key={idx} className="compact-row">
                                <td style={{ textAlign: 'center' }}>{idx + 1}</td>
                                <td style={{ fontWeight: 'bold' }}>{row.account_name}</td>
                                <td>{row.bank_name} {row.account_number !== 'N/A' && `(${row.account_number})`}</td>
                                <td style={{ fontSize: '10px' }}>{row.is_global ? 'Global' : (row.college && row.college !== 'N/A' ? `${row.college} - ${row.course}` : 'General / Direct')}</td>
                                <td style={{ textAlign: 'center' }}>{row.count}</td>
                                {effectiveShowCash && <td style={{ textAlign: 'right' }}>₹{Number(row.cashAmount || 0).toLocaleString('en-IN')}</td>}
                                {effectiveShowBank && <td style={{ textAlign: 'right' }}>₹{Number(row.bankAmount || 0).toLocaleString('en-IN')}</td>}
                                <td style={{ textAlign: 'right', fontWeight: 'bold' }}>₹{Number(row.debitAmount || 0).toLocaleString('en-IN')}</td>
                            </tr>
                        ))}
                        <tr style={{ backgroundColor: '#e0e0e0', fontWeight: 'bold' }}>
                            <td colSpan={4}>TOTAL</td>
                            <td style={{ textAlign: 'center' }}>{globalTotals.receiptsCount}</td>
                            {effectiveShowCash && <td style={{ textAlign: 'right' }}>₹{Number(globalTotals.cashAmt).toLocaleString('en-IN')}</td>}
                            {effectiveShowBank && <td style={{ textAlign: 'right' }}>₹{Number(globalTotals.bankAmt).toLocaleString('en-IN')}</td>}
                            <td style={{ textAlign: 'right' }}>₹{Number(globalTotals.netTotal).toLocaleString('en-IN')}</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div style={{ marginTop: '50px', display: 'flex', justifyContent: 'space-around', fontSize: '12px' }}>
                <div style={{ textAlign: 'center' }}>
                    <p style={{ borderTop: '1px solid #000', width: '150px', paddingTop: '5px' }}>Administrative Officer (AO)</p>
                </div>
                <div style={{ textAlign: 'center' }}>
                    <p style={{ borderTop: '1px solid #000', width: '150px', paddingTop: '5px' }}>Principal/Vice Principal</p>
                </div>
            </div>
        </div>
    );
};

const AccountReportTemplate = forwardRef(({ data, dateRange, options = {} }, ref) => {
    if (!data) return null;
    const isArray = Array.isArray(data) && data.length > 0;

    return (
        <div ref={ref}>
            {isArray ? (
                <>
                    {/* Consolidated summary page */}
                    <div style={{ pageBreakAfter: 'always' }}>
                        <AccountGlobalSummaryPage data={data} dateRange={dateRange} options={options} />
                    </div>
                    {/* Individual account reports */}
                    {data.filter(Boolean).map((accountRow, index) => (
                        <div key={index} style={{ pageBreakAfter: index === data.length - 1 ? 'auto' : 'always' }}>
                            <SingleAccountReport data={accountRow} dateRange={dateRange} options={options} hideGeneratedInfo={true} />
                        </div>
                    ))}
                </>
            ) : (
                <SingleAccountReport data={data} dateRange={dateRange} options={options} />
            )}
        </div>
    );
});

export default AccountReportTemplate;
