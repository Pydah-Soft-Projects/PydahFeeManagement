import React, { forwardRef } from 'react';

const ReceiptTemplate = forwardRef(({ transaction, transactions, relatedTransactions, student, totalDue, settings }, ref) => { // Accept settings
    // Determine the list of items to show (excluding transferred out transactions)
    let items = [];
    const list = relatedTransactions || transactions;
    if (list && list.length > 0) {
        const activeItems = list.filter(t => t.status !== 'transferred');
        items = activeItems.length > 0 ? activeItems : list;
    } else if (transaction) {
        items = [transaction];
    } else {
        return null;
    }

    const primary = items[0]; // Shared details
    const totalAmount = items.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);

    // Dynamic cell padding to ensure responsiveness to table length
    const cellPadding = items.length > 4 ? '3px 8px' : (items.length > 2 ? '4px 8px' : '5px 8px');
    const headerPadding = items.length > 4 ? '4px 8px' : '6px 8px';

    // Apply settings
    const showHeader = settings?.showCollegeHeader !== false; // Default true
    const maskedFeeHeads = settings?.maskedFeeHeads || [];
    const maskName = settings?.maskName || 'Processing Fee';

    // Configuration defaults if undefined
    const copies = settings?.copiesPerPage || 2;

    // Helper component for a single receipt copy
    const ReceiptOneCopy = ({ copyTitle, items, primary, totalAmount, cellPadding, headerPadding }) => (
        <div style={{
            padding: '3mm 6mm', // Compressed vertical and horizontal padding
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-start', // Remove vertical gap distribution, elements stack continuously
            boxSizing: 'border-box',
            fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            color: '#000' // Sharp black text for printing
        }}>
            {/* Header Section */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '6px', borderBottom: '3px solid #000', width: '100%', boxSizing: 'border-box' }}>
                {showHeader ? (
                    <>
                        {/* Left: Logo */}
                        <div style={{ width: '80px', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', flexShrink: 0 }}>
                            <img src="https://static.wixstatic.com/media/bfee2e_7d499a9b2c40442e85bb0fa99e7d5d37~mv2.png/v1/fill/w_162,h_89,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/logo1.png" alt="Logo" style={{ height: '46px', width: 'auto', objectFit: 'contain' }} />
                        </div>
                        
                        {/* Center: College Name */}
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '0 8px' }}>
                            <h1 style={{ 
                                fontFamily: "'Outfit', sans-serif", 
                                fontSize: '16.5px', 
                                fontWeight: '800', 
                                margin: 0, 
                                color: '#000',
                                textTransform: 'uppercase',
                                letterSpacing: '0.2px',
                                lineHeight: '1.6'
                            }}>
                                {student.college || 'PYDAH COLLEGE OF ENGINEERING'}
                            </h1>
                            <p style={{ fontSize: '8.5px', color: '#000', margin: '1px 0 0 0', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                Kakinada, Andhra Pradesh
                            </p>
                        </div>
                        
                        {/* Right: Fee Receipt label */}
                        <div style={{ width: '90px', textAlign: 'right', display: 'flex', flexDirection: 'column', justifyContent: 'center', flexShrink: 0 }}>
                            <h2 style={{ fontSize: '13.5px', fontWeight: '800', color: '#000', margin: 0, textTransform: 'uppercase', letterSpacing: '0.2px' }}>
                                Fee Receipt
                            </h2>
                            <p style={{ fontSize: '8.5px', color: '#000', fontWeight: '700', margin: '1px 0 0 0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                {copyTitle}
                            </p>
                        </div>
                    </>
                ) : (
                    <>
                        <div style={{ width: '80px', flexShrink: 0 }}>
                            <span style={{ fontSize: '9px', fontWeight: '700', color: '#000', textTransform: 'uppercase' }}>{copyTitle}</span>
                        </div>
                        <div style={{ flex: 1 }}></div>
                        <div style={{ width: '90px', textAlign: 'right', flexShrink: 0 }}>
                            <h2 style={{ fontSize: '13.5px', fontWeight: '800', color: '#000', margin: 0, textTransform: 'uppercase', letterSpacing: '0.2px' }}>
                                Fee Receipt
                            </h2>
                            <p style={{ fontSize: '8.5px', color: '#000', fontWeight: '700', margin: '1px 0 0 0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                {copyTitle}
                            </p>
                        </div>
                    </>
                )}
            </div>

            {/* Information Box (Ledger Style) */}
            <div style={{ 
                border: '2px solid #000', 
                borderRadius: '8px', 
                margin: '8px 0',
                fontSize: '9.5px',
                color: '#000',
                backgroundColor: '#ffffff',
                display: 'flex',
                justifyContent: 'space-between',
                padding: '6px 12px',
                boxSizing: 'border-box'
            }}>
                {/* Col 1 */}
                <div style={{ flex: '1 1 28%', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <svg style={{ width: '19px', height: '19px', flexShrink: 0 }} fill="currentColor" viewBox="0 0 24 24">
                            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM9 17a1 1 0 010-2h6a1 1 0 010 2H9zm0-4a1 1 0 010-2h6a1 1 0 010 2H9z" />
                        </svg>
                        <div>
                            <div style={{ fontSize: '7.5px', color: '#555', fontWeight: '600' }}>Receipt No.</div>
                            <strong style={{ fontSize: '10px' }}>{primary.receiptNumber}</strong>
                        </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <svg style={{ width: '19px', height: '19px', flexShrink: 0 }} fill="currentColor" viewBox="0 0 24 24">
                            <path d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2zm0 16H5V9h14v11zM7 11h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2zm-8 4h2v2H7zm4 0h2v2h-2z" />
                        </svg>
                        <div>
                            <div style={{ fontSize: '7.5px', color: '#555', fontWeight: '600' }}>Date</div>
                            <strong style={{ fontSize: '10px' }}>{new Date(primary.createdAt).toLocaleDateString('en-IN')}</strong>
                        </div>
                    </div>
                </div>

                {/* Divider */}
                <div style={{ borderLeft: '1.5px dashed #bbb', margin: '0 8px' }}></div>

                {/* Col 2 */}
                <div style={{ flex: '1 1 38%', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <svg style={{ width: '19px', height: '19px', flexShrink: 0 }} fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
                        </svg>
                        <div>
                            <div style={{ fontSize: '7.5px', color: '#555', fontWeight: '600' }}>Student Name</div>
                            <strong style={{ fontSize: '10px', textTransform: 'uppercase' }}>{student.student_name}</strong>
                        </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <svg style={{ width: '19px', height: '19px', flexShrink: 0 }} fill="currentColor" viewBox="0 0 24 24">
                            <path d="M20 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V6a2 2 0 00-2-2zm-8 3a3 3 0 110 6 3 3 0 010-6zm-5 10c0-1.657 2.239-3 5-3s5 1.343 5 3H7zm11-7h2v2h-2zm0-3h2v2h-2z" />
                        </svg>
                        <div>
                            <div style={{ fontSize: '7.5px', color: '#555', fontWeight: '600' }}>PIN / Roll No.</div>
                            <strong style={{ fontSize: '10px' }}>{student.pin_no || '-'}</strong>
                        </div>
                    </div>
                </div>

                {/* Divider */}
                <div style={{ borderLeft: '1.5px dashed #bbb', margin: '0 8px' }}></div>

                {/* Col 3 */}
                <div style={{ flex: '1 1 34%', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <svg style={{ width: '19px', height: '19px', flexShrink: 0 }} fill="currentColor" viewBox="0 0 24 24">
                            <path d="M17 2H7a2 2 0 00-2 2v18h14V4a2 2 0 00-2-2zM9 16H7v-2h2v2zm0-4H7v-2h2v2zm0-4H7V6h2v2zm4 8h-2v-2h2v2zm0-4h-2v-2h2v2zm0-4h-2V6h2v2zm4 8h-2v-2h2v2zm0-4h-2v-2h2v2zm0-4h-2V6h2v2z" />
                        </svg>
                        <div>
                            <div style={{ fontSize: '7.5px', color: '#555', fontWeight: '600' }}>Admission No.</div>
                            <strong style={{ fontSize: '10px' }}>{student.admission_number}</strong>
                        </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <svg style={{ width: '19px', height: '19px', flexShrink: 0 }} fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12 3L1 9l11 6 9-4.91V17h2V9L12 3zm-5 9.18V16l5 2.72L17 16v-3.82l-5 2.72-5-2.72z" />
                        </svg>
                        <div>
                            <div style={{ fontSize: '7.5px', color: '#555', fontWeight: '600' }}>Course / Branch</div>
                            <strong style={{ fontSize: '10px' }}>{student.course} - {student.branch}</strong>
                        </div>
                    </div>
                </div>
            </div>

            {/* Fees Table */}
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-start' }}>
                <div style={{ border: '2px solid #000', borderRadius: '8px', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px', color: '#000' }}>
                        <thead>
                            <tr style={{ backgroundColor: '#f3f4f6', color: '#000000' }}>
                                <th style={{ padding: headerPadding, textAlign: 'center', fontWeight: '700', width: '45px', borderRight: '1.5px solid #000', borderBottom: '2px solid #000' }}>S.No</th>
                                <th style={{ padding: headerPadding, textAlign: 'left', fontWeight: '700', borderRight: '1.5px solid #000', borderBottom: '2px solid #000' }}>Particulars / Fee Description</th>
                                <th style={{ padding: headerPadding, textAlign: 'right', fontWeight: '700', width: '110px', borderBottom: '2px solid #000' }}>Amount (₹)</th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.map((item, index) => {
                                const feeHeadId = item.feeHead?._id || item.feeHead;
                                const isMasked = maskedFeeHeads.includes(feeHeadId);
                                const displayName = isMasked ? maskName : (item.feeHead?.name || 'Fee');

                                return (
                                    <tr key={index} style={{ borderBottom: '1.5px solid #000' }}>
                                        <td style={{ padding: cellPadding, textAlign: 'center', borderRight: '1.5px solid #000', fontWeight: '500' }}>{index + 1}</td>
                                        <td style={{ padding: cellPadding, borderRight: '1.5px solid #000' }}>
                                            <div style={{ fontWeight: '700' }}>{displayName}</div>
                                            {item.remarks && <div style={{ fontSize: '8px', fontStyle: 'italic', color: '#333', marginTop: '1px' }}>{item.remarks}</div>}
                                        </td>
                                        <td style={{ padding: cellPadding, textAlign: 'right', fontWeight: '700', fontSize: '10.5px' }}>{item.amount.toLocaleString('en-IN')}</td>
                                    </tr>
                                );
                            })}

                            {/* TOTAL Row */}
                            <tr style={{ backgroundColor: '#ffffff', fontWeight: '800', borderTop: '2px solid #000' }}>
                                <td colSpan="2" style={{ padding: cellPadding, textAlign: 'right', borderRight: '1.5px solid #000', fontSize: '10.5px', letterSpacing: '0.2px' }}>TOTAL AMOUNT PAID</td>
                                <td style={{ padding: cellPadding, textAlign: 'right', fontSize: '12px', fontWeight: '900' }}>₹{totalAmount.toLocaleString('en-IN')}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                {/* Outstanding Dues */}
                {(totalDue !== undefined && totalDue !== null) && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', fontSize: '9px', marginTop: '4px', color: '#000', fontWeight: '700' }}>
                        <span style={{ fontStyle: 'italic' }}>Total Outstanding Due</span>
                        <span>₹{Number(totalDue).toLocaleString('en-IN')}</span>
                    </div>
                )}
            </div>

            {/* Footer Elements (Verification, Signature & Info) */}
            <div style={{ marginTop: '25px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxSizing: 'border-box', width: '100%' }}>
                {/* Left side: QR Code Verification Box */}
                <div style={{ border: '1.5px solid #000', borderRadius: '8px', padding: '6px 10px', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                    <img src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(`${typeof window !== 'undefined' ? window.location.origin : ''}/public/verify-receipt/${primary.receiptNumber}`)}`} alt="QR" style={{ width: '48px', height: '48px' }} />
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <div style={{ fontSize: '7.5px', fontWeight: '800', color: '#000' }}>SCAN TO VERIFY</div>
                        <div style={{ fontSize: '7px', color: '#555', marginTop: '1px' }}>Receipt No.</div>
                        <strong style={{ fontSize: '8px', color: '#000' }}>{primary.receiptNumber}</strong>
                    </div>
                </div>

                {/* Dotted Divider */}
                <div style={{ borderLeft: '1.5px dotted #000', height: '36px', margin: '0 4px', flexShrink: 0 }}></div>

                {/* Payment Mode */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center', flex: '1 1 0%' }}>
                    <div style={{ border: '1.5px solid #000', borderRadius: '50%', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <span style={{ fontSize: '12.5px', fontWeight: '800' }}>₹</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <div style={{ fontSize: '7px', color: '#555', fontWeight: '500', lineHeight: '1.1' }}>Payment Mode</div>
                        <strong style={{ fontSize: '8.5px', color: '#000', marginTop: '1px' }}>{items[0].paymentMode}</strong>
                    </div>
                </div>

                {/* Dotted Divider */}
                <div style={{ borderLeft: '1.5px dotted #000', height: '36px', margin: '0 4px', flexShrink: 0 }}></div>

                {/* Generated On */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center', flex: '1.3 1 0%' }}>
                    <svg style={{ width: '24px', height: '24px', flexShrink: 0 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <div style={{ fontSize: '7px', color: '#555', fontWeight: '500', lineHeight: '1.1' }}>Generated On</div>
                        <strong style={{ fontSize: '8.5px', color: '#000', marginTop: '1px', whiteSpace: 'nowrap' }}>
                            {new Date().toLocaleDateString('en-IN')} {new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                        </strong>
                    </div>
                </div>

                {/* Dotted Divider */}
                <div style={{ borderLeft: '1.5px dotted #000', height: '36px', margin: '0 4px', flexShrink: 0 }}></div>

                {/* Verified */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center', flex: '1 1 0%' }}>
                    <svg style={{ width: '24px', height: '24px', flexShrink: 0 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <div style={{ fontSize: '7px', color: '#555', fontWeight: '500', lineHeight: '1.1' }}>Verified</div>
                        <strong style={{ fontSize: '8.5px', color: '#000', marginTop: '1px' }}>Officially Verified</strong>
                    </div>
                </div>

                {/* Solid Separator */}
                <div style={{ borderLeft: '2px solid #000', height: '50px', margin: '0 10px', flexShrink: 0 }}></div>

                {/* Right side: Authorized Signatory */}
                <div style={{ textAlign: 'center', width: '150px', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end' }}>
                    <div style={{ height: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {/* Space for signature */}
                    </div>
                    <div style={{ width: '100%', borderTop: '1.5px solid #000', marginTop: '4px', paddingTop: '2px' }}>
                        <p style={{ fontSize: '9.5px', fontWeight: '800', color: '#000', margin: '0 0 1px 0', textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {primary.collectedByName || 'PADALA AJAYAKUMAR'}
                        </p>
                        <p style={{ fontSize: '7.5px', color: '#555', fontWeight: '600', margin: 0 }}>
                            Authorized Signatory
                        </p>
                    </div>
                </div>
            </div>

            {/* Note & Branding Line */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '7.5px', color: '#000', marginTop: '10px', marginBottom: '2px' }}>
                <span style={{ fontStyle: 'italic', fontWeight: '500' }}>Note: Please preserve this receipt for future reference.</span>
            </div>

            {/* Contact Details Bottom Bar */}
            <div style={{ borderTop: '1.5px solid #000', paddingTop: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '7.5px', color: '#000', fontWeight: '600', marginTop: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                    <svg style={{ width: '13px', height: '13px', flexShrink: 0 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <span>Kakinada, Andhra Pradesh - 533003</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: '700', textTransform: 'uppercase', color: '#000', fontSize: '7.5px', letterSpacing: '0.3px' }}>
                    {/* Computer / Software icon */}
                    <svg style={{ width: '11px', height: '11px', flexShrink: 0 }} fill="currentColor" viewBox="0 0 24 24">
                        <path d="M20 3H4a2 2 0 00-2 2v11a2 2 0 002 2h7v2H8v2h8v-2h-3v-2h7a2 2 0 002-2V5a2 2 0 00-2-2zm0 13H4V5h16v11z" />
                    </svg>
                    Powered by PydahSoft
                    {/* Lightning bolt / power icon */}
                    {/* <svg style={{ width: '10px', height: '10px', flexShrink: 0 }} fill="currentColor" viewBox="0 0 24 24">
                        <path d="M11 21h-1l1-7H7.5c-.58 0-.57-.32-.38-.66.19-.34.05-.08.07-.12C8.48 10.94 10.42 7.54 13 3h1l-1 7h3.5c.49 0 .56.33.47.51l-.07.15L11 21z" />
                    </svg> */}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                    <svg style={{ width: '13px', height: '13px', flexShrink: 0 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                    </svg>
                    <span>www.pydah.edu.in</span>
                </div>
            </div>
        </div>
    );

    // Configuration defaults if undefined
    const paperSizeStr = settings?.paperSize || 'A4';
    const orientation = (settings?.orientation || 'portrait').toString().toLowerCase();

    // Determine layout variables
    // If paperSize is set to 'A5' or 'auto', let the browser offer native dialog options.
    // Otherwise include orientation (e.g. 'A4 landscape') which modern browsers understand for @page.
    let pageCssSize;
    if (paperSizeStr === 'A5' || paperSizeStr === 'auto') {
        pageCssSize = 'auto';
    } else {
        pageCssSize = paperSizeStr + (orientation === 'landscape' ? ' landscape' : '');
    }

    // For container heights in percentages to prevent page-overflow in print media
    const copyHeight = copies === 1 ? '100%' : '49%';

    // Group items by receiptNumber to print separate pages per receipt number
    const groupedReceipts = {};
    items.forEach(item => {
        const rn = item.receiptNumber || 'TEMP';
        if (!groupedReceipts[rn]) {
            groupedReceipts[rn] = [];
        }
        groupedReceipts[rn].push(item);
    });
    const receiptGroups = Object.values(groupedReceipts);

    return (
        <div ref={ref} style={{
            width: '100%',
            backgroundColor: 'white',
            fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            color: '#000',
            margin: '0 auto',
            boxSizing: 'border-box'
        }}>
            <style type="text/css">
                {`
                    @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@800&family=Inter:wght@400;500;600;700;800&display=swap');
                `}
            </style>
            <style type="text/css" media="print">
                {`
                    @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@800&family=Inter:wght@400;500;600;700;800&display=swap');
                    @page { size: ${pageCssSize}; margin: 5mm; }
                    html, body { -webkit-print-color-adjust: exact; margin: 0; padding: 0; }
                    .receipt-page { page-break-after: always; height: 100vh; display: flex; flex-direction: column; justify-content: space-between; box-sizing: border-box; }
                    .receipt-page:last-child { page-break-after: avoid; }
                `}
            </style>

            {receiptGroups.map((groupItems, groupIndex) => {
                const groupPrimary = groupItems[0];
                const groupTotalAmount = groupItems.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
                const groupCellPadding = groupItems.length > 4 ? '3px 8px' : (groupItems.length > 2 ? '4px 8px' : '5px 8px');
                const groupHeaderPadding = groupItems.length > 4 ? '4px 8px' : '6px 8px';

                return (
                    <div key={groupIndex} className="receipt-page">
                        {/* Copy 1: Student Copy */}
                        <div style={{ height: copyHeight, position: 'relative', boxSizing: 'border-box' }}>
                            <ReceiptOneCopy 
                                copyTitle="STUDENT COPY" 
                                items={groupItems}
                                primary={groupPrimary}
                                totalAmount={groupTotalAmount}
                                cellPadding={groupCellPadding}
                                headerPadding={groupHeaderPadding}
                            />

                            {/* Dotted Separator Line (Only show if we have a second copy below) */}
                            {copies === 2 && (
                                <div style={{
                                    position: 'absolute',
                                    bottom: 0,
                                    left: '20px',
                                    right: '20px',
                                    borderBottom: '2px dashed #000'
                                }}></div>
                            )}
                        </div>

                        {/* Copy 2: Office Copy (Only if requested) */}
                        {copies === 2 && (
                            <div style={{ height: copyHeight, paddingTop: '15px', boxSizing: 'border-box' }}>
                                <ReceiptOneCopy 
                                    copyTitle="OFFICE COPY" 
                                    items={groupItems}
                                    primary={groupPrimary}
                                    totalAmount={groupTotalAmount}
                                    cellPadding={groupCellPadding}
                                    headerPadding={groupHeaderPadding}
                                />
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
});

export default ReceiptTemplate;
