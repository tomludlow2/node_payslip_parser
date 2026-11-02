function payslip(overrides = {}) {
  return {
    filename: "sample.pdf",
    demographics: {
      name: "SAMPLE PERSON",
      assignment_no: "12345",
      location: "Example Hospital",
    },
    job: { job_title: "Doctor", department: "Emergency medicine" },
    wage: { salary: "60000.00" },
    tax: { ni_number: "AA123456A" },
    pay_lines: [
      {
        Description: "Basic pay",
        Worked: "160",
        Paid: "160",
        Rate: "25",
        Amount: "4000.00",
      },
    ],
    deduction_lines: { PAYE: "800.00", Pension: "400.00" },
    this_period_summary: {
      total_payments: "4000.00",
      total_deductions: "1200.00",
      net_pay: "2800.00",
    },
    year_to_date: { gross_pay: "24000.00", tax_paid: "4800.00" },
    total_payments: "4000.00",
    total_deductions: "1200.00",
    net_pay: "2800.00",
    pay_date: "2026-10-24",
    ...overrides,
  };
}
module.exports = { payslip };
