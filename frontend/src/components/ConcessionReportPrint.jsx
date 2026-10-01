import React, { forwardRef } from 'react';

const ConcessionReportPrint = forwardRef(({ data = [], filters = {} }, ref) => {
    // Grouping data by approver (concessionGivenBy)
    const groupedData = data.reduce((acc, item) => {
        const approver = item.concessionGivenBy || 'System / Management';
        if (!acc[approver]) acc[approver] = [];
        acc[approver].push(item);
        return acc;
    }, {});

    const totalConcession = data.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    const authorizersCount = Object.keys(groupedData).length;

    const formattedStartDate = filters.startDate ? new Date(filters.startDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'All Time';
    const formattedEndDate = filters.endDate ? new Date(filters.endDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Today';

    return (
        <div ref={ref} className="p-8 sm:p-10 bg-white font-sans text-slate-800 print:p-4" style={{ minHeight: '297mm' }}>
            {/* Main Institutional Header */}
            <div className="border-b-2 border-slate-900 pb-5 mb-6 text-center">
                <div className="flex items-center justify-between mb-2">
                    <div className="text-left">
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block">Pydah Educational Society</span>
                        <h1 className="text-xl font-black uppercase tracking-wider text-slate-900 leading-tight">
                            Pydah Group of Educational Institutions
                        </h1>
                    </div>
                    <div className="text-right">
                        <span className="bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-md">
                            Official Audit Document
                        </span>
                        <div className="text-[10px] font-bold text-slate-400 mt-1 font-mono">
                            REF: CON-REP-{new Date().getFullYear()}-{Math.floor(1000 + Math.random() * 9000)}
                        </div>
                    </div>
                </div>

                <div className="bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 text-white py-2 px-4 rounded-lg mt-3 flex justify-between items-center shadow-xs">
                    <span className="text-xs font-black uppercase tracking-wider">Fee Concession & Authorization Advice Report</span>
                    <span className="text-[10px] font-bold uppercase tracking-widest bg-white/20 px-2.5 py-0.5 rounded backdrop-blur-xs">
                        Status: {filters.status ? filters.status.toUpperCase() : 'APPROVED'}
                    </span>
                </div>
            </div>

            {/* Filter & Metadata Bar */}
            <div className="grid grid-cols-4 gap-3 bg-slate-50 border border-slate-200 rounded-xl p-3.5 mb-6 text-xs shadow-2xs">
                <div>
                    <span className="text-[9px] font-extrabold uppercase tracking-widest text-slate-400 block">Report Date Range</span>
                    <span className="font-bold text-slate-800 font-mono text-[11px]">{formattedStartDate} — {formattedEndDate}</span>
                </div>
                <div>
                    <span className="text-[9px] font-extrabold uppercase tracking-widest text-slate-400 block">Target Scope</span>
                    <span className="font-bold text-slate-800 truncate block">
                        {filters.college || 'All Colleges'} {filters.course ? `(${filters.course})` : ''}
                    </span>
                </div>
                <div>
                    <span className="text-[9px] font-extrabold uppercase tracking-widest text-slate-400 block">Beneficiaries</span>
                    <span className="font-extrabold text-blue-700 font-mono text-[11px]">{data.length} Students</span>
                </div>
                <div className="text-right">
                    <span className="text-[9px] font-extrabold uppercase tracking-widest text-slate-400 block">Total Sanctioned</span>
                    <span className="font-black text-emerald-700 text-sm font-sans">₹{totalConcession.toLocaleString('en-IN')}</span>
                </div>
            </div>

            {/* Authorizer Group Sections */}
            {Object.keys(groupedData).map((authorizer, idx) => {
                const authorizerItems = groupedData[authorizer];
                const authorizerSubtotal = authorizerItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);

                return (
                    <div key={idx} className="mb-8 break-inside-avoid">
                        {/* Section Header Banner */}
                        <div className="bg-slate-900 text-white p-3 px-4 rounded-t-xl flex justify-between items-center shadow-xs">
                            <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></div>
                                <h2 className="text-xs font-black uppercase tracking-wider">
                                    Authorizing Authority: <span className="text-emerald-300 ml-1">{authorizer}</span>
                                </h2>
                            </div>
                            <div className="flex items-center gap-3 text-[10px] font-extrabold">
                                <span className="bg-slate-800 px-2.5 py-1 rounded-md text-slate-300 border border-slate-700">
                                    {authorizerItems.length} Student{authorizerItems.length > 1 ? 's' : ''}
                                </span>
                                <span className="bg-emerald-500/20 text-emerald-300 px-2.5 py-1 rounded-md border border-emerald-500/30">
                                    Subtotal: ₹{authorizerSubtotal.toLocaleString('en-IN')}
                                </span>
                            </div>
                        </div>

                        {/* Authorizer Table */}
                        <div className="border border-slate-200 rounded-b-xl overflow-hidden shadow-2xs">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-slate-100 text-slate-600 text-[9px] font-black uppercase tracking-widest border-b border-slate-200">
                                        <th className="p-2.5 w-10 text-center">S.No</th>
                                        <th className="p-2.5 w-24">Voucher #</th>
                                        <th className="p-2.5 w-32">PIN / Adm No</th>
                                        <th className="p-2.5">Student Name</th>
                                        <th className="p-2.5">College / Course</th>
                                        <th className="p-2.5">Fee Component</th>
                                        <th className="p-2.5 text-right w-28">Concession (₹)</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 text-xs text-slate-800">
                                    {authorizerItems.map((student, sIdx) => {
                                        const feeHeadName = typeof student.feeHead === 'object' ? student.feeHead?.name : (student.feeHead || 'Fee Concession');
                                        return (
                                            <tr key={sIdx} className="hover:bg-slate-50/80 transition-colors">
                                                <td className="p-2.5 text-center text-[10px] font-bold text-slate-400">{sIdx + 1}</td>
                                                <td className="p-2.5 font-mono text-[10px] font-black text-slate-700">
                                                    <span className="bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                                                        #{student.voucherId || '---'}
                                                    </span>
                                                </td>
                                                <td className="p-2.5 font-mono font-bold text-[11px] text-slate-900">
                                                    {student.studentPin || student.studentId || 'N/A'}
                                                </td>
                                                <td className="p-2.5 font-bold text-slate-900">
                                                    {student.studentName}
                                                </td>
                                                <td className="p-2.5 text-[11px]">
                                                    <div className="font-semibold text-slate-800">{student.college || 'N/A'}</div>
                                                    <div className="text-[10px] text-slate-400 font-medium">{student.course} {student.branch ? `- ${student.branch}` : ''}</div>
                                                </td>
                                                <td className="p-2.5">
                                                    <span className="inline-block bg-indigo-50 text-indigo-700 text-[10px] font-extrabold px-2 py-0.5 rounded border border-indigo-100">
                                                        {feeHeadName}
                                                    </span>
                                                </td>
                                                <td className="p-2.5 font-black text-right text-slate-900">
                                                    ₹{(Number(student.amount) || 0).toLocaleString('en-IN')}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                                <tfoot>
                                    <tr className="bg-slate-50 border-t-2 border-slate-200 text-xs font-black text-slate-800">
                                        <td colSpan="6" className="p-2.5 text-right uppercase tracking-wider text-[10px] text-slate-500">
                                            Subtotal for {authorizer}
                                        </td>
                                        <td className="p-2.5 text-right text-emerald-800 font-extrabold text-sm">
                                            ₹{authorizerSubtotal.toLocaleString('en-IN')}
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>

                        {/* Signature block per Authorizer */}
                        <div className="mt-4 flex justify-between items-end px-2 pt-2">
                            <div className="text-[9px] text-slate-400 font-mono">
                                Remarks: {authorizerItems[0]?.reason ? `"${authorizerItems[0].reason}"` : 'Approved as per institutional guidelines.'}
                            </div>
                            <div className="text-center w-52">
                                <div className="border-b border-slate-400 mb-1"></div>
                                <span className="text-[9px] font-extrabold uppercase tracking-widest text-slate-600 block">
                                    Signature — {authorizer}
                                </span>
                            </div>
                        </div>
                    </div>
                );
            })}

            {/* Grand Total Aggregate Summary Banner */}
            <div className="mt-8 p-5 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-2xl flex justify-between items-center shadow-md print:shadow-none border border-slate-800">
                <div>
                    <span className="text-[9px] uppercase font-black tracking-widest text-indigo-300 block mb-0.5">Grand Total Sanctioned Concessions</span>
                    <div className="text-2xl font-black font-sans tracking-tight text-emerald-400">
                        ₹{totalConcession.toLocaleString('en-IN')}
                    </div>
                </div>
                <div className="flex gap-6 text-right">
                    <div>
                        <span className="text-[9px] uppercase font-black tracking-widest text-slate-400 block mb-0.5">Students Benefitted</span>
                        <div className="text-lg font-black text-white font-mono">{data.length}</div>
                    </div>
                    <div>
                        <span className="text-[9px] uppercase font-black tracking-widest text-slate-400 block mb-0.5">Authorizers</span>
                        <div className="text-lg font-black text-white font-mono">{authorizersCount}</div>
                    </div>
                </div>
            </div>

            {/* Footer */}
            <div className="mt-8 pt-4 border-t border-slate-200 flex justify-between items-center text-[9px] text-slate-400 font-medium">
                <span>Computer Generated Advice Report — Pydah Fee Management System</span>
                <span>Print Timestamp: {new Date().toLocaleString('en-IN')}</span>
            </div>

            <style dangerouslySetInnerHTML={{ __html: `
                @media print {
                    @page { size: A4; margin: 12mm; }
                    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                }
            ` }} />
        </div>
    );
});

export default ConcessionReportPrint;
