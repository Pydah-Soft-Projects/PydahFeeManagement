import React, { forwardRef } from 'react';

const PRINT_STYLES = `
    @page { size: A4 portrait; margin: 8mm; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0; padding: 0; }
    .print-container { padding: 0; margin: 0; font-family: Arial, sans-serif; background-color: #fff; color: #000; }
    .print-table { width: 100%; border-collapse: collapse; font-size: 10px; border: 2px solid #000; }
    .print-table th, .print-table td { border: 1.5px solid #000; padding: 4px 8px; }
    .print-table th { background-color: #f0f0f0 !important; font-weight: bold; text-align: left; }
    .print-header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 12px; }
    .section-header { font-size: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; border-left: 4px solid #333; padding-left: 8px; margin: 12px 0 6px 0; }
    .page-break { page-break-before: always; }
    @media screen { .print-container { padding: 15px; } }
`;

const formatCurrency = (v) => `Rs.${Number(v || 0).toLocaleString('en-IN')}`;

const ConcessionReportPrint = forwardRef(({ data = [], filters = {} }, ref) => {
    // Sort data by voucherId ascending (e.g. 001, 002, 003...)
    const sortedData = [...data].sort((a, b) => {
        const vA = a.voucherId != null ? String(a.voucherId) : '';
        const vB = b.voucherId != null ? String(b.voucherId) : '';
        if (!vA && !vB) return 0;
        if (!vA) return 1;
        if (!vB) return -1;
        return vA.localeCompare(vB, undefined, { numeric: true, sensitivity: 'base' });
    });

    // Grouping data by approver (concessionGivenBy)
    const groupedData = sortedData.reduce((acc, item) => {
        const approver = item.concessionGivenBy || 'System / Management';
        if (!acc[approver]) acc[approver] = [];
        acc[approver].push(item);
        return acc;
    }, {});

    const totalConcession = sortedData.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);

    const formattedStartDate = filters.startDate
        ? (new Date(filters.startDate).toString() !== 'Invalid Date' 
            ? new Date(filters.startDate).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })
            : filters.startDate)
        : '-';
    const formattedEndDate = filters.endDate
        ? (new Date(filters.endDate).toString() !== 'Invalid Date'
            ? new Date(filters.endDate).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })
            : filters.endDate)
        : '-';

    const reportedBy = filters.reportedBy || filters.printedBy || filters.printedByName || '';

    return (
        <div ref={ref} className="print-container">
            <style dangerouslySetInnerHTML={{ __html: PRINT_STYLES }} />

            {/* Header */}
            <div className="print-header">
                <h1 style={{ fontSize: '20px', fontWeight: 'bold', margin: 0, textTransform: 'uppercase' }}>
                    FEE CONCESSION REPORT
                </h1>
                <p style={{ margin: '4px 0', fontSize: '13px', fontWeight: 'bold' }}>
                    PYDAH GROUP OF COLLEGES
                </p>
                <p style={{ margin: '4px 0', fontSize: '10px' }}>
                    Period: {formattedStartDate} to {formattedEndDate} {reportedBy ? ` | Reported By: ${reportedBy}` : ''}
                </p>
            </div>

            {/* Breakdown by Authorizing Authority */}
            {Object.keys(groupedData).length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px', fontSize: '12px', fontWeight: 'bold', color: '#666' }}>
                    No concession records found for the selected criteria.
                </div>
            ) : (
                Object.keys(groupedData).map((authorizer, idx) => {
                    const authorizerItems = groupedData[authorizer];
                    const authorizerSubtotal = authorizerItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);

                    return (
                        <div key={idx} style={{ marginBottom: '16px' }}>
                            <div className="section-header">
                                AUTHORIZING AUTHORITY: {authorizer} ({authorizerItems.length} Student{authorizerItems.length > 1 ? 's' : ''})
                            </div>
                            <table className="print-table">
                                <thead>
                                    <tr>
                                        <th style={{ width: '4%', textAlign: 'center' }}>S.No</th>
                                        <th style={{ width: '8%' }}>Voucher #</th>
                                        <th style={{ width: '10%' }}>Pin Number</th>
                                        <th style={{ width: '9%' }}>Admiss No</th>
                                        <th style={{ width: '18%' }}>Student Name</th>
                                        <th style={{ width: '30%' }}>College / Course</th>
                                        <th style={{ width: '11%' }}>Fee Head</th>
                                        <th style={{ width: '10%', textAlign: 'right' }}>Concession</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {authorizerItems.map((student, sIdx) => {
                                        const feeHeadName = typeof student.feeHead === 'object' ? student.feeHead?.name : (student.feeHead || 'Fee Concession');
                                        const courseBranch = [student.course, student.branch].filter(Boolean).join(' - ');
                                        return (
                                            <tr key={sIdx}>
                                                <td style={{ textAlign: 'center' }}>{sIdx + 1}</td>
                                                <td style={{ fontWeight: 'bold' }}>#{student.voucherId || '---'}</td>
                                                <td style={{ fontWeight: 'bold' }}>{student.pinNo || student.studentPin || '-'}</td>
                                                <td>{student.studentId || '-'}</td>
                                                <td style={{ fontWeight: 'bold' }}>{student.studentName || '-'}</td>
                                                <td>
                                                    <div style={{ fontWeight: 'bold', whiteSpace: 'nowrap' }}>{student.college || '-'}</div>
                                                    <div style={{ fontSize: '9px', color: '#444', whiteSpace: 'nowrap' }}>{courseBranch || '-'}</div>
                                                </td>
                                                <td>{feeHeadName}</td>
                                                <td style={{ textAlign: 'right', fontWeight: 'bold' }}>{formatCurrency(student.amount)}</td>
                                            </tr>
                                        );
                                    })}
                                    <tr style={{ backgroundColor: '#f0f0f0', fontWeight: 'bold' }}>
                                        <td colSpan="7" style={{ textAlign: 'right', textTransform: 'uppercase' }}>
                                            TOTAL FOR {authorizer}
                                        </td>
                                        <td style={{ textAlign: 'right' }}>
                                            {formatCurrency(authorizerSubtotal)}
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    );
                })
            )}

            {/* Signature Block */}
            <div style={{ marginTop: '35px', display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
                <div>Reported By: <strong>{reportedBy || '___________________'}</strong></div>
                <div>Verified By: ___________________</div>
                <div>Principal / Head of Finance</div>
            </div>
        </div>
    );
});

export default ConcessionReportPrint;

