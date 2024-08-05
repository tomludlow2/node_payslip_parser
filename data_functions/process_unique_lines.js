const fs = require('fs');
const readline = require('readline');

// Define the mapping function
function mapDescriptionToCategory(description) {
  const desc = description.toLowerCase().trim();
  if (desc.startsWith('addnroster')) return 'Additional Hours';
  if (desc.includes('miles')) return 'Expenses';
  if (desc.endsWith('arrs')) return 'Arrears';
  if (desc === 'basicpay' || desc === 'addbasicpay') return 'Basic Pay';
  if (desc === 'nightduty37%') return 'Night Pay';
  if (desc.startsWith('weekend')) return 'Weekend Pay';
  if (desc.includes('travel') || desc.includes('expenses')) return 'Expenses';
  return 'Other';
}

// Define available categories
const categories = ['Basic Pay', 'Additional Hours', 'Weekend Pay', 'Night Pay', 'Expenses', 'Arrears', 'Other'];

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Function to prompt the user
function askQuestion(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

// Function to get category from user
async function getCategoryFromUser(description) {
  const predictedCategory = mapDescriptionToCategory(description);
  console.log(`Description: ${description}`);
  console.log(`Predicted Category: ${predictedCategory}`);
  console.log('Is this correct? (Y/N)');

  const answer = await askQuestion('> ');

  if (answer.toLowerCase() === 'y') {
    return predictedCategory;
  } else {
    console.log('Please choose the correct category from the list below:');
    categories.forEach((cat, index) => console.log(`${index + 1}: ${cat}`));

    const choice = await askQuestion('> ');
    const index = parseInt(choice, 10) - 1;

    if (index >= 0 && index < categories.length) {
      return categories[index];
    } else {
      console.log('Invalid choice. Defaulting to Other.');
      return 'Other';
    }
  }
}

// Main function to categorize descriptions
async function categorizeDescriptions(descriptions) {
  const finalCategories = {};

  for (const description of descriptions) {
    const category = await getCategoryFromUser(description);
    finalCategories[description] = category;
    console.log(`Final Category for "${description}": ${category}`);
    console.log(''); // For spacing
  }

  // Save the final categories to a JSON file
  fs.writeFileSync('categories.json', JSON.stringify(finalCategories, null, 2));
  console.log('Category mapping has been saved to categories.json');
  rl.close();
}

// List of unique descriptions (example data)
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

// Run the categorization process
categorizeDescriptions(descriptions).catch(console.error);
