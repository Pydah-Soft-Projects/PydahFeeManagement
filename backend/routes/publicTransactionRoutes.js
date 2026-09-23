const express = require('express');
const router = express.Router();
const Transaction = require('../models/Transaction');
const db = require('../config/sqlDb');

// @desc    Get Receipt Details by Receipt Number (Public verification endpoint)
// @route   GET /api/public/transactions/receipt/:receiptNumber
router.get('/receipt/:receiptNumber', async (req, res) => {
  try {
    const { receiptNumber } = req.params;

    // Find all active transactions sharing this receipt number (excluding transferred out items)
    let transactions = await Transaction.find({ receiptNumber, status: { $ne: 'transferred' } })
      .populate('feeHead', 'name')
      .sort({ createdAt: 1 });

    if (!transactions || transactions.length === 0) {
      transactions = await Transaction.find({ receiptNumber })
        .populate('feeHead', 'name')
        .sort({ createdAt: 1 });
    }

    if (!transactions || transactions.length === 0) {
      return res.status(404).json({ message: 'Receipt not found or invalid receipt number' });
    }

    const primary = transactions[0];

    // Find student details from MySQL using the studentId (admission_number) from transaction
    let student = null;
    try {
      const [rows] = await db.query(`SELECT * FROM students WHERE admission_number = ?`, [primary.studentId]);
      if (rows.length > 0) {
        student = rows[0];
      }
    } catch (sqlErr) {
      console.error('SQL error fetching student for public verification:', sqlErr);
    }

    res.json({
      receiptNumber,
      createdAt: primary.createdAt,
      paymentMode: primary.paymentMode,
      collectedByName: primary.collectedByName,
      studentId: primary.studentId,
      studentName: primary.studentName,
      student: student, // Detailed student info from SQL
      transactions: transactions
    });
  } catch (error) {
    console.error('Error verifying receipt:', error);
    res.status(500).json({ message: 'Server Error', error: error.message });
  }
});

module.exports = router;
