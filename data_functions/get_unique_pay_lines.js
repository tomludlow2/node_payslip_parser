require('dotenv').config({ path: '../.env' }); // Adjust path to your .env file
const { Pool } = require('pg');
const pool = require('../database'); // Assuming database.js is in the same directory

async function getUniqueDescriptions() {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT DISTINCT jsonb_array_elements(pay_lines)->>'Description' AS description
      FROM public.payslips
      WHERE jsonb_typeof(pay_lines) = 'array' -- Ensure pay_lines is an array
    `);

    // Collect unique descriptions
    const descriptions = result.rows.map(row => row.description);
    const uniqueDescriptions = [...new Set(descriptions)];

    console.log('Unique Descriptions:');
    uniqueDescriptions.forEach(desc => console.log(desc));

  } catch (error) {
    console.error('Error executing query', error.stack);
  } finally {
    client.release();
  }
}

//getUniqueDescriptions().catch(console.error);


// Define the mapping function
function mapDescriptionToCategory(description) {
  // Normalize the description to lower case for case-insensitive matching
  const desc = description.toLowerCase().trim();

  // Define the mapping rules
  if (desc.startsWith('addnroster')) {
    return 'Additional Hours';
  }
  if (desc.includes('miles')) {
    return 'Expenses';
  }
  if (desc.endsWith('arrs')) {
    return 'Arrears';
  }
  if (desc === 'basicpay' || desc === 'addbasicpay') {
    return 'Basic Pay';
  }
  if (desc === 'nightduty37%') {
    return 'Night Pay';
  }
  if (desc.startsWith('weekend')) {
    return 'Weekend Pay';
  }
  if (desc.includes('travel') || desc.includes('expenses')) {
    return 'Expenses';
  }
  return 'Other';
}

// List of unique descriptions
const descriptions = [
  'AddnRosterHoursNP',
  'NightDuty37%Arrs',
  'AddnRosHrsNPArrs',
  'BusinessMilesTASNT',
  'Weekend<1in3-1Arrs',
  'Weekend<1in4-1Arrs',
  '157AddPayment',
  'CourseExpenses',
  'Weekend<1in2-1in4',
  'AddBasicPay',
  'ExcessTravelNPNT',
  'Weekend<1in4-1in5',
  'NightDuty37%',
  'AddnRosterNRNP',
  'Weekend<1in2-1Arrs',
  'BasicPayArrs',
  '157AdditionalHours',
  'MiscTravelNPNT',
  'Weekend<1in2-1in3',
  'BasicPay',
  'ExpensesNPNTNNI',
  'Weekend<1in3-1in4',
];

// Map each description to its category
const categorizedDescriptions = descriptions.map(description => ({
  description,
  category: mapDescriptionToCategory(description)
}));

// Print out the categorized descriptions
console.log('Categorized Descriptions:');
categorizedDescriptions.forEach(({ description, category }) => {
  console.log(`${description}: ${category}`);
});
